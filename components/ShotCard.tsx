"use client";

import { memo } from "react";
import { Map } from "lucide-react";
import { ShotOverheadPreview } from "@/components/ShotOverheadPreview";
import { type Shot, type ShotStatus } from "@/lib/types";
import { hasShotOverheadContent } from "@/lib/shotOverhead";
import { cn } from "@/lib/utils";

type ShotCardProps = {
  shot: Shot;
  onOpen: (shot: Shot) => void;
  onOpenOverhead: (shot: Shot) => void;
  onImagePreview: (url: string, title: string) => void;
  onStatusChange: (shot: Shot, status: ShotStatus) => void;
  progressOnly?: boolean;
  isOverheadLoading?: boolean;
};

/** 컷 중심 현장 진행표 카드입니다. 버튼 클릭은 카드 수정 모달과 분리합니다. */
export const ShotCard = memo(function ShotCard({
  shot,
  onOpen,
  onOpenOverhead,
  onImagePreview,
  onStatusChange,
  progressOnly = false,
  isOverheadLoading = false
}: ShotCardProps) {
  const isOk = shot.status === "ok";
  const isOmit = shot.status === "omit";
  const isProcessed = isOk || isOmit;
  const hasOverhead = hasShotOverheadContent(shot.overheadDiagram);
  const statusLabel = isOk ? "OK" : isOmit ? "omit" : "대기";
  const hasMedia = Boolean(shot.storyboardImageUrl || hasOverhead);
  const displayText = getShotDisplayText(shot);

  function shouldIgnoreCardOpen(target: EventTarget | null) {
    return target instanceof HTMLElement && Boolean(target.closest("button, a, input, textarea, select, [data-no-drag]"));
  }

  function handleCardOpen(event: React.MouseEvent<HTMLElement>) {
    if (progressOnly || shouldIgnoreCardOpen(event.target)) return;
    onOpen(shot);
  }

  function handleStatusClick(event: React.MouseEvent<HTMLButtonElement>, status: ShotStatus) {
    event.stopPropagation();
    onStatusChange(shot, shot.status === status ? "pending" : status);
  }

  function handleImageClick(event: React.MouseEvent<HTMLButtonElement>) {
    event.stopPropagation();
    if (shot.storyboardImageUrl) {
      onImagePreview(shot.storyboardImageUrl, shot.title);
    }
  }

  return (
    <article
      onClick={handleCardOpen}
      aria-label={progressOnly ? `${shot.title} 컷 진행 상태` : `${shot.title} 컷 수정`}
      className={cn(
        "grid gap-2 rounded-[1.5rem] border bg-white p-2 transition-[background-color,border-color,transform] active:scale-[0.995] md:grid-cols-[minmax(0,1fr)_6.5rem] md:items-center",
        !progressOnly && "cursor-pointer",
        isOk && "border-field-primary bg-field-light",
        isOmit && "border-field-danger bg-white opacity-75",
        !isOk && !isOmit && "border-field-border hover:border-field-secondary"
      )}
    >
      <div className={cn("grid min-w-0 gap-2", hasMedia && "sm:grid-cols-[minmax(15rem,19rem)_minmax(0,1fr)] sm:items-center")}>
        {hasMedia ? (
          <div className={cn("grid h-36 min-w-0 gap-1.5 sm:h-32", shot.storyboardImageUrl && hasOverhead ? "grid-cols-2" : "grid-cols-1")}>
            {shot.storyboardImageUrl ? (
              <button
                type="button"
                onClick={handleImageClick}
                data-no-drag="true"
                className="flex min-w-0 items-center justify-center overflow-hidden rounded-[1.05rem] border border-field-border bg-field-soft focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[#d7b95f]"
                title="콘티 크게 보기"
              >
                {/* eslint-disable-next-line @next/next/no-img-element */}
                <img
                  src={shot.storyboardImageUrl}
                  alt={`${displayText} 콘티`}
                  draggable={false}
                  className="h-full w-full select-none object-contain [-webkit-user-drag:none]"
                />
              </button>
            ) : null}
            {hasOverhead && shot.overheadDiagram ? (
              <button
                type="button"
                onClick={(event) => {
                  event.stopPropagation();
                  onOpenOverhead(shot);
                }}
                data-no-drag="true"
                className="min-w-0 overflow-hidden rounded-[1.05rem] border border-field-border bg-[#fbfaf6] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[#d7b95f]"
                title={progressOnly ? "부감도 보기" : "부감도 편집"}
              >
                <ShotOverheadPreview diagram={shot.overheadDiagram} label={`${displayText} 부감도 미리보기`} />
              </button>
            ) : null}
          </div>
        ) : null}

        <div className="min-w-0 px-0.5">
        <div className="flex min-w-0 items-center gap-1.5">
          <p className={cn("rounded-full px-2 py-1 text-[10px] font-black leading-[1.35]", isOk ? "bg-field-primary text-white" : isOmit ? "bg-field-danger text-white" : "bg-field-soft text-field-muted")}>
            <span className="font-display">{statusLabel}</span>
          </p>
          <p className="truncate text-[10px] font-black text-field-muted">촬영순서 {shot.orderIndex}</p>
          <button
            type="button"
            onClick={(event) => {
              event.stopPropagation();
              onOpenOverhead(shot);
            }}
            disabled={isOverheadLoading}
            className={cn(
              "ml-auto inline-flex min-h-7 shrink-0 items-center gap-1 rounded-full border px-2 text-[10px] font-black transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[#d7b95f] disabled:cursor-wait disabled:opacity-55",
              hasOverhead ? "border-field-primary bg-field-primary text-white" : "border-field-border bg-white text-field-primary"
            )}
            title={progressOnly ? "부감도 보기" : hasOverhead ? "부감도 편집" : "부감도 만들기"}
          >
            <Map className="h-3.5 w-3.5" aria-hidden />
            부감도
          </button>
        </div>

        <h2 className={cn("mt-1 truncate text-sm font-black leading-5 text-field-text", isProcessed && "underline decoration-2 underline-offset-4")}>
          {displayText}
        </h2>
        <div className="mt-0.5 flex min-w-0 items-center gap-2 text-[11px] font-bold text-field-muted">
          {shot.characters.length > 0 ? <p className="max-w-[35%] shrink-0 truncate">등장 {shot.characters.join(", ")}</p> : null}
          {shot.location ? <p className="min-w-0 flex-1 truncate text-field-secondary">장소 {shot.location}</p> : null}
          {!shot.location && shot.memo ? <p className="min-w-0 flex-1 truncate">{shot.memo}</p> : null}
        </div>
      </div>
      </div>

        <div className={cn("grid gap-2", progressOnly ? "grid-cols-1" : "grid-cols-2 md:grid-cols-1")}>
          <button
            type="button"
            data-no-drag="true"
            onClick={(event) => handleStatusClick(event, "ok")}
            aria-pressed={isOk}
            disabled={progressOnly && shot.status !== "pending"}
            className={cn(
              "min-h-[38px] rounded-full border text-xs font-black leading-[1.25] transition-[background-color,transform] active:scale-95 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[#d7b95f]",
              isOk ? "border-field-primary bg-field-primary text-white" : "border-field-border bg-white text-field-primary",
              progressOnly && shot.status !== "pending" && "cursor-not-allowed opacity-60"
            )}
          >
            <span className="font-display">OK</span>
          </button>
          {!progressOnly ? (
          <button
            type="button"
            data-no-drag="true"
            onClick={(event) => handleStatusClick(event, "omit")}
            aria-pressed={isOmit}
            className={cn(
              "min-h-[38px] rounded-full border text-xs font-black leading-[1.25] transition-[background-color,transform] active:scale-95 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[#d7b95f]",
              isOmit ? "border-field-danger bg-field-danger text-white" : "border-field-border bg-white text-field-danger"
            )}
          >
            <span className="font-display">omit</span>
          </button>
          ) : null}
        </div>
    </article>
  );
});

function getShotDisplayText(shot: Shot) {
  const description = shot.description.trim();
  if (description) return description;
  const title = shot.title.trim();
  if (!title || isAutomaticSceneCutLabel(title, shot.sceneNumber, shot.cutNumber)) return "촬영 내용 없음";
  return title;
}

function isAutomaticSceneCutLabel(value: string, sceneNumber: string, cutNumber: string) {
  const compact = value.replace(/\s+/g, "").toLowerCase();
  const scene = sceneNumber.trim().toLowerCase();
  const cut = cutNumber.trim().toLowerCase();
  return new Set([
    `씬${scene}컷${cut}`,
    `scene${scene}cut${cut}`,
    `s#${scene}/c#${cut}`,
    `s#${scene}c#${cut}`
  ]).has(compact);
}
