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

export type ArchiveCropBatchRequest = {
  page: ArchiveImportPage;
  crop: RelativeCrop;
  filename: string;
};

export type ArchiveCropBatchFiles = {
  displayFile: File;
  thumbnailFile: File;
  timings: {
    cropDrawMs: number;
    imageEncodeMs: number;
  };
};

export type ArchiveCropBatchProgress = {
  completedCount: number;
  totalCount: number;
  succeededCount: number;
  failedCount: number;
};

export type ArchiveCropBatchOptions = {
  concurrency?: number;
  onProgress?: (progress: ArchiveCropBatchProgress) => void;
};

export type ArchiveCropSession = {
  pageId: string;
  createFiles: (crop: RelativeCrop, filename: string) => Promise<ArchiveCropBatchFiles>;
  close: () => void;
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
      try {
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
      } finally {
        releaseCanvas(canvas);
        page.cleanup();
      }
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

/**
 * 같은 PDF 페이지나 이미지에서 여러 crop을 만들 때 디코딩된 원본을 공유합니다.
 * close 도중 실행 중인 createFiles가 있으면 마지막 작업이 끝난 직후 원본을 정리합니다.
 */
export async function createArchiveCropSession(
  page: Pick<ArchiveImportPage, "id" | "blob">
): Promise<ArchiveCropSession> {
  const decoded = await decodeArchiveImage(page.blob);
  let activeCount = 0;
  let closeRequested = false;
  let closed = false;

  function releaseSource() {
    if (closed || !closeRequested || activeCount > 0) return;
    closed = true;
    decoded.close();
  }

  return {
    pageId: page.id,
    async createFiles(crop, filename) {
      if (closeRequested || closed) {
        throw new Error("이미 종료된 crop source는 다시 사용할 수 없습니다.");
      }
      activeCount += 1;
      try {
        return await createArchiveCropFilesFromSource(decoded, crop, filename);
      } finally {
        activeCount -= 1;
        releaseSource();
        await yieldArchiveMainThread();
      }
    },
    close() {
      closeRequested = true;
      releaseSource();
    }
  };
}

/**
 * 요청을 page별로 묶고 각 page Blob을 한 번만 디코딩해 display/thumbnail을 함께 만듭니다.
 * 결과의 index는 입력 배열의 원래 index이므로 부분 실패를 안전하게 원본 요청에 연결할 수 있습니다.
 */
export async function createCroppedArchiveFilesBatch(
  requests: ArchiveCropBatchRequest[],
  options: ArchiveCropBatchOptions = {}
): Promise<Array<SettledMapFulfilled<ArchiveCropBatchFiles> | SettledMapRejected>> {
  if (requests.length === 0) return [];

  type PageGroup = {
    page: ArchiveImportPage;
    remainingCount: number;
    sessionPromise: Promise<ArchiveCropSession> | null;
  };

  const pageGroups = new Map<string, PageGroup>();
  for (const request of requests) {
    const key = archiveCropPageKey(request.page);
    const existing = pageGroups.get(key);
    if (existing) {
      existing.remainingCount += 1;
    } else {
      pageGroups.set(key, {
        page: request.page,
        remainingCount: 1,
        sessionPromise: null
      });
    }
  }

  const totalCount = requests.length;
  let completedCount = 0;
  let succeededCount = 0;
  let failedCount = 0;
  const requestedConcurrency = options.concurrency ?? 3;
  const concurrency = Number.isFinite(requestedConcurrency)
    ? Math.min(4, Math.max(1, Math.floor(requestedConcurrency)))
    : 3;

  return mapSettledWithConcurrency(requests, concurrency, async (request) => {
    const group = pageGroups.get(archiveCropPageKey(request.page));
    if (!group) throw new Error("crop source page를 찾을 수 없습니다.");
    if (!group.sessionPromise) {
      group.sessionPromise = createArchiveCropSession(group.page);
    }

    try {
      const session = await group.sessionPromise;
      const files = await session.createFiles(request.crop, request.filename);
      succeededCount += 1;
      return files;
    } catch (error) {
      failedCount += 1;
      throw error;
    } finally {
      completedCount += 1;
      group.remainingCount -= 1;
      if (group.remainingCount === 0 && group.sessionPromise) {
        void group.sessionPromise.then((session) => session.close()).catch(() => undefined);
        group.sessionPromise = null;
      }
      notifyArchiveCropProgress(options.onProgress, {
        completedCount,
        totalCount,
        succeededCount,
        failedCount
      });
    }
  });
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
  try {
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
  } finally {
    releaseCanvas(canvas);
  }
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
  try {
    context.fillStyle = "#ffffff";
    context.fillRect(0, 0, canvas.width, canvas.height);
    context.drawImage(image, 0, 0, canvas.width, canvas.height);
    return await canvasBlob(canvas, "image/jpeg", quality);
  } finally {
    releaseCanvas(canvas);
  }
}

type DecodedArchiveImage = {
  source: CanvasImageSource;
  width: number;
  height: number;
  close: () => void;
};

async function decodeArchiveImage(file: Blob): Promise<DecodedArchiveImage> {
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

async function createArchiveCropFilesFromSource(
  decoded: DecodedArchiveImage,
  crop: RelativeCrop,
  filename: string
): Promise<ArchiveCropBatchFiles> {
  const sourceX = Math.min(decoded.width - 1, Math.round(clamp(crop.x) * decoded.width));
  const sourceY = Math.min(decoded.height - 1, Math.round(clamp(crop.y) * decoded.height));
  const sourceWidth = Math.max(1, Math.round(clamp(crop.width, 0.01) * decoded.width));
  const sourceHeight = Math.max(1, Math.round(clamp(crop.height, 0.01) * decoded.height));
  const safeSourceWidth = Math.max(1, Math.min(sourceWidth, decoded.width - sourceX));
  const safeSourceHeight = Math.max(1, Math.min(sourceHeight, decoded.height - sourceY));
  const displayScale = Math.min(
    1,
    ARCHIVE_DISPLAY_MAX_SIDE / Math.max(safeSourceWidth, safeSourceHeight)
  );
  const thumbnailScale = Math.min(
    1,
    ARCHIVE_THUMBNAIL_MAX_SIDE / Math.max(safeSourceWidth, safeSourceHeight)
  );
  const displayCanvas = documentCanvas(
    safeSourceWidth * displayScale,
    safeSourceHeight * displayScale
  );
  const thumbnailCanvas = documentCanvas(
    safeSourceWidth * thumbnailScale,
    safeSourceHeight * thumbnailScale
  );

  try {
    const drawStartedAt = archiveClientNow();
    drawArchiveCrop(
      displayCanvas,
      decoded.source,
      sourceX,
      sourceY,
      safeSourceWidth,
      safeSourceHeight
    );
    drawArchiveCrop(
      thumbnailCanvas,
      decoded.source,
      sourceX,
      sourceY,
      safeSourceWidth,
      safeSourceHeight
    );
    const cropDrawMs = archiveClientNow() - drawStartedAt;
    const encodeStartedAt = archiveClientNow();
    const [displayBlob, thumbnailBlob] = await Promise.all([
      canvasBlob(displayCanvas, "image/jpeg", ARCHIVE_DISPLAY_QUALITY),
      canvasBlob(thumbnailCanvas, "image/jpeg", ARCHIVE_THUMBNAIL_QUALITY)
    ]);
    const imageEncodeMs = archiveClientNow() - encodeStartedAt;
    return {
      displayFile: new File([displayBlob], ensureJpegName(filename), { type: "image/jpeg" }),
      thumbnailFile: new File(
        [thumbnailBlob],
        `${stripExtension(filename)}-thumb.jpg`,
        { type: "image/jpeg" }
      ),
      timings: {
        cropDrawMs,
        imageEncodeMs
      }
    };
  } finally {
    releaseCanvas(displayCanvas);
    releaseCanvas(thumbnailCanvas);
  }
}

function drawArchiveCrop(
  canvas: HTMLCanvasElement,
  source: CanvasImageSource,
  sourceX: number,
  sourceY: number,
  sourceWidth: number,
  sourceHeight: number
) {
  const context = canvas.getContext("2d", { alpha: false });
  if (!context) throw new Error("crop 캔버스를 준비하지 못했습니다.");
  context.fillStyle = "#ffffff";
  context.fillRect(0, 0, canvas.width, canvas.height);
  context.drawImage(
    source,
    sourceX,
    sourceY,
    sourceWidth,
    sourceHeight,
    0,
    0,
    canvas.width,
    canvas.height
  );
}

function releaseCanvas(canvas: HTMLCanvasElement) {
  canvas.width = 0;
  canvas.height = 0;
}

function archiveCropPageKey(page: Pick<ArchiveImportPage, "id" | "sourceFileIndex">) {
  return `${page.sourceFileIndex}:${page.id}`;
}

function notifyArchiveCropProgress(
  onProgress: ArchiveCropBatchOptions["onProgress"],
  progress: ArchiveCropBatchProgress
) {
  if (!onProgress) return;
  try {
    onProgress(progress);
  } catch {
    // 진행 UI 오류가 이미지 생성 결과에 영향을 주지 않게 합니다.
  }
}

async function yieldArchiveMainThread() {
  const scheduler = (
    globalThis as typeof globalThis & {
      scheduler?: { yield?: () => Promise<void> };
    }
  ).scheduler;
  if (typeof scheduler?.yield === "function") {
    await scheduler.yield();
    return;
  }
  await new Promise<void>((resolve) => setTimeout(resolve, 0));
}

function archiveClientNow() {
  return typeof performance === "undefined" ? Date.now() : performance.now();
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
