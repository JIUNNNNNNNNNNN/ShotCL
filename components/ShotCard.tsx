"use client";

import { memo, useEffect, useMemo, useState, type RefCallback } from "react";
import { Images, Map } from "lucide-react";
import { ImagePreviewModal } from "@/components/ImagePreviewModal";
import { ShotOverheadPreview } from "@/components/ShotOverheadPreview";
import { useContextualGuideAnchor } from "@/components/guides/ContextualGuideProvider";
import type { ProgressArchiveMediaAsset } from "@/lib/data/shotMediaArchive";
import {
  buildProgressMediaGalleryItems,
  clampGalleryIndex,
  type ProgressMediaCategory,
  type ProgressMediaGalleryItem
} from "@/lib/progress/mediaGallery";
import { formatProgressCutLabel } from "@/lib/progress/cutLabel";
import { type Shot, type ShotMediaType, type ShotStatus } from "@/lib/types";
import { hasShotOverheadContent } from "@/lib/shotOverhead";
import { cn } from "@/lib/utils";

type ShotCardProps = {
  shot: Shot;
  onOpen: (shot: Shot) => void;
  onOpenMedia: (shot: Shot, type: ShotMediaType) => void;
  archiveMedia?: ProgressArchiveMediaAsset[];
  onStatusChange: (shot: Shot, status: ShotStatus) => void;
  progressOnly?: boolean;
  isOverheadLoading?: boolean;
  interactionMediaGuideTarget?: boolean;
};

