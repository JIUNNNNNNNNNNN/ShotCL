"use client";

import { forwardRef } from "react";
import { Trash2 } from "lucide-react";

export const ArchiveDeleteDropZone = forwardRef<HTMLDivElement, { isActive: boolean }>(
  function ArchiveDeleteDropZone({ isActive }, ref) {
    return (
      <div
        className="pointer-events-none fixed left-1/2 z-[130] flex min-h-16 w-32 -translate-x-1/2"
        style={{ bottom: "calc(env(safe-area-inset-bottom, 0px) + 20px)" }}
      >
        <div
          ref={ref}
          className={`flex min-h-16 w-full items-center justify-center gap-2 rounded-[10px] border-2 px-4 py-3 font-semibold transition-[transform,border-color,background-color,color] duration-150 motion-reduce:transition-none ${
          isActive
            ? "scale-[1.04] border-field-danger bg-field-danger/10 text-field-danger"
            : "border-field-divider bg-field-floating text-field-subtle shadow-floating"
          }`}
          role="status"
          aria-label={isActive ? "삭제 영역에 놓을 수 있습니다" : "삭제 영역"}
        >
          <Trash2 className="h-5 w-5 shrink-0" aria-hidden />
          <span className="text-sm">삭제</span>
        </div>
      </div>
    );
  }
);
