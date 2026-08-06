"use client";

import { useEffect, useRef } from "react";
import type { Project } from "@/lib/types";

const LONG_PRESS_MS = 600;
const LONG_PRESS_MOVEMENT_PX = 9;

type RememberedProjectCardProps = {
  project: Project;
  disabled: boolean;
  isOpening: boolean;
  onOpen: (project: Project) => void;
  onOpenMenu: (
    project: Project,
    clientX: number,
    clientY: number,
    triggerElement: HTMLButtonElement
  ) => void;
};

type PointerSession = {
  pointerId: number;
  startX: number;
  startY: number;
  lastX: number;
  lastY: number;
  moved: boolean;
  longPressed: boolean;
  timer: number;
};

/** 이전 참여 프로젝트의 짧은 탭과 모바일 길게 누르기를 분리합니다. */
export function RememberedProjectCard({
  project,
  disabled,
  isOpening,
  onOpen,
  onOpenMenu
}: RememberedProjectCardProps) {
  const pointerSessionRef = useRef<PointerSession | null>(null);
  const suppressNextClickRef = useRef(false);

  useEffect(() => {
    return () => clearPointerSession();
  }, []);

  useEffect(() => {
    if (disabled) clearPointerSession();
  }, [disabled]);

  function clearPointerSession() {
    const session = pointerSessionRef.current;
    if (session) window.clearTimeout(session.timer);
    pointerSessionRef.current = null;
  }

  function suppressSyntheticClick() {
    suppressNextClickRef.current = true;
  }

  function openMenu(
    clientX: number,
    clientY: number,
    triggerElement: HTMLButtonElement,
    shouldSuppressClick = false
  ) {
    if (shouldSuppressClick) suppressSyntheticClick();
    onOpenMenu(project, clientX, clientY, triggerElement);
  }

  return (
    <button
      type="button"
      disabled={disabled}
      draggable={false}
      onContextMenu={(event) => {
        event.preventDefault();
        event.stopPropagation();
        const session = pointerSessionRef.current;
        if (session?.moved) {
          clearPointerSession();
          return;
        }
        const nativePointerType = "pointerType" in event.nativeEvent
          ? String(event.nativeEvent.pointerType)
          : "";
        const shouldSuppressClick = Boolean(session)
          || nativePointerType === "touch"
          || nativePointerType === "pen";
        clearPointerSession();
        const bounds = event.currentTarget.getBoundingClientRect();
        openMenu(
          event.clientX || bounds.left + bounds.width / 2,
          event.clientY || bounds.top + bounds.height / 2,
          event.currentTarget,
          shouldSuppressClick
        );
      }}
      onPointerDown={(event) => {
        if (
          disabled
          || !event.isPrimary
          || event.button !== 0
        ) return;

        clearPointerSession();
        suppressNextClickRef.current = false;
        if (event.pointerType === "mouse") return;
        const pointerId = event.pointerId;
        const triggerElement = event.currentTarget;
        const session: PointerSession = {
          pointerId,
          startX: event.clientX,
          startY: event.clientY,
          lastX: event.clientX,
          lastY: event.clientY,
          moved: false,
          longPressed: false,
          timer: 0
        };
        session.timer = window.setTimeout(() => {
          const current = pointerSessionRef.current;
          if (!current || current.pointerId !== pointerId || current.moved) return;
          current.longPressed = true;
          openMenu(current.lastX, current.lastY, triggerElement, true);
        }, LONG_PRESS_MS);
        pointerSessionRef.current = session;
      }}
      onPointerMove={(event) => {
        const session = pointerSessionRef.current;
        if (!session || session.pointerId !== event.pointerId) return;
        session.lastX = event.clientX;
        session.lastY = event.clientY;
        if (
          !session.longPressed
          && Math.hypot(event.clientX - session.startX, event.clientY - session.startY)
            > LONG_PRESS_MOVEMENT_PX
        ) {
          session.moved = true;
          window.clearTimeout(session.timer);
        }
      }}
      onPointerUp={(event) => {
        const session = pointerSessionRef.current;
        if (!session || session.pointerId !== event.pointerId) return;
        if (session.longPressed || session.moved) suppressSyntheticClick();
        clearPointerSession();
      }}
      onPointerCancel={() => {
        clearPointerSession();
      }}
      onKeyDown={(event) => {
        if (event.key !== "ContextMenu" && !(event.shiftKey && event.key === "F10")) return;
        event.preventDefault();
        event.stopPropagation();
        const bounds = event.currentTarget.getBoundingClientRect();
        openMenu(
          bounds.left + bounds.width / 2,
          bounds.top + bounds.height / 2,
          event.currentTarget
        );
      }}
      onClick={(event) => {
        event.stopPropagation();
        if (suppressNextClickRef.current) {
          event.preventDefault();
          suppressNextClickRef.current = false;
          return;
        }
        onOpen(project);
      }}
      className="ui-motion-surface flex min-h-14 min-w-0 touch-pan-y select-none flex-col items-center justify-center gap-0.5 rounded-[var(--radius-card)] border border-field-divider bg-field-panel px-3 py-2 text-center transition-[border-color,background-color,transform] hover:border-field-subtle hover:bg-field-hover active:scale-[0.99] disabled:cursor-not-allowed disabled:opacity-55 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-field-primary"
      style={{ WebkitTouchCallout: "none" }}
      aria-label={`${project.name} 프로젝트 홈 열기`}
      aria-busy={isOpening}
    >
      <span className="min-w-0 break-words text-center text-xs font-black leading-5 text-field-text [overflow-wrap:anywhere]">
        <span className="font-display">{project.name}</span>
      </span>
      <span className="shrink-0 text-center text-[9px] font-bold text-field-muted">
        {isOpening ? "확인 중" : project.accessRole === "admin" ? "Key staff" : "Staff"}
      </span>
    </button>
  );
}

