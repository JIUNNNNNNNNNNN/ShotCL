"use client";

import { ImageIcon } from "lucide-react";
import { type Shot, type ShotStatus } from "@/lib/types";
import { cn } from "@/lib/utils";

type ShotCardProps = {
  shot: Shot;
  onOpen: (shot: Shot) => void;
  onImagePreview: (url: string, title: string) => void;
  onStatusChange: (shot: Shot, status: ShotStatus) => void;
  progressOnly?: boolean;
};

/** 컷 중심 현장 진행표 카드입니다. 버튼 클릭은 카드 수정 모달과 분리합니다. */
export function ShotCard({ shot, onOpen, onImagePreview, onStatusChange, progressOnly = false }: ShotCardProps) {
  const isOk = shot.status === "ok";
  const isOmit = shot.status === "omit";
  const isProcessed = isOk || isOmit;
  const statusLabel = isOk ? "OK" : isOmit ? "omit" : "대기";

  function shouldIgnoreCardOpen(target: EventTarget | null) {
    return target instanceof HTMLElement && Boolean(target.closest("button"));
  }

  function handleCardOpen(event: React.MouseEvent<HTMLElement> | React.PointerEvent<HTMLElement>) {
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
      onPointerUp={handleCardOpen}
      aria-label={progressOnly ? `${shot.title} 컷 진행 상태` : `${shot.title} 컷 수정`}
      className={cn(
        "grid grid-cols-[96px_minmax(0,1fr)] items-center gap-2 rounded-[1.5rem] border bg-white p-1.5 transition-[background-color,border-color,transform] active:scale-[0.995] sm:grid-cols-[96px_minmax(0,1fr)_6.5rem]",
        !progressOnly && "cursor-pointer",
        isOk && "border-field-primary bg-field-light",
        isOmit && "border-field-danger bg-white opacity-75",
        !isOk && !isOmit && "border-field-border hover:border-field-secondary"
      )}
    >
      {shot.storyboardImageUrl ? (
        <button
          type="button"
          onClick={handleImageClick}
          className="flex h-[72px] w-24 shrink-0 items-center justify-center overflow-hidden rounded-[1.1rem] border border-field-border bg-field-soft text-xs font-black focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[#d7b95f]"
          title="콘티 크게 보기"
        >
          {/* eslint-disable-next-line @next/next/no-img-element */}
          <img src={shot.storyboardImageUrl} alt={`${shot.title} 콘티`} className="h-full w-full object-contain" />
        </button>
      ) : (
        <div className="flex h-[72px] w-24 shrink-0 items-center justify-center rounded-[1.1rem] border border-field-border bg-field-soft text-[10px] font-black text-field-muted">
          <span className="grid place-items-center gap-1">
            <ImageIcon className="mx-auto h-4 w-4" aria-hidden />
            콘티 없음
          </span>
        </div>
      )}

      <div className="min-w-0">
        <div className="flex min-w-0 items-center gap-1.5">
          <p className="rounded-full bg-field-light px-2 py-1 text-[10px] font-black leading-[1.35] text-field-primary">
            S#{shot.sceneNumber || "-"} / C#{shot.cutNumber || "-"}
          </p>
          <p className={cn("rounded-full px-2 py-1 text-[10px] font-black leading-[1.35]", isOk ? "bg-field-primary text-white" : isOmit ? "bg-field-danger text-white" : "bg-field-soft text-field-muted")}>
            <span className="font-display">{statusLabel}</span>
          </p>
          <p className="truncate text-[10px] font-black text-field-muted">촬영순서 {shot.orderIndex}</p>
        </div>

        <h2 className={cn("mt-1 truncate text-sm font-black leading-5 text-field-text", isProcessed && "underline decoration-2 underline-offset-4")}>
          {shot.description || shot.title}
        </h2>
        <div className="mt-0.5 flex min-w-0 items-center gap-2 text-[11px] font-bold text-field-muted">
          {shot.characters.length > 0 ? <p className="max-w-[35%] shrink-0 truncate">등장 {shot.characters.join(", ")}</p> : null}
          {shot.location ? <p className="min-w-0 flex-1 truncate text-field-secondary">장소 {shot.location}</p> : null}
          {!shot.location && shot.memo ? <p className="min-w-0 flex-1 truncate">{shot.memo}</p> : null}
        </div>
      </div>

        <div className={cn("col-span-2 grid gap-2 sm:col-span-1", progressOnly ? "grid-cols-1" : "grid-cols-2")}>
          <button
            type="button"
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
}
