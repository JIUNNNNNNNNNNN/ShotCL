"use client";

import { X } from "lucide-react";
import { Button } from "@/components/ui/Button";

type ImagePreviewModalProps = {
  imageUrl: string | null;
  title: string;
  onClose: () => void;
};

/** 콘티 썸네일을 크게 확인하는 간단한 이미지 모달입니다. */
export function ImagePreviewModal({ imageUrl, title, onClose }: ImagePreviewModalProps) {
  if (!imageUrl) return null;

  return (
    <div className="fixed inset-0 z-50 bg-black/70 p-4" role="dialog" aria-modal="true">
      <div className="mx-auto flex h-full max-w-3xl flex-col justify-center">
        <div className="mb-3 flex items-center justify-between gap-3 text-white">
          <h2 className="break-words text-lg font-black">{title}</h2>
          <Button variant="ghost" onClick={onClose} className="border-white/30 bg-white text-field-text">
            <X className="h-4 w-4" aria-hidden />
            닫기
          </Button>
        </div>
        {/* eslint-disable-next-line @next/next/no-img-element */}
        <img src={imageUrl} alt={`${title} 콘티`} className="max-h-[78vh] w-full bg-white object-contain" />
      </div>
    </div>
  );
}
