"use client";

import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useLayoutEffect,
  useMemo,
  useRef,
  useState,
  type CSSProperties,
  type RefCallback
} from "react";
import { createPortal } from "react-dom";
import { Check, HelpCircle, X } from "lucide-react";
import { usePathname, useSearchParams } from "next/navigation";
import { usePersistentProjectShell } from "@/hooks/useProjectShellMode";
import {
  CONTEXTUAL_GUIDES,
  MAIN_INTRO_GUIDE_IDS,
  canUseGuide,
  getGuideIdsForPage,
  getGuidePage,
  getGuideStorageToken,
  type ContextualGuideAnchorKey,
  type ContextualGuideDefinition,
  type ContextualGuideId,
  type ContextualGuidePlacement
} from "@/lib/contextualGuides";
import type { SharedProjectRole } from "@/lib/projectAccess/core";
import { resolveDismissedProjectOwnerId } from "@/lib/projectAccess/dismissedProjects";

type GuideRequestSource = "auto" | "feature" | "replay";

type ActiveGuide = {
  id: ContextualGuideId;
  source: GuideRequestSource;
  anchorKey?: ContextualGuideAnchorKey;
  anchor?: HTMLElement;
};

type GuideContextValue = {
  role: SharedProjectRole | null;
  persistentShell: boolean;
  activeGuideId: ContextualGuideId | null;
  readinessVersion: number;
  registerAnchor: (key: ContextualGuideAnchorKey, element: HTMLElement | null) => () => void;
  requestGuide: (
    id: ContextualGuideId,
    source?: GuideRequestSource,
    preferredAnchor?: HTMLElement | null
  ) => boolean;
  isGuideCompleted: (id: ContextualGuideId) => boolean;
  completeGuide: (id: ContextualGuideId) => void;
  dismissActiveGuide: () => void;
  registerBlocker: (key: string, blocked: boolean) => void;
  getReplayGuides: () => ContextualGuideDefinition[];
};

const ContextualGuideContext = createContext<GuideContextValue | null>(null);
const GUIDE_ANONYMOUS_KEY = "shotcl:guide-anonymous:v1";
const GUIDE_STORAGE_PREFIX = "shotcl:guides";
const MAIN_INTRO_GUIDE_ID_SET = new Set<ContextualGuideId>(MAIN_INTRO_GUIDE_IDS);

