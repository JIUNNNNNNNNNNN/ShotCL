"use client";

import { memo } from "react";
import { Images, Map } from "lucide-react";
import { ShotOverheadPreview } from "@/components/ShotOverheadPreview";
import type { ProgressArchiveMediaAsset } from "@/lib/data/shotMediaArchive";
import { formatProgressCutLabel } from "@/lib/progress/cutLabel";
import { type Shot, type ShotMediaType, type ShotStatus } from "@/lib/types";
import { hasShotOverheadContent } from "@/lib/shotOverhead";
import { cn } from "@/lib/utils";

type ShotCardProps = {
  shot: Shot;
  onOpen: (shot: Shot) => void;
  onOpenMedia: (shot: Shot, type: ShotMediaType) => void;
  onImagePreview: (url: string, title: string) => void;
  archiveMedia?: ProgressArchiveMediaAsset[];
  onArchivePreview?: (
    asset: ProgressArchiveMediaAsset,
    assets: ProgressArchiveMediaAsset[]
  ) => void;
  onStatusChange: (shot: Shot, status: ShotStatus) => void;
  progressOnly?: boolean;
  isOverheadLoading?: boolean;
};

/** 컷 중심 현장 진행표 카드입니다. 버튼 클릭은 카드 수정 모달과 분리합니다. */
export const ShotCard = memo(function ShotCard({
  shot,
  onOpen,
  onOpenMedia,
  onImagePreview,
  archiveMedia = [],
  onArchivePreview,
  onStatusChange,
  progressOnly = false,
  isOverheadLoading = false
}: ShotCardProps) {
  const isOk = shot.status === "ok";
  const isOmit = shot.status === "omit";
  const hasOverheadDiagram = hasShotOverheadContent(shot.overheadDiagram);
  const storyboardArchive = archiveMedia.filter((asset) => asset.mediaType === "storyboard");
  const overheadArchive = archiveMedia.filter((asset) => asset.mediaType === "overhead");
  const primaryStoryboardImageUrl = shot.storyboardImageUrl
    && !storyboardArchive.some((asset) => asset.publicUrl === shot.storyboardImageUrl)
    ? shot.storyboardImageUrl
    : null;
  const primaryOverheadImageUrl = shot.overheadImageUrl
    && !overheadArchive.some((asset) => asset.publicUrl === shot.overheadImageUrl)
    ? shot.overheadImageUrl
    : null;
  const hasStoryboard = Boolean(shot.storyboardImageUrl || storyboardArchive.length);
  const hasOverhead = Boolean(shot.overheadImageUrl || hasOverheadDiagram || overheadArchive.length);
  const statusLabel = isOk ? "OK" : isOmit ? "OMIT" : "대기";
  const hasPrimaryMedia = Boolean(primaryStoryboardImageUrl || primaryOverheadImageUrl || hasOverheadDiagram);
  const cutLabel = formatProgressCutLabel(shot.sceneNumber, shot.cutNumber);

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

  function handleImageClick(event: React.MouseEvent<HTMLButtonElement>) {
    event.stopPropagation();
    if (primaryStoryboardImageUrl) {
      onImagePreview(primaryStoryboardImageUrl, `${cutLabel} 콘티`);
    }
  }

  return (
    <article
      onClick={handleCardOpen}
      aria-label={progressOnly ? `${cutLabel} 상세 보기` : `${cutLabel} 수정`}
      className={cn(
        "relative grid min-w-0 cursor-pointer gap-2 overflow-hidden  border p-2 transition-[background-color,border-color,transform] active:scale-[0.995] md:grid-cols-[minmax(0,1fr)_6.5rem] md:items-center",
        isOk
          ? "border-field-primary/80 bg-field-primary/10 after:pointer-events-none after:absolute after:inset-x-3 after:top-1/2 after:z-10 after:h-[2px] after:-translate-y-1/2 after:bg-field-primary/55 after:content-['']"
          : isOmit
            ? "border-field-danger/70 bg-field-danger/10"
            : "border-field-divider bg-field-panel hover:border-field-subtle hover:bg-field-hover"
      )}
    >
      <div className="grid min-w-0 max-w-full gap-2 overflow-hidden">
        <div className={cn("grid min-w-0 max-w-full gap-2 overflow-hidden", hasPrimaryMedia && "sm:grid-cols-[minmax(0,19rem)_minmax(0,1fr)] sm:items-center")}>
        {hasPrimaryMedia ? (
          <div className={cn("grid h-36 w-full max-w-full min-w-0 overflow-visible  gap-1.5 sm:h-32", primaryStoryboardImageUrl && (primaryOverheadImageUrl || hasOverheadDiagram) ? "grid-cols-2" : "grid-cols-1")}>
            {primaryStoryboardImageUrl ? (
              <button
                type="button"
                onClick={handleImageClick}
                data-no-drag="true"
                className="flex h-full w-full max-w-full min-w-0 items-center justify-center overflow-visible  !border-0 p-0 focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-[-2px] focus-visible:outline-field-primary"
                title="콘티 크게 보기"
              >
                {/* eslint-disable-next-line @next/next/no-img-element */}
                <img
                  src={primaryStoryboardImageUrl}
                  alt={`${cutLabel} 콘티`}
                  loading="lazy"
                  decoding="async"
                  draggable={false}
                  className="block h-full max-h-full w-full max-w-full select-none  object-contain [-webkit-user-drag:none]"
                />
              </button>
            ) : null}
            {primaryOverheadImageUrl ? (
              <button
                type="button"
                onClick={(event) => {
                  event.stopPropagation();
                  onImagePreview(primaryOverheadImageUrl, `${cutLabel} 부감도`);
                }}
                data-no-drag="true"
                className="h-full w-full max-w-full min-w-0 overflow-visible  !border-0 p-0 focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-[-2px] focus-visible:outline-field-primary"
                title="업로드 부감도 크게 보기"
              >
                {/* eslint-disable-next-line @next/next/no-img-element */}
                <img
                  src={primaryOverheadImageUrl}
                  alt={`${cutLabel} 부감도`}
                  loading="lazy"
                  decoding="async"
                  draggable={false}
                  className="block h-full max-h-full w-full max-w-full select-none  object-contain [-webkit-user-drag:none]"
                />
              </button>
            ) : hasOverheadDiagram && shot.overheadDiagram ? (
              <button
                type="button"
                onClick={(event) => {
                  event.stopPropagation();
                  onOpenMedia(shot, "overhead");
                }}
                data-no-drag="true"
                className="h-full w-full max-w-full min-w-0 overflow-visible  !border-0 p-0 focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-[-2px] focus-visible:outline-field-primary"
                title="부감도&콘티 페이지로 이동"
              >
                <ShotOverheadPreview diagram={shot.overheadDiagram} label={`${cutLabel} 부감도 미리보기`} />
              </button>
            ) : null}
          </div>
        ) : null}

        <div className="min-w-0 px-0.5">
        <div className="flex min-w-0 items-center gap-1.5">
          <h2 className="min-w-0 truncate text-sm font-bold leading-5 text-field-text">
            {cutLabel}
          </h2>
          <p className={cn("px-2 py-1 text-[10px] font-bold leading-[1.35]", isOk ? "border border-field-primary/70 bg-field-primary/10 text-field-primary" : isOmit ? "bg-field-danger text-field-text" : "border border-field-divider bg-field-input text-field-muted")}>
            <span className="font-display">{statusLabel}</span>
          </p>
          <div className="ml-auto flex shrink-0 items-center gap-1">
            <button
              type="button"
              onClick={(event) => {
                event.stopPropagation();
                onOpenMedia(shot, "storyboard");
              }}
              className={cn(
                "inline-flex min-h-7 items-center gap-1  border px-2 text-[10px] font-bold transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-field-primary",
                hasStoryboard ? "border-field-primary/80 bg-field-primary/10 text-field-primary" : "border-field-divider bg-field-input text-field-text hover:border-field-subtle hover:bg-field-hover"
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
                "inline-flex min-h-7 items-center gap-1  border px-2 text-[10px] font-bold transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-field-primary disabled:cursor-wait disabled:opacity-55",
                hasOverhead ? "border-field-primary/80 bg-field-primary/10 text-field-primary" : "border-field-divider bg-field-input text-field-text hover:border-field-subtle hover:bg-field-hover"
              )}
              title={progressOnly ? "부감도 아카이브 보기" : "부감도 아카이브에서 선택"}
            >
              <Map className="h-3.5 w-3.5" aria-hidden />
              부감도
            </button>
          </div>
        </div>

        <div className="mt-0.5 flex min-w-0 items-center gap-2 text-[11px] font-normal text-field-muted">
          {shot.characters.length > 0 ? <p className="max-w-[35%] shrink-0 truncate">등장 {shot.characters.join(", ")}</p> : null}
          {shot.location ? <p className="min-w-0 flex-1 truncate text-field-muted">장소 {shot.location}</p> : null}
          {!shot.location && shot.memo ? <p className="min-w-0 flex-1 truncate">{shot.memo}</p> : null}
        </div>
      </div>
      </div>
        {storyboardArchive.length > 0 ? (
          <ArchiveMediaStrip
            label="콘티"
            assets={storyboardArchive}
            onPreview={onArchivePreview}
          />
        ) : null}
        {overheadArchive.length > 0 ? (
          <ArchiveMediaStrip
            label="부감도"
            assets={overheadArchive}
            onPreview={onArchivePreview}
          />
        ) : null}
      </div>

        <div className="grid grid-cols-2 gap-2 md:grid-cols-1">
          <button
            type="button"
            data-no-drag="true"
            onClick={(event) => handleStatusClick(event, "ok")}
            aria-pressed={isOk}
            className={cn(
              "min-h-[38px]  border text-xs font-bold leading-[1.25] transition-[background-color,transform] active:scale-95 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-field-primary",
              isOk ? "border-field-primary/80 bg-field-primary/10 text-field-primary" : "border-field-divider bg-field-input text-field-text hover:border-field-subtle hover:bg-field-hover"
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
              "min-h-[38px]  border text-xs font-bold leading-[1.25] transition-[background-color,transform] active:scale-95 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-field-primary",
              isOmit ? "border-field-danger bg-field-danger text-field-text" : "border-field-danger/60 bg-field-input text-field-danger"
            )}
          >
            <span className="font-display">OMIT</span>
          </button>
        </div>
    </article>
  );
});

