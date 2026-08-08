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
  type RefCallback
} from "react";
import { createPortal } from "react-dom";
import { Check, HelpCircle, X } from "lucide-react";
import { usePathname, useSearchParams } from "next/navigation";
import { usePersistentProjectShell } from "@/hooks/useProjectShellMode";
import {
  CONTEXTUAL_GUIDES,
  canUseGuide,
  getGuideIdsForPage,
  getGuidePage,
  getGuideStorageToken,
  type ContextualGuideAnchorKey,
  type ContextualGuideDefinition,
  type ContextualGuideId
} from "@/lib/contextualGuides";
import type { SharedProjectRole } from "@/lib/projectAccess/core";
import { resolveDismissedProjectOwnerId } from "@/lib/projectAccess/dismissedProjects";

type GuideRequestSource = "auto" | "feature" | "replay";

type ActiveGuide = {
  id: ContextualGuideId;
  source: GuideRequestSource;
  anchorKey: ContextualGuideAnchorKey;
  anchor: HTMLElement;
};

type GuideContextValue = {
  role: SharedProjectRole | null;
  persistentShell: boolean;
  readinessVersion: number;
  registerAnchor: (key: ContextualGuideAnchorKey, element: HTMLElement | null) => () => void;
  requestGuide: (
    id: ContextualGuideId,
    source?: GuideRequestSource,
    preferredAnchor?: HTMLElement | null
  ) => boolean;
  completeGuide: (id: ContextualGuideId) => void;
  dismissActiveGuide: () => void;
  registerBlocker: (key: string, blocked: boolean) => void;
  getReplayGuides: () => ContextualGuideDefinition[];
};

const ContextualGuideContext = createContext<GuideContextValue | null>(null);
const GUIDE_ANONYMOUS_KEY = "shotcl:guide-anonymous:v1";
const GUIDE_STORAGE_PREFIX = "shotcl:guides";

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

  useEffect(() => {
    const handlePointerDown = (event: PointerEvent) => {
      routeInteractionRef.current = true;
      const active = activeGuideRef.current;
      const target = event.target instanceof Node ? event.target : null;
      if (!active || !target) return;
      if (target instanceof Element && target.closest("[data-contextual-guide]")) return;
      if (active.anchor.contains(target)) completeGuide(active.id);
      else dismissActiveGuide();
    };
    const handleKeyDown = (event: KeyboardEvent) => {
      routeInteractionRef.current = true;
      const target = event.target instanceof Node ? event.target : null;
      const active = activeGuideRef.current;
      if (!active || (target instanceof Element && target.closest("[data-contextual-guide]"))) return;
      if (target && active.anchor.contains(target)) completeGuide(active.id);
      else dismissActiveGuide();
    };
    const handleScroll = (event: Event) => {
      routeInteractionRef.current = true;
      if (event.target instanceof Element && event.target.closest("[data-contextual-guide]")) return;
      if (activeGuideRef.current) dismissActiveGuide();
    };
    document.addEventListener("pointerdown", handlePointerDown, true);
    document.addEventListener("keydown", handleKeyDown, true);
    document.addEventListener("scroll", handleScroll, true);
    return () => {
      document.removeEventListener("pointerdown", handlePointerDown, true);
      document.removeEventListener("keydown", handleKeyDown, true);
      document.removeEventListener("scroll", handleScroll, true);
    };
  }, [completeGuide, dismissActiveGuide, routeKey]);

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

    const anchorKey = persistentShell ? definition.persistentAnchor : definition.compactAnchor;
    const registeredAnchors = anchorsRef.current.get(anchorKey);
    const anchor = preferredAnchor
      && registeredAnchors?.has(preferredAnchor)
      && isVisibleGuideAnchor(preferredAnchor)
      ? preferredAnchor
      : getVisibleGuideAnchor(registeredAnchors);
    if (!anchor) return false;

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
      if (!canUseGuide(definition, role) || !canUseGuideCapability(definition)) return false;
      const anchorKey = persistentShell ? definition.persistentAnchor : definition.compactAnchor;
      return Boolean(getRenderableGuideAnchor(anchorsRef.current.get(anchorKey)));
    }), [page, persistentShell, readinessVersion, role]);

  const contextValue = useMemo<GuideContextValue>(() => ({
    role,
    persistentShell,
    readinessVersion: readinessVersion + (persistenceReady ? 1 : 0),
    registerAnchor,
    requestGuide,
    completeGuide,
    dismissActiveGuide,
    registerBlocker,
    getReplayGuides
  }), [
    completeGuide,
    dismissActiveGuide,
    getReplayGuides,
    persistenceReady,
    persistentShell,
    readinessVersion,
    registerAnchor,
    registerBlocker,
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
  onBeforeReplay
}: {
  onBeforeReplay?: () => void;
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
        aria-label="현재 페이지 도움말"
        aria-haspopup="menu"
        aria-expanded={open}
        onClick={() => setOpen((current) => !current)}
      >
        <HelpCircle aria-hidden />
        <span>도움말</span>
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
  onComplete
}: {
  activeGuide: ActiveGuide;
  persistent: boolean;
  role: SharedProjectRole | null;
  onComplete: () => void;
}) {
  const definition = CONTEXTUAL_GUIDES[activeGuide.id];
  const [position, setPosition] = useState<GuidePosition | null>(null);
  const [closing, setClosing] = useState(false);
  const closeTimerRef = useRef<number | null>(null);
  const titleId = `contextual-guide-title-${activeGuide.id.replaceAll(".", "-")}`;
  const descriptionId = `contextual-guide-description-${activeGuide.id.replaceAll(".", "-")}`;
  const description = !persistent && definition.compactDescription
    ? definition.compactDescription
    : role === "progress" && definition.readOnlyDescription
      ? definition.readOnlyDescription
      : definition.description;

  const requestClose = useCallback(() => {
    if (closing) return;
    setClosing(true);
    closeTimerRef.current = window.setTimeout(onComplete, 130);
  }, [closing, onComplete]);

  useEffect(() => () => {
    if (closeTimerRef.current !== null) window.clearTimeout(closeTimerRef.current);
  }, []);

  useLayoutEffect(() => {
    if (!persistent) return undefined;
    let frame = 0;
    const updatePosition = () => {
      window.cancelAnimationFrame(frame);
      frame = window.requestAnimationFrame(() => {
        setPosition(calculateGuidePosition(activeGuide.anchor));
      });
    };
    updatePosition();
    window.addEventListener("resize", updatePosition);
    window.addEventListener("scroll", updatePosition, true);
    window.visualViewport?.addEventListener("resize", updatePosition);
    window.visualViewport?.addEventListener("scroll", updatePosition);
    return () => {
      window.cancelAnimationFrame(frame);
      window.removeEventListener("resize", updatePosition);
      window.removeEventListener("scroll", updatePosition, true);
      window.visualViewport?.removeEventListener("resize", updatePosition);
      window.visualViewport?.removeEventListener("scroll", updatePosition);
    };
  }, [activeGuide.anchor, persistent]);

  useEffect(() => {
    const closeOnEscape = (event: KeyboardEvent) => {
      if (event.key === "Escape") requestClose();
    };
    window.addEventListener("keydown", closeOnEscape);
    return () => window.removeEventListener("keydown", closeOnEscape);
  }, [requestClose]);

  return (
    <aside
      data-contextual-guide
      data-closing={closing ? "true" : "false"}
      data-presentation={persistent ? "popover" : "bottom-coach"}
      data-side={position?.side}
      role="dialog"
      aria-modal="false"
      aria-labelledby={titleId}
      aria-describedby={descriptionId}
      className="contextual-guide-coach no-print"
      style={persistent && position ? {
        left: `${position.left}px`,
        top: `${position.top}px`
      } : undefined}
    >
      <button
        type="button"
        className="contextual-guide-coach__close"
        aria-label="가이드 닫기"
        onClick={requestClose}
      >
        <X aria-hidden />
      </button>
      <div className="contextual-guide-coach__copy">
        <h2 id={titleId}>{definition.title}</h2>
        <p id={descriptionId}>{description}</p>
      </div>
      <button type="button" className="contextual-guide-coach__ack" onClick={requestClose}>
        <Check aria-hidden />
        알겠어요
      </button>
    </aside>
  );
}