export function ContextualGuideProvider({
  userNamespace,
  role,
  children
}: {
  userNamespace: string;
  role: SharedProjectRole | null;
  children: React.ReactNode;
}) {
  const pathname = usePathname();
  const searchParams = useSearchParams();
  const routeKey = `${pathname}?${searchParams.toString()}`;
  const page = getGuidePage(pathname, searchParams);
  const persistentShell = usePersistentProjectShell();
  const anchorsRef = useRef(new Map<ContextualGuideAnchorKey, Set<HTMLElement>>());
  const blockersRef = useRef(new Set<string>());
  const completedRef = useRef(new Set<string>());
  const activeGuideRef = useRef<ActiveGuide | null>(null);
  const routeInteractionRef = useRef(false);
  const storageKeyRef = useRef("");
  const [activeGuide, setActiveGuide] = useState<ActiveGuide | null>(null);
  const [persistenceReady, setPersistenceReady] = useState(false);
  const [readinessVersion, setReadinessVersion] = useState(0);

  useEffect(() => {
    let cancelled = false;
    let activeStorageKey = "";
    const handleStorage = (event: StorageEvent) => {
      if (!activeStorageKey || event.key !== activeStorageKey) return;
      completedRef.current = readCompletedGuideTokens(activeStorageKey);
      setReadinessVersion((current) => current + 1);
    };

    storageKeyRef.current = "";
    completedRef.current = new Set();
    activeGuideRef.current = null;
    setActiveGuide(null);
    setPersistenceReady(false);

    void resolveGuideUserNamespace(userNamespace).then((namespace) => {
      if (cancelled) return;
      activeStorageKey = `${GUIDE_STORAGE_PREFIX}:${encodeURIComponent(namespace)}:v1`;
      storageKeyRef.current = activeStorageKey;
      completedRef.current = readCompletedGuideTokens(activeStorageKey);
      setPersistenceReady(true);
      setReadinessVersion((current) => current + 1);
      window.addEventListener("storage", handleStorage);
    });

    return () => {
      cancelled = true;
      window.removeEventListener("storage", handleStorage);
    };
  }, [userNamespace]);

  useLayoutEffect(() => {
    routeInteractionRef.current = false;
    activeGuideRef.current = null;
    setActiveGuide(null);
    setReadinessVersion((current) => current + 1);
  }, [routeKey]);

  const registerAnchor = useCallback((key: ContextualGuideAnchorKey, element: HTMLElement | null) => {
    if (!element) return () => undefined;
    const elements = anchorsRef.current.get(key) ?? new Set<HTMLElement>();
    elements.add(element);
    anchorsRef.current.set(key, elements);
    setReadinessVersion((current) => current + 1);
    return () => {
      const current = anchorsRef.current.get(key);
      current?.delete(element);
      if (current?.size === 0) anchorsRef.current.delete(key);
      if (activeGuideRef.current?.anchor === element) {
        activeGuideRef.current = null;
        setActiveGuide(null);
      }
      setReadinessVersion((version) => version + 1);
    };
  }, []);

  const persistCompletion = useCallback((id: ContextualGuideId) => {
    const token = getGuideStorageToken(id);
    if (completedRef.current.has(token)) return;
    completedRef.current.add(token);
    const storageKey = storageKeyRef.current;
    if (storageKey) {
      try {
        window.localStorage.setItem(storageKey, JSON.stringify(Array.from(completedRef.current).sort()));
      } catch {
        // 가이드 상태 저장 실패는 핵심 화면이나 기능을 막지 않습니다.
      }
    }
    setReadinessVersion((current) => current + 1);
  }, []);

  const dismissActiveGuide = useCallback(() => {
    activeGuideRef.current = null;
    setActiveGuide(null);
  }, []);

  const completeGuide = useCallback((id: ContextualGuideId) => {
    persistCompletion(id);
    if (activeGuideRef.current?.id === id) dismissActiveGuide();
  }, [dismissActiveGuide, persistCompletion]);

  const isGuideCompleted = useCallback((id: ContextualGuideId) => (
    completedRef.current.has(getGuideStorageToken(id))
  ), []);

  useEffect(() => {
    const handlePointerDown = (event: PointerEvent) => {
      routeInteractionRef.current = true;
      const active = activeGuideRef.current;
      const target = event.target instanceof Node ? event.target : null;
      if (!active || !target) return;
      const insideGuide = target instanceof Element && Boolean(target.closest("[data-contextual-guide]"));
      if (MAIN_INTRO_GUIDE_ID_SET.has(active.id) && (!persistentShell || !insideGuide)) {
        completeGuide(active.id);
        return;
      }
      if (insideGuide) return;
      if (active.anchor?.contains(target)) completeGuide(active.id);
      else dismissActiveGuide();
    };
    const handleKeyDown = (event: KeyboardEvent) => {
      routeInteractionRef.current = true;
      const target = event.target instanceof Node ? event.target : null;
      const active = activeGuideRef.current;
      if (!active || (target instanceof Element && target.closest("[data-contextual-guide]"))) return;
      if (MAIN_INTRO_GUIDE_ID_SET.has(active.id) || (target && active.anchor?.contains(target))) {
        completeGuide(active.id);
      }
      else dismissActiveGuide();
    };
    const handleScroll = (event: Event) => {
      routeInteractionRef.current = true;
      if (event.target instanceof Element && event.target.closest("[data-contextual-guide]")) return;
      const active = activeGuideRef.current;
      if (!active) return;
      if (MAIN_INTRO_GUIDE_ID_SET.has(active.id)) completeGuide(active.id);
      else dismissActiveGuide();
    };
    document.addEventListener("pointerdown", handlePointerDown, true);
    document.addEventListener("keydown", handleKeyDown, true);
    document.addEventListener("scroll", handleScroll, true);
    return () => {
      document.removeEventListener("pointerdown", handlePointerDown, true);
      document.removeEventListener("keydown", handleKeyDown, true);
      document.removeEventListener("scroll", handleScroll, true);
    };
  }, [completeGuide, dismissActiveGuide, persistentShell, routeKey]);

  const requestGuide = useCallback((
    id: ContextualGuideId,
    source: GuideRequestSource = "feature",
    preferredAnchor?: HTMLElement | null
  ) => {
    const definition = CONTEXTUAL_GUIDES[id];
    if (
      !definition
      || definition.page !== page
      || !canUseGuide(definition, role)
      || !canUseGuideCapability(definition)
    ) return false;
    if (!persistenceReady && source !== "replay") return false;
    if (source !== "replay" && completedRef.current.has(getGuideStorageToken(id))) return false;
    if (source === "auto" && routeInteractionRef.current) return false;
    if (blockersRef.current.size > 0 || hasVisibleInteractiveOverlay()) return false;

    let anchorKey: ContextualGuideAnchorKey | undefined;
    let anchor: HTMLElement | undefined;
    if (definition.type === "anchor") {
      anchorKey = persistentShell ? definition.persistentAnchor : definition.compactAnchor;
      const registeredAnchors = anchorsRef.current.get(anchorKey);
      anchor = preferredAnchor
        && registeredAnchors?.has(preferredAnchor)
        && isVisibleGuideAnchor(preferredAnchor)
        ? preferredAnchor
        : getVisibleGuideAnchor(registeredAnchors) ?? undefined;
      if (!anchor) return false;
    }

    const current = activeGuideRef.current;
    if (current?.id === id) return true;
    if (current) {
      const currentPriority = CONTEXTUAL_GUIDES[current.id].priority;
      if (source !== "replay" && definition.priority <= currentPriority) return false;
    }

    const nextGuide = { id, source, anchorKey, anchor } satisfies ActiveGuide;
    activeGuideRef.current = nextGuide;
    setActiveGuide(nextGuide);
    return true;
  }, [page, persistenceReady, persistentShell, role]);

  const registerBlocker = useCallback((key: string, blocked: boolean) => {
    const changed = blocked
      ? !blockersRef.current.has(key)
      : blockersRef.current.has(key);
    if (!changed) return;
    if (blocked) blockersRef.current.add(key);
    else blockersRef.current.delete(key);
    if (blocked && activeGuideRef.current) dismissActiveGuide();
    setReadinessVersion((current) => current + 1);
  }, [dismissActiveGuide]);

  const getReplayGuides = useCallback(() => getGuideIdsForPage(page)
    .map((id) => CONTEXTUAL_GUIDES[id])
    .filter((definition) => {
      if (definition.replayHidden) return false;
      if (!canUseGuide(definition, role) || !canUseGuideCapability(definition)) return false;
      if (definition.type === "page") return true;
      const anchorKey = persistentShell ? definition.persistentAnchor : definition.compactAnchor;
      return Boolean(getVisibleGuideAnchor(anchorsRef.current.get(anchorKey)));
    }), [page, persistentShell, readinessVersion, role]);

  const contextValue = useMemo<GuideContextValue>(() => ({
    role,
    persistentShell,
    activeGuideId: activeGuide?.id ?? null,
    readinessVersion: readinessVersion + (persistenceReady ? 1 : 0),
    registerAnchor,
    requestGuide,
    isGuideCompleted,
    completeGuide,
    dismissActiveGuide,
    registerBlocker,
    getReplayGuides
  }), [
    activeGuide?.id,
    completeGuide,
    dismissActiveGuide,
    getReplayGuides,
    persistenceReady,
    persistentShell,
    readinessVersion,
    registerAnchor,
    registerBlocker,
    isGuideCompleted,
    requestGuide,
    role
  ]);

  return (
    <ContextualGuideContext.Provider value={contextValue}>
      {children}
      {activeGuide && typeof document !== "undefined" ? createPortal(
        <ContextualGuideCoach
          key={activeGuide.id}
          activeGuide={activeGuide}
          persistent={persistentShell}
          role={role}
          onDismiss={() => MAIN_INTRO_GUIDE_ID_SET.has(activeGuide.id)
            ? completeGuide(activeGuide.id)
            : dismissActiveGuide()}
          onComplete={() => completeGuide(activeGuide.id)}
        />,
        document.body
      ) : null}
    </ContextualGuideContext.Provider>
  );
}

