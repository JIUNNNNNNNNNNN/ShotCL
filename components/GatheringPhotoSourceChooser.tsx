"use client";

import {
  forwardRef,
  useCallback,
  useEffect,
  useImperativeHandle,
  useId,
  useLayoutEffect,
  useRef,
  useState
} from "react";
import { createPortal } from "react-dom";
import { Camera, ImageIcon } from "lucide-react";
import { useContextualGuideBlocker } from "@/components/guides/ContextualGuideProvider";
import { PERSISTENT_PROJECT_SHELL_QUERY } from "@/hooks/useProjectShellMode";
import {
  consumeAndResetGatheringPhotoInput,
  GATHERING_PHOTO_FINE_POINTER_QUERY,
  GATHERING_PHOTO_TOUCH_POINTER_QUERY,
  getGatheringPhotoInputPolicy,
  requiresGatheringPhotoDrawerHandoff,
  resetGatheringPhotoInput,
  resolveGatheringPhotoPickerPresentation,
  resolveGatheringPhotoSourceSheetDelay,
  type GatheringPhotoSource
} from "@/lib/client/gatheringPhotoSource";
import styles from "./GatheringPhotoSourceChooser.module.css";

const SOURCE_SHEET_CLOSE_MS = 140;

export type GatheringPhotoSourceChooserHandle = {
  open: (options?: {
    /** Card triggers are already outside the compact action drawer transition. */
    origin?: "auto" | "card";
    title?: string;
  }) => "blocked" | "album-direct" | "source-sheet";
};

type GatheringPhotoSourceChooserProps = {
  allowMultipleAlbum?: boolean;
  disabled?: boolean;
  onFilesSelected: (files: File[]) => void | Promise<void>;
  /** Cancels a deferred drawer open when the selected plan or permission scope changes. */
  resetKey?: string;
};

type SheetPhase = "closed" | "open" | "closing";

export const GatheringPhotoSourceChooser = forwardRef<
  GatheringPhotoSourceChooserHandle,
  GatheringPhotoSourceChooserProps
