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

export type ArchiveCropSourceKind = "pdf" | "image";

export type ArchiveCropSource = {
  kind: ArchiveCropSourceKind;
  sourceAssetId: string | null;
  file: File;
  pageCount: number;
  pages: ArchiveImportPage[];
};

export type CreateArchiveCropSourceOptions = {
  sourceAssetId?: string | null;
  onProgress?: (current: number, total: number) => void;
};

export type ArchiveCropSourceDescriptor = {
  type?: string | null;
  name?: string | null;
  mimeType?: string | null;
  filename?: string | null;
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
  templateId: string;
  rowIndex: number;
  columnIndex: number;
  cellKey: string;
  manuallyPositioned: boolean;
  customSize: boolean;
};

export type StoryboardGridOrigin = {
  x: number;
  y: number;
};

export type StoryboardGridCell = {
  key: string;
  templateId: string;
  rowIndex: number;
  columnIndex: number;
  crop: RelativeCrop;
};

export type StoryboardCropTemplate = {
  templateId: string;
  basePageWidth: number;
  basePageHeight: number;
  pageNativeWidth: number;
  pageNativeHeight: number;
  templateWidth: number;
  templateHeight: number;
  templateX: number;
  templateY: number;
  columnOriginX: number;
  rowOriginY: number;
  horizontalGap: number;
  verticalGap: number;
  cropWidth: number;
  cropHeight: number;
  aspectRatio: number;
  columnX: number;
  rowAnchorCenterY: number;
  rowStep: number;
  rowsPerPage: number;
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

export function detectArchiveCropSourceKind(
  source: ArchiveCropSourceDescriptor
): ArchiveCropSourceKind | null {
  const mimeType = String(source.type ?? source.mimeType ?? "").trim().toLowerCase();
  const filename = String(source.name ?? source.filename ?? "").trim();
  if (mimeType === "application/pdf" || /\.pdf$/i.test(filename)) return "pdf";
  if (
    /^(?:image\/jpeg|image\/png|image\/webp)$/i.test(mimeType)
    || /\.(?:jpe?g|png|webp)$/i.test(filename)
  ) {
    return "image";
  }
  return null;
}

export async function createArchiveCropSource(
  file: File,
  options: CreateArchiveCropSourceOptions = {}
): Promise<ArchiveCropSource> {
  const kind = detectArchiveCropSourceKind(file);
  if (!kind) {
    throw new Error("PDF, JPG, JPEG, PNG 또는 WebP 파일만 crop할 수 있습니다.");
  }
  const pages = kind === "pdf"
    ? await renderArchivePdfPages(file, options.onProgress, 0)
    : await loadArchiveImagePages([file]);
  if (kind === "image") options.onProgress?.(pages.length, pages.length);
  if (pages.length === 0) throw new Error("crop할 페이지나 이미지를 읽지 못했습니다.");
  return {
    kind,
    sourceAssetId: options.sourceAssetId?.trim() || null,
    file,
    pageCount: pages.length,
    pages
  };
}

export async function renderArchivePdfPages(
  file: File,
  onProgress?: (current: number, total: number) => void,
  sourceFileIndex = 0
): Promise<ArchiveImportPage[]> {
  const pdfjs = await loadPdfJs();
  let sourceData: ArrayBuffer | null = await file.arrayBuffer();
  const loadingTask = pdfjs.getDocument({ data: sourceData });
  const document = await loadingTask.promise.catch(async (error) => {
    sourceData = null;
    await loadingTask.destroy();
    throw error;
  });
  sourceData = null;
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
  } catch (error) {
    releaseArchivePages(pages);
    throw error;
  } finally {
    await document.cleanup();
    await loadingTask.destroy();
  }
}

