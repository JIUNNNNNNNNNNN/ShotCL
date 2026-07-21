"use client";

import { ImageIcon } from "lucide-react";
import { type Shot, type ShotStatus } from "@/lib/types";
import { cn } from "@/lib/utils";

type ShotCardProps = {
  shot: Shot;
  onOpen: (shot: Shot) => void;
  onImagePreview: (url: string, title: string) => void;
  onStatusChange: (shot: Shot, status: ShotStatus) => void;
};

/** 컷 중심 현장 진행표 카드입니다. 버튼 클릭은 카드 수정 모달과 분리합니다. */
export function ShotCard({ shot, onOpen, onImagePreview, onStatusChange }: ShotCardProps) {
  const isOk = shot.status === "ok";
  const isOmit = shot.status === "omit";

  function shouldIgnoreCardOpen(target: EventTarget | null) {
    return target instanceof HTMLElement && Boolean(target.closest("button"));
  }

  function handleCardOpen(event: React.MouseEvent<HTMLElement> | React.PointerEvent<HTMLElement>) {
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
      onImagePreview(shot.storyboardImageUrl, shot.title);
    }
  }

  return (
    <article
      onClick={handleCardOpen}
      onPointerUp={handleCardOpen}
      aria-label={`${shot.title} 컷 수정`}
      className={cn(
        "grid cursor-pointer grid-cols-[72px_minmax(0,1fr)] items-center gap-3 rounded-2xl border bg-white p-3 shadow-sm transition sm:grid-cols-[72px_minmax(0,1fr)_7rem]",
        isOk && "border-field-primary bg-field-light",
        isOmit && "border-field-danger bg-white opacity-75",
        !isOk && !isOmit && "border-field-border hover:border-field-secondary"
      )}
    >
      {shot.storyboardImageUrl ? (
        <button
          type="button"
          onClick={handleImageClick}
          className="flex h-14 w-[72px] shrink-0 items-center justify-center overflow-hidden rounded-xl border border-field-border bg-field-soft text-xs font-black"
          title="콘티 크게 보기"
        >
          {/* eslint-disable-next-line @next/next/no-img-element */}
          <img src={shot.storyboardImageUrl} alt={`${shot.title} 콘티`} className="h-full w-full object-cover" />
        </button>
      ) : (
        <div className="flex h-14 w-[72px] shrink-0 items-center justify-center rounded-xl border border-field-border bg-field-soft text-[10px] font-black text-field-muted">
          <span className="grid place-items-center gap-1">
            <ImageIcon className="mx-auto h-4 w-4" aria-hidden />
            콘티 없음
          </span>
        </div>
      )}

      <div className="min-w-0">
        <div className="flex items-center gap-2">
          <p className="rounded-lg bg-field-light px-2 py-0.5 text-[11px] font-black text-field-primary">
            S#{shot.sceneNumber || "-"} / C#{shot.cutNumber || "-"}
          </p>
          <p className="text-xs font-black text-field-muted">#{shot.orderIndex}</p>
        </div>

        <h2 className={cn("mt-1 truncate text-sm font-black leading-5 text-field-text", isOmit && "line-through")}>
          {shot.title}
        </h2>
        <div className="mt-0.5 flex min-w-0 items-center gap-2 text-xs font-bold text-field-muted">
          {shot.description ? <p className="min-w-0 flex-1 truncate">{shot.description}</p> : null}
          {shot.location ? <p className="max-w-[35%] shrink-0 truncate text-field-secondary">{shot.location}</p> : null}
          {shot.memo ? <p className="hidden max-w-[30%] shrink-0 truncate lg:block">{shot.memo}</p> : null}
        </div>
      </div>

        <div className="col-span-2 grid grid-cols-2 gap-2 sm:col-span-1">
          <button
            type="button"
            onClick={(event) => handleStatusClick(event, "ok")}
            aria-pressed={isOk}
            className={cn(
              "min-h-9 rounded-xl border text-sm font-black",
              isOk ? "border-field-primary bg-field-primary text-white" : "border-field-border bg-white text-field-primary"
            )}
          >
            OK
          </button>
          <button
            type="button"
            onClick={(event) => handleStatusClick(event, "omit")}
            aria-pressed={isOmit}
            className={cn(
              "min-h-9 rounded-xl border text-sm font-black",
              isOmit ? "border-field-danger bg-field-danger text-white" : "border-field-border bg-white text-field-danger"
            )}
          >
            omit
          </button>
        </div>
    </article>
  );
}