function ArchiveMediaStrip({
  label,
  assets,
  onPreview
}: {
  label: "콘티" | "부감도";
  assets: ProgressArchiveMediaAsset[];
  onPreview?: (
    asset: ProgressArchiveMediaAsset,
    assets: ProgressArchiveMediaAsset[]
  ) => void;
}) {
  return (
    <div className="grid min-w-0 grid-cols-[2.75rem_minmax(0,1fr)] items-center gap-2 border-t border-field-divider/80 pt-2">
      <span className="text-[10px] font-bold text-field-muted">
        {label} {assets.length}
      </span>
      <div className="flex min-w-0 gap-1.5 overflow-x-auto overscroll-x-contain pb-1 [scrollbar-width:thin]">
        {assets.map((asset) => (
          <button
            key={asset.id}
            type="button"
            data-no-drag="true"
            onClick={(event) => {
              event.stopPropagation();
              onPreview?.(asset, assets);
            }}
            className="h-14 w-20 shrink-0 overflow-hidden border border-field-divider bg-field-input p-0 transition-colors hover:border-field-subtle focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-field-primary"
            aria-label={`${asset.title || label} 크게 보기`}
            title={asset.title || `${label} 크게 보기`}
          >
            {/* eslint-disable-next-line @next/next/no-img-element */}
            <img
              src={asset.thumbnailUrl}
              alt=""
              loading="lazy"
              decoding="async"
              draggable={false}
              className="block h-full w-full select-none object-cover [-webkit-user-drag:none]"
            />
          </button>
        ))}
      </div>
    </div>
  );
}
