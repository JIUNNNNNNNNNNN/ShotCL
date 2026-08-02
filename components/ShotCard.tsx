"use client";

import { memo } from "react";
import { ChevronDown, ChevronUp, Images, Map } from "lucide-react";
import { ShotOverheadPreview } from "@/components/ShotOverheadPreview";
import { formatProgressCutLabel } from "@/lib/progress/cutLabel";
import { type Shot, type ShotMediaType, type ShotStatus } from "@/lib/types";
import { hasShotOverheadContent } from "@/lib/shotOverhead";
import { cn } from "@/lib/utils";

type ShotCardProps = {
  shot: Shot;
  onOpen: (shot: Shot) => void;
  onOpenMedia: (shot: Shot, type: ShotMediaType) => void;
  onImagePreview: (url: string, title: string) => void;
  onStatusChange: (shot: Shot, status: ShotStatus) => void;
  collapsed?: boolean;
  onToggleCollapsed?: (shot: Shot) => void;
  progressOnly?: boolean;
  isOverheadLoading?: boolean;
};

/** 컷 중심 현장 진행표 카드입니다. 버튼 클릭은 카드 수정 모달과 분리합니다. */
export const ShotCard = memo(function ShotCard({
  shot,
  onOpen,
  onOpenMedia,
  onImagePreview,
  onStatusChange,
  collapsed = false,
  onToggleCollapsed,
  progressOnly = false,
  isOverheadLoading = false
}: ShotCardProps) {
  const isOk = shot.status === "ok";
  const isOmit = shot.status === "omit";
  const isProcessed = isOk || isOmit;
  const hasOverheadDiagram = hasShotOverheadContent(shot.overheadDiagram);
  const hasOverhead = Boolean(shot.overheadImageUrl || hasOverheadDiagram);
  const statusLabel = isOk ? "OK" : isOmit ? "OMIT" : "대기";
  const hasMedia = Boolean(shot.storyboardImageUrl || hasOverhead);
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
    if (shot.storyboardImageUrl) {
      onImagePreview(shot.storyboardImageUrl, `${cutLabel} 콘티`);
    }
  }

  if (collapsed && isProcessed) {
    return (
      <article
        className={cn(
          "min-w-0 overflow-hidden  border border-l-[3px] bg-black transition-[background-color,border-color]",
          isOk ? "border-field-primary border-l-[#d7b95f]" : "border-field-danger/70 border-l-field-danger"
        )}
      >
        <button
          type="button"
          onClick={() => onToggleCollapsed?.(shot)}
          aria-expanded={false}
          className="grid min-h-12 w-full grid-cols-[minmax(0,1fr)_auto] items-center gap-2 px-3 py-2 text-left focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-field-primary"
        >
          <span className="flex min-w-0 flex-wrap items-center gap-x-2 gap-y-0.5">
            <strong className="truncate text-sm font-bold text-field-primary">
              {cutLabel}
            </strong>
            <span className={cn(
              "text-[11px] font-bold",
              isOk ? "text-field-primary" : "text-field-danger"
            )}>
              {statusLabel}
            </span>
            {shot.orderIndex > 0 ? (
              <span className="text-[10px] font-normal text-field-muted">순서 {shot.orderIndex}</span>
            ) : null}
          </span>
          <ChevronDown className="h-5 w-5 shrink-0 text-field-muted" aria-hidden />
        </button>
      </article>
    );
  }

  return (
    <article
      onClick={handleCardOpen}
      aria-label={progressOnly ? `${cutLabel} 상세 보기` : `${cutLabel} 수정`}
      className={cn(
        "relative grid min-w-0 cursor-pointer gap-2 overflow-hidden  border p-2 transition-[background-color,border-color,transform] active:scale-[0.995] md:grid-cols-[minmax(0,1fr)_6.5rem] md:items-center",
        isOk
          ? "border-field-primary bg-[#15130b] after:pointer-events-none after:absolute after:inset-x-3 after:top-1/2 after:z-10 after:h-[2px] after:-translate-y-1/2 after:bg-field-primary/55 after:content-['']"
          : isOmit
            ? "border-field-danger/70 bg-[#160d0d]"
            : "border-field-border bg-black hover:border-field-primary"
      )}
    >
      <div className={cn("grid min-w-0 max-w-full gap-2 overflow-hidden", hasMedia && "sm:grid-cols-[minmax(0,19rem)_minmax(0,1fr)] sm:items-center")}>
        {hasMedia ? (
          <div className={cn("grid h-36 w-full max-w-full min-w-0 overflow-visible  gap-1.5 sm:h-32", shot.storyboardImageUrl && hasOverhead ? "grid-cols-2" : "grid-cols-1")}>
            {shot.storyboardImageUrl ? (
              <button
                type="button"
                onClick={handleImageClick}
                data-no-drag="true"
                className="flex h-full w-full max-w-full min-w-0 items-center justify-center overflow-visible  !border-0 p-0 focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-[-2px] focus-visible:outline-field-primary"
                title="콘티 크게 보기"
              >
                {/* eslint-disable-next-line @next/next/no-img-element */}
                <img
                  src={shot.storyboardImageUrl}
                  alt={`${cutLabel} 콘티`}
                  draggable={false}
                  className="block h-full max-h-full w-full max-w-full select-none  object-contain [-webkit-user-drag:none]"
                />
              </button>
            ) : null}
            {shot.overheadImageUrl ? (
              <button
                type="button"
                onClick={(event) => {
                  event.stopPropagation();
                  onImagePreview(shot.overheadImageUrl as string, `${cutLabel} 부감도`);
                }}
                data-no-drag="true"
                className="h-full w-full max-w-full min-w-0 overflow-visible  !border-0 p-0 focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-[-2px] focus-visible:outline-field-primary"
                title="업로드 부감도 크게 보기"
              >
                {/* eslint-disable-next-line @next/next/no-img-element */}
                <img
                  src={shot.overheadImageUrl}
                  alt={`${cutLabel} 부감도`}
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
          <h2 className="min-w-0 truncate text-sm font-bold leading-5 text-white">
            {cutLabel}
          </h2>
          <p className={cn(" px-2 py-1 text-[10px] font-bold leading-[1.35]", isOk ? "bg-field-primary text-black" : isOmit ? "bg-field-danger text-white" : "border border-field-border bg-field-panel text-field-muted")}>
            <span className="font-display">{statusLabel}</span>
          </p>
          <div className="ml-auto flex shrink-0 items-center gap-1">
            {isProcessed && onToggleCollapsed ? (
              <button
                type="button"
                onClick={(event) => {
                  event.stopPropagation();
                  onToggleCollapsed(shot);
                }}
                data-no-drag="true"
                className="inline-flex min-h-7 min-w-7 items-center justify-center  border border-field-border bg-field-panel text-field-muted transition-colors hover:border-field-primary hover:text-field-primary focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-field-primary"
                aria-label={`${statusLabel} 컷 접기`}
                aria-expanded={true}
                title="완료 컷 접기"
              >
                <ChevronUp className="h-3.5 w-3.5" aria-hidden />
              </button>
            ) : null}
            <button
              type="button"
              onClick={(event) => {
                event.stopPropagation();
                onOpenMedia(shot, "storyboard");
              }}
              className={cn(
                "inline-flex min-h-7 items-center gap-1  border px-2 text-[10px] font-bold transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-field-primary",
                shot.storyboardImageUrl ? "border-field-primary bg-field-primary text-black" : "border-field-border bg-field-panel text-white hover:border-field-primary hover:text-field-primary"
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
                hasOverhead ? "border-field-primary bg-field-primary text-black" : "border-field-border bg-field-panel text-white hover:border-field-primary hover:text-field-primary"
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

        <div className="grid grid-cols-2 gap-2 md:grid-cols-1">
          <button
            type="button"
            data-no-drag="true"
            onClick={(event) => handleStatusClick(event, "ok")}
            aria-pressed={isOk}
            className={cn(
              "min-h-[38px]  border text-xs font-bold leading-[1.25] transition-[background-color,transform] active:scale-95 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-field-primary",
              isOk ? "border-field-primary bg-field-primary text-black" : "border-field-border bg-field-panel text-white hover:border-field-primary hover:text-field-primary"
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
              isOmit ? "border-field-danger bg-field-danger text-white" : "border-field-danger/60 bg-field-panel text-field-danger"
            )}
          >
            <span className="font-display">OMIT</span>
          </button>
        </div>
    </article>
  );
});
