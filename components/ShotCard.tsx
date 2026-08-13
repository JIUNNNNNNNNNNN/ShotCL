"use client";

import { memo, useEffect, useMemo, useRef, useState, type RefCallback } from "react";
import { ImagePreviewModal } from "@/components/ImagePreviewModal";
import { ShotOverheadPreview } from "@/components/ShotOverheadPreview";
import { useContextualGuideAnchor } from "@/components/guides/ContextualGuideProvider";
import type { ProgressArchiveMediaAsset } from "@/lib/data/shotMediaArchive";
import {
  buildProgressMediaGalleryItems,
  clampGalleryIndex,
  prioritizeProgressMediaGalleryItem,
  type ProgressMediaCategory,
  type ProgressMediaGalleryItem
} from "@/lib/progress/mediaGallery";
import { formatProgressCutLabel } from "@/lib/progress/cutLabel";
import {
  resolveProgressCardHalfStatus,
  resolveProgressStatusToggle
} from "@/lib/progress/shotCardInteraction";
import { type Shot, type ShotMediaLink, type ShotStatus } from "@/lib/types";
import { hasShotOverheadContent } from "@/lib/shotOverhead";
import { cn } from "@/lib/utils";
import { usePersistentProjectShell } from "@/hooks/useProjectShellMode";

export type ShotCardProps = {
  shot: Shot;
  onOpen: (shot: Shot) => void;
  onEdit?: (shot: Shot) => void;
  archiveMedia?: ProgressArchiveMediaAsset[];
  selectedMediaLinks?: readonly ShotMediaLink[];
  mediaRevision?: number;
  onLoadGalleryMedia?: (
    shot: Shot,
    category: ProgressMediaCategory
  ) => Promise<ProgressArchiveMediaAsset[]>;
  onStatusChange: (shot: Shot, status: ShotStatus) => void;
  cardOpenDisabled?: boolean;
  statusReadOnly?: boolean;
  interactionMediaGuideTarget?: boolean;
};

