export type DailyPlanPdfOrientation = "landscape" | "portrait";

export const DAILY_PLAN_PDF_ERROR_MESSAGE = "PDF를 만들지 못했습니다. 다시 시도해 주세요.";
export const DAILY_PLAN_PDF_PAGE_SELECTOR = "[data-daily-plan-pdf-page]";

const DAILY_PLAN_PDF_BACKGROUND = "#ffffff";
const DAILY_PLAN_PDF_RENDER_SCALE = 2;
const DAILY_PLAN_PDF_URL_REVOKE_DELAY_MS = 30_000;

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
    useCORS: boolean;
  }
) => Promise<HTMLCanvasElement>;

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
  filename: string;
  orientation: DailyPlanPdfOrientation;
  root: HTMLElement;
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
 * 현재 편집 상태로 렌더된 canonical 문서를 A4 PDF로 만들고 즉시 다운로드합니다.
 * 무거운 캡처/PDF 라이브러리는 이 함수가 호출될 때에만 불러옵니다.
 */
export async function exportDailyPlanPdf(
  input: DailyPlanPdfExportInput,
  dependencyOverrides: Partial<DailyPlanPdfDependencies> = {}
): Promise<DailyPlanPdfExportResult> {
  try {
    const filename = normalizePdfFilename(input.filename);
    assertExportInput(input);
    const pages = resolvePdfPages(input.root);
    const dependencies = { ...defaultDependencies, ...dependencyOverrides };
    const [html2canvas, JsPdf] = await Promise.all([
      dependencies.loadHtml2Canvas(),
      dependencies.loadJsPdf()
    ]);
    const pdf = new JsPdf({
      orientation: input.orientation,
      unit: "mm",
      format: "a4",
      compress: true
    });

    for (let index = 0; index < pages.length; index += 1) {
      const page = pages[index];
      const canvas = await html2canvas(page, {
        allowTaint: false,
        backgroundColor: DAILY_PLAN_PDF_BACKGROUND,
        logging: false,
        removeContainer: true,
        scale: DAILY_PLAN_PDF_RENDER_SCALE,
        useCORS: true,
        onclone(_document, clonedPage) {
          // Move the isolated offscreen staging clone into the capture viewport
          // without touching the live document or its screen preview transform.
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
          clonedPage.style.opacity = "1";
          clonedPage.style.transform = "none";
          clonedPage.style.transformOrigin = "top left";
        }
      });
      assertCanvas(canvas);

      if (index > 0) pdf.addPage("a4", input.orientation);
      const placement = resolveImagePlacement(
        canvas,
        pdf.internal.pageSize.getWidth(),
        pdf.internal.pageSize.getHeight()
      );
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

function assertExportInput(input: DailyPlanPdfExportInput) {
  if (
    !input.root
    || typeof input.root.matches !== "function"
    || typeof input.root.querySelectorAll !== "function"
    || (input.orientation !== "landscape" && input.orientation !== "portrait")
  ) {
    throw new Error("Invalid Daily Plan PDF input");
  }
}

function resolvePdfPages(root: HTMLElement) {
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

function assertCanvas(canvas: DailyPlanPdfCanvas) {
  if (
    !Number.isFinite(canvas.width)
    || !Number.isFinite(canvas.height)
    || canvas.width <= 0
    || canvas.height <= 0
  ) {
    throw new Error("Invalid Daily Plan PDF canvas");
  }
}

function resolveImagePlacement(
  canvas: DailyPlanPdfCanvas,
  pageWidth: number,
  pageHeight: number
) {
  const availableWidth = pageWidth;
  const availableHeight = pageHeight;
  if (
    !Number.isFinite(availableWidth)
    || !Number.isFinite(availableHeight)
    || availableWidth <= 0
    || availableHeight <= 0
  ) {
    throw new Error("Invalid A4 PDF page size");
  }

  const scale = Math.min(availableWidth / canvas.width, availableHeight / canvas.height);
  const width = canvas.width * scale;
  const height = canvas.height * scale;
  return {
    x: (pageWidth - width) / 2,
    y: (pageHeight - height) / 2,
    width,
    height
  };
}