export function useContextualGuide() {
  const value = useContext(ContextualGuideContext);
  if (!value) throw new Error("useContextualGuide must be used inside ContextualGuideProvider.");
  return value;
}

export function useContextualGuideAnchor<T extends HTMLElement = HTMLElement>(
  key: ContextualGuideAnchorKey | null
): RefCallback<T> {
  const { registerAnchor } = useContextualGuide();
  const cleanupRef = useRef<(() => void) | null>(null);

  useEffect(() => () => cleanupRef.current?.(), []);

  return useCallback((element: T | null) => {
    cleanupRef.current?.();
    cleanupRef.current = element && key ? registerAnchor(key, element) : null;
  }, [key, registerAnchor]);
}

export function useAutoContextualGuide(id: ContextualGuideId, enabled = true, delayMs = 420) {
  const { readinessVersion, requestGuide } = useContextualGuide();
  const shownRef = useRef(false);

  useEffect(() => {
    if (!enabled || shownRef.current) return undefined;
    const timer = window.setTimeout(() => {
      if (requestGuide(id, "auto")) shownRef.current = true;
    }, delayMs);
    return () => window.clearTimeout(timer);
  }, [delayMs, enabled, id, readinessVersion, requestGuide]);
}

export function useContextualGuideBlocker(key: string, blocked: boolean) {
  const { registerBlocker } = useContextualGuide();
  useEffect(() => {
    registerBlocker(key, blocked);
    return () => registerBlocker(key, false);
  }, [blocked, key, registerBlocker]);
}

