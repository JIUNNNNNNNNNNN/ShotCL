export type DailyPlanPdfOrientation = "landscape" | "portrait";
export type DailyPlanPdfCaptureMode = "live-root" | "paginated";

export const DAILY_PLAN_PDF_ERROR_MESSAGE = "PDF를 만들지 못했습니다. 다시 시도해 주세요.";
export const DAILY_PLAN_PDF_PAGE_SELECTOR = "[data-daily-plan-pdf-page]";

const DAILY_PLAN_PDF_BACKGROUND = "#ffffff";
const DAILY_PLAN_PDF_RENDER_SCALE = 2;
const DAILY_PLAN_PDF_URL_REVOKE_DELAY_MS = 30_000;
const CSS_PIXELS_PER_INCH = 96;
const MILLIMETERS_PER_INCH = 25.4;
const A4_SHORT_EDGE_MM = 210;
const A4_LONG_EDGE_MM = 297;
const CANVAS_DIMENSION_TOLERANCE_PX = 2;
const CANVAS_ASPECT_RATIO_TOLERANCE = 0.002;
const MAX_DAILY_PLAN_PDF_CANVAS_PIXELS = 8_000_000;
const HTML2CANVAS_FONT_METRICS_IMAGE_SOURCE =
  "data:image/gif;base64,R0lGODlhAQABAIAAAAAAAP///yH5BAEAAAAALAAAAAABAAEAAAIBRAA7";

type DailyPlanPdfCanvas = Pick<HTMLCanvasElement, "height" | "width">;

type DailyPlanHtml2Canvas = (
  element: HTMLElement,
  options: {
    allowTaint: boolean;
    backgroundColor: string;
    logging: boolean;
    onclone: (document: Document, element: HTMLElement) => void;
    removeContainer: boolean;
    scale: number;
    scrollX: number;
    scrollY: number;
    useCORS: boolean;
    width: number;
    height: number;
    windowWidth: number;
    windowHeight: number;
  }
) => Promise<HTMLCanvasElement>;

type DailyPlanPdfPageGeometry = {
  cssHeight: number;
  cssWidth: number;
  expectedCanvasHeight: number;
  expectedCanvasWidth: number;
  heightMm: number;
  widthMm: number;
};

type DailyPlanJsPdfDocument = {
  addImage: (
    imageData: HTMLCanvasElement,
    format: "PNG",
    x: number,
    y: number,
    width: number,
    height: number,
    alias?: string,
    compression?: "FAST"
  ) => unknown;
  addPage: (format: "a4", orientation: DailyPlanPdfOrientation) => unknown;
  internal: {
    pageSize: {
      getHeight: () => number;
      getWidth: () => number;
    };
  };
  output: (type: "blob") => Blob;
};

type DailyPlanJsPdfConstructor = new (options: {
  compress: boolean;
  format: "a4";
  orientation: DailyPlanPdfOrientation;
  unit: "mm";
}) => DailyPlanJsPdfDocument;

export type DailyPlanPdfDependencies = {
  createObjectUrl: (blob: Blob) => string;
  loadHtml2Canvas: () => Promise<DailyPlanHtml2Canvas>;
  loadJsPdf: () => Promise<DailyPlanJsPdfConstructor>;
  revokeObjectUrl: (url: string) => void;
  triggerDownload: (url: string, filename: string) => void;
};

export type DailyPlanPdfExportInput = {
  /** Landscape uses the one mounted white-paper root; Portrait keeps canonical pages. */
  captureMode?: DailyPlanPdfCaptureMode;
  filename: string;
  orientation: DailyPlanPdfOrientation;
  root: HTMLElement;
  /** Live Landscape capture guard; omitted by the isolated Portrait renderer. */
  validateSource?: (root: HTMLElement) => boolean;
};

export type DailyPlanPdfExportResult = {
  blob: Blob;
  filename: string;
  pageCount: number;
};

export class DailyPlanPdfExportError extends Error {
  readonly code = "DAILY_PLAN_PDF_EXPORT_FAILED";

  constructor() {
    super(DAILY_PLAN_PDF_ERROR_MESSAGE);
    this.name = "DailyPlanPdfExportError";
  }
}