/** 대표 미디어는 Gallery, 카드의 물리 우클릭은 기존 Cut 편집기로 분리합니다. */
export const ShotCard = memo(function ShotCard({
  shot,
  onOpen,
  onEdit,
  archiveMedia = [],
  selectedMediaLinks = [],
  mediaRevision = 0,
  onLoadGalleryMedia,
  onStatusChange,
  cardOpenDisabled = false,
  statusReadOnly = false,
  interactionMediaGuideTarget = false
}: ShotCardProps) {
  const persistentInteraction = usePersistentProjectShell();
  const lastPointerRef = useRef({ pointerType: "", button: -1, at: 0 });
  const isOk = shot.status === "ok";
  const isOmit = shot.status === "omit";
  const hasOverheadDiagram = hasShotOverheadContent(shot.overheadDiagram);
  const statusLabel = isOk ? "OK" : isOmit ? "OMIT" : "대기";
  const cutLabel = formatProgressCutLabel(shot.sceneNumber, shot.cutNumber);
  const [loadedGalleryMedia, setLoadedGalleryMedia] = useState<{
    shotId: string;
    revision: number;
    assets: ProgressArchiveMediaAsset[];
  } | null>(null);
  const mediaRevisionRef = useRef(mediaRevision);
  mediaRevisionRef.current = mediaRevision;
  const effectiveArchiveMedia = loadedGalleryMedia?.shotId === shot.id
    && loadedGalleryMedia.revision === mediaRevision
    ? loadedGalleryMedia.assets
    : archiveMedia;
  const selectedStoryboardLink = selectedMediaLinks.find((link) => link.mediaType === "storyboard") ?? null;
  const selectedOverheadLink = selectedMediaLinks.find((link) => link.mediaType === "overhead") ?? null;
  const storyboardGallery = useMemo(() => prioritizeProgressMediaGalleryItem(
    buildProgressMediaGalleryItems(
      effectiveArchiveMedia,
      "storyboard",
      shot.storyboardImageUrl ? {
        id: `${shot.id}:legacy-storyboard`,
        title: `${cutLabel} 콘티`,
        url: shot.storyboardImageUrl,
        thumbnailUrl: shot.storyboardImageUrl
      } : null
    ),
    selectedStoryboardLink?.publicUrl
  ), [cutLabel, effectiveArchiveMedia, selectedStoryboardLink?.publicUrl, shot.id, shot.storyboardImageUrl]);
  const overheadGallery = useMemo(() => prioritizeProgressMediaGalleryItem(
    buildProgressMediaGalleryItems(
      effectiveArchiveMedia,
      "overhead",
      shot.overheadImageUrl ? {
        id: `${shot.id}:legacy-overhead`,
        title: `${cutLabel} 부감도`,
        url: shot.overheadImageUrl,
        thumbnailUrl: shot.overheadImageUrl
      } : null
    ),
    selectedOverheadLink?.publicUrl
  ), [cutLabel, effectiveArchiveMedia, selectedOverheadLink?.publicUrl, shot.id, shot.overheadImageUrl]);
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
  const [loadingGallery, setLoadingGallery] = useState<ProgressMediaCategory | null>(null);
  const storyboardGalleryImages = useMemo(
    () => storyboardGallery.map((item) => ({ url: item.url, title: item.title })),
    [storyboardGallery]
  );
  const prefersLinkedOverheadImage = Boolean(selectedOverheadLink?.publicUrl?.trim());
  const overheadDiagramGalleryItem = hasOverheadDiagram && shot.overheadDiagram ? {
      url: `diagram:${shot.id}`,
      title: `${cutLabel} 부감도`,
      content: (
        <div className="h-[min(70vh,48rem)] w-full">
          <ShotOverheadPreview diagram={shot.overheadDiagram} label={`${cutLabel} 부감도`} />
        </div>
      )
    } : null;
  const overheadGalleryImages = useMemo(() => {
    const imageItems = overheadGallery.map((item) => ({ url: item.url, title: item.title }));
    if (!overheadDiagramGalleryItem) return imageItems;
    return prefersLinkedOverheadImage
      ? [...imageItems, overheadDiagramGalleryItem]
      : [overheadDiagramGalleryItem, ...imageItems];
  }, [overheadDiagramGalleryItem, overheadGallery, prefersLinkedOverheadImage]);
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

  useEffect(() => {
    setLoadedGalleryMedia(null);
    setLoadingGallery(null);
  }, [mediaRevision, shot.id]);

  function shouldIgnoreCardStatus(target: EventTarget | null) {
    return target instanceof Element && Boolean(target.closest(
      "button, a, input, textarea, select, option, label, [contenteditable='true'], [role='button'], [data-progress-interactive], [data-no-drag]"
    ));
  }

  function handleCardBackgroundClick(event: React.MouseEvent<HTMLElement>) {
    if (
      !persistentInteraction
      || statusReadOnly
      || event.defaultPrevented
      || event.button !== 0
      || event.detail === 0
      || event.ctrlKey
      || shouldIgnoreCardStatus(event.target)
    ) return;
    const requestedStatus = resolveProgressCardHalfStatus(
      event.clientX,
      event.currentTarget.getBoundingClientRect()
    );
    if (!requestedStatus) return;
    onStatusChange(shot, resolveProgressStatusToggle(shot.status, requestedStatus));
  }

  function handleCardContextMenu(event: React.MouseEvent<HTMLElement>) {
    event.preventDefault();
    event.stopPropagation();
    // A touch long-press can synthesize contextmenu on iPad/iPhone. Only the
    // preceding physical mouse/trackpad pointer may enter the desktop editor.
    const lastPointer = lastPointerRef.current;
    const physicalMouseContext = lastPointer.pointerType === "mouse"
      && Date.now() - lastPointer.at < 1_500
      && (lastPointer.button === 2 || event.button === 2 || event.ctrlKey);
    if (!persistentInteraction || cardOpenDisabled || !physicalMouseContext) return;
    (onEdit ?? onOpen)(shot);
  }

  async function openGallery(event: React.MouseEvent<HTMLButtonElement>, category: ProgressMediaCategory) {
    event.stopPropagation();
    const requestedRevision = mediaRevisionRef.current;
    if (
      onLoadGalleryMedia
      && (
        loadedGalleryMedia?.shotId !== shot.id
        || loadedGalleryMedia.revision !== requestedRevision
      )
    ) {
      setLoadingGallery(category);
      try {
        const assets = await onLoadGalleryMedia(shot, category);
        if (mediaRevisionRef.current !== requestedRevision) return;
        setLoadedGalleryMedia({ shotId: shot.id, revision: requestedRevision, assets });
      } catch {
        return;
      } finally {
        setLoadingGallery(null);
      }
    }
    if (mediaRevisionRef.current !== requestedRevision) return;
    setGalleryIndex(0);
    setActiveGallery(category);
  }

  return (
    <>
      <article
        data-progress-shot-card="true"
        onPointerDownCapture={(event) => {
          if (event.isPrimary) {
            lastPointerRef.current = {
              pointerType: event.pointerType,
              button: event.button,
              at: Date.now()
            };
          }
        }}
        onClick={handleCardBackgroundClick}
        onContextMenu={handleCardContextMenu}
        aria-label={statusReadOnly
          ? cutLabel
          : persistentInteraction
            ? `${cutLabel}. 왼쪽 영역 OMIT, 오른쪽 영역 OK`
            : `${cutLabel}. 오른쪽 스와이프 OK, 왼쪽 스와이프 OMIT`}
        className={cn(
          "ui-motion-surface relative grid min-w-0 gap-2 overflow-hidden rounded-[var(--radius-card)] border p-2 text-center transition-[background-color,border-color,transform]",
          persistentInteraction && !statusReadOnly ? "cursor-pointer active:scale-[0.995]" : "cursor-default",
          isOk
            ? "border-status-ok/80 bg-status-ok/10"
            : isOmit
              ? "border-field-danger/70 bg-field-danger/10"
              : "border-field-divider bg-field-panel hover:border-field-subtle hover:bg-field-hover"
        )}
      >
        <div className="grid min-w-0 max-w-full gap-2 overflow-hidden">
          <div className="min-w-0 px-0.5">
            <div className="flex min-w-0 flex-wrap items-center justify-center gap-1.5">
              <h2 className="min-w-0 break-words text-sm font-bold leading-5 text-field-text [overflow-wrap:anywhere]">
                {cutLabel}
              </h2>
              <p className={cn("rounded-md px-2 py-1 text-[10px] font-semibold leading-[1.35]", isOk ? "border border-status-ok/70 bg-status-ok/10 text-status-ok" : isOmit ? "bg-field-danger text-field-text" : "border border-field-divider bg-field-input text-field-muted")}>
                <span className="font-display">{statusLabel}</span>
              </p>
            </div>

            <div className="mt-0.5 grid min-w-0 grid-cols-2 gap-x-2 gap-y-1 text-[11px] font-normal leading-4 text-field-muted">
              {shot.characters.length > 0 ? <p className="col-start-1 min-w-0 break-words text-left [overflow-wrap:anywhere]">등장 {shot.characters.join(", ")}</p> : null}
              {shot.location ? <p className="col-start-2 min-w-0 break-words text-right text-field-muted [overflow-wrap:anywhere]">장소 {shot.location}</p> : null}
              {!shot.location && shot.memo ? <p className="col-span-2 min-w-0 break-words text-center [overflow-wrap:anywhere]">{shot.memo}</p> : null}
            </div>
          </div>

          {hasAnyMedia ? (
            <div className={cn(
              "grid min-w-0 gap-1.5 border-t border-field-divider/80 pt-2 sm:gap-2",
              hasStoryboard && hasOverhead ? "grid-cols-2" : "grid-cols-1"
            )}>
              {hasStoryboard ? (
                <ProgressMediaPreviewTile
                  label="콘티"
                  items={storyboardGallery}
                  loading={loadingGallery === "storyboard"}
                  guideAnchorRef={interactionMediaGuideCategory === "storyboard"
                    ? mediaGalleryGuideAnchorRef
                    : undefined}
                  onOpen={(event) => openGallery(event, "storyboard")}
                />
              ) : null}
              {hasOverhead ? (
                <ProgressMediaPreviewTile
                  label="부감도"
                  items={overheadGallery}
                  diagram={hasOverheadDiagram && !prefersLinkedOverheadImage ? shot.overheadDiagram : null}
                  count={overheadGalleryImages.length}
                  loading={loadingGallery === "overhead"}
                  guideAnchorRef={interactionMediaGuideCategory === "overhead"
                    ? mediaGalleryGuideAnchorRef
                    : undefined}
                  onOpen={(event) => openGallery(event, "overhead")}
                />
              ) : null}
            </div>
          ) : null}
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
  count: countOverride,
  loading = false,
  guideAnchorRef,
  onOpen
}: {
  label: "콘티" | "부감도";
  items: ProgressMediaGalleryItem[];
  diagram?: Shot["overheadDiagram"] | null;
  count?: number;
  loading?: boolean;
  guideAnchorRef?: RefCallback<HTMLButtonElement>;
  onOpen: (event: React.MouseEvent<HTMLButtonElement>) => void;
}) {
  const firstItem = items[0] ?? null;
  // Legacy archive rows may predate thumbnail generation. Their canonical
  // browser URL remains a safe fallback; modern rows still prefer the compact
  // thumbnail variant.
  const previewUrl = firstItem?.thumbnailUrl || firstItem?.url || "";
  const count = countOverride ?? items.length + (diagram ? 1 : 0);
  const [imageFailed, setImageFailed] = useState(false);

  useEffect(() => {
    setImageFailed(false);
  }, [previewUrl]);

  return (
    <button
      ref={guideAnchorRef}
      type="button"
      data-no-drag="true"
      disabled={loading}
      onClick={onOpen}
      className="group grid min-w-0 grid-rows-[auto_minmax(0,1fr)] overflow-hidden rounded-[var(--radius-control)] border border-field-divider bg-field-input p-0 text-field-text transition-[border-color,background-color,opacity] hover:border-field-primary/70 hover:bg-field-hover active:opacity-80 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-field-primary"
      aria-label={loading ? `${label} 불러오는 중` : `${label} ${count}장 보기`}
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
        ) : previewUrl && !imageFailed ? (
          // eslint-disable-next-line @next/next/no-img-element
          <img
            src={previewUrl}
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