export function ContextualGuideHelpButton({
  onBeforeReplay,
  onReplayGuide
}: {
  onBeforeReplay?: () => void;
  onReplayGuide?: (id: ContextualGuideId) => boolean;
} = {}) {
  const { getReplayGuides, requestGuide, readinessVersion } = useContextualGuide();
  const [open, setOpen] = useState(false);
  const containerRef = useRef<HTMLDivElement | null>(null);
  const guides = useMemo(() => getReplayGuides(), [getReplayGuides, readinessVersion]);

  useEffect(() => {
    if (!open) return undefined;
    const closeOnOutsidePointer = (event: PointerEvent) => {
      if (!containerRef.current?.contains(event.target as Node)) setOpen(false);
    };
    const closeOnEscape = (event: KeyboardEvent) => {
      if (event.key === "Escape") setOpen(false);
    };
    document.addEventListener("pointerdown", closeOnOutsidePointer);
    window.addEventListener("keydown", closeOnEscape);
    return () => {
      document.removeEventListener("pointerdown", closeOnOutsidePointer);
      window.removeEventListener("keydown", closeOnEscape);
    };
  }, [open]);

  if (guides.length === 0) return null;

  return (
    <div ref={containerRef} className="contextual-guide-help no-print">
      <button
        type="button"
        className="contextual-guide-help__trigger"
        aria-label="도움말"
        title="도움말"
        aria-haspopup="menu"
        aria-expanded={open}
        onClick={() => setOpen((current) => !current)}
      >
        <HelpCircle aria-hidden />
        <span className="sr-only">도움말</span>
      </button>
      {open ? (
        <div role="menu" aria-label="현재 페이지 도움말" className="contextual-guide-help__menu">
          {guides.map((guide) => (
            <button
              key={guide.id}
              type="button"
              role="menuitem"
              onClick={() => {
                setOpen(false);
                onBeforeReplay?.();
                if (onReplayGuide?.(guide.id)) return;
                window.setTimeout(() => requestGuide(guide.id, "replay"), onBeforeReplay ? 220 : 0);
              }}
            >
              {guide.replayLabel}
            </button>
          ))}
        </div>
      ) : null}
    </div>
  );
}

