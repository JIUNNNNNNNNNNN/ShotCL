"use client";

export type ArchiveImportPage = {
  id: string;
  index: number;
  sourceFileIndex: number;
  name: string;
  width: number;
  height: number;
  previewUrl: string;
  blob: Blob;
  originalFile?: File;
};

export type RelativeCrop = {
  x: number;
  y: number;
  width: number;
  height: number;
};

export type StoryboardCropCandidate = {
  id: string;
  page: ArchiveImportPage;
  crop: RelativeCrop;
};

export type StoryboardCropTemplate = {
  basePageWidth: number;
  basePageHeight: number;
  cropWidth: number;
  cropHeight: number;
  aspectRatio: number;
  clickPlacementMode: "center";
  targetColumn: "storyboard";
  includeContext: false;
};

export type OptimizedArchiveImage = {
  displayFile: File;
  thumbnailFile: File;
};

const ARCHIVE_DISPLAY_MAX_SIDE = 1600;
const ARCHIVE_THUMBNAIL_MAX_SIDE = 420;
const ARCHIVE_DISPLAY_QUALITY = 0.78;
const ARCHIVE_THUMBNAIL_QUALITY = 0.72;

let configuredPdfJs:
  | Promise<typeof import("pdfjs-dist/legacy/build/pdf.mjs")>
  | null = null;

export async function renderArchivePdfPages(
  file: File,
  onProgress?: (current: number, total: number) => void,
  sourceFileIndex = 0
): Promise<ArchiveImportPage[]> {
  const pdfjs = await loadPdfJs();
  const document = await pdfjs.getDocument({ data: await file.arrayBuffer() }).promise;
  const pages: ArchiveImportPage[] = [];
  try {
    for (let pageIndex = 0; pageIndex < document.numPages; pageIndex += 1) {
      const page = await document.getPage(pageIndex + 1);
      const baseViewport = page.getViewport({ scale: 1 });
      const scale = Math.min(1.35, 1440 / Math.max(baseViewport.width, baseViewport.height));
      const viewport = page.getViewport({ scale: Math.max(0.85, scale) });
      const canvas = documentCanvas(viewport.width, viewport.height);
      const context = canvas.getContext("2d", { alpha: false });
      if (!context) throw new Error("PDF 페이지 캔버스를 준비하지 못했습니다.");
      await page.render({ canvas, canvasContext: context, viewport }).promise;
      const blob = await canvasBlob(canvas, "image/jpeg", ARCHIVE_DISPLAY_QUALITY);
      pages.push({
        id: `pdf-${sourceFileIndex}-${pageIndex}`,
        index: pageIndex,
        sourceFileIndex,
        name: `${stripExtension(file.name)}-${pageIndex + 1}.jpg`,
        width: canvas.width,
        height: canvas.height,
        previewUrl: URL.createObjectURL(blob),
        blob
      });
      page.cleanup();
      onProgress?.(pageIndex + 1, document.numPages);
    }
    return pages;
  } finally {
    await document.cleanup();
  }
}

export async function loadArchiveImagePages(files: File[]): Promise<ArchiveImportPage[]> {
  return mapWithConcurrency(files, 3, async (file, index) => {
    const optimized = await optimizeArchiveImage(file);
    const url = URL.createObjectURL(optimized.displayFile);
    try {
      const image = await loadImage(url);
      return {
        id: `image-${index}-${file.lastModified}`,
        index,
        sourceFileIndex: index,
        name: optimized.displayFile.name,
        width: image.naturalWidth,
        height: image.naturalHeight,
        previewUrl: url,
        blob: optimized.displayFile,
        originalFile: file
      };
    } catch (error) {
      URL.revokeObjectURL(url);
      throw error;
    }
  });
}

export function createStoryboardCropTemplate(
  page: ArchiveImportPage,
  crop: RelativeCrop
): StoryboardCropTemplate {
  const safeCrop = normalizeRelativeCrop(crop);
  return {
    basePageWidth: page.width,
    basePageHeight: page.height,
    cropWidth: safeCrop.width,
    cropHeight: safeCrop.height,
    aspectRatio: safeCrop.height > 0 ? safeCrop.width / safeCrop.height : 1,
    clickPlacementMode: "center",
    targetColumn: "storyboard",
    includeContext: false
  };
}

export function createCenteredStoryboardCrop(
  template: StoryboardCropTemplate,
  centerX: number,
  centerY: number
): RelativeCrop {
  const width = Math.min(1, Math.max(0.01, template.cropWidth));
  const height = Math.min(1, Math.max(0.01, template.cropHeight));
  return {
    x: Math.min(1 - width, Math.max(0, centerX - width / 2)),
    y: Math.min(1 - height, Math.max(0, centerY - height / 2)),
    width,
    height
  };
}