const defaultDependencies: DailyPlanPdfDependencies = {
  async loadHtml2Canvas() {
    const module = await import("html2canvas");
    return module.default;
  },
  async loadJsPdf() {
    const module = await import("jspdf");
    return module.jsPDF as unknown as DailyPlanJsPdfConstructor;
  },
  createObjectUrl(blob) {
    return URL.createObjectURL(blob);
  },
  triggerDownload(url, filename) {
    const anchor = document.createElement("a");
    anchor.href = url;
    anchor.download = filename;
    anchor.rel = "noopener";
    anchor.style.display = "none";
    document.body.appendChild(anchor);
    try {
      anchor.click();
    } finally {
      anchor.remove();
    }
  },
  revokeObjectUrl(url) {
    // Safari can still be consuming the Blob URL after click() returns.
    window.setTimeout(() => URL.revokeObjectURL(url), DAILY_PLAN_PDF_URL_REVOKE_DELAY_MS);
  }
};

/**
 * 현재 편집 상태로 렌더된 문서를 고해상도 PNG로 캡처해 A4 PDF로 다운로드합니다.
 * 무거운 캡처/PDF 라이브러리는 이 함수가 호출될 때에만 불러옵니다.
 */
export async function exportDailyPlanPdf(
  input: DailyPlanPdfExportInput,
  dependencyOverrides: Partial<DailyPlanPdfDependencies> = {}
): Promise<DailyPlanPdfExportResult> {
  try {
    const filename = normalizePdfFilename(input.filename);
    assertExportInput(input);
    const captureMode = input.captureMode ?? "paginated";
    const pages = resolvePdfPages(input.root, captureMode);
    const geometries = pages.map((page) => resolveCaptureGeometry(
      page,
      input.orientation,
      captureMode
    ));
    const dependencies = { ...defaultDependencies, ...dependencyOverrides };
    const [html2canvas, JsPdf] = await Promise.all([
      dependencies.loadHtml2Canvas(),
      dependencies.loadJsPdf()
    ]);
    assertSourceIsCurrent(input);
    const pdf = new JsPdf({
      orientation: input.orientation,
      unit: "mm",
      format: "a4",
      compress: true
    });
    const removeFontMetricsFix = installHtml2CanvasFontMetricsFix(input.root.ownerDocument);
    try {
      for (let index = 0; index < pages.length; index += 1) {
        assertSourceIsCurrent(input);
        const page = pages[index];
        const geometry = geometries[index];
        assertCaptureGeometryIsCurrent(page, geometry, captureMode);
        const canvas = await html2canvas(page, {
          allowTaint: false,
          backgroundColor: DAILY_PLAN_PDF_BACKGROUND,
          logging: false,
          removeContainer: true,
          scale: DAILY_PLAN_PDF_RENDER_SCALE,
          scrollX: 0,
          scrollY: 0,
          useCORS: true,
          width: geometry.cssWidth,
          height: geometry.cssHeight,
          windowWidth: geometry.cssWidth,
          windowHeight: geometry.cssHeight,
          onclone(_document, clonedPage) {
            // Normalize only capture-shell positioning/transforms inside html2canvas's
            // clone. The live preview and all document cell geometry stay untouched.
            let ancestor: HTMLElement | null = clonedPage;
            while (ancestor) {
              ancestor.style.visibility = "visible";
              ancestor = ancestor.parentElement;
            }
            const staging = clonedPage.closest<HTMLElement>(".daily-plan-print-staging");
            if (staging) {
              staging.style.left = "0";
              staging.style.position = "absolute";
              staging.style.top = "0";
              staging.style.zIndex = "0";
            }
            const livePreviewPaper = clonedPage.closest<HTMLElement>(
              ".daily-plan-preview-sheet"
            );
            if (livePreviewPaper) {
              livePreviewPaper.style.transform = "none";
              livePreviewPaper.style.transformOrigin = "top left";
            }
            clonedPage.style.boxSizing = "border-box";
            if (captureMode === "paginated") {
              const width = `${geometry.cssWidth}px`;
              const height = `${geometry.cssHeight}px`;
              clonedPage.style.width = width;
              clonedPage.style.minWidth = width;
              clonedPage.style.maxWidth = width;
              clonedPage.style.height = height;
              clonedPage.style.minHeight = height;
              clonedPage.style.maxHeight = height;
            }
            clonedPage.style.margin = "0";
            clonedPage.style.opacity = "1";
            clonedPage.style.transform = "none";
            clonedPage.style.transformOrigin = "top left";
          }
        });
        assertCanvas(canvas, geometry);

        if (index > 0) pdf.addPage("a4", input.orientation);
        const pageWidth = pdf.internal.pageSize.getWidth();
        const pageHeight = pdf.internal.pageSize.getHeight();
        assertPdfPageSize(pageWidth, pageHeight, geometry);
        const placement = resolveCenteredImagePlacement(canvas, pageWidth, pageHeight);
        pdf.addImage(
          canvas,
          "PNG",
          placement.x,
          placement.y,
          placement.width,
          placement.height,
          undefined,
          "FAST"
        );
      }
    } finally {
      removeFontMetricsFix();
    }

    const blob = pdf.output("blob");
    const signature = await blob.slice(0, 5).text();
    if (
      blob.size <= 0
      || blob.type.toLowerCase() !== "application/pdf"
      || signature !== "%PDF-"
    ) {
      throw new Error("Invalid PDF Blob");
    }

    const objectUrl = dependencies.createObjectUrl(blob);
    if (!objectUrl) throw new Error("Invalid PDF object URL");
    try {
      dependencies.triggerDownload(objectUrl, filename);
    } finally {
      // Cleanup must not turn a successfully-triggered download into a user-visible failure.
      try {
        dependencies.revokeObjectUrl(objectUrl);
      } catch {
        // Browser cleanup is best-effort after the download has been triggered.
      }
    }

    return { blob, filename, pageCount: pages.length };
  } catch {
    throw new DailyPlanPdfExportError();
  }
}