function ContextualGuideCoach({
  activeGuide,
  persistent,
  role,
  onDismiss,
  onComplete
}: {
  activeGuide: ActiveGuide;
  persistent: boolean;
  role: SharedProjectRole | null;
  onDismiss: () => void;
  onComplete: () => void;
}) {
  const definition = CONTEXTUAL_GUIDES[activeGuide.id];
  const coachRef = useRef<HTMLElement | null>(null);
  const [position, setPosition] = useState<GuidePosition | null>(null);
  const [closing, setClosing] = useState(false);
  const closeTimerRef = useRef<number | null>(null);
  const closingRef = useRef(false);
  const titleId = `contextual-guide-title-${activeGuide.id.replaceAll(".", "-")}`;
  const descriptionId = `contextual-guide-description-${activeGuide.id.replaceAll(".", "-")}`;
  const description = !persistent && definition.compactDescription
    ? definition.compactDescription
    : role === "progress" && definition.readOnlyDescription
      ? definition.readOnlyDescription
      : definition.description;

  const requestExit = useCallback((callback: () => void) => {
    if (closingRef.current) return;
    closingRef.current = true;
    setClosing(true);
    closeTimerRef.current = window.setTimeout(callback, 130);
  }, []);

  const requestComplete = useCallback(() => requestExit(onComplete), [onComplete, requestExit]);
  const requestDismiss = useCallback(() => requestExit(onDismiss), [onDismiss, requestExit]);

  useEffect(() => () => {
    if (closeTimerRef.current !== null) window.clearTimeout(closeTimerRef.current);
  }, []);

  useLayoutEffect(() => {
    let frame = 0;
    const updatePosition = () => {
      window.cancelAnimationFrame(frame);
      frame = window.requestAnimationFrame(() => {
        const coach = coachRef.current;
        if (!coach) return;
        let nextPosition: GuidePosition;
        if (definition.type === "page") {
          nextPosition = calculatePageGuidePosition(coach);
        } else {
          const anchor = activeGuide.anchor;
          if (!anchor || !isVisibleGuideAnchor(anchor)) {
            onDismiss();
            return;
          }
          nextPosition = calculateAnchorGuidePosition(
            anchor,
            coach,
            definition.preferredPlacement ?? "auto"
          );
        }
        setPosition((current) => isSameGuidePosition(current, nextPosition) ? current : nextPosition);
      });
    };
    updatePosition();
    const resizeObserver = typeof ResizeObserver === "undefined"
      ? null
      : new ResizeObserver(updatePosition);
    if (coachRef.current) resizeObserver?.observe(coachRef.current);
    if (activeGuide.anchor) resizeObserver?.observe(activeGuide.anchor);
    const content = document.getElementById("project-main-content");
    if (definition.type === "page" && content) resizeObserver?.observe(content);
    window.addEventListener("resize", updatePosition);
    window.addEventListener("scroll", updatePosition, true);
    window.visualViewport?.addEventListener("resize", updatePosition);
    window.visualViewport?.addEventListener("scroll", updatePosition);
    return () => {
      window.cancelAnimationFrame(frame);
      resizeObserver?.disconnect();
      window.removeEventListener("resize", updatePosition);
      window.removeEventListener("scroll", updatePosition, true);
      window.visualViewport?.removeEventListener("resize", updatePosition);
      window.visualViewport?.removeEventListener("scroll", updatePosition);
    };
  }, [activeGuide.anchor, definition.preferredPlacement, definition.type, onDismiss]);

  useEffect(() => {
    const anchor = activeGuide.anchor;
    if (definition.type !== "anchor" || !anchor) return undefined;
    const previousDescription = anchor.getAttribute("aria-describedby");
    const descriptionIds = new Set(previousDescription?.split(/\s+/u).filter(Boolean) ?? []);
    descriptionIds.add(descriptionId);
    anchor.setAttribute("aria-describedby", Array.from(descriptionIds).join(" "));
    anchor.setAttribute("data-contextual-guide-active-anchor", "true");
    return () => {
      anchor.removeAttribute("data-contextual-guide-active-anchor");
      if (previousDescription) anchor.setAttribute("aria-describedby", previousDescription);
      else anchor.removeAttribute("aria-describedby");
    };
  }, [activeGuide.anchor, definition.type, descriptionId]);

  useEffect(() => {
    const closeOnEscape = (event: KeyboardEvent) => {
      if (event.key === "Escape") requestDismiss();
    };
    window.addEventListener("keydown", closeOnEscape);
    return () => window.removeEventListener("keydown", closeOnEscape);
  }, [requestDismiss]);

  const presentation = position?.presentation ?? definition.type;
  const style = position && presentation !== "bottom-coach" ? {
    left: `${position.left}px`,
    top: `${position.top}px`,
    "--contextual-guide-caret-offset": position.caretOffset === undefined
      ? undefined
      : `${position.caretOffset}px`
  } as CSSProperties : undefined;

  return (
    <aside
      ref={coachRef}
      data-contextual-guide
      data-closing={closing ? "true" : "false"}
      data-positioned={position ? "true" : "false"}
      data-presentation={presentation}
      data-side={position?.side}
      role="dialog"
      aria-modal="false"
      aria-labelledby={titleId}
      aria-describedby={descriptionId}
      className="contextual-guide-coach no-print"
      style={style}
    >
      {definition.type === "anchor" && presentation === "anchor" ? (
        <span className="contextual-guide-coach__caret" aria-hidden />
      ) : null}
      <header className="contextual-guide-coach__header">
        <h2 id={titleId}>{definition.title}</h2>
        <button
          type="button"
          className="contextual-guide-coach__close"
          aria-label="가이드 닫기"
          onClick={requestComplete}
        >
          <X aria-hidden />
        </button>
      </header>
      <div className="contextual-guide-coach__body">
        <p id={descriptionId}>{description}</p>
      </div>
      <footer className="contextual-guide-coach__footer">
        <button type="button" className="contextual-guide-coach__ack" onClick={requestComplete}>
          <Check aria-hidden />
          확인
        </button>
      </footer>
    </aside>
  );
}

