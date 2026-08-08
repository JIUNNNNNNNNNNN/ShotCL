"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import { ExternalLink } from "lucide-react";
import { SectionLoader } from "@/components/PixelDogLoader";
import { loadScenarioPdfDocument } from "@/lib/client/scenarioPdfImages";
import { auditQuery } from "@/lib/queryAudit";
import type { ProjectScenarioImageSegment } from "@/lib/types";

type Props = {
  pdfUrl: string;
  filename: string;
  segments: ProjectScenarioImageSegment[];
  pageStart: number | null;
  pageEnd: number | null;
};

type RenderState = "loading" | "ready" | "error";

export function ScenarioPdfSceneSegments({
  pdfUrl,
  filename,
  segments,
  pageStart,
  pageEnd
}: Props) {
  const containerRef = useRef<HTMLDivElement | null>(null);
  const [state, setState] = useState<RenderState>("loading");
  const renderSegments = useMemo(
    () => segments.length > 0
      ? segments
      : buildPageFallbackSegments(pageStart, pageEnd),
    [pageEnd, pageStart, segments]
  );

  useEffect(() => {
    let cancelled = false;
    const canvases: HTMLCanvasElement[] = [];
    setState("loading");

    async function render() {
      if (!containerRef.current || renderSegments.length === 0) {
        setState("error");
        return;
      }
      const pdfDocument = await auditQuery(
        "scenario.renderExpandedScenePdf",
        "components/ScenarioPdfSceneSegments.tsx:render",
        () => loadScenarioPdfDocument(pdfUrl)
      );
      try {
        const segmentsByPage = new Map<
          number,
          Array<{ index: number; segment: ProjectScenarioImageSegment }>
        >();
        renderSegments.forEach((segment, index) => {
          if (segment.pageIndex < 0 || segment.pageIndex >= pdfDocument.numPages) return;
          const pageSegments = segmentsByPage.get(segment.pageIndex) ?? [];
          pageSegments.push({ index, segment });
          segmentsByPage.set(segment.pageIndex, pageSegments);
        });
        const pixelRatio = Math.min(3, Math.max(2, window.devicePixelRatio || 1));

        for (const [pageIndex, pageSegments] of segmentsByPage) {
          if (cancelled) return;
          const targets = pageSegments.flatMap(({ index, segment }) => {
            const target = containerRef.current?.querySelector<HTMLCanvasElement>(
              `[data-segment-index="${index}"]`
            );
            return target ? [{ segment, target }] : [];
          });
          if (targets.length === 0) continue;
          targets.forEach(({ target }) => canvases.push(target));

          const page = await pdfDocument.getPage(pageIndex + 1);
          const source = window.document.createElement("canvas");
          try {
            const viewport = page.getViewport({ scale: pixelRatio });
            source.width = Math.ceil(viewport.width);
            source.height = Math.ceil(viewport.height);
            const sourceContext = source.getContext("2d", { alpha: false });
            if (!sourceContext) throw new Error("PDF canvas를 생성하지 못했습니다.");
            await page.render({ canvas: source, canvasContext: sourceContext, viewport }).promise;
            if (cancelled) return;

            targets.forEach(({ segment, target }) => {
              const startY = Math.floor(clamp(segment.startYRatio, 0, 1) * source.height);
              const endY = Math.ceil(clamp(segment.endYRatio, 0, 1) * source.height);
              const cropHeight = Math.max(1, endY - startY);
              target.width = source.width;
              target.height = cropHeight;
              const targetContext = target.getContext("2d", { alpha: false });
              if (!targetContext) throw new Error("PDF crop canvas를 생성하지 못했습니다.");
              targetContext.fillStyle = "#ffffff";
              targetContext.fillRect(0, 0, target.width, target.height);
              targetContext.drawImage(
                source,
                0,
                startY,
                source.width,
                cropHeight,
                0,
                0,
                source.width,
                cropHeight
              );
            });
          } finally {
            source.width = 1;
            source.height = 1;
            page.cleanup();
          }
        }
        if (!cancelled) setState("ready");
      } finally {
        await pdfDocument.cleanup();
      }
    }

    void render().catch(() => {
      if (!cancelled) setState("error");
    });

    return () => {
      cancelled = true;
      canvases.forEach((canvas) => {
        canvas.width = 1;
        canvas.height = 1;
      });
    };
  }, [pdfUrl, renderSegments]);

  if (renderSegments.length === 0) {
    return <SceneImageFallback pdfUrl={pdfUrl} filename={filename} />;
  }

  return (
    <div className="relative mx-auto w-full max-w-5xl bg-white">
      {state === "loading" ? (
        <div className="absolute inset-x-0 top-8 z-10 flex justify-center">
          <SectionLoader className="!min-h-20" />
        </div>
      ) : null}
      <div
        ref={containerRef}
        className={state === "ready" ? "opacity-100" : "min-h-52 opacity-0"}
      >
        {renderSegments.map((segment, index) => (
          <canvas
            key={`${segment.pageIndex}-${segment.startYRatio}-${segment.endYRatio}-${index}`}
            data-segment-index={index}
            aria-label={`${filename} ${segment.pageIndex + 1}페이지 씬 이미지`}
            className="block h-auto w-full bg-white"
          />
        ))}
      </div>
      {state === "error" ? <SceneImageFallback pdfUrl={pdfUrl} filename={filename} /> : null}
    </div>
  );
}

function SceneImageFallback({ pdfUrl, filename }: { pdfUrl: string; filename: string }) {
  return (
    <div className="flex min-h-40 items-center justify-center bg-field-panel px-4 py-6">
      <a
        href={pdfUrl}
        target="_blank"
        rel="noreferrer"
        className="inline-flex min-h-9 items-center gap-1.5 border border-field-divider bg-field-panel px-3 text-xs font-bold text-field-text transition-colors hover:bg-field-hover focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-field-primary"
      >
        <ExternalLink className="h-3.5 w-3.5" aria-hidden />
        {filename} 원본 PDF 열기
      </a>
    </div>
  );
}

function buildPageFallbackSegments(pageStart: number | null, pageEnd: number | null) {
  if (!pageStart) return [];
  const end = Math.max(pageStart, pageEnd ?? pageStart);
  return Array.from({ length: end - pageStart + 1 }, (_, offset) => ({
    pageIndex: pageStart - 1 + offset,
    startYRatio: 0,
    endYRatio: 1
  }));
}

function clamp(value: number, minimum: number, maximum: number) {
  return Math.min(maximum, Math.max(minimum, value));
}