export const rememberedProjectLongPressConfig = {
  delayMs: LONG_PRESS_MS,
  movementThresholdPx: LONG_PRESS_MOVEMENT_PX
} as const;

type RememberedProjectActionsProps = {
  menuTarget: {
    project: Project;
    left: number;
    top: number;
    triggerElement: HTMLButtonElement;
  } | null;
  confirmationTarget: Project | null;
  onRequestRemoval: (project: Project) => void;
  onCancelRemoval: () => void;
  onConfirmRemoval: (project: Project) => void;
};

/** 메인 화면에서만 쓰는 직사각형 메뉴와 제거 확인창입니다. */
export function RememberedProjectActions({
  menuTarget,
  confirmationTarget,
  onRequestRemoval,
  onCancelRemoval,
  onConfirmRemoval
}: RememberedProjectActionsProps) {
  const menuButtonRef = useRef<HTMLButtonElement | null>(null);
  const cancelButtonRef = useRef<HTMLButtonElement | null>(null);

  useEffect(() => {
    if (!menuTarget) return;
    menuButtonRef.current?.focus();
  }, [menuTarget]);

  useEffect(() => {
    if (confirmationTarget) cancelButtonRef.current?.focus();
  }, [confirmationTarget]);

  if (confirmationTarget) {
    return (
      <div
        className="fixed inset-0 z-[90] flex items-center justify-center bg-black/70 p-4 pb-[max(1rem,env(safe-area-inset-bottom))] pt-[max(1rem,env(safe-area-inset-top))]"
        onPointerDown={(event) => event.stopPropagation()}
        onContextMenu={(event) => event.preventDefault()}
      >
        <section
          role="alertdialog"
          aria-modal="true"
          aria-labelledby="remembered-project-removal-title"
          aria-describedby="remembered-project-removal-description"
          className="ui-motion-dialog max-h-[min(28rem,calc(100dvh-2rem))] w-full max-w-sm overflow-y-auto rounded-[var(--radius-dialog)] border border-field-divider bg-field-dialog p-4 text-center shadow-dialog"
        >
          <h2 id="remembered-project-removal-title" className="text-sm font-black text-field-text">
            프로젝트 목록에서 지우기
          </h2>
          <div id="remembered-project-removal-description" className="mt-3 space-y-2 text-xs font-bold leading-5 text-field-muted">
            <p>
              <span className="font-black text-field-text">{confirmationTarget.name}</span>을(를) 이전 참여 프로젝트 목록에서 지우시겠습니까?
            </p>
            <p>프로젝트와 참여 권한은 삭제되지 않습니다.</p>
          </div>
          <div className="mt-5 grid grid-cols-2 gap-2">
            <button
              ref={cancelButtonRef}
              type="button"
              onClick={onCancelRemoval}
              className="min-h-10 border border-field-divider bg-field-panel px-3 text-xs font-black text-field-text hover:border-field-subtle hover:bg-field-hover focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-field-primary"
            >
              취소
            </button>
            <button
              type="button"
              onClick={() => onConfirmRemoval(confirmationTarget)}
              className="min-h-10 border border-field-danger bg-field-danger px-3 text-xs font-black text-field-text hover:brightness-105 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-field-danger focus-visible:ring-offset-2"
            >
              목록에서 지우기
            </button>
          </div>
        </section>
      </div>
    );
  }

  if (!menuTarget) return null;

  return (
    <div
      role="menu"
      aria-label={`${menuTarget.project.name} 프로젝트 메뉴`}
      className="ui-motion-menu fixed z-[80] w-44 rounded-[var(--radius-menu)] border border-field-divider bg-field-elevated p-1"
      style={{ left: menuTarget.left, top: menuTarget.top }}
      onPointerDown={(event) => event.stopPropagation()}
      onContextMenu={(event) => {
        event.preventDefault();
        event.stopPropagation();
      }}
    >
      <button
        ref={menuButtonRef}
        type="button"
        role="menuitem"
        onClick={() => onRequestRemoval(menuTarget.project)}
        className="flex min-h-11 w-full items-center justify-center rounded-[var(--radius-control)] px-3 text-center text-xs font-black text-field-danger hover:bg-field-danger hover:text-field-text focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-field-primary"
      >
        목록에서 지우기
      </button>
    </div>
  );
}