type GuideSide = "left" | "right" | "top" | "bottom";
type GuidePosition = {
  presentation: "page" | "anchor" | "bottom-coach";
  left?: number;
  top?: number;
  side?: GuideSide;
  caretOffset?: number;
};

type ViewportBounds = {
  left: number;
  top: number;
  right: number;
  bottom: number;
  width: number;
  height: number;
};

function calculatePageGuidePosition(coach: HTMLElement): GuidePosition {
  const viewport = getVisualViewportBounds();
  const contentRect = document.getElementById("project-main-content")?.getBoundingClientRect();
  const contentBounds = contentRect
    ? intersectBounds(viewport, {
        left: contentRect.left,
        top: contentRect.top,
        right: contentRect.right,
        bottom: contentRect.bottom,
        width: contentRect.width,
        height: contentRect.height
      })
    : viewport;
  const bounds = contentBounds.width > 0 && contentBounds.height > 0 ? contentBounds : viewport;
  const coachRect = coach.getBoundingClientRect();
  const edge = 12;
  const left = bounds.left + (bounds.width - coachRect.width) / 2;
  const top = bounds.top + Math.max(0, bounds.height - coachRect.height) * 0.42;
  return {
    presentation: "page",
    left: clamp(left, bounds.left + edge, bounds.right - coachRect.width - edge),
    top: clamp(top, bounds.top + edge, bounds.bottom - coachRect.height - edge)
  };
}

function calculateAnchorGuidePosition(
  anchor: HTMLElement,
  coach: HTMLElement,
  preferredPlacement: ContextualGuidePlacement
): GuidePosition {
  const rect = anchor.getBoundingClientRect();
  const viewport = getVisualViewportBounds();
  const coachRect = coach.getBoundingClientRect();
  const placementRect = getAnchorPlacementRect(anchor, rect);
  const width = coachRect.width;
  const height = coachRect.height;
  const gap = 10;
  const edge = 12;
  const sides = orderGuideSides(anchor, rect, viewport, preferredPlacement);
  const candidates = sides.map((side) => makeAnchorCandidate(side, placementRect, width, height, gap));
  const fitted = candidates.find((candidate) => isCandidateInside(candidate, width, height, viewport, edge));

  if (!fitted && viewport.width <= 480) {
    return { presentation: "bottom-coach" };
  }

  const roomBySide: Record<GuideSide, number> = {
    right: viewport.right - placementRect.right,
    left: placementRect.left - viewport.left,
    bottom: viewport.bottom - placementRect.bottom,
    top: placementRect.top - viewport.top
  };
  const selected = fitted ?? makeAnchorCandidate(
    sides.reduce((best, side) => roomBySide[side] > roomBySide[best] ? side : best, sides[0]),
    placementRect,
    width,
    height,
    gap
  );
  const left = clamp(selected.left, viewport.left + edge, viewport.right - width - edge);
  const top = clamp(selected.top, viewport.top + edge, viewport.bottom - height - edge);
  const caretOffset = selected.side === "left" || selected.side === "right"
    ? clamp(rect.top + rect.height / 2 - top, 18, height - 18)
    : clamp(rect.left + rect.width / 2 - left, 18, width - 18);

  return {
    presentation: "anchor",
    side: selected.side,
    left,
    top,
    caretOffset
  };
}