/** 컷 중심 현장 진행표 카드입니다. 버튼 클릭은 카드 수정 모달과 분리합니다. */
export const ShotCard = memo(function ShotCard({
  shot,
  onOpen,
  onOpenMedia,
  archiveMedia = [],
  onStatusChange,
  progressOnly = false,
  isOverheadLoading = false,
  interactionMediaGuideTarget = false
}: ShotCardProps) {
  const isOk = shot.status === "ok";
  const isOmit = shot.status === "omit";
  const hasOverheadDiagram = hasShotOverheadContent(shot.overheadDiagram);
  const statusLabel = isOk ? "OK" : isOmit ? "OMIT" : "대기";
  const cutLabel = formatProgressCutLabel(shot.sceneNumber, shot.cutNumber);
  const storyboardGallery = useMemo(() => buildProgressMediaGalleryItems(
    archiveMedia,
    "storyboard",
    shot.storyboardImageUrl ? {
      id: `${shot.id}:legacy-storyboard`,
      title: `${cutLabel} 콘티`,
      url: shot.storyboardImageUrl,
      // Metadata가 없는 오래된 직접 연결은 원본을 목록 thumbnail로 내려받지 않습니다.
      // Gallery에서는 원본 URL을 그대로 사용할 수 있고, 목록은 compact fallback을 표시합니다.
      thumbnailUrl: ""
    } : null
  ), [archiveMedia, cutLabel, shot.id, shot.storyboardImageUrl]);
  const overheadGallery = useMemo(() => buildProgressMediaGalleryItems(
    archiveMedia,
    "overhead",
    shot.overheadImageUrl ? {
      id: `${shot.id}:legacy-overhead`,
      title: `${cutLabel} 부감도`,
      url: shot.overheadImageUrl,
      thumbnailUrl: ""
    } : null
  ), [archiveMedia, cutLabel, shot.id, shot.overheadImageUrl]);
  const hasStoryboard = storyboardGallery.length > 0;
  const hasOverhead = overheadGallery.length > 0 || hasOverheadDiagram;
  const hasAnyMedia = hasStoryboard || hasOverhead;
  const interactionMediaGuideCategory = interactionMediaGuideTarget
    ? storyboardGallery.length >= 2
      ? "storyboard"
      : overheadGallery.length + (hasOverheadDiagram ? 1 : 0) >= 2
        ? "overhead"
        : null
    : null;
  const mediaGalleryGuideAnchorRef = useContextualGuideAnchor<HTMLButtonElement>(
    interactionMediaGuideCategory ? "progress.media-gallery" : null
  );
  const [activeGallery, setActiveGallery] = useState<ProgressMediaCategory | null>(null);
  const [galleryIndex, setGalleryIndex] = useState(0);
  const storyboardGalleryImages = useMemo(
    () => storyboardGallery.map((item) => ({ url: item.url, title: item.title })),
    [storyboardGallery]
  );
  const overheadGalleryImages = useMemo(() => [
    ...(hasOverheadDiagram && shot.overheadDiagram ? [{
      url: `diagram:${shot.id}`,
      title: `${cutLabel} 부감도`,
      content: (
        <div className="h-[min(70vh,48rem)] w-full">
          <ShotOverheadPreview diagram={shot.overheadDiagram} label={`${cutLabel} 부감도`} />
        </div>
      )
    }] : []),
    ...overheadGallery.map((item) => ({ url: item.url, title: item.title }))
  ], [cutLabel, hasOverheadDiagram, overheadGallery, shot.id, shot.overheadDiagram]);
  const activeGalleryImages = activeGallery === "storyboard"
    ? storyboardGalleryImages
    : activeGallery === "overhead"
      ? overheadGalleryImages
      : [];
  const safeGalleryIndex = clampGalleryIndex(galleryIndex, activeGalleryImages.length);
  const activeGalleryItem = activeGalleryImages[safeGalleryIndex] ?? null;

  useEffect(() => {
    if (!activeGallery) return;
    if (activeGalleryImages.length === 0) {
      setActiveGallery(null);
      setGalleryIndex(0);
      return;
    }
    if (galleryIndex !== safeGalleryIndex) setGalleryIndex(safeGalleryIndex);
  }, [activeGallery, activeGalleryImages.length, galleryIndex, safeGalleryIndex]);

  function shouldIgnoreCardOpen(target: EventTarget | null) {
    return target instanceof HTMLElement && Boolean(target.closest("button, a, input, textarea, select, [data-no-drag]"));
  }

  function handleCardOpen(event: React.MouseEvent<HTMLElement>) {
    if (shouldIgnoreCardOpen(event.target)) return;
    onOpen(shot);
  }

  function handleStatusClick(event: React.MouseEvent<HTMLButtonElement>, status: ShotStatus) {
    event.stopPropagation();
    onStatusChange(shot, shot.status === status ? "pending" : status);
  }

  function openGallery(event: React.MouseEvent<HTMLButtonElement>, category: ProgressMediaCategory) {
    event.stopPropagation();
    setGalleryIndex(0);
    setActiveGallery(category);
  }

  return (
    <>
      <article
        onClick={handleCardOpen}
        aria-label={progressOnly ? `${cutLabel} 상세 보기` : `${cutLabel} 수정`}
        className={cn(
          "ui-motion-surface relative grid min-w-0 cursor-pointer gap-2 overflow-hidden rounded-[var(--radius-card)] border p-2 text-center transition-[background-color,border-color,transform] active:scale-[0.995] md:grid-cols-[minmax(0,1fr)_6.5rem] md:items-center",
          isOk
            ? "border-status-ok/80 bg-status-ok/10"
            : isOmit
              ? "border-field-danger/70 bg-field-danger/10"
              : "border-field-divider bg-field-panel hover:border-field-subtle hover:bg-field-hover"
        )}
      >
        <div className="grid min-w-0 max-w-full gap-2 overflow-hidden">
          <div className="min-w-0 px-0.5">
            <div className="relative flex min-w-0 flex-wrap items-center justify-center gap-1.5">
              <h2 className="min-w-0 break-words text-sm font-bold leading-5 text-field-text [overflow-wrap:anywhere]">
                {cutLabel}
              </h2>
              <p className={cn("rounded-md px-2 py-1 text-[10px] font-semibold leading-[1.35]", isOk ? "border border-status-ok/70 bg-status-ok/10 text-status-ok" : isOmit ? "bg-field-danger text-field-text" : "border border-field-divider bg-field-input text-field-muted")}>
                <span className="font-display">{statusLabel}</span>
              </p>
              <div className="flex flex-wrap items-center justify-center gap-1 sm:ml-auto">
                <button
                  type="button"
                  onClick={(event) => {
                    event.stopPropagation();
                    onOpenMedia(shot, "storyboard");
                  }}
                  className={cn(
                    "ui-density-control inline-flex items-center gap-1 border px-2 text-[10px] font-bold transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-field-primary",
                    hasStoryboard ? "neon-selected" : "border-field-divider bg-field-input text-field-text hover:border-field-subtle hover:bg-field-hover"
                  )}
                  title={progressOnly ? "콘티 아카이브 보기" : "콘티 아카이브에서 선택"}
                >
                  <Images className="h-3.5 w-3.5" aria-hidden />
                  콘티
                </button>
                <button
                  type="button"
                  onClick={(event) => {
                    event.stopPropagation();
                    onOpenMedia(shot, "overhead");
                  }}
                  disabled={isOverheadLoading}
                  className={cn(
                    "ui-density-control inline-flex items-center gap-1 border px-2 text-[10px] font-bold transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-field-primary disabled:cursor-wait disabled:opacity-55",
                    hasOverhead ? "neon-selected" : "border-field-divider bg-field-input text-field-text hover:border-field-subtle hover:bg-field-hover"
                  )}
                  title={progressOnly ? "부감도 아카이브 보기" : "부감도 아카이브에서 선택"}
                >
                  <Map className="h-3.5 w-3.5" aria-hidden />
                  부감도
                </button>
              </div>
            </div>

            <div className="mt-0.5 grid min-w-0 gap-1 text-center text-[11px] font-normal leading-4 text-field-muted sm:grid-cols-2">
              {shot.characters.length > 0 ? <p className="min-w-0 break-words [overflow-wrap:anywhere]">등장 {shot.characters.join(", ")}</p> : null}
              {shot.location ? <p className="min-w-0 break-words text-field-muted [overflow-wrap:anywhere]">장소 {shot.location}</p> : null}
              {!shot.location && shot.memo ? <p className="min-w-0 break-words sm:col-span-2 [overflow-wrap:anywhere]">{shot.memo}</p> : null}
            </div>
          </div>

          {hasAnyMedia ? (
            <div className="grid min-w-0 grid-cols-2 gap-1.5 border-t border-field-divider/80 pt-2 sm:gap-2">
              <ProgressMediaPreviewTile
                label="콘티"
                items={storyboardGallery}
                guideAnchorRef={interactionMediaGuideCategory === "storyboard"
                  ? mediaGalleryGuideAnchorRef
                  : undefined}
                onOpen={(event) => openGallery(event, "storyboard")}
              />
              <ProgressMediaPreviewTile
                label="부감도"
                items={overheadGallery}
                diagram={hasOverheadDiagram ? shot.overheadDiagram : null}
                guideAnchorRef={interactionMediaGuideCategory === "overhead"
                  ? mediaGalleryGuideAnchorRef
                  : undefined}
                onOpen={(event) => openGallery(event, "overhead")}
              />
            </div>
          ) : null}
        </div>

        <div className="grid grid-cols-2 gap-2 md:grid-cols-1">
          <button
            type="button"
            data-no-drag="true"
            onClick={(event) => handleStatusClick(event, "ok")}
            aria-pressed={isOk}
            className={cn(
              "ui-density-control border text-xs font-bold leading-[1.25] transition-[background-color,transform] active:scale-95 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-field-primary",
              isOk ? "border-status-ok/80 bg-status-ok/10 text-status-ok" : "border-field-divider bg-field-input text-field-text hover:border-field-subtle hover:bg-field-hover"
            )}
          >
            <span className="font-display">OK</span>
          </button>
          <button
            type="button"
            data-no-drag="true"
            onClick={(event) => handleStatusClick(event, "omit")}
            aria-pressed={isOmit}
            className={cn(
              "ui-density-control border text-xs font-bold leading-[1.25] transition-[background-color,transform] active:scale-95 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-field-primary",
              isOmit ? "border-field-danger bg-field-danger text-field-text" : "border-field-danger/60 bg-field-input text-field-danger"
            )}
          >
            <span className="font-display">OMIT</span>
          </button>
        </div>
      </article>

      {activeGallery && activeGalleryItem ? (
        <ImagePreviewModal
          imageUrl={activeGalleryItem.url}
          title={activeGalleryItem.title || (activeGallery === "storyboard" ? "콘티" : "부감도")}
          galleryLabel={activeGallery === "storyboard" ? "콘티" : "부감도"}
          images={activeGalleryImages}
          activeIndex={safeGalleryIndex}
          loop={false}
          onNavigate={setGalleryIndex}
          onClose={() => {
            setActiveGallery(null);
            setGalleryIndex(0);
          }}
        />
      ) : null}
    </>
  );
});