export async function loadArchiveImagePages(files: File[]): Promise<ArchiveImportPage[]> {
  const results = await mapSettledWithConcurrency(files, 3, async (file, index) => {
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
  const pages = results.flatMap((result) => (
    result.status === "fulfilled" ? [result.value] : []
  ));
  const failure = results.find(
    (result): result is SettledMapRejected => result.status === "rejected"
  );
  if (failure) {
    releaseArchivePages(pages);
    throw failure.reason;
  }
  return pages;
}

export function createStoryboardCropTemplate(
  page: ArchiveImportPage,
  crop: RelativeCrop,
  templateId = createStoryboardTemplateId()
): StoryboardCropTemplate {
  const safeCrop = normalizeRelativeCrop(crop);
  const templateWidth = safeCrop.width * page.width;
  const templateHeight = safeCrop.height * page.height;
  return {
    templateId,
    basePageWidth: page.width,
    basePageHeight: page.height,
    pageNativeWidth: page.width,
    pageNativeHeight: page.height,
    templateWidth,
    templateHeight,
    templateX: safeCrop.x * page.width,
    templateY: safeCrop.y * page.height,
    columnOriginX: safeCrop.x * page.width,
    rowOriginY: safeCrop.y * page.height,
    horizontalGap: 0,
    verticalGap: 0,
    cropWidth: safeCrop.width,
    cropHeight: safeCrop.height,
    aspectRatio: templateHeight > 0 ? templateWidth / templateHeight : 1,
    columnX: safeCrop.x,
    rowAnchorCenterY: safeCrop.y + safeCrop.height / 2,
    rowStep: safeCrop.height,
    rowsPerPage: Math.max(1, Math.floor(1 / safeCrop.height)),
    clickPlacementMode: "center",
    targetColumn: "storyboard",
    includeContext: false
  };
}

export function createCenteredStoryboardCrop(
  template: StoryboardCropTemplate,
  centerX: number,
  centerY: number,
  page: Pick<ArchiveImportPage, "width" | "height"> = {
    width: template.pageNativeWidth,
    height: template.pageNativeHeight
  }
): RelativeCrop {
  const { width, height } = getStoryboardPageGeometry(template, page);
  return {
    x: Math.min(1 - width, Math.max(0, centerX - width / 2)),
    y: Math.min(1 - height, Math.max(0, centerY - height / 2)),
    width,
    height
  };
}

export function createStoryboardCellKey(
  page: Pick<ArchiveImportPage, "sourceFileIndex" | "index">,
  rowIndex: number,
  columnIndex: number
) {
  return `${page.sourceFileIndex}:${page.index}:${rowIndex}:${columnIndex}`;
}

export function getStoryboardPageOrigin(
  template: StoryboardCropTemplate,
  page: Pick<ArchiveImportPage, "width" | "height"> = {
    width: template.pageNativeWidth,
    height: template.pageNativeHeight
  }
): StoryboardGridOrigin {
  const geometry = getStoryboardPageGeometry(template, page);
  return {
    x: template.columnOriginX * geometry.nativeScale / geometry.pageWidth,
    y: template.rowOriginY * geometry.nativeScale / geometry.pageHeight
  };
}

export function getStoryboardPageGeometry(
  template: StoryboardCropTemplate,
  page: Pick<ArchiveImportPage, "width" | "height">
) {
  const pageWidth = Math.max(1, page.width);
  const pageHeight = Math.max(1, page.height);
  const templateWidth = Math.max(Number.EPSILON, template.templateWidth);
  const templateHeight = Math.max(Number.EPSILON, template.templateHeight);
  const nativeScale = Math.min(
    1,
    pageWidth / templateWidth,
    pageHeight / templateHeight
  );
  const width = templateWidth * nativeScale / pageWidth;
  const height = templateHeight * nativeScale / pageHeight;
  const horizontalGap = Math.max(0, template.horizontalGap) * nativeScale / pageWidth;
  const verticalGap = Math.max(0, template.verticalGap) * nativeScale / pageHeight;
  return {
    pageWidth,
    pageHeight,
    nativeScale,
    width,
    height,
    horizontalGap,
    verticalGap,
    columnStep: width + horizontalGap,
    rowStep: height + verticalGap
  };
}

export function createStoryboardGridCells(
  template: StoryboardCropTemplate,
  page: Pick<ArchiveImportPage, "sourceFileIndex" | "index" | "width" | "height">,
  origin = getStoryboardPageOrigin(template, page)
): StoryboardGridCell[] {
  const {
    width,
    height,
    columnStep,
    rowStep
  } = getStoryboardPageGeometry(template, page);
  if (columnStep <= 0 || rowStep <= 0) return [];

  const firstColumn = Math.ceil((-origin.x - 0.000001) / columnStep);
  const lastColumn = Math.floor((1 - width - origin.x + 0.000001) / columnStep);
  const firstRow = Math.ceil((-origin.y - 0.000001) / rowStep);
  const lastRow = Math.floor((1 - height - origin.y + 0.000001) / rowStep);
  const cells: StoryboardGridCell[] = [];

  for (let rowIndex = firstRow; rowIndex <= lastRow; rowIndex += 1) {
    for (let columnIndex = firstColumn; columnIndex <= lastColumn; columnIndex += 1) {
      cells.push({
        key: createStoryboardCellKey(page, rowIndex, columnIndex),
        templateId: template.templateId,
        rowIndex,
        columnIndex,
        crop: {
          x: origin.x + columnIndex * columnStep,
          y: origin.y + rowIndex * rowStep,
          width,
          height
        }
      });
    }
  }

  return cells;
}

export function findNearestStoryboardGridCell(
  template: StoryboardCropTemplate,
  page: Pick<ArchiveImportPage, "sourceFileIndex" | "index" | "width" | "height">,
  point: { x: number; y: number },
  origin = getStoryboardPageOrigin(template, page),
  excludedKeys: ReadonlySet<string> = new Set()
) {
  let nearest: StoryboardGridCell | null = null;
  let nearestDistance = Number.POSITIVE_INFINITY;
  for (const cell of createStoryboardGridCells(template, page, origin)) {
    if (excludedKeys.has(cell.key)) continue;
    const centerX = cell.crop.x + cell.crop.width / 2;
    const centerY = cell.crop.y + cell.crop.height / 2;
    const dx = (centerX - point.x) * page.width;
    const dy = (centerY - point.y) * page.height;
    const distance = dx * dx + dy * dy;
    if (distance < nearestDistance) {
      nearest = cell;
      nearestDistance = distance;
    }
  }
  return nearest;
}

export function selectStoryboardGridCells(
  template: StoryboardCropTemplate,
  page: Pick<ArchiveImportPage, "sourceFileIndex" | "index" | "width" | "height">,
  selection: RelativeCrop,
  origin = getStoryboardPageOrigin(template, page)
) {
  const safeSelection = normalizeRelativeCrop(selection);
  const geometry = getStoryboardPageGeometry(template, page);
  const toleranceX = Math.min(geometry.width * 0.12, 8 / geometry.pageWidth);
  const toleranceY = Math.min(geometry.height * 0.12, 8 / geometry.pageHeight);
  const selectionLeft = safeSelection.x - toleranceX;
  const selectionTop = safeSelection.y - toleranceY;
  const selectionRight = safeSelection.x + safeSelection.width + toleranceX;
  const selectionBottom = safeSelection.y + safeSelection.height + toleranceY;

  return createStoryboardGridCells(template, page, origin).filter((cell) => {
    const centerX = cell.crop.x + cell.crop.width / 2;
    const centerY = cell.crop.y + cell.crop.height / 2;
    if (
      centerX >= selectionLeft
      && centerX <= selectionRight
      && centerY >= selectionTop
      && centerY <= selectionBottom
    ) {
      return true;
    }

    const overlapWidth = Math.max(
      0,
      Math.min(cell.crop.x + cell.crop.width, selectionRight)
        - Math.max(cell.crop.x, selectionLeft)
    );
    const overlapHeight = Math.max(
      0,
      Math.min(cell.crop.y + cell.crop.height, selectionBottom)
        - Math.max(cell.crop.y, selectionTop)
    );
    const overlapRatio = (overlapWidth * overlapHeight) / (cell.crop.width * cell.crop.height);
    return overlapRatio >= 0.18;
  });
}

export function createStoryboardAutoCrops(
  template: StoryboardCropTemplate,
  page: Pick<ArchiveImportPage, "sourceFileIndex" | "index" | "width" | "height">,
  origin = getStoryboardPageOrigin(template, page)
) {
  return createStoryboardGridCells(template, page, origin);
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
  const decoded = await decodeArchiveImage(file);
  try {
    const displayBlob = await resizeImage(
      decoded.source,
      decoded.width,
      decoded.height,
      ARCHIVE_DISPLAY_MAX_SIDE,
      ARCHIVE_DISPLAY_QUALITY
    );
    const thumbnailBlob = await resizeImage(
      decoded.source,
      decoded.width,
      decoded.height,
      ARCHIVE_THUMBNAIL_MAX_SIDE,
      ARCHIVE_THUMBNAIL_QUALITY
    );
    return {
      displayFile: new File([displayBlob], ensureJpegName(file.name), { type: "image/jpeg" }),
      thumbnailFile: new File([thumbnailBlob], `${stripExtension(file.name)}-thumb.jpg`, { type: "image/jpeg" })
    };
  } finally {
    decoded.close();
  }
}

export async function createArchiveThumbnail(file: File) {
  const decoded = await decodeArchiveImage(file);
  try {
    const blob = await resizeImage(
      decoded.source,
      decoded.width,
      decoded.height,
      ARCHIVE_THUMBNAIL_MAX_SIDE,
      ARCHIVE_THUMBNAIL_QUALITY
    );
    return new File([blob], `${stripExtension(file.name)}-thumb.jpg`, { type: "image/jpeg" });
  } finally {
    decoded.close();
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

async function resizeImage(
  image: CanvasImageSource,
  sourceWidth: number,
  sourceHeight: number,
  maxSide: number,
  quality: number
) {
  const scale = Math.min(1, maxSide / Math.max(sourceWidth, sourceHeight));
  const canvas = documentCanvas(sourceWidth * scale, sourceHeight * scale);
  const context = canvas.getContext("2d", { alpha: false });
  if (!context) throw new Error("이미지 최적화 캔버스를 준비하지 못했습니다.");
  context.fillStyle = "#ffffff";
  context.fillRect(0, 0, canvas.width, canvas.height);
  context.drawImage(image, 0, 0, canvas.width, canvas.height);
  return canvasBlob(canvas, "image/jpeg", quality);
}

async function decodeArchiveImage(file: File) {
  if (typeof createImageBitmap === "function") {
    try {
      const bitmap = await createImageBitmap(file, { imageOrientation: "from-image" });
      return {
        source: bitmap as CanvasImageSource,
        width: bitmap.width,
        height: bitmap.height,
        close: () => bitmap.close()
      };
    } catch {
      // Some older Safari versions do not support imageOrientation. Fall through
      // to the HTMLImageElement decoder, which applies EXIF orientation in modern browsers.
    }
  }

  const sourceUrl = URL.createObjectURL(file);
  try {
    const image = await loadImage(sourceUrl);
    return {
      source: image as CanvasImageSource,
      width: image.naturalWidth,
      height: image.naturalHeight,
      close: () => URL.revokeObjectURL(sourceUrl)
    };
  } catch (error) {
    URL.revokeObjectURL(sourceUrl);
    throw error;
  }
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

function createStoryboardTemplateId() {
  if (typeof globalThis.crypto?.randomUUID === "function") {
    return `storyboard-template-${globalThis.crypto.randomUUID()}`;
  }
  return `storyboard-template-${Date.now().toString(36)}-${Math.random().toString(36).slice(2)}`;
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
  const workers = await Promise.allSettled(
    Array.from({ length: Math.min(Math.max(1, concurrency), values.length) }, run)
  );
  const failure = workers.find(
    (result): result is PromiseRejectedResult => result.status === "rejected"
  );
  if (failure) throw failure.reason;
  return results;
}

export type SettledMapFulfilled<R> = {
  status: "fulfilled";
  index: number;
  value: R;
};

export type SettledMapRejected = {
  status: "rejected";
  index: number;
  reason: unknown;
};

export async function mapSettledWithConcurrency<T, R>(
  values: T[],
  concurrency: number,
  worker: (value: T, index: number) => Promise<R>
): Promise<Array<SettledMapFulfilled<R> | SettledMapRejected>> {
  return mapWithConcurrency(values, concurrency, async (value, index) => {
    try {
      return {
        status: "fulfilled",
        index,
        value: await worker(value, index)
      } as const;
    } catch (reason) {
      return {
        status: "rejected",
        index,
        reason
      } as const;
    }
  });
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