function orderGuideSides(
  anchor: HTMLElement,
  rect: DOMRect,
  viewport: ViewportBounds,
  preferredPlacement: ContextualGuidePlacement
): GuideSide[] {
  let first: GuideSide;
  if (preferredPlacement !== "auto") {
    first = preferredPlacement;
  } else if (anchor.closest(".project-shell__navigation")) {
    first = "right";
  } else if (anchor.closest(".project-shell__action-panel")) {
    first = "left";
  } else if (anchor.closest(".project-shell__app-bar") || rect.top < viewport.top + viewport.height * 0.25) {
    first = "bottom";
  } else if (rect.bottom > viewport.top + viewport.height * 0.75) {
    first = "top";
  } else if (rect.left + rect.width / 2 > viewport.left + viewport.width * 0.68) {
    first = "left";
  } else {
    first = "right";
  }
  const opposite: Record<GuideSide, GuideSide> = {
    right: "left",
    left: "right",
    bottom: "top",
    top: "bottom"
  };
  const perpendicular: Record<GuideSide, GuideSide[]> = {
    right: ["bottom", "top"],
    left: ["bottom", "top"],
    bottom: ["right", "left"],
    top: ["right", "left"]
  };
  return [first, opposite[first], ...perpendicular[first]];
}

function makeAnchorCandidate(
  side: GuideSide,
  rect: Pick<DOMRect, "left" | "right" | "top" | "bottom" | "width" | "height">,
  width: number,
  height: number,
  gap: number
) {
  if (side === "left") {
    return { side, left: rect.left - width - gap, top: rect.top + rect.height / 2 - height / 2 };
  }
  if (side === "bottom") {
    return { side, left: rect.left + rect.width / 2 - width / 2, top: rect.bottom + gap };
  }
  if (side === "top") {
    return { side, left: rect.left + rect.width / 2 - width / 2, top: rect.top - height - gap };
  }
  return { side, left: rect.right + gap, top: rect.top + rect.height / 2 - height / 2 };
}

function getAnchorPlacementRect(anchor: HTMLElement, rect: DOMRect) {
  const navigationRect = anchor.closest(".project-shell__navigation")?.getBoundingClientRect();
  if (navigationRect) {
    return {
      left: rect.left,
      right: navigationRect.right,
      top: rect.top,
      bottom: rect.bottom,
      width: navigationRect.right - rect.left,
      height: rect.height
    };
  }
  const actionPanelRect = anchor.closest(".project-shell__action-panel")?.getBoundingClientRect();
  if (actionPanelRect) {
    return {
      left: actionPanelRect.left,
      right: rect.right,
      top: rect.top,
      bottom: rect.bottom,
      width: rect.right - actionPanelRect.left,
      height: rect.height
    };
  }
  const appBarRect = anchor.closest(".project-shell__app-bar")?.getBoundingClientRect();
  if (appBarRect) {
    return {
      left: rect.left,
      right: rect.right,
      top: appBarRect.top,
      bottom: appBarRect.bottom,
      width: rect.width,
      height: appBarRect.height
    };
  }
  return rect;
}

function isCandidateInside(
  candidate: { left: number; top: number },
  width: number,
  height: number,
  viewport: ViewportBounds,
  edge: number
) {
  return candidate.left >= viewport.left + edge
    && candidate.top >= viewport.top + edge
    && candidate.left + width <= viewport.right - edge
    && candidate.top + height <= viewport.bottom - edge;
}