type GuidePosition = { left: number; top: number; side: "left" | "right" | "top" | "bottom" };

function calculateGuidePosition(anchor: HTMLElement): GuidePosition {
  const rect = anchor.getBoundingClientRect();
  const viewport = window.visualViewport;
  const viewportLeft = viewport?.offsetLeft ?? 0;
  const viewportTop = viewport?.offsetTop ?? 0;
  const viewportWidth = viewport?.width ?? window.innerWidth;
  const viewportHeight = viewport?.height ?? window.innerHeight;
  const width = Math.min(288, viewportWidth - 24);
  const estimatedHeight = 164;
  const gap = 12;
  const edge = 12;

  const roomRight = viewportLeft + viewportWidth - rect.right;
  const roomLeft = rect.left - viewportLeft;
  const roomBottom = viewportTop + viewportHeight - rect.bottom;
  const roomTop = rect.top - viewportTop;
  let side: GuidePosition["side"] = "right";
  let left = rect.right + gap;
  let top = rect.top + rect.height / 2 - estimatedHeight / 2;

  if (roomRight < width + gap && roomLeft >= width + gap) {
    side = "left";
    left = rect.left - width - gap;
  } else if (roomRight < width + gap && roomLeft < width + gap && roomBottom >= estimatedHeight + gap) {
    side = "bottom";
    left = rect.left + rect.width / 2 - width / 2;
    top = rect.bottom + gap;
  } else if (roomRight < width + gap && roomLeft < width + gap && roomTop >= estimatedHeight + gap) {
    side = "top";
    left = rect.left + rect.width / 2 - width / 2;
    top = rect.top - estimatedHeight - gap;
  }

  return {
    side,
    left: clamp(left, viewportLeft + edge, viewportLeft + viewportWidth - width - edge),
    top: clamp(top, viewportTop + edge, viewportTop + viewportHeight - estimatedHeight - edge)
  };
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

function getRenderableGuideAnchor(elements: Set<HTMLElement> | undefined) {
  if (!elements) return null;
  for (const element of elements) {
    if (!element.isConnected) continue;
    const rect = element.getBoundingClientRect();
    const style = window.getComputedStyle(element);
    if (rect.width > 0 && rect.height > 0 && style.display !== "none" && style.visibility !== "hidden") {
      return element;
    }
  }
  return null;
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
