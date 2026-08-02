"use client";

import { useEffect } from "react";
import { ChevronLeft, ChevronRight, X } from "lucide-react";

type ImagePreviewModalProps = {
  imageUrl: string | null;
  title: string;
  onClose: () => void;
  images?: Array<{ url: string; title?: string }>;
  activeIndex?: number;
  onNavigate?: (index: number) => void;
};

/** 콘티 썸네일을 크게 확인하는 간단한 이미지 모달입니다. */
export function ImagePreviewModal({
  imageUrl,
  title,
  onClose,
  images,
  activeIndex = 0,
  onNavigate
}: ImagePreviewModalProps) {
  const normalizedImages = images?.length ? images : [{ url: imageUrl ?? "", title }];
  const safeIndex = Math.min(Math.max(activeIndex, 0), normalizedImages.length - 1);
  const activeImage = normalizedImages[safeIndex] ?? { url: imageUrl ?? "", title };
  const canNavigate = normalizedImages.length > 1 && Boolean(onNavigate);

  useEffect(() => {
    if (!imageUrl) return undefined;
    function handleKeyDown(event: KeyboardEvent) {
      if (event.key === "Escape") onClose();
      if (!canNavigate) return;
      if (event.key === "ArrowLeft") onNavigate?.((safeIndex - 1 + normalizedImages.length) % normalizedImages.length);
      if (event.key === "ArrowRight") onNavigate?.((safeIndex + 1) % normalizedImages.length);
    }
    window.addEventListener("keydown", handleKeyDown);
    return () => window.removeEventListener("keydown", handleKeyDown);
  }, [canNavigate, imageUrl, normalizedImages.length, onClose, onNavigate, safeIndex]);

  if (!imageUrl) return null;

  return (
    <div className="fixed inset-0 z-50 bg-black/70 p-4" role="dialog" aria-modal="true">
      <div className="mx-auto flex h-full max-w-3xl flex-col justify-center">
        <div className="mb-3 flex items-center justify-between gap-3 text-white">
          <div className="min-w-0">
            <h2 className="break-words text-lg font-black">{activeImage.title || title}</h2>
            {normalizedImages.length > 1 ? (
              <p className="mt-0.5 text-xs text-white/75">{safeIndex + 1} / {normalizedImages.length}</p>
            ) : null}
          </div>
          <button type="button" onClick={onClose} className="flex min-h-[38px] items-center gap-1.5 border border-field-border bg-field-panel px-3 py-1.5 text-sm font-bold text-field-text transition-colors hover:border-field-primary hover:bg-field-primary hover:text-black focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-field-primary">
            <X className="h-4 w-4" aria-hidden />
            닫기
          </button>
        </div>
        <div className="relative flex min-h-0 items-center justify-center">
          {canNavigate ? (
            <button
              type="button"
              onClick={() => onNavigate?.((safeIndex - 1 + normalizedImages.length) % normalizedImages.length)}
              className="absolute left-2 z-10 flex h-10 w-10 items-center justify-center border border-white/45 bg-black/70 text-white transition-colors hover:border-field-primary hover:bg-field-primary hover:text-black focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-field-primary"
              aria-label="이전 사진"
            >
              <ChevronLeft className="h-5 w-5" aria-hidden />
            </button>
          ) : null}
          {/* eslint-disable-next-line @next/next/no-img-element */}
          <img
            src={activeImage.url}
            alt={activeImage.title || title}
            className="max-h-[78vh] w-full bg-field-panel object-contain"
          />
          {canNavigate ? (
            <button
              type="button"
              onClick={() => onNavigate?.((safeIndex + 1) % normalizedImages.length)}
              className="absolute right-2 z-10 flex h-10 w-10 items-center justify-center border border-white/45 bg-black/70 text-white transition-colors hover:border-field-primary hover:bg-field-primary hover:text-black focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-field-primary"
              aria-label="다음 사진"
            >
              <ChevronRight className="h-5 w-5" aria-hidden />
            </button>
          ) : null}
        </div>
      </div>
    </div>
  );
}
