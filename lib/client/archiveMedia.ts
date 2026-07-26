"use client";

export type ArchiveImportPage = {
  id: string;
  index: number;
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

let configuredPdfJs:
  | Promise<typeof import("pdfjs-dist/legacy/build/pdf.mjs")>
  | null = null;

export async function renderArchivePdfPages(
  file: File,
  onProgress?: (current: number, total: number) => void
): Promise<ArchiveImportPage[]> {
  const pdfjs = await loadPdfJs();
  const document = await pdfjs.getDocument({ data: await file.arrayBuffer() }).promise;
  const pages: ArchiveImportPage[] = [];
  try {
    for (let pageIndex = 0; pageIndex < document.numPages; pageIndex += 1) {
      const page = await document.getPage(pageIndex + 1);
      const baseViewport = page.getViewport({ scale: 1 });
      const scale = Math.min(1.6, 1600 / Math.max(baseViewport.width, baseViewport.height));
      const viewport = page.getViewport({ scale: Math.max(1, scale) });
      const canvas = documentCanvas(viewport.width, viewport.height);
      const context = canvas.getContext("2d", { alpha: false });
      if (!context) throw new Error("PDF 페이지 캔버스를 준비하지 못했습니다.");
      await page.render({ canvas, canvasContext: context, viewport }).promise;
      const blob = await canvasBlob(canvas, "image/jpeg", 0.9);
      pages.push({
        id: `pdf-${pageIndex}`,
        index: pageIndex,
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
  return Promise.all(files.map(async (file, index) => {
    const url = URL.createObjectURL(file);
    try {
      const image = await loadImage(url);
      return {
        id: `image-${index}-${file.lastModified}`,
        index,
        name: file.name,
        width: image.naturalWidth,
        height: image.naturalHeight,
        previewUrl: url,
        blob: file,
        originalFile: file
      };
    } catch (error) {
      URL.revokeObjectURL(url);
      throw error;
    }
  }));
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
  const canvas = documentCanvas(sourceWidth, sourceHeight);
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
    sourceWidth,
    sourceHeight
  );
  const blob = await canvasBlob(canvas, "image/jpeg", 0.92);
  return new File([blob], ensureJpegName(filename), { type: "image/jpeg" });
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