export async function createCroppedArchiveFile(
  page: ArchiveImportPage,
  crop: RelativeCrop,
  filename: string
) {
  const image = await loadImage(page.previewUrl);
  const sourceX = Math.round(clamp(crop.x) * image.naturalWidth);
  const sourceY = Math.round(clamp(crop.y) * image.naturalHeight);
  const sourceWidth = Math.max(1, Math.round(clamp(crop.width, 0.01) * image.naturalWidth));
  const sourceHeight = Math.max(1, Math.round(clamp(crop.height, 0.01) * image.naturalHeight));
  const targetScale = Math.min(1, ARCHIVE_DISPLAY_MAX_SIDE / Math.max(sourceWidth, sourceHeight));
  const targetWidth = Math.max(1, Math.round(sourceWidth * targetScale));
  const targetHeight = Math.max(1, Math.round(sourceHeight * targetScale));
  const canvas = documentCanvas(targetWidth, targetHeight);
  const context = canvas.getContext("2d", { alpha: false });
  if (!context) throw new Error("crop 캔버스를 준비하지 못했습니다.");
  context.drawImage(
    image,
    sourceX,
    sourceY,
    Math.min(sourceWidth, image.naturalWidth - sourceX),
    Math.min(sourceHeight, image.naturalHeight - sourceY),
    0,
    0,
    targetWidth,
    targetHeight
  );
  const blob = await canvasBlob(canvas, "image/jpeg", ARCHIVE_DISPLAY_QUALITY);
  return new File([blob], ensureJpegName(filename), { type: "image/jpeg" });
}

export async function optimizeArchiveImage(file: File): Promise<OptimizedArchiveImage> {
  const sourceUrl = URL.createObjectURL(file);
  try {
    const image = await loadImage(sourceUrl);
    const displayBlob = await resizeImage(
      image,
      ARCHIVE_DISPLAY_MAX_SIDE,
      ARCHIVE_DISPLAY_QUALITY
    );
    const thumbnailBlob = await resizeImage(
      image,
      ARCHIVE_THUMBNAIL_MAX_SIDE,
      ARCHIVE_THUMBNAIL_QUALITY
    );
    return {
      displayFile: new File([displayBlob], ensureJpegName(file.name), { type: "image/jpeg" }),
      thumbnailFile: new File([thumbnailBlob], `${stripExtension(file.name)}-thumb.jpg`, { type: "image/jpeg" })
    };
  } finally {
    URL.revokeObjectURL(sourceUrl);
  }
}

export async function createArchiveThumbnail(file: File) {
  const sourceUrl = URL.createObjectURL(file);
  try {
    const image = await loadImage(sourceUrl);
    const blob = await resizeImage(image, ARCHIVE_THUMBNAIL_MAX_SIDE, ARCHIVE_THUMBNAIL_QUALITY);
    return new File([blob], `${stripExtension(file.name)}-thumb.jpg`, { type: "image/jpeg" });
  } finally {
    URL.revokeObjectURL(sourceUrl);
  }
}

export function releaseArchivePages(pages: ArchiveImportPage[]) {
  pages.forEach((page) => URL.revokeObjectURL(page.previewUrl));
}

function documentCanvas(width: number, height: number) {
  const canvas = document.createElement("canvas");
  canvas.width = Math.max(1, Math.round(width));
  canvas.height = Math.max(1, Math.round(height));
  return canvas;
}

function canvasBlob(canvas: HTMLCanvasElement, type: string, quality: number) {
  return new Promise<Blob>((resolve, reject) => {
    canvas.toBlob((blob) => {
      if (blob) resolve(blob);
      else reject(new Error("이미지 파일을 만들지 못했습니다."));
    }, type, quality);
  });
}

async function resizeImage(image: HTMLImageElement, maxSide: number, quality: number) {
  const scale = Math.min(1, maxSide / Math.max(image.naturalWidth, image.naturalHeight));
  const canvas = documentCanvas(image.naturalWidth * scale, image.naturalHeight * scale);
  const context = canvas.getContext("2d", { alpha: false });
  if (!context) throw new Error("이미지 최적화 캔버스를 준비하지 못했습니다.");
  context.fillStyle = "#ffffff";
  context.fillRect(0, 0, canvas.width, canvas.height);
  context.drawImage(image, 0, 0, canvas.width, canvas.height);
  return canvasBlob(canvas, "image/jpeg", quality);
}

function loadImage(url: string) {
  return new Promise<HTMLImageElement>((resolve, reject) => {
    const image = new Image();
    image.onload = () => resolve(image);
    image.onerror = () => reject(new Error("이미지를 읽지 못했습니다."));
    image.src = url;
  });
}

function stripExtension(value: string) {
  return value.replace(/\.[^.]+$/, "") || "page";
}

function ensureJpegName(value: string) {
  return `${stripExtension(value)}.jpg`;
}

function clamp(value: number, min = 0) {
  return Math.min(1, Math.max(min, Number.isFinite(value) ? value : min));
}

function normalizeRelativeCrop(value: RelativeCrop): RelativeCrop {
  const x = clamp(value.x);
  const y = clamp(value.y);
  return {
    x,
    y,
    width: Math.min(1 - x, clamp(value.width, 0.01)),
    height: Math.min(1 - y, clamp(value.height, 0.01))
  };
}

export async function mapWithConcurrency<T, R>(
  values: T[],
  concurrency: number,
  worker: (value: T, index: number) => Promise<R>
) {
  const results = new Array<R>(values.length);
  let nextIndex = 0;
  async function run() {
    while (nextIndex < values.length) {
      const index = nextIndex;
      nextIndex += 1;
      results[index] = await worker(values[index], index);
    }
  }
  await Promise.all(Array.from({ length: Math.min(Math.max(1, concurrency), values.length) }, run));
  return results;
}

async function loadPdfJs() {
  if (!configuredPdfJs) {
    configuredPdfJs = import("pdfjs-dist/legacy/build/pdf.mjs").then((pdfjs) => {
      pdfjs.GlobalWorkerOptions.workerSrc = new URL(
        "pdfjs-dist/legacy/build/pdf.worker.min.mjs",
        import.meta.url
      ).toString();
      return pdfjs;
    });
  }
  return configuredPdfJs;
}
