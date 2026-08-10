"use client";

import {
  useCallback,
  useEffect,
  useRef,
  useState,
  type ReactNode,
  type PointerEvent as ReactPointerEvent
} from "react";
import { createPortal } from "react-dom";
import { ChevronLeft, ChevronRight, X } from "lucide-react";
import {
  clampGalleryIndex,
  getGalleryNeighborIndexes,
  moveGalleryIndex
} from "@/lib/progress/mediaGallery";

type ImagePreviewModalProps = {
  imageUrl: string | null;
  title: string;
  onClose: () => void;
  images?: Array<{ url: string; title?: string; content?: ReactNode }>;
  activeIndex?: number;
  onNavigate?: (index: number) => void;
  galleryLabel?: string;
  loop?: boolean;
};

const SWIPE_THRESHOLD_PX = 48;
const SWIPE_AXIS_RATIO = 1.2;

/** 콘티 썸네일을 크게 확인하는 간단한 이미지 모달입니다. */
export function ImagePreviewModal({
  imageUrl,
  title,
  onClose,
  images,
  activeIndex = 0,
  onNavigate,
  galleryLabel,
  loop = true
}: ImagePreviewModalProps) {
  const normalizedImages = images?.length ? images : [{ url: imageUrl ?? "", title }];
  const safeIndex = clampGalleryIndex(activeIndex, normalizedImages.length);
  const activeImage = normalizedImages[safeIndex] ?? { url: imageUrl ?? "", title };
  const canNavigate = normalizedImages.length > 1 && Boolean(onNavigate);
  const [motionDirection, setMotionDirection] = useState<"previous" | "next" | null>(null);
  const pointerSessionRef = useRef<{
    pointerId: number;
    startX: number;
    startY: number;
  } | null>(null);
  const closeButtonRef = useRef<HTMLButtonElement | null>(null);
  const isOpen = Boolean(imageUrl);

  const navigateBy = useCallback((step: -1 | 1) => {
    if (!canNavigate) return;
    const nextIndex = moveGalleryIndex(safeIndex, step, normalizedImages.length, loop);
    if (nextIndex === safeIndex) return;
    setMotionDirection(step > 0 ? "next" : "previous");
    onNavigate?.(nextIndex);
  }, [canNavigate, loop, normalizedImages.length, onNavigate, safeIndex]);

  useEffect(() => {
    if (!imageUrl) return undefined;
    function handleKeyDown(event: KeyboardEvent) {
      if (event.key === "Escape") onClose();
      if (!canNavigate) return;
      if (event.key === "ArrowLeft") navigateBy(-1);
      if (event.key === "ArrowRight") navigateBy(1);
    }
    window.addEventListener("keydown", handleKeyDown);
    return () => window.removeEventListener("keydown", handleKeyDown);
  }, [canNavigate, imageUrl, navigateBy, onClose]);

  useEffect(() => {
    if (!imageUrl || normalizedImages.length <= 1) return;
    getGalleryNeighborIndexes(safeIndex, normalizedImages.length, loop).forEach((index) => {
      const neighbor = normalizedImages[index];
      const neighborUrl = neighbor?.content ? "" : neighbor?.url;
      if (!neighborUrl) return;
      const preloader = new window.Image();
      preloader.decoding = "async";
      preloader.src = neighborUrl;
    });
  }, [imageUrl, loop, normalizedImages, safeIndex]);

  useEffect(() => {
    if (!isOpen) return undefined;
    const previouslyFocused = document.activeElement instanceof HTMLElement
      ? document.activeElement
      : null;
    const frame = window.requestAnimationFrame(() => closeButtonRef.current?.focus());
    return () => {
      window.cancelAnimationFrame(frame);
      previouslyFocused?.focus();
    };
  }, [isOpen]);

  if (!imageUrl || typeof document === "undefined") return null;

  function handlePointerDown(event: ReactPointerEvent<HTMLDivElement>) {
    if (!canNavigate || event.pointerType === "mouse") return;
    if (event.target instanceof Element && event.target.closest("button")) return;
    pointerSessionRef.current = {
      pointerId: event.pointerId,
      startX: event.clientX,
      startY: event.clientY
    };
    try {
      event.currentTarget.setPointerCapture(event.pointerId);
    } catch {
      // Pointer capture가 없는 오래된 모바일 브라우저에서도 pointerup으로 마무리합니다.
    }
  }

  function finishPointerSession(event: ReactPointerEvent<HTMLDivElement>, cancelled = false) {
    const session = pointerSessionRef.current;
    if (!session || session.pointerId !== event.pointerId) return;
    pointerSessionRef.current = null;
    if (event.currentTarget.hasPointerCapture(event.pointerId)) {
      event.currentTarget.releasePointerCapture(event.pointerId);
    }
    if (cancelled) return;

    const deltaX = event.clientX - session.startX;
    const deltaY = event.clientY - session.startY;
    if (
      Math.abs(deltaX) < SWIPE_THRESHOLD_PX
      || Math.abs(deltaX) < Math.abs(deltaY) * SWIPE_AXIS_RATIO
    ) return;
    navigateBy(deltaX < 0 ? 1 : -1);
  }

  return createPortal(
    <div
      data-no-drag="true"
      className="fixed inset-0 z-[150] bg-black/75 p-3 sm:p-4"
      role="dialog"
      aria-modal="true"
      aria-label={galleryLabel ? `${galleryLabel} 이미지 보기` : `${title} 이미지 보기`}
      onClick={(event) => {
        if (event.target === event.currentTarget) onClose();
      }}
    >
      <div className="mx-auto flex h-full max-w-3xl flex-col justify-center">
        <div className="mb-3 flex items-center justify-between gap-3 text-white">
          <div className="min-w-0">
            <h2 className="break-words text-lg font-black">{activeImage.title || title}</h2>
            {galleryLabel ? (
              <p className="mt-0.5 text-xs font-bold text-white/75" aria-live="polite">
                {galleryLabel} · {safeIndex + 1} / {normalizedImages.length}
              </p>
            ) : normalizedImages.length > 1 ? (
              <p className="mt-0.5 text-xs text-white/75" aria-live="polite">{safeIndex + 1} / {normalizedImages.length}</p>
            ) : null}
          </div>
          <button ref={closeButtonRef} type="button" onClick={onClose} className="flex h-11 w-11 shrink-0 items-center justify-center border border-white/35 bg-black/60 p-0 text-white transition-colors hover:border-field-primary hover:text-field-primary focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-field-primary" aria-label="이미지 보기 닫기">
            <X className="h-4 w-4" aria-hidden />
          </button>
        </div>
        <div
          className="relative flex min-h-0 touch-pan-y items-center justify-center overflow-hidden"
          onPointerDown={handlePointerDown}
          onPointerUp={(event) => finishPointerSession(event)}
          onPointerCancel={(event) => finishPointerSession(event, true)}
        >
          {canNavigate ? (
            <button
              type="button"
              onClick={() => navigateBy(-1)}
              disabled={!loop && safeIndex === 0}
              className="absolute left-2 z-10 flex h-10 w-10 items-center justify-center border border-white/45 bg-black/70 text-white transition-colors hover:border-field-primary hover:bg-field-hover hover:text-field-text focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-field-primary disabled:pointer-events-none disabled:opacity-25"
              aria-label="이전 사진"
            >
              <ChevronLeft className="h-5 w-5" aria-hidden />
            </button>
          ) : null}
          {activeImage.content ? (
            <div
              key={activeImage.url}
              data-direction={motionDirection ?? undefined}
              className="progress-media-gallery-image flex max-h-[78vh] w-full items-center justify-center overflow-hidden bg-field-panel"
            >
              {activeImage.content}
            </div>
          ) : (
            // eslint-disable-next-line @next/next/no-img-element
            <img
              key={activeImage.url}
              src={activeImage.url}
              alt={activeImage.title || title}
              draggable={false}
              decoding="async"
              data-direction={motionDirection ?? undefined}
              className="progress-media-gallery-image max-h-[78vh] w-full select-none bg-field-panel object-contain [-webkit-user-drag:none]"
            />
          )}
          {canNavigate ? (
            <button
              type="button"
              onClick={() => navigateBy(1)}
              disabled={!loop && safeIndex === normalizedImages.length - 1}
              className="absolute right-2 z-10 flex h-10 w-10 items-center justify-center border border-white/45 bg-black/70 text-white transition-colors hover:border-field-primary hover:bg-field-hover hover:text-field-text focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-field-primary disabled:pointer-events-none disabled:opacity-25"
              aria-label="다음 사진"
            >
              <ChevronRight className="h-5 w-5" aria-hidden />
            </button>
          ) : null}
        </div>
      </div>
    </div>,
    document.body
  );
}