function ProgressMediaPreviewTile({
  label,
  items,
  diagram,
  guideAnchorRef,
  onOpen
}: {
  label: "콘티" | "부감도";
  items: ProgressMediaGalleryItem[];
  diagram?: Shot["overheadDiagram"] | null;
  guideAnchorRef?: RefCallback<HTMLButtonElement>;
  onOpen: (event: React.MouseEvent<HTMLButtonElement>) => void;
}) {
  const firstItem = items[0] ?? null;
  const hasContent = Boolean(firstItem || diagram);
  const count = items.length + (diagram ? 1 : 0);
  const [imageFailed, setImageFailed] = useState(false);

  useEffect(() => {
    setImageFailed(false);
  }, [firstItem?.thumbnailUrl]);

  if (!hasContent) {
    return (
      <div className="grid min-w-0 grid-rows-[auto_minmax(0,1fr)] overflow-hidden rounded-[var(--radius-control)] border border-dashed border-field-divider bg-field-input/40 text-field-muted" aria-label={`${label} 없음`}>
        <span className="truncate whitespace-nowrap border-b border-field-divider/70 px-2 py-1.5 text-[10px] font-bold">{label} 없음</span>
        <span className="flex h-24 min-w-0 items-center justify-center px-2 text-[10px] sm:h-28">이미지 없음</span>
      </div>
    );
  }

  return (
    <button
      ref={guideAnchorRef}
      type="button"
      data-no-drag="true"
      onClick={onOpen}
      className="group grid min-w-0 grid-rows-[auto_minmax(0,1fr)] overflow-hidden rounded-[var(--radius-control)] border border-field-divider bg-field-input p-0 text-field-text transition-[border-color,background-color,opacity] hover:border-field-primary/70 hover:bg-field-hover active:opacity-80 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-field-primary"
      aria-label={`${label} ${count}장 보기`}
      title={`${label} ${count}장 보기`}
    >
      <span className="truncate whitespace-nowrap border-b border-field-divider/70 px-2 py-1.5 text-[10px] font-bold">
        {label} · {count}
      </span>
      <span className="relative flex h-24 min-w-0 items-center justify-center overflow-hidden bg-field-soft sm:h-28">
        <span className="absolute inset-0 flex items-center justify-center px-2 text-[10px] text-field-muted">
          미리보기 없음
        </span>
        {diagram ? (
          <span className="relative z-[1] block h-full w-full">
            <ShotOverheadPreview diagram={diagram} label="부감도 미리보기" />
          </span>
        ) : firstItem?.thumbnailUrl && !imageFailed ? (
          // eslint-disable-next-line @next/next/no-img-element
          <img
            src={firstItem.thumbnailUrl}
            alt=""
            loading="lazy"
            decoding="async"
            draggable={false}
            onError={() => setImageFailed(true)}
            className="relative z-[1] block h-full w-full select-none object-contain [-webkit-user-drag:none]"
          />
        ) : null}
      </span>
    </button>
  );
}