>(function GatheringPhotoSourceChooser({
  allowMultipleAlbum = true,
  disabled = false,
  onFilesSelected,
  resetKey = ""
}, ref) {
  const cameraPolicy = getGatheringPhotoInputPolicy("camera", allowMultipleAlbum);
  const albumPolicy = getGatheringPhotoInputPolicy("album", allowMultipleAlbum);
  const cameraInputRef = useRef<HTMLInputElement | null>(null);
  const albumInputRef = useRef<HTMLInputElement | null>(null);
  const sheetRef = useRef<HTMLDivElement | null>(null);
  const cameraButtonRef = useRef<HTMLButtonElement | null>(null);
  const returnFocusRef = useRef<HTMLElement | null>(null);
  const openTimerRef = useRef<number | null>(null);
  const openFrameRef = useRef<number | null>(null);
  const closeTimerRef = useRef<number | null>(null);
  const activeResetKeyRef = useRef(resetKey);
  const pickerResetKeyRef = useRef("");
  const onFilesSelectedRef = useRef(onFilesSelected);
  const [sheetPhase, setSheetPhase] = useState<SheetPhase>("closed");
  const [sourceSheetRequested, setSourceSheetRequested] = useState(false);
  const [sourceSheetTitle, setSourceSheetTitle] = useState("집합장소 사진 추가");
  const sheetRendered = sheetPhase !== "closed";
  const titleId = useId();

  useLayoutEffect(() => {
    onFilesSelectedRef.current = onFilesSelected;
  }, [onFilesSelected]);

  useLayoutEffect(() => {
    activeResetKeyRef.current = resetKey;
  }, [resetKey]);

  useContextualGuideBlocker(
    "progress-gathering-photo-source",
    sourceSheetRequested || sheetRendered
  );

  const clearOpenRequest = useCallback(() => {
    if (openTimerRef.current !== null) window.clearTimeout(openTimerRef.current);
    if (openFrameRef.current !== null) window.cancelAnimationFrame(openFrameRef.current);
    openTimerRef.current = null;
    openFrameRef.current = null;
    setSourceSheetRequested(false);
  }, []);

  const restoreTriggerFocus = useCallback(() => {
    const trigger = returnFocusRef.current;
    returnFocusRef.current = null;
    window.requestAnimationFrame(() => {
      const fallback = document.querySelector<HTMLButtonElement>(".project-shell__action-toggle");
      const target = isValidSourceSheetReturnTarget(trigger) ? trigger : fallback;
      target?.focus({ preventScroll: true });
    });
  }, []);

  const finishClosing = useCallback(() => {
    if (closeTimerRef.current !== null) window.clearTimeout(closeTimerRef.current);
    closeTimerRef.current = null;
    setSheetPhase("closed");
  }, []);

  const closeSourceSheet = useCallback((restoreFocus: boolean) => {
    clearOpenRequest();
    if (!restoreFocus) returnFocusRef.current = null;
    setSheetPhase((current) => {
      if (current === "closed") return current;
      return "closing";
    });
    if (restoreFocus) restoreTriggerFocus();

    if (window.matchMedia("(prefers-reduced-motion: reduce)").matches) {
      finishClosing();
      return;
    }
    if (closeTimerRef.current !== null) window.clearTimeout(closeTimerRef.current);
    closeTimerRef.current = window.setTimeout(finishClosing, SOURCE_SHEET_CLOSE_MS);
  }, [clearOpenRequest, finishClosing, restoreTriggerFocus]);

  const openNativePicker = useCallback((source: GatheringPhotoSource) => {
    const input = source === "camera" ? cameraInputRef.current : albumInputRef.current;
    if (!input || input.disabled) return false;
    resetGatheringPhotoInput(input);
    pickerResetKeyRef.current = activeResetKeyRef.current;
    input.click();
    return true;
  }, []);

  useImperativeHandle(ref, () => ({
    open(options) {
      if (disabled || typeof window === "undefined") return "blocked";
      const persistentProjectShell = window.matchMedia(PERSISTENT_PROJECT_SHELL_QUERY).matches;
      const presentation = resolveGatheringPhotoPickerPresentation({
        persistentProjectShell,
        finePointer: window.matchMedia(GATHERING_PHOTO_FINE_POINTER_QUERY).matches,
        touchCapable: navigator.maxTouchPoints > 0
          || window.matchMedia(GATHERING_PHOTO_TOUCH_POINTER_QUERY).matches
      });
      if (presentation === "album-direct") {
        return openNativePicker("album") ? presentation : "blocked";
      }

      clearOpenRequest();
      setSourceSheetTitle(options?.title?.trim() || "집합장소 사진 추가");
      if (closeTimerRef.current !== null) window.clearTimeout(closeTimerRef.current);
      closeTimerRef.current = null;
      const trigger = document.activeElement instanceof HTMLElement
        ? document.activeElement
        : null;
      returnFocusRef.current = trigger;
      const triggeredFromActionDrawer = options?.origin === "card"
        ? false
        : requiresGatheringPhotoDrawerHandoff({
            persistentProjectShell,
            triggerInsideActionDrawer: Boolean(trigger?.closest("#project-action-drawer"))
          });
      const reducedMotion = window.matchMedia("(prefers-reduced-motion: reduce)").matches;
      const delay = resolveGatheringPhotoSourceSheetDelay({
        triggeredFromActionDrawer,
        reducedMotion
      });
      setSourceSheetRequested(true);

      const showSheet = () => {
        openTimerRef.current = null;
        openFrameRef.current = null;
        setSourceSheetRequested(false);
        setSheetPhase("open");
      };
      if (delay > 0) {
        openTimerRef.current = window.setTimeout(showSheet, delay);
      } else if (triggeredFromActionDrawer) {
        // Reduced motion collapses the drawer transition; the next frame still
        // lets its inert/focus lifecycle settle before the dialog takes focus.
        openFrameRef.current = window.requestAnimationFrame(showSheet);
      } else {
        showSheet();
      }
      return presentation;
    }
  }), [clearOpenRequest, disabled, openNativePicker]);

  useEffect(() => {
    if (!disabled) return;
    clearOpenRequest();
    returnFocusRef.current = null;
    if (closeTimerRef.current !== null) window.clearTimeout(closeTimerRef.current);
    closeTimerRef.current = null;
    setSheetPhase("closed");
  }, [clearOpenRequest, disabled]);

  useEffect(() => {
    clearOpenRequest();
    returnFocusRef.current = null;
    if (closeTimerRef.current !== null) window.clearTimeout(closeTimerRef.current);
    closeTimerRef.current = null;
    setSheetPhase("closed");
  }, [clearOpenRequest, resetKey]);

  useEffect(() => () => {
    if (openTimerRef.current !== null) window.clearTimeout(openTimerRef.current);
    if (openFrameRef.current !== null) window.cancelAnimationFrame(openFrameRef.current);
    if (closeTimerRef.current !== null) window.clearTimeout(closeTimerRef.current);
  }, []);

  useEffect(() => {
    if (!sheetRendered) return undefined;
    const mainContent = document.getElementById("project-main-content");
    const previousBodyOverflow = document.body.style.overflow;
    const previousMainOverflowY = mainContent?.style.overflowY ?? "";
    const previousMainOverscrollBehavior = mainContent?.style.overscrollBehavior ?? "";
    document.body.style.overflow = "hidden";
    if (mainContent) {
      mainContent.style.overflowY = "hidden";
      mainContent.style.overscrollBehavior = "contain";
    }
    return () => {
      document.body.style.overflow = previousBodyOverflow;
      if (mainContent) {
        mainContent.style.overflowY = previousMainOverflowY;
        mainContent.style.overscrollBehavior = previousMainOverscrollBehavior;
      }
    };
  }, [sheetRendered]);

  useEffect(() => {
    if (sheetPhase !== "open") return undefined;
    const dialog = sheetRef.current;
    if (!dialog) return undefined;
    const focusFrame = window.requestAnimationFrame(() => {
      cameraButtonRef.current?.focus({ preventScroll: true });
    });

    function handleKeyDown(event: KeyboardEvent) {
      if (event.key === "Escape") {
        event.preventDefault();
        closeSourceSheet(true);
        return;
      }
      if (event.key !== "Tab") return;
      const focusable = getSourceSheetFocusable(dialog!);
      if (focusable.length === 0) {
        event.preventDefault();
        dialog!.focus({ preventScroll: true });
        return;
      }
      const first = focusable[0];
      const last = focusable.at(-1)!;
      if (!dialog!.contains(document.activeElement)) {
        event.preventDefault();
        (event.shiftKey ? last : first).focus({ preventScroll: true });
      } else if (event.shiftKey && document.activeElement === first) {
        event.preventDefault();
        last.focus({ preventScroll: true });
      } else if (!event.shiftKey && document.activeElement === last) {
        event.preventDefault();
        first.focus({ preventScroll: true });
      }
    }

    document.addEventListener("keydown", handleKeyDown);
    return () => {
      window.cancelAnimationFrame(focusFrame);
      document.removeEventListener("keydown", handleKeyDown);
    };
  }, [closeSourceSheet, sheetPhase]);

  function handleInputChange(input: HTMLInputElement) {
    const files = consumeAndResetGatheringPhotoInput(input);
    if (
      files.length === 0
      || disabled
      || pickerResetKeyRef.current !== activeResetKeyRef.current
    ) return;
    void onFilesSelectedRef.current(files);
  }

  function chooseSource(source: GatheringPhotoSource) {
    if (disabled) {
      closeSourceSheet(false);
      return;
    }
    // Do not restore the drawer trigger after returning from an OS picker.
    // Clearing/closing first is safe because input.click() remains in this
    // same trusted button event stack.
    closeSourceSheet(false);
    openNativePicker(source);
  }

  const sourceSheet = sheetRendered && typeof document !== "undefined" ? createPortal(
    <div
      ref={sheetRef}
      className={styles.overlay}
      data-contextual-guide-overlay
      data-project-shell-portal
      data-closing={sheetPhase === "closing" ? "true" : "false"}
      role="dialog"
      aria-modal="true"
      aria-labelledby={titleId}
      aria-hidden={sheetPhase === "closing" || undefined}
      inert={sheetPhase === "closing" || undefined}
      tabIndex={-1}
      onPointerDown={(event) => {
        if (event.target === event.currentTarget) closeSourceSheet(true);
      }}
    >
      <section className={styles.sheet}>
        <header className={styles.header}>
          <h2 id={titleId} className={styles.title}>{sourceSheetTitle}</h2>
        </header>
        <div className={styles.actions}>
          <button
            ref={cameraButtonRef}
            type="button"
            className={styles.action}
            disabled={disabled}
            onClick={() => chooseSource("camera")}
          >
            <Camera className={styles.actionIcon} aria-hidden />
            <span className={styles.actionLabel}>사진 촬영</span>
            <span aria-hidden />
          </button>
          <button
            type="button"
            className={styles.action}
            disabled={disabled}
            onClick={() => chooseSource("album")}
          >
            <ImageIcon className={styles.actionIcon} aria-hidden />
            <span className={styles.actionLabel}>앨범에서 선택</span>
            <span aria-hidden />
          </button>
        </div>
        <footer className={styles.footer}>
          <button type="button" className={styles.cancel} onClick={() => closeSourceSheet(true)}>
            취소
          </button>
        </footer>
      </section>
    </div>,
    document.body
  ) : null;

  return (
    <>
      <input
        ref={cameraInputRef}
        type="file"
        className="sr-only"
        tabIndex={-1}
        aria-hidden="true"
        accept={cameraPolicy.accept}
        capture={cameraPolicy.capture}
        multiple={cameraPolicy.multiple}
        disabled={disabled}
        onChange={(event) => handleInputChange(event.currentTarget)}
      />
      <input
        ref={albumInputRef}
        type="file"
        className="sr-only"
        tabIndex={-1}
        aria-hidden="true"
        accept={albumPolicy.accept}
        multiple={albumPolicy.multiple}
        disabled={disabled}
        onChange={(event) => handleInputChange(event.currentTarget)}
      />
      {sourceSheet}
    </>
  );
});

GatheringPhotoSourceChooser.displayName = "GatheringPhotoSourceChooser";

function getSourceSheetFocusable(root: HTMLElement) {
  return Array.from(root.querySelectorAll<HTMLElement>(
    "button:not([disabled]), [href], [tabindex]:not([tabindex='-1'])"
  )).filter((element) => !element.hasAttribute("hidden") && element.getAttribute("aria-hidden") !== "true");
}

function isValidSourceSheetReturnTarget(element: HTMLElement | null) {
  return Boolean(
    element
    && element !== document.body
    && element !== document.documentElement
    && element.isConnected
    && !element.closest("[inert]")
    && element.matches("button:not([disabled]), [href], input:not([disabled]), select:not([disabled]), textarea:not([disabled]), [tabindex]:not([tabindex='-1'])")
  );
}