function getVisualViewportBounds(): ViewportBounds {
  const visualViewport = window.visualViewport;
  const left = visualViewport?.offsetLeft ?? 0;
  const top = visualViewport?.offsetTop ?? 0;
  const width = visualViewport?.width ?? window.innerWidth;
  const height = visualViewport?.height ?? window.innerHeight;
  return { left, top, width, height, right: left + width, bottom: top + height };
}

function intersectBounds(a: ViewportBounds, b: ViewportBounds): ViewportBounds {
  const left = Math.max(a.left, b.left);
  const top = Math.max(a.top, b.top);
  const right = Math.min(a.right, b.right);
  const bottom = Math.min(a.bottom, b.bottom);
  return {
    left,
    top,
    right,
    bottom,
    width: Math.max(0, right - left),
    height: Math.max(0, bottom - top)
  };
}

function isSameGuidePosition(a: GuidePosition | null, b: GuidePosition) {
  return a?.presentation === b.presentation
    && a.left === b.left
    && a.top === b.top
    && a.side === b.side
    && a.caretOffset === b.caretOffset;
}

function getVisibleGuideAnchor(elements: Set<HTMLElement> | undefined) {
  if (!elements) return null;
  for (const element of elements) {
    if (isVisibleGuideAnchor(element)) return element;
  }
  return null;
}

function isVisibleGuideAnchor(element: HTMLElement) {
  if (!element.isConnected || element.closest('[inert], [aria-hidden="true"]')) return false;
  const rect = element.getBoundingClientRect();
  const style = window.getComputedStyle(element);
  if (rect.width <= 0 || rect.height <= 0 || style.display === "none" || style.visibility === "hidden") {
    return false;
  }
  const viewport = window.visualViewport;
  const left = viewport?.offsetLeft ?? 0;
  const top = viewport?.offsetTop ?? 0;
  const right = left + (viewport?.width ?? window.innerWidth);
  const bottom = top + (viewport?.height ?? window.innerHeight);
  return rect.right > left && rect.left < right && rect.bottom > top && rect.top < bottom;
}

function hasVisibleInteractiveOverlay() {
  const overlays = document.querySelectorAll<HTMLElement>(
    '[role="dialog"], [role="alertdialog"], [role="menu"], [data-memo-popover], [data-weather-region-popover], [data-shooting-order-popover]'
  );
  return Array.from(overlays).some((element) => {
    if (element.hasAttribute("data-contextual-guide") || element.closest(".contextual-guide-help")) return false;
    if (element.closest('[inert], [aria-hidden="true"]')) return false;
    const rect = element.getBoundingClientRect();
    const style = window.getComputedStyle(element);
    return rect.width > 0 && rect.height > 0 && style.display !== "none" && style.visibility !== "hidden";
  });
}

function canUseGuideCapability(definition: ContextualGuideDefinition) {
  if (!definition.capability) return true;
  if (typeof window === "undefined") return false;
  const hasFinePointer = window.matchMedia("(hover: hover) and (pointer: fine)").matches;
  return definition.capability === "fine-pointer" ? hasFinePointer : !hasFinePointer;
}

function readCompletedGuideTokens(storageKey: string) {
  try {
    const value = JSON.parse(window.localStorage.getItem(storageKey) ?? "[]") as unknown;
    return new Set(Array.isArray(value) ? value.filter((item): item is string => typeof item === "string") : []);
  } catch {
    return new Set<string>();
  }
}

async function resolveGuideUserNamespace(accessPreferenceScope: string) {
  const resolvedOwnerId = await resolveDismissedProjectOwnerId(accessPreferenceScope);
  if (resolvedOwnerId) return resolvedOwnerId;
  try {
    const existing = window.localStorage.getItem(GUIDE_ANONYMOUS_KEY)?.trim();
    if (existing) return `anonymous:${existing}`;
    const next = typeof crypto.randomUUID === "function"
      ? crypto.randomUUID()
      : `${Date.now().toString(36)}-${Math.random().toString(36).slice(2)}`;
    window.localStorage.setItem(GUIDE_ANONYMOUS_KEY, next);
    return `anonymous:${next}`;
  } catch {
    return "anonymous:memory";
  }
}

function clamp(value: number, min: number, max: number) {
  return Math.min(Math.max(value, min), Math.max(min, max));
}
