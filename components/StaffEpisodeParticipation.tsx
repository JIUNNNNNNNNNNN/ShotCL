"use client";

import {
  useCallback,
  useEffect,
  useId,
  useMemo,
  useRef,
  useState,
  type CSSProperties,
  type KeyboardEvent as ReactKeyboardEvent
} from "react";
import { createPortal } from "react-dom";
import { ChevronDown, X } from "lucide-react";
import {
  useContextualGuide,
  useContextualGuideAnchor,
  useContextualGuideBlocker
} from "@/components/guides/ContextualGuideProvider";
import { normalizeExcludedEpisodeNumbers } from "@/lib/staffParticipation";
import styles from "./StaffEpisodeParticipation.module.css";

const INLINE_EPISODE_LIMIT = 7;
const POPOVER_MAX_WIDTH = 420;
const POPOVER_VIEWPORT_GUTTER = 12;
const HOVER_CLOSE_DELAY_MS = 140;
const EXIT_MOTION_MS = 140;

type StaffEpisodeParticipationProps = {
  staffLabel: string;
  totalEpisodes: number;
  excludedEpisodeNumbers: number[];
  canEdit: boolean;
  interactionBlocked?: boolean;
  supportsHover: boolean;
  useBottomSheet: boolean;
  departmentColor: { background: string; border: string };
  isOpen: boolean;
  onOpenChange: (open: boolean) => void;
  onChange: (excludedEpisodeNumbers: number[]) => void;
};

type PopoverPosition = {
  left: number;
  top: number;
  width: number;
  ready: boolean;
};

