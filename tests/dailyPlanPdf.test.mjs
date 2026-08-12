import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

const helperPath = new URL("../lib/client/dailyPlanPdf.ts", import.meta.url);

const {
  DAILY_PLAN_PDF_ERROR_MESSAGE,
  DAILY_PLAN_PDF_PAGE_SELECTOR,
  DailyPlanPdfExportError,
  exportDailyPlanPdf
} = await import("../lib/client/dailyPlanPdf.ts");

test("PDF capture libraries remain on-call dynamic imports", async () => {
  const source = await readFile(helperPath, "utf8");
  assert.match(source, /await import\("html2canvas"\)/u);
  assert.match(source, /await import\("jspdf"\)/u);
  assert.match(source, /const DAILY_PLAN_PDF_RENDER_SCALE = 2;/u);
  assert.match(source, /pdf\.addImage\([\s\S]*canvas,[\s\S]*"PNG"/u);
  assert.doesNotMatch(source, /from\s+["'](?:html2canvas|jspdf)["']/u);
  assert.doesNotMatch(source, /devicePixelRatio|drawImage\(|"JPEG"|'JPEG'/u);
});

test("installed jsPDF emits a signed A4 PDF Blob for both orientations", async () => {
  const { jsPDF } = await import("jspdf");
  for (const orientation of ["landscape", "portrait"]) {
    const pdf = new jsPDF({ orientation, unit: "mm", format: "a4", compress: true });
    const pageWidth = pdf.internal.pageSize.getWidth();
    const pageHeight = pdf.internal.pageSize.getHeight();
    if (orientation === "landscape") assert.ok(pageWidth > pageHeight);
    else assert.ok(pageHeight > pageWidth);

    const blob = pdf.output("blob");
    assert.equal(blob.type, "application/pdf");
    assert.ok(blob.size > 0);
    assert.equal(await blob.slice(0, 5).text(), "%PDF-");
  }
});

test("Landscape lazily captures the mounted live root once into one named A4 download", async () => {
  const firstPage = { id: "first" };
  const secondPage = { id: "second" };
  const root = createRoot(
    [firstPage, secondPage],
    undefined,
    { clientWidth: 1123, clientHeight: 1618 }
  );
  const events = [];
  const pdfInstances = [];
  let html2canvasLoads = 0;
  let jsPdfLoads = 0;

  const dependencies = {
    async loadHtml2Canvas() {
      html2canvasLoads += 1;
      return async (page, options) => {
        events.push(["capture", page.id, options]);
        return createCanonicalCanvas(options);
      };
    },
    async loadJsPdf() {
      jsPdfLoads += 1;
      return createFakeJsPdf(pdfInstances, "landscape");
    },
    createObjectUrl(blob) {
      events.push(["create-url", blob]);
      return "blob:daily-plan";
    },
    triggerDownload(url, filename) {
      events.push(["download", url, filename]);
    },
    revokeObjectUrl(url) {
      events.push(["revoke", url]);
    }
  };

  assert.equal(html2canvasLoads, 0);
  assert.equal(jsPdfLoads, 0);
  const result = await exportDailyPlanPdf({
    root,
    orientation: "landscape",
    captureMode: "live-root",
    filename: "7월 20일 일촬표.pdf"
  }, dependencies);

  assert.equal(html2canvasLoads, 1);
  assert.equal(jsPdfLoads, 1);
  assert.equal(result.filename, "7월 20일 일촬표.pdf");
  assert.equal(result.pageCount, 1);
  assert.equal(result.blob.type, "application/pdf");
  assert.ok(result.blob.size > 0);
  assert.deepEqual(root.queries, []);

  assert.equal(pdfInstances.length, 1);
  const pdf = pdfInstances[0];
  assert.deepEqual(pdf.options, {
    orientation: "landscape",
    unit: "mm",
    format: "a4",
    compress: true
  });
  assert.deepEqual(pdf.addedPages, []);
  assert.equal(pdf.images.length, 1);
  for (const image of pdf.images) {
    assert.equal(image.format, "PNG");
    assertCenteredUniformPlacement(image, 297, 210);
    assert.equal(image.compression, "FAST");
  }

  const captures = events.filter(([event]) => event === "capture");
  assert.deepEqual(captures.map(([, id]) => id), ["root"]);
  const landscapeGeometry = expectedLiveRootCaptureGeometry(root);
  for (const [, , options] of captures) {
    assert.equal(options.backgroundColor, "#ffffff");
    assert.equal(options.scale, 2);
    assert.equal(options.useCORS, true);
    assert.equal(options.allowTaint, false);
    assert.equal(options.logging, false);
    assert.equal(options.width, landscapeGeometry.cssWidth);
    assert.equal(options.height, landscapeGeometry.cssHeight);
    assert.equal(options.windowWidth, landscapeGeometry.cssWidth);
    assert.equal(options.windowHeight, landscapeGeometry.cssHeight);
    assert.equal(options.scrollX, 0);
    assert.equal(options.scrollY, 0);
  }
  const previewViewportClone = { style: {}, parentElement: null };
  const livePreviewPaperClone = {
    style: { transform: "scale(0.42)", transformOrigin: "top left" },
    parentElement: previewViewportClone,
    closest(selector) {
      if (selector === ".daily-plan-print-staging") return null;
      if (selector === ".daily-plan-preview-sheet") return this;
      assert.fail(`unexpected closest selector: ${selector}`);
    }
  };
  captures[0][2].onclone({}, livePreviewPaperClone);
  assert.equal(livePreviewPaperClone.style.visibility, "visible");
  assert.equal(previewViewportClone.style.visibility, "visible");
  assert.equal(livePreviewPaperClone.style.transform, "none");
  assert.equal(livePreviewPaperClone.style.transformOrigin, "top left");
  assert.equal(livePreviewPaperClone.style.boxSizing, "border-box");
  assert.equal(livePreviewPaperClone.style.width, undefined);
  assert.equal(livePreviewPaperClone.style.height, undefined);
  assert.equal(livePreviewPaperClone.style.margin, "0");
  assert.equal(livePreviewPaperClone.style.opacity, "1");
  assert.deepEqual(events.slice(-3).map(([event]) => event), ["create-url", "download", "revoke"]);
  assert.deepEqual(events.at(-2), ["download", "blob:daily-plan", "7월 20일 일촬표.pdf"]);
});

test("exportDailyPlanPdf falls back to the root and keeps portrait A4 geometry", async () => {
  const root = createRoot([]);
  const pdfInstances = [];
  const captured = [];
  const result = await exportDailyPlanPdf({
    root,
    orientation: "portrait",
    filename: "portrait plan"
  }, createDependencies({
    pdfInstances,
    orientation: "portrait",
    capture(page, options) {
      captured.push({ page, options });
      return createCanonicalCanvas(options);
    }
  }));

  assert.deepEqual(captured.map(({ page }) => page), [root]);
  const portraitGeometry = expectedCaptureGeometry("portrait");
  assert.equal(captured[0].options.width, portraitGeometry.cssWidth);
  assert.equal(captured[0].options.height, portraitGeometry.cssHeight);
  assert.equal(captured[0].options.windowWidth, portraitGeometry.cssWidth);
  assert.equal(captured[0].options.windowHeight, portraitGeometry.cssHeight);
  const stagingClone = { style: {}, parentElement: null };
  const pageClone = {
    style: {},
    parentElement: stagingClone,
    closest(selector) {
      if (selector === ".daily-plan-print-staging") return stagingClone;
      if (selector === ".daily-plan-preview-sheet") return null;
      assert.fail(`unexpected closest selector: ${selector}`);
    }
  };
  captured[0].options.onclone({}, pageClone);
  assert.equal(stagingClone.style.visibility, "visible");
  assert.equal(stagingClone.style.left, "0");
  assert.equal(stagingClone.style.top, "0");
  assert.equal(stagingClone.style.position, "absolute");
  assert.equal(stagingClone.style.zIndex, "0");
  assert.equal(pageClone.style.transform, "none");
  assert.equal(result.filename, "portrait plan.pdf");
  assert.equal(result.pageCount, 1);
  assert.deepEqual(pdfInstances[0].addedPages, []);
  assert.equal(pdfInstances[0].images.length, 1);
  assertCenteredUniformPlacement(pdfInstances[0].images[0], 210, 297);
});

test("Portrait keeps marked canonical pages instead of using the Landscape live-root policy", async () => {
  const firstPage = { id: "portrait-first" };
  const secondPage = { id: "portrait-second" };
  const root = createRoot([firstPage, secondPage]);
  const pdfInstances = [];
  const captures = [];

  const result = await exportDailyPlanPdf({
    root,
    orientation: "portrait",
    captureMode: "paginated",
    filename: "portrait-pages.pdf"
  }, createDependencies({
    pdfInstances,
    orientation: "portrait",
    capture(page, options) {
      captures.push(page.id);
      return createCanonicalCanvas(options);
    }
  }));

  assert.deepEqual(root.queries, [DAILY_PLAN_PDF_PAGE_SELECTOR]);
  assert.deepEqual(captures, ["portrait-first", "portrait-second"]);
  assert.equal(result.pageCount, 2);
  assert.deepEqual(pdfInstances[0].addedPages, [["a4", "portrait"]]);
  assert.equal(pdfInstances[0].images.length, 2);
});

test("PDF capture narrowly restores html2canvas font metrics images and removes the style", async () => {
  const styleDocument = createStyleOwnerDocument();
  const root = createRoot([{ id: "first" }, { id: "second" }], styleDocument.ownerDocument);
  const activeRules = [];

  await exportDailyPlanPdf({
    root,
    orientation: "landscape",
    filename: "font-metrics.pdf"
  }, createDependencies({
    capture(_page, options) {
      assert.equal(styleDocument.mountedStyles.length, 1);
      activeRules.push(styleDocument.mountedStyles[0].textContent);
      return createCanonicalCanvas(options);
    }
  }));

  assert.deepEqual(activeRules, [
    'img[src="data:image/gif;base64,R0lGODlhAQABAIAAAAAAAP///yH5BAEAAAAALAAAAAABAAEAAAIBRAA7"] { display: inline-block !important; }',
    'img[src="data:image/gif;base64,R0lGODlhAQABAIAAAAAAAP///yH5BAEAAAAALAAAAAABAAEAAAIBRAA7"] { display: inline-block !important; }'
  ]);
  assert.equal(styleDocument.mountedStyles.length, 0);
  assert.equal(styleDocument.removedStyles.length, 1);
  assert.equal(
    styleDocument.removedStyles[0].attributes["data-daily-plan-pdf-font-metrics-fix"],
    "true"
  );
});

test("font metrics compatibility style is removed when html2canvas rejects", async () => {
  const styleDocument = createStyleOwnerDocument();
  const root = createRoot([], styleDocument.ownerDocument);

  await assert.rejects(
    exportDailyPlanPdf({
      root,
      orientation: "landscape",
      filename: "font-metrics-failure.pdf"
    }, createDependencies({
      capture() {
        assert.equal(styleDocument.mountedStyles.length, 1);
        throw new Error("capture failed");
      }
    })),
    (error) => error instanceof DailyPlanPdfExportError
      && error.message === DAILY_PLAN_PDF_ERROR_MESSAGE
  );

  assert.equal(styleDocument.mountedStyles.length, 0);
  assert.equal(styleDocument.removedStyles.length, 1);
});

test("font metrics compatibility style is removed when jsPDF image placement rejects", async () => {
  const styleDocument = createStyleOwnerDocument();
  const root = createRoot([], styleDocument.ownerDocument);

  await assert.rejects(
    exportDailyPlanPdf({
      root,
      orientation: "landscape",
      filename: "font-metrics-add-image-failure.pdf"
    }, createDependencies({ addImageError: new Error("addImage failed") })),
    (error) => error instanceof DailyPlanPdfExportError
      && error.message === DAILY_PLAN_PDF_ERROR_MESSAGE
  );

  assert.equal(styleDocument.mountedStyles.length, 0);
  assert.equal(styleDocument.removedStyles.length, 1);
});

test("exportDailyPlanPdf rejects a non-PDF signature before creating a download URL", async () => {
  const styleDocument = createStyleOwnerDocument();
  const root = createRoot([], styleDocument.ownerDocument);
  let objectUrlCalls = 0;
  const dependencies = createDependencies({
    outputBlob: new Blob(["not a pdf"], { type: "application/pdf" }),
    createObjectUrl() {
      objectUrlCalls += 1;
      return "blob:invalid";
    }
  });

  await assert.rejects(
    exportDailyPlanPdf({ root, orientation: "landscape", filename: "invalid.pdf" }, dependencies),
    (error) => error instanceof DailyPlanPdfExportError
      && error.message === DAILY_PLAN_PDF_ERROR_MESSAGE
  );
  assert.equal(objectUrlCalls, 0);
  assert.equal(styleDocument.mountedStyles.length, 0);
  assert.equal(styleDocument.removedStyles.length, 1);
});

test("exportDailyPlanPdf rejects noncanonical capture dimensions before creating a download URL", async () => {
  const root = createRoot([]);
  const geometry = expectedCaptureGeometry("landscape");
  for (const canvas of [
    { width: geometry.canvasWidth + 20, height: geometry.canvasHeight },
    { width: geometry.canvasWidth, height: geometry.canvasHeight + 20 }
  ]) {
    let objectUrlCalls = 0;
    const dependencies = createDependencies({
      capture: () => canvas,
      createObjectUrl() {
        objectUrlCalls += 1;
        return "blob:invalid-canvas";
      }
    });

    await assert.rejects(
      exportDailyPlanPdf({ root, orientation: "landscape", filename: "invalid.pdf" }, dependencies),
      (error) => error instanceof DailyPlanPdfExportError
        && error.message === DAILY_PLAN_PDF_ERROR_MESSAGE
    );
    assert.equal(objectUrlCalls, 0);
  }
});

test("exportDailyPlanPdf enforces canvas aspect tolerance inside the dimension tolerance", async () => {
  const root = createRoot([]);
  const geometry = expectedCaptureGeometry("landscape");
  let objectUrlCalls = 0;
  const dependencies = createDependencies({
    capture: () => ({
      width: geometry.canvasWidth + 2,
      height: geometry.canvasHeight - 2
    }),
    createObjectUrl() {
      objectUrlCalls += 1;
      return "blob:invalid-aspect";
    }
  });

  await assert.rejects(
    exportDailyPlanPdf({ root, orientation: "landscape", filename: "invalid.pdf" }, dependencies),
    (error) => error instanceof DailyPlanPdfExportError
      && error.message === DAILY_PLAN_PDF_ERROR_MESSAGE
  );
  assert.equal(objectUrlCalls, 0);
});

test("exportDailyPlanPdf rejects more than two marked pages before loading libraries", async () => {
  const root = createRoot([{ id: "one" }, { id: "two" }, { id: "three" }]);
  let loaderCalls = 0;
  await assert.rejects(
    exportDailyPlanPdf({
      root,
      orientation: "landscape",
      filename: "too-many.pdf"
    }, {
      async loadHtml2Canvas() {
        loaderCalls += 1;
        throw new Error("must not load");
      },
      async loadJsPdf() {
        loaderCalls += 1;
        throw new Error("must not load");
      }
    }),
    (error) => error instanceof DailyPlanPdfExportError
      && error.message === DAILY_PLAN_PDF_ERROR_MESSAGE
  );
  assert.equal(loaderCalls, 0);
});

test("exportDailyPlanPdf exposes only the stable error and remains retryable", async () => {
  const root = createRoot([]);
  let attempts = 0;
  const secret = "html2canvas internal Safari stack and source URL";
  const dependencies = createDependencies({
    async capture() {
      attempts += 1;
      if (attempts === 1) throw new Error(secret);
      const geometry = expectedCaptureGeometry("landscape");
      return { width: geometry.canvasWidth, height: geometry.canvasHeight };
    }
  });

  await assert.rejects(
    exportDailyPlanPdf({ root, orientation: "landscape", filename: "retry.pdf" }, dependencies),
    (error) => {
      assert.ok(error instanceof DailyPlanPdfExportError);
      assert.equal(error.code, "DAILY_PLAN_PDF_EXPORT_FAILED");
      assert.equal(error.message, DAILY_PLAN_PDF_ERROR_MESSAGE);
      assert.doesNotMatch(String(error), new RegExp(secret, "u"));
      return true;
    }
  );

  const retry = await exportDailyPlanPdf(
    { root, orientation: "landscape", filename: "retry.pdf" },
    dependencies
  );
  assert.equal(attempts, 2);
  assert.equal(retry.pageCount, 1);
});

test("exportDailyPlanPdf revokes its object URL when the download trigger fails", async () => {
  const root = createRoot([]);
  const revoked = [];
  const dependencies = createDependencies({
    triggerDownload() {
      throw new Error("download implementation detail");
    },
    revokeObjectUrl(url) {
      revoked.push(url);
    }
  });

  await assert.rejects(
    exportDailyPlanPdf({ root, orientation: "landscape", filename: "failure.pdf" }, dependencies),
    (error) => error instanceof DailyPlanPdfExportError
      && error.message === DAILY_PLAN_PDF_ERROR_MESSAGE
  );
  assert.deepEqual(revoked, ["blob:test"]);
});

test("live Landscape capture aborts when its snapshot changes during lazy loading", async () => {
  const root = createRoot([{ id: "ignored-page" }]);
  let validations = 0;
  let captures = 0;
  let objectUrlCalls = 0;
  await assert.rejects(
    exportDailyPlanPdf({
      root,
      orientation: "landscape",
      captureMode: "live-root",
      filename: "source-changed.pdf",
      validateSource() {
        validations += 1;
        return validations === 1;
      }
    }, createDependencies({
      capture(_page, options) {
        captures += 1;
        return createCanonicalCanvas(options);
      },
      createObjectUrl() {
        objectUrlCalls += 1;
        return "blob:must-not-download";
      }
    })),
    (error) => error instanceof DailyPlanPdfExportError
      && error.message === DAILY_PLAN_PDF_ERROR_MESSAGE
  );
  assert.equal(validations, 2);
  assert.equal(captures, 0);
  assert.equal(objectUrlCalls, 0);
});

test("live Landscape capture rejects geometry changes and unsafe canvas sizes", async () => {
  const changedRoot = createRoot([], undefined, { clientWidth: 1123, clientHeight: 794 });
  let changedRootCaptureCalls = 0;
  await assert.rejects(
    exportDailyPlanPdf({
      root: changedRoot,
      orientation: "landscape",
      captureMode: "live-root",
      filename: "geometry-changed.pdf"
    }, {
      async loadHtml2Canvas() {
        changedRoot.clientHeight += 1;
        return async () => {
          changedRootCaptureCalls += 1;
          return { width: 1, height: 1 };
        };
      },
      async loadJsPdf() {
        return createFakeJsPdf([], "landscape");
      }
    }),
    (error) => error instanceof DailyPlanPdfExportError
      && error.message === DAILY_PLAN_PDF_ERROR_MESSAGE
  );
  assert.equal(changedRootCaptureCalls, 0);

  const oversizedRoot = createRoot([], undefined, { clientWidth: 2000, clientHeight: 2000 });
  let loaderCalls = 0;
  await assert.rejects(
    exportDailyPlanPdf({
      root: oversizedRoot,
      orientation: "landscape",
      captureMode: "live-root",
      filename: "too-large.pdf"
    }, {
      async loadHtml2Canvas() {
        loaderCalls += 1;
        throw new Error("must not load");
      },
      async loadJsPdf() {
        loaderCalls += 1;
        throw new Error("must not load");
      }
    }),
    (error) => error instanceof DailyPlanPdfExportError
      && error.message === DAILY_PLAN_PDF_ERROR_MESSAGE
  );
  assert.equal(loaderCalls, 0);
});

function createRoot(
  markedPages,
  ownerDocument,
  { clientWidth = 1123, clientHeight = 794 } = {}
) {
  return {
    id: "root",
    clientHeight,
    clientWidth,
    ownerDocument,
    queries: [],
    matches() {
      return false;
    },
    querySelectorAll(selector) {
      this.queries.push(selector);
      return markedPages;
    }
  };
}

function createStyleOwnerDocument() {
  const mountedStyles = [];
  const removedStyles = [];
  const head = {
    appendChild(style) {
      mountedStyles.push(style);
      style.remove = () => {
        const index = mountedStyles.indexOf(style);
        if (index >= 0) mountedStyles.splice(index, 1);
        removedStyles.push(style);
      };
      return style;
    }
  };
  return {
    mountedStyles,
    removedStyles,
    ownerDocument: {
      head,
      documentElement: head,
      createElement(tagName) {
        assert.equal(tagName, "style");
        return {
          attributes: {},
          textContent: "",
          setAttribute(name, value) {
            this.attributes[name] = value;
          },
          remove() {}
        };
      }
    }
  };
}

function createDependencies({
  capture = (_page, options) => createCanonicalCanvas(options),
  orientation = "landscape",
  pdfInstances = [],
  outputBlob = new Blob(["%PDF-1.7 test"], { type: "application/pdf" }),
  addImageError,
  createObjectUrl = () => "blob:test",
  triggerDownload = () => undefined,
  revokeObjectUrl = () => undefined
} = {}) {
  return {
    async loadHtml2Canvas() {
      return async (page, options) => capture(page, options);
    },
    async loadJsPdf() {
      return createFakeJsPdf(pdfInstances, orientation, outputBlob, addImageError);
    },
    createObjectUrl,
    triggerDownload,
    revokeObjectUrl
  };
}

function expectedCaptureGeometry(orientation) {
  const widthMm = orientation === "landscape" ? 297 : 210;
  const heightMm = orientation === "landscape" ? 210 : 297;
  const cssWidth = widthMm * 96 / 25.4;
  const cssHeight = heightMm * 96 / 25.4;
  return {
    cssWidth,
    cssHeight,
    canvasWidth: Math.floor(cssWidth * 2),
    canvasHeight: Math.floor(cssHeight * 2)
  };
}

function expectedLiveRootCaptureGeometry(root) {
  return {
    cssWidth: root.clientWidth,
    cssHeight: root.clientHeight,
    canvasWidth: root.clientWidth * 2,
    canvasHeight: root.clientHeight * 2
  };
}

function createCanonicalCanvas(options) {
  return {
    width: Math.floor(options.width * options.scale),
    height: Math.floor(options.height * options.scale)
  };
}

function assertCenteredUniformPlacement(image, pageWidth, pageHeight) {
  const horizontalScale = image.width / image.canvas.width;
  const verticalScale = image.height / image.canvas.height;
  assert.ok(Math.abs(horizontalScale - verticalScale) < 1e-12);
  assert.ok(Math.abs(image.x - (pageWidth - image.width) / 2) < 1e-12);
  assert.ok(Math.abs(image.y - (pageHeight - image.height) / 2) < 1e-12);
  assert.ok(image.x >= 0);
  assert.ok(image.y >= 0);
  assert.ok(image.x + image.width <= pageWidth + Number.EPSILON);
  assert.ok(image.y + image.height <= pageHeight + Number.EPSILON);
  assert.ok(image.x > 0 || image.y > 0);
}

function createFakeJsPdf(
  instances,
  orientation,
  outputBlob = new Blob(["%PDF-1.7 test"], { type: "application/pdf" }),
  addImageError
) {
  return class FakeJsPdf {
    constructor(options) {
      this.options = options;
      this.addedPages = [];
      this.images = [];
      this.internal = {
        pageSize: {
          getWidth: () => orientation === "landscape" ? 297 : 210,
          getHeight: () => orientation === "landscape" ? 210 : 297
        }
      };
      instances.push(this);
    }

    addPage(format, nextOrientation) {
      this.addedPages.push([format, nextOrientation]);
    }

    addImage(canvas, format, x, y, width, height, alias, compression) {
      if (addImageError) throw addImageError;
      this.images.push({ canvas, format, x, y, width, height, alias, compression });
    }

    output(type) {
      assert.equal(type, "blob");
      return outputBlob;
    }
  };
}