function installHtml2CanvasFontMetricsFix(ownerDocument: Document | null) {
  const parent = ownerDocument?.head ?? ownerDocument?.documentElement;
  if (!ownerDocument || !parent) return () => {};
  // html2canvas measures font baselines with this private 1px GIF. Tailwind's
  // global img display:block reset changes its offset and shifts captured text.
  const style = ownerDocument.createElement("style");
  style.setAttribute("data-daily-plan-pdf-font-metrics-fix", "true");
  style.textContent = `img[src="${HTML2CANVAS_FONT_METRICS_IMAGE_SOURCE}"] { display: inline-block !important; }`;
  parent.appendChild(style);
  return () => style.remove();
}

function assertExportInput(input: DailyPlanPdfExportInput) {
  if (
    !input.root
    || typeof input.root.matches !== "function"
    || typeof input.root.querySelectorAll !== "function"
    || (input.orientation !== "landscape" && input.orientation !== "portrait")
    || (input.captureMode !== undefined
      && input.captureMode !== "live-root"
      && input.captureMode !== "paginated")
  ) {
    throw new Error("Invalid Daily Plan PDF input");
  }
}

function assertSourceIsCurrent(input: DailyPlanPdfExportInput) {
  if (input.validateSource && !input.validateSource(input.root)) {
    throw new Error("Daily Plan PDF source changed before capture");
  }
}

function resolvePdfPages(root: HTMLElement, captureMode: DailyPlanPdfCaptureMode) {
  if (captureMode === "live-root") return [root];
  if (root.matches(DAILY_PLAN_PDF_PAGE_SELECTOR)) return [root];
  const markedPages = Array.from(
    root.querySelectorAll<HTMLElement>(DAILY_PLAN_PDF_PAGE_SELECTOR)
  );
  const pages = markedPages.length > 0 ? markedPages : [root];
  if (pages.length > 2 || new Set(pages).size !== pages.length) {
    throw new Error("Invalid Daily Plan PDF page set");
  }
  return pages;
}

function normalizePdfFilename(filename: string) {
  const trimmed = filename.trim();
  if (!trimmed) throw new Error("Invalid PDF filename");
  const safeFilename = trimmed
    .replace(/[\u0000-\u001f\u007f]/gu, "")
    .replace(/[\\/]/gu, "-")
    .trim();
  if (!safeFilename) throw new Error("Invalid PDF filename");
  return /\.pdf$/iu.test(safeFilename) ? safeFilename : `${safeFilename}.pdf`;
}

function resolvePageGeometry(
  orientation: DailyPlanPdfOrientation
): DailyPlanPdfPageGeometry {
  const widthMm = orientation === "landscape" ? A4_LONG_EDGE_MM : A4_SHORT_EDGE_MM;
  const heightMm = orientation === "landscape" ? A4_SHORT_EDGE_MM : A4_LONG_EDGE_MM;
  const cssWidth = widthMm * CSS_PIXELS_PER_INCH / MILLIMETERS_PER_INCH;
  const cssHeight = heightMm * CSS_PIXELS_PER_INCH / MILLIMETERS_PER_INCH;
  return {
    cssWidth,
    cssHeight,
    expectedCanvasWidth: Math.floor(cssWidth * DAILY_PLAN_PDF_RENDER_SCALE),
    expectedCanvasHeight: Math.floor(cssHeight * DAILY_PLAN_PDF_RENDER_SCALE),
    widthMm,
    heightMm
  };
}