export function StaffEpisodeParticipation({
  staffLabel,
  totalEpisodes,
  excludedEpisodeNumbers,
  canEdit,
  interactionBlocked = false,
  supportsHover,
  useBottomSheet,
  departmentColor,
  isOpen,
  onOpenChange,
  onChange
}: StaffEpisodeParticipationProps) {
  const rootRef = useRef<HTMLDivElement | null>(null);
  const triggerRef = useRef<HTMLButtonElement | null>(null);
  const panelRef = useRef<HTMLDivElement | null>(null);
  const closeTimerRef = useRef<number | null>(null);
  const exitTimerRef = useRef<number | null>(null);
  const pinnedRef = useRef(false);
  const focusFirstEpisodeRef = useRef(false);
  const suppressNextFocusOpenRef = useRef(false);
  const [containerWidth, setContainerWidth] = useState(0);
  const [focusRequest, setFocusRequest] = useState(0);
  const [isRendered, setIsRendered] = useState(isOpen);
  const [isClosing, setIsClosing] = useState(false);
  const [position, setPosition] = useState<PopoverPosition>({ left: 0, top: 0, width: 0, ready: false });
  const pendingSummaryGuideRef = useRef(false);
  const canToggle = canEdit && !interactionBlocked;
  const panelId = `staff-participation-${useId().replace(/:/g, "")}`;
  const participationGuideAnchorRef = useContextualGuideAnchor(
    canToggle && totalEpisodes > 0 ? "staff.participation" : null
  );
  const { requestGuide } = useContextualGuide();
  useContextualGuideBlocker(`${panelId}-guide-blocker`, isOpen || isRendered);

  useEffect(() => {
    if (isOpen || isRendered || !pendingSummaryGuideRef.current) return undefined;
    pendingSummaryGuideRef.current = false;
    const frame = window.requestAnimationFrame(() => {
      requestGuide("staff.participation-summary", "feature", rootRef.current);
    });
    return () => window.cancelAnimationFrame(frame);
  }, [isOpen, isRendered, requestGuide]);

  const episodeNumbers = useMemo(
    () => Array.from({ length: totalEpisodes }, (_, index) => index + 1),
    [totalEpisodes]
  );
  const normalizedExcluded = useMemo(
    () => normalizeExcludedEpisodeNumbers(excludedEpisodeNumbers, totalEpisodes),
    [excludedEpisodeNumbers, totalEpisodes]
  );
  const excludedSet = useMemo(() => new Set(normalizedExcluded), [normalizedExcluded]);
  const participatingEpisodes = useMemo(
    () => episodeNumbers.filter((episodeNumber) => !excludedSet.has(episodeNumber)),
    [episodeNumbers, excludedSet]
  );
  const nonParticipatingEpisodes = normalizedExcluded;
  const participatingCount = participatingEpisodes.length;
  const inlineMinimumWidth = 36 + episodeNumbers.length * 24;
  const useSummary = episodeNumbers.length > INLINE_EPISODE_LIMIT
    || containerWidth === 0
    || containerWidth < inlineMinimumWidth;
  const summaryLabel = totalEpisodes > 0 && participatingCount === totalEpisodes
    ? "참여 전체 회차"
    : `참여 ${participatingCount} / ${totalEpisodes}`;
  const summaryAriaLabel = `${staffLabel} 참여 ${participatingCount}회차, 전체 ${totalEpisodes}회차`;
  const readOnlyAriaLabel = `${summaryAriaLabel}; 참여 회차 ${participatingEpisodes.join(", ") || "없음"}; 미참여 회차 ${nonParticipatingEpisodes.join(", ") || "없음"}`;
  const departmentStyle = {
    "--staff-department-color": departmentColor.border
  } as CSSProperties;

  const setRootElement = useCallback((element: HTMLDivElement | null) => {
    rootRef.current = element;
    participationGuideAnchorRef(element);
  }, [participationGuideAnchorRef]);

  const showInteractionGuide = useCallback((summary: boolean) => {
    if (!canToggle) return;
    if (summary) {
      pendingSummaryGuideRef.current = true;
      return;
    }
    requestGuide("staff.participation", "feature", rootRef.current);
  }, [canToggle, requestGuide]);

  const clearCloseTimer = useCallback(() => {
    if (closeTimerRef.current === null) return;
    window.clearTimeout(closeTimerRef.current);
    closeTimerRef.current = null;
  }, []);

  const closePanel = useCallback((restoreFocus = false) => {
    clearCloseTimer();
    pinnedRef.current = false;
    focusFirstEpisodeRef.current = false;
    const trigger = triggerRef.current;
    const shouldMoveFocus = restoreFocus
      && typeof document !== "undefined"
      && document.activeElement !== trigger;
    suppressNextFocusOpenRef.current = shouldMoveFocus;
    onOpenChange(false);
    if (shouldMoveFocus) {
      window.requestAnimationFrame(() => {
        trigger?.focus();
        if (document.activeElement !== trigger) suppressNextFocusOpenRef.current = false;
      });
    }
  }, [clearCloseTimer, onOpenChange]);

  const openPanel = useCallback((options: { pin?: boolean; focusFirstEpisode?: boolean } = {}) => {
    if (interactionBlocked) return;
    clearCloseTimer();
    if (options.pin) pinnedRef.current = true;
    if (options.focusFirstEpisode) {
      focusFirstEpisodeRef.current = true;
      setFocusRequest((current) => current + 1);
    }
    onOpenChange(true);
  }, [clearCloseTimer, interactionBlocked, onOpenChange]);

  const scheduleHoverClose = useCallback(() => {
    clearCloseTimer();
    if (pinnedRef.current) return;
    closeTimerRef.current = window.setTimeout(() => {
      closeTimerRef.current = null;
      onOpenChange(false);
    }, HOVER_CLOSE_DELAY_MS);
  }, [clearCloseTimer, onOpenChange]);

  const toggleEpisode = useCallback((episodeNumber: number) => {
    if (!canToggle) return;
    onChange(excludedSet.has(episodeNumber)
      ? normalizedExcluded.filter((value) => value !== episodeNumber)
      : [...normalizedExcluded, episodeNumber].sort((left, right) => left - right));
  }, [canToggle, excludedSet, normalizedExcluded, onChange]);

  useEffect(() => {
    const root = rootRef.current;
    if (!root) return;
    const updateWidth = () => setContainerWidth(root.getBoundingClientRect().width);
    updateWidth();
    const observer = new ResizeObserver(updateWidth);
    observer.observe(root);
    return () => observer.disconnect();
  }, []);

  useEffect(() => {
    if (isOpen) {
      if (exitTimerRef.current !== null) window.clearTimeout(exitTimerRef.current);
      exitTimerRef.current = null;
      setIsRendered(true);
      setIsClosing(false);
      return;
    }
    pinnedRef.current = false;
    clearCloseTimer();
    if (!isRendered) return;
    setIsClosing(true);
    exitTimerRef.current = window.setTimeout(() => {
      setIsRendered(false);
      setIsClosing(false);
      exitTimerRef.current = null;
    }, EXIT_MOTION_MS);
    return () => {
      if (exitTimerRef.current !== null) window.clearTimeout(exitTimerRef.current);
      exitTimerRef.current = null;
    };
  }, [clearCloseTimer, isOpen, isRendered]);

  useEffect(() => {
    if (useSummary || !isOpen) return;
    closePanel(false);
  }, [closePanel, isOpen, useSummary]);

  useEffect(() => {
    if (!interactionBlocked || !isOpen) return;
    closePanel(false);
  }, [closePanel, interactionBlocked, isOpen]);

  useEffect(() => {
    if (!isRendered || useBottomSheet) return;

    const updatePosition = () => {
      const trigger = triggerRef.current;
      const panel = panelRef.current;
      if (!trigger || !panel) return;
      const triggerRect = trigger.getBoundingClientRect();
      const viewport = window.visualViewport;
      const viewportLeft = viewport?.offsetLeft ?? 0;
      const viewportTop = viewport?.offsetTop ?? 0;
      const viewportWidth = viewport?.width ?? window.innerWidth;
      const viewportHeight = viewport?.height ?? window.innerHeight;
      const viewportRight = viewportLeft + viewportWidth;
      const viewportBottom = viewportTop + viewportHeight;
      if (
        triggerRect.bottom < viewportTop
        || triggerRect.top > viewportBottom
        || triggerRect.right < viewportLeft
        || triggerRect.left > viewportRight
      ) {
        closePanel(false);
        return;
      }
      const panelWidth = Math.min(
        POPOVER_MAX_WIDTH,
        Math.max(1, viewportWidth - POPOVER_VIEWPORT_GUTTER * 2)
      );
      const measuredHeight = panel.getBoundingClientRect().height;
      const left = Math.min(
        Math.max(triggerRect.right - panelWidth, viewportLeft + POPOVER_VIEWPORT_GUTTER),
        viewportLeft + viewportWidth - panelWidth - POPOVER_VIEWPORT_GUTTER
      );
      const spaceBelow = viewportBottom - triggerRect.bottom;
      const preferredTop = spaceBelow >= measuredHeight + 8
        ? triggerRect.bottom + 6
        : triggerRect.top - measuredHeight - 6;
      const minimumTop = viewportTop + POPOVER_VIEWPORT_GUTTER;
      const maximumTop = Math.max(minimumTop, viewportBottom - measuredHeight - POPOVER_VIEWPORT_GUTTER);
      const top = Math.min(Math.max(preferredTop, minimumTop), maximumTop);
      setPosition({ left, top, width: panelWidth, ready: true });
    };

    const frameId = window.requestAnimationFrame(updatePosition);
    window.addEventListener("resize", updatePosition);
    window.addEventListener("scroll", updatePosition, true);
    window.visualViewport?.addEventListener("resize", updatePosition);
    window.visualViewport?.addEventListener("scroll", updatePosition);
    return () => {
      window.cancelAnimationFrame(frameId);
      window.removeEventListener("resize", updatePosition);
      window.removeEventListener("scroll", updatePosition, true);
      window.visualViewport?.removeEventListener("resize", updatePosition);
      window.visualViewport?.removeEventListener("scroll", updatePosition);
      setPosition((current) => ({ ...current, ready: false }));
    };
  }, [closePanel, isRendered, useBottomSheet, totalEpisodes]);

  useEffect(() => {
    if (!isOpen) return;

    function handlePointerDown(event: PointerEvent) {
      const target = event.target;
      if (!(target instanceof Node)) return;
      if (triggerRef.current?.contains(target) || panelRef.current?.contains(target)) return;
      const focusIsInsidePanel = panelRef.current?.contains(document.activeElement) ?? false;
      const targetWillReceiveFocus = target instanceof Element
        && target.closest("button, a[href], input, textarea, select, [tabindex]:not([tabindex='-1'])") !== null;
      closePanel(focusIsInsidePanel && !targetWillReceiveFocus);
    }

    function handleFocusIn(event: FocusEvent) {
      if (pinnedRef.current) return;
      const target = event.target;
      if (!(target instanceof Node)) return;
      if (triggerRef.current?.contains(target) || panelRef.current?.contains(target)) {
        clearCloseTimer();
        return;
      }
      scheduleHoverClose();
    }

    function handleKeyDown(event: KeyboardEvent) {
      if (event.key === "Escape") {
        event.preventDefault();
        closePanel(true);
        return;
      }
      if (!useBottomSheet || event.key !== "Tab") return;
      const focusable = Array.from(
        panelRef.current?.querySelectorAll<HTMLElement>(
          "button:not([disabled]), [href], [tabindex]:not([tabindex='-1'])"
        ) ?? []
      );
      if (focusable.length === 0) return;
      const currentIndex = focusable.indexOf(document.activeElement as HTMLElement);
      const nextIndex = event.shiftKey
        ? (currentIndex <= 0 ? focusable.length - 1 : currentIndex - 1)
        : (currentIndex < 0 || currentIndex === focusable.length - 1 ? 0 : currentIndex + 1);
      event.preventDefault();
      focusable[nextIndex]?.focus();
    }

    document.addEventListener("pointerdown", handlePointerDown, true);
    document.addEventListener("focusin", handleFocusIn);
    document.addEventListener("keydown", handleKeyDown);
    return () => {
      document.removeEventListener("pointerdown", handlePointerDown, true);
      document.removeEventListener("focusin", handleFocusIn);
      document.removeEventListener("keydown", handleKeyDown);
    };
  }, [clearCloseTimer, closePanel, isOpen, scheduleHoverClose, useBottomSheet]);

  useEffect(() => {
    if (!isRendered || !isOpen || !focusFirstEpisodeRef.current) return;
    const frameId = window.requestAnimationFrame(() => {
      const firstEpisode = panelRef.current?.querySelector<HTMLButtonElement>(
        "[data-participation-episode]:not([tabindex='-1'])"
      );
      const closeButton = panelRef.current?.querySelector<HTMLButtonElement>("[data-participation-close]");
      (firstEpisode ?? closeButton)?.focus();
      focusFirstEpisodeRef.current = false;
    });
    return () => window.cancelAnimationFrame(frameId);
  }, [focusRequest, isOpen, isRendered]);

  useEffect(() => () => {
    clearCloseTimer();
    if (exitTimerRef.current !== null) window.clearTimeout(exitTimerRef.current);
  }, [clearCloseTimer]);

  function handleTriggerClick() {
    if (isOpen && pinnedRef.current) {
      closePanel(false);
      return;
    }
    showInteractionGuide(true);
    openPanel({ pin: true, focusFirstEpisode: useBottomSheet });
  }

  function handleTriggerKeyDown(event: ReactKeyboardEvent<HTMLButtonElement>) {
    if (event.key !== "Enter" && event.key !== " " && event.key !== "ArrowDown") return;
    event.preventDefault();
    showInteractionGuide(true);
    openPanel({ pin: true, focusFirstEpisode: true });
  }

  const panel = isRendered && typeof document !== "undefined" ? createPortal(
    <div
      className={`staff-workspace ${useBottomSheet ? styles.sheetLayer : styles.popoverLayer}`}
      data-closing={isClosing ? "true" : "false"}
      aria-hidden={isClosing || undefined}
      inert={isClosing ? true : undefined}
      onPointerDown={(event) => {
        if (useBottomSheet && event.target === event.currentTarget) closePanel(true);
      }}
    >
      <div
        ref={panelRef}
        id={panelId}
        role="dialog"
        aria-modal={useBottomSheet ? "true" : "false"}
        aria-label={`${staffLabel} 참여 회차 상세`}
        className={`${styles.panel} ${useBottomSheet ? styles.sheet : styles.popover}`}
        style={useBottomSheet ? departmentStyle : {
          ...departmentStyle,
          left: position.left,
          top: position.top,
          width: position.ready ? position.width : undefined,
          visibility: position.ready ? "visible" : "hidden"
        }}
        onPointerEnter={() => clearCloseTimer()}
        onPointerLeave={() => {
          if (supportsHover) scheduleHoverClose();
        }}
        onFocusCapture={() => clearCloseTimer()}
      >
        <div className={styles.panelHeader}>
          <div className={styles.panelHeading}>
            <strong>참여 회차</strong>
            <span aria-live="polite">{summaryLabel}</span>
          </div>
          <button
            type="button"
            data-participation-close
            className={styles.closeButton}
            onClick={() => closePanel(true)}
            aria-label="참여 회차 상세 닫기"
          >
            <X aria-hidden />
          </button>
        </div>

        <div className={styles.episodeGrid} role="group" aria-label={`${staffLabel} 참여 회차 편집`}>
          {episodeNumbers.map((episodeNumber) => {
            const participating = !excludedSet.has(episodeNumber);
            return (
              <button
                key={episodeNumber}
                type="button"
                data-participation-episode
                tabIndex={canToggle ? 0 : -1}
                aria-pressed={participating}
                aria-disabled={!canToggle || undefined}
                aria-label={`${episodeNumber}회차 ${participating ? "참여" : "미참여"}`}
                className={`${styles.gridEpisode} ${participating ? styles.activeEpisode : styles.inactiveEpisode}`}
                onClick={() => toggleEpisode(episodeNumber)}
              >
                {episodeNumber}
              </button>
            );
          })}
        </div>

        <div className={styles.stateSummary}>
          <ParticipationSummaryRow label="참여 회차" values={participatingEpisodes} />
          <ParticipationSummaryRow label="미참여 회차" values={nonParticipatingEpisodes} />
        </div>
        {!canEdit ? <p className={styles.readOnlyLabel}>읽기 전용</p> : null}
      </div>
    </div>,
    document.body
  ) : null;

  return (
    <div
      ref={setRootElement}
      className={styles.root}
      data-staff-participation-control="true"
      style={departmentStyle}
      role={!canEdit && !useSummary && episodeNumbers.length > 0 ? "group" : undefined}
      tabIndex={!canEdit && !useSummary && episodeNumbers.length > 0 ? 0 : undefined}
      aria-label={!canEdit && !useSummary && episodeNumbers.length > 0 ? readOnlyAriaLabel : undefined}
    >
      <span className={styles.fieldLabel} aria-hidden>
        <span className={styles.compactFieldLabel}>회차</span>
        <span className={styles.fullFieldLabel}>참여 회차</span>
      </span>

      {episodeNumbers.length === 0 ? (
        <span className={styles.emptyValue} aria-label="등록된 회차 없음">-</span>
      ) : useSummary ? (
        <button
          ref={triggerRef}
          type="button"
          className={styles.summaryButton}
          aria-expanded={isOpen}
          aria-controls={panelId}
          aria-label={summaryAriaLabel}
          onClick={handleTriggerClick}
          onKeyDown={handleTriggerKeyDown}
          onFocus={() => {
            if (suppressNextFocusOpenRef.current) {
              suppressNextFocusOpenRef.current = false;
              return;
            }
            openPanel();
          }}
          onBlur={() => scheduleHoverClose()}
          onPointerEnter={() => {
            if (supportsHover) openPanel();
          }}
          onPointerLeave={() => {
            if (supportsHover) scheduleHoverClose();
          }}
        >
          <span className={styles.summaryText}>{summaryLabel}</span>
          <ChevronDown className={styles.summaryIcon} aria-hidden />
        </button>
      ) : (
        <div
          className={styles.segmentedControl}
          role="group"
          aria-label={`${staffLabel} 참여 회차`}
          style={{ gridTemplateColumns: `repeat(${episodeNumbers.length}, minmax(0, 1fr))` }}
        >
          {episodeNumbers.map((episodeNumber) => {
            const participating = !excludedSet.has(episodeNumber);
            return (
              <button
                key={episodeNumber}
                type="button"
                tabIndex={canToggle ? 0 : -1}
                aria-pressed={participating}
                aria-disabled={!canToggle || undefined}
                aria-label={`${episodeNumber}회차 ${participating ? "참여" : "미참여"}`}
                className={`${styles.segment} ${participating ? styles.activeEpisode : styles.inactiveEpisode}`}
                onClick={() => {
                  showInteractionGuide(false);
                  toggleEpisode(episodeNumber);
                }}
              >
                {episodeNumber}
              </button>
            );
          })}
        </div>
      )}
      {panel}
    </div>
  );
}

function ParticipationSummaryRow({ label, values }: { label: string; values: number[] }) {
  return (
    <div className={styles.summaryRow}>
      <span>{label}</span>
      <strong>{values.length > 0 ? values.join(", ") : "없음"}</strong>
    </div>
  );
}

export function isStaffParticipationControlTarget(target: EventTarget | null) {
  return target instanceof Element
    && target.closest('[data-staff-participation-control="true"]') !== null;
}