function resolveCaptureGeometry(
  source: HTMLElement,
  orientation: DailyPlanPdfOrientation,
  captureMode: DailyPlanPdfCaptureMode
) {
  if (captureMode === "paginated") return resolvePageGeometry(orientation);
  const pageGeometry = resolvePageGeometry(orientation);
  const cssWidth = source.clientWidth;
  const cssHeight = source.clientHeight;
  if (
    !Number.isFinite(cssWidth)
    || !Number.isFinite(cssHeight)
    || cssWidth <= 0
    || cssHeight <= 0
  ) {
    throw new Error("Invalid live Daily Plan PDF source geometry");
  }
  const expectedCanvasWidth = Math.floor(cssWidth * DAILY_PLAN_PDF_RENDER_SCALE);
  const expectedCanvasHeight = Math.floor(cssHeight * DAILY_PLAN_PDF_RENDER_SCALE);
  if (expectedCanvasWidth * expectedCanvasHeight > MAX_DAILY_PLAN_PDF_CANVAS_PIXELS) {
    throw new Error("Daily Plan PDF canvas exceeds the safe memory budget");
  }
  return {
    ...pageGeometry,
    cssWidth,
    cssHeight,
    expectedCanvasWidth,
    expectedCanvasHeight
  };
}

function assertCaptureGeometryIsCurrent(
  source: HTMLElement,
  geometry: DailyPlanPdfPageGeometry,
  captureMode: DailyPlanPdfCaptureMode
) {
  if (
    captureMode === "live-root"
    && (source.clientWidth !== geometry.cssWidth || source.clientHeight !== geometry.cssHeight)
  ) {
    throw new Error("Live Daily Plan PDF source geometry changed before capture");
  }
}

function assertCanvas(
  canvas: DailyPlanPdfCanvas,
  geometry: DailyPlanPdfPageGeometry
) {
  if (
    !Number.isFinite(canvas.width)
    || !Number.isFinite(canvas.height)
    || canvas.width <= 0
    || canvas.height <= 0
  ) {
    throw new Error("Invalid Daily Plan PDF canvas");
  }
  if (
    Math.abs(canvas.width - geometry.expectedCanvasWidth) > CANVAS_DIMENSION_TOLERANCE_PX
    || Math.abs(canvas.height - geometry.expectedCanvasHeight) > CANVAS_DIMENSION_TOLERANCE_PX
  ) {
    throw new Error("Unexpected Daily Plan PDF canvas size");
  }
  const actualAspectRatio = canvas.width / canvas.height;
  const expectedAspectRatio = geometry.cssWidth / geometry.cssHeight;
  const aspectRatioError = Math.abs(actualAspectRatio / expectedAspectRatio - 1);
  if (aspectRatioError > CANVAS_ASPECT_RATIO_TOLERANCE) {
    throw new Error("Unexpected Daily Plan PDF canvas aspect ratio");
  }
}

function assertPdfPageSize(
  pageWidth: number,
  pageHeight: number,
  geometry: DailyPlanPdfPageGeometry
) {
  if (
    !Number.isFinite(pageWidth)
    || !Number.isFinite(pageHeight)
    || pageWidth <= 0
    || pageHeight <= 0
  ) {
    throw new Error("Invalid A4 PDF page size");
  }
  const actualAspectRatio = pageWidth / pageHeight;
  const expectedAspectRatio = geometry.widthMm / geometry.heightMm;
  if (Math.abs(actualAspectRatio / expectedAspectRatio - 1) > CANVAS_ASPECT_RATIO_TOLERANCE) {
    throw new Error("Unexpected A4 PDF page aspect ratio");
  }
}

function resolveCenteredImagePlacement(
  canvas: DailyPlanPdfCanvas,
  pageWidth: number,
  pageHeight: number
) {
  const scale = Math.min(pageWidth / canvas.width, pageHeight / canvas.height);
  const width = canvas.width * scale;
  const height = canvas.height * scale;
  return {
    x: (pageWidth - width) / 2,
    y: (pageHeight - height) / 2,
    width,
    height
  };
}
