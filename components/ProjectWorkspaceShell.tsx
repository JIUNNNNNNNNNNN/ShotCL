"use client";

import { useCallback, useEffect, useLayoutEffect, useRef, useState } from "react";
import { Menu, PanelRight, TriangleAlert, X } from "lucide-react";
import { usePathname, useSearchParams } from "next/navigation";
import { HomeButton } from "@/components/HomeButton";
import { useProjectAccess } from "@/components/ProjectAccessGate";
import { ProjectNavigation, getProjectPageTitle } from "@/components/ProjectNavigation";
import { useCurrentProjectPageActionMenu } from "@/components/ProjectPageActions";
import { RightProjectSidebar } from "@/components/RightProjectSidebar";
import { useProjectWorkspace } from "@/components/ProjectWorkspaceContext";
import {
  useContextualGuideAnchor,
  useContextualGuideBlocker
} from "@/components/guides/ContextualGuideProvider";
import {
  isPersistentProjectShellViewport,
  usePersistentProjectShell
} from "@/hooks/useProjectShellMode";
import {
  consumePendingProjectJoinNotice,
  type ProjectJoinNotice
} from "@/lib/projectAccess/joinNotice.client";
import { isDemoStorageMode } from "@/lib/runtimeMode";

type OpenDrawer = "navigation" | "actions" | null;

/** 프로젝트 내부만 좌측 navigation·중앙 page·우측 action으로 배치합니다. */
export function ProjectWorkspaceShell({ children }: { children: React.ReactNode }) {
  const pathname = usePathname();
  const searchParams = useSearchParams();
  const routeKey = `${pathname}?${searchParams.toString()}`;
  const menu = useCurrentProjectPageActionMenu();
  const { isGuest } = useProjectAccess();
  const { projectId, projectName } = useProjectWorkspace();
  const persistentShell = usePersistentProjectShell();
  const [openDrawer, setOpenDrawer] = useState<OpenDrawer>(null);
  const [joinNotice, setJoinNotice] = useState<ProjectJoinNotice | null>(null);
  const previousPersistentShellRef = useRef(persistentShell);
  const navigationToggleRef = useRef<HTMLButtonElement | null>(null);
  const actionToggleRef = useRef<HTMLButtonElement | null>(null);
  const navigationDrawerRef = useRef<HTMLElement | null>(null);
  const actionDrawerRef = useRef<HTMLElement | null>(null);
  const contentRef = useRef<HTMLElement | null>(null);
  const closeDrawer = useCallback(() => setOpenDrawer(null), []);
  const navigationGuideAnchor = useContextualGuideAnchor<HTMLButtonElement>("shell.navigation-toggle");
  const actionGuideAnchor = useContextualGuideAnchor<HTMLButtonElement>("shell.action-toggle");
  const setNavigationToggleRef = useCallback((element: HTMLButtonElement | null) => {
    navigationToggleRef.current = element;
    navigationGuideAnchor(element);
  }, [navigationGuideAnchor]);
  const setActionToggleRef = useCallback((element: HTMLButtonElement | null) => {
    actionToggleRef.current = element;
    actionGuideAnchor(element);
  }, [actionGuideAnchor]);

  useLayoutEffect(() => {
    setOpenDrawer(null);
  }, [menu?.key, menu?.scopeKey, routeKey]);

  useAccessibleProjectDrawer({
    enabled: !persistentShell,
    openDrawer,
    onClose: closeDrawer,
    navigationDrawerRef,
    actionDrawerRef,
    contentRef,
    navigationToggleRef,
    actionToggleRef
  });

  useLayoutEffect(() => {
    if (persistentShell) setOpenDrawer(null);
  }, [persistentShell]);

  useLayoutEffect(() => {
    const wasPersistent = previousPersistentShellRef.current;
    previousPersistentShellRef.current = persistentShell;
    if (wasPersistent && !persistentShell && joinNotice) {
      setOpenDrawer("navigation");
    }
  }, [joinNotice, persistentShell]);

  useEffect(() => {
    const notice = consumePendingProjectJoinNotice(projectId);
    if (!notice) return;
    setJoinNotice(notice);
    if (!persistentShell) setOpenDrawer("navigation");
  }, [persistentShell, projectId]);

  useEffect(() => {
    if (!joinNotice) return undefined;
    const timerId = window.setTimeout(() => setJoinNotice(null), 15_000);
    return () => window.clearTimeout(timerId);
  }, [joinNotice]);

  const pageTitle = getProjectPageTitle(pathname, searchParams);
  const hasRightPanel = !isGuest && Boolean(menu?.actions.length);
  const modalDrawerOpen = !persistentShell && openDrawer !== null;
  useContextualGuideBlocker("project-shell-drawer", modalDrawerOpen);

  return (
    <div
      className={`project-shell ${hasRightPanel ? "project-shell--has-actions" : ""}`}
      data-project-shell
      data-project-shell-actions={hasRightPanel ? "true" : "false"}
      data-project-shell-mode={persistentShell ? "persistent" : "drawer"}
    >
      {persistentShell ? (
        <aside className="project-shell__navigation no-print" aria-label="프로젝트 전체 메뉴">
          <ProjectNavigation
            joinNotice={joinNotice}
            onDismissJoinNotice={() => setJoinNotice(null)}
          />
        </aside>
      ) : null}

      {!persistentShell ? <header className="project-shell__app-bar no-print" inert={modalDrawerOpen}>
        <div className="project-shell__mobile-home">
          {!isGuest ? <HomeButton embedded /> : <span aria-hidden />}
        </div>
        <button
          ref={setNavigationToggleRef}
          type="button"
          className="project-shell__bar-button project-shell__navigation-toggle"
          aria-label={openDrawer === "navigation" ? "프로젝트 메뉴 닫기" : "프로젝트 메뉴 열기"}
          aria-controls="project-navigation-drawer"
          aria-expanded={openDrawer === "navigation"}
          onClick={() => setOpenDrawer((current) => current === "navigation" ? null : "navigation")}
        >
          {openDrawer === "navigation" ? <X aria-hidden /> : <Menu aria-hidden />}
        </button>
        <div className="min-w-0 text-center leading-tight">
          <p className="break-words text-[11px] font-semibold text-field-muted [overflow-wrap:anywhere]">{projectName}</p>
          <h1 className="break-words text-sm font-black text-field-text [overflow-wrap:anywhere]">{pageTitle}</h1>
        </div>
        {hasRightPanel ? (
          <button
            ref={setActionToggleRef}
            type="button"
            className="project-shell__bar-button project-shell__action-toggle"
            aria-label={openDrawer === "actions" ? "페이지 작업 닫기" : "페이지 작업 열기"}
            aria-controls="project-action-drawer"
            aria-expanded={openDrawer === "actions"}
            onClick={() => setOpenDrawer((current) => current === "actions" ? null : "actions")}
          >
            {openDrawer === "actions" ? <X aria-hidden /> : <PanelRight aria-hidden />}
          </button>
        ) : <span className="project-shell__bar-spacer" aria-hidden />}
      </header> : null}

      <main ref={contentRef} className="project-shell__content" id="project-main-content" inert={modalDrawerOpen}>
        {isDemoStorageMode() && !isGuest ? <ProjectTestModeWarning /> : null}
        <div className="project-shell__page">{children}</div>
      </main>

      {hasRightPanel ? (
        <RightProjectSidebar
          mode={persistentShell ? "panel" : "drawer"}
          projectName={projectName}
          menu={menu}
          drawerOpen={!persistentShell && openDrawer === "actions"}
          onDrawerClose={closeDrawer}
          drawerRef={actionDrawerRef}
        />
      ) : null}

      {!persistentShell ? <div
        className="project-shell__drawer-layer no-print"
        data-open={openDrawer === "navigation" ? "true" : "false"}
        aria-hidden={openDrawer !== "navigation"}
        inert={openDrawer !== "navigation"}
      >
          <button
            type="button"
            className="project-shell__drawer-backdrop"
            aria-label="프로젝트 메뉴 닫기"
            onClick={() => setOpenDrawer(null)}
          />
          <aside
            ref={navigationDrawerRef}
            id="project-navigation-drawer"
            role="dialog"
            aria-modal={openDrawer === "navigation" ? "true" : undefined}
            aria-labelledby="project-navigation-drawer-title"
            tabIndex={-1}
            data-side="left"
            data-open={openDrawer === "navigation" ? "true" : "false"}
            className="project-shell__navigation-drawer ui-drawer"
          >
            <div className="project-shell__navigation-drawer-header">
              <p id="project-navigation-drawer-title" className="project-shell__navigation-drawer-title">
                프로젝트 메뉴
              </p>
              <button
                type="button"
                onClick={closeDrawer}
                aria-label="프로젝트 메뉴 닫기"
                className="project-shell__bar-button project-shell__navigation-drawer-close"
              >
                <X aria-hidden />
              </button>
            </div>
            <ProjectNavigation
              drawer
              joinNotice={joinNotice}
              onDismissJoinNotice={() => setJoinNotice(null)}
              onNavigate={() => setOpenDrawer(null)}
              onGuideReplay={closeDrawer}
            />
          </aside>
      </div> : null}
    </div>
  );
}

function ProjectTestModeWarning() {
  return (
    <aside role="alert" className="no-print mb-3 border border-status-warning/60 bg-status-warning/10 px-3 py-2.5 text-field-text">
      <details>
        <summary className="flex cursor-pointer list-none items-center gap-2 text-sm font-black marker:content-none">
          <TriangleAlert className="h-4 w-4 shrink-0" aria-hidden />
          테스트 모드 · 이 브라우저에만 저장됩니다.
          <span className="ml-auto text-xs text-field-subtle">안내 보기</span>
        </summary>
        <p className="mt-2 pl-6 text-xs leading-5 text-field-muted">
          Supabase Auth/RLS가 연결되지 않아 프로젝트는 다른 사람과 공유되지 않습니다. 실제 작품 정보, 배우 연락처, 촬영 장소, 콘티 파일을 입력하지 마세요.
        </p>
      </details>
    </aside>
  );
}

function useAccessibleProjectDrawer({
  enabled,
  openDrawer,
  onClose,
  navigationDrawerRef,
  actionDrawerRef,
  contentRef,
  navigationToggleRef,
  actionToggleRef
}: {
  enabled: boolean;
  openDrawer: OpenDrawer;
  onClose: () => void;
  navigationDrawerRef: React.RefObject<HTMLElement | null>;
  actionDrawerRef: React.RefObject<HTMLElement | null>;
  contentRef: React.RefObject<HTMLElement | null>;
  navigationToggleRef: React.RefObject<HTMLButtonElement | null>;
  actionToggleRef: React.RefObject<HTMLButtonElement | null>;
}) {
  useEffect(() => {
    if (!enabled || !openDrawer) return undefined;
    const drawer = openDrawer === "navigation" ? navigationDrawerRef.current : actionDrawerRef.current;
    const returnTarget = openDrawer === "navigation" ? navigationToggleRef.current : actionToggleRef.current;
    if (!drawer) return undefined;

    const previousOverflow = document.body.style.overflow;
    const content = contentRef.current;
    const previousContentOverflow = content?.style.overflowY ?? "";
    document.body.style.overflow = "hidden";
    if (content) content.style.overflowY = "hidden";
    const focusable = getFocusableElements(drawer);
    (focusable[0] ?? drawer).focus();

    function handleKeyDown(event: KeyboardEvent) {
      const activeElement = document.activeElement;
      if (
        activeElement instanceof HTMLElement
        && activeElement.closest("[data-project-shell-portal]")
      ) {
        return;
      }
      if (event.key === "Escape") {
        event.preventDefault();
        onClose();
        return;
      }
      if (event.key !== "Tab") return;
      const items = getFocusableElements(drawer!);
      if (items.length === 0) {
        event.preventDefault();
        drawer!.focus();
        return;
      }
      const first = items[0];
      const last = items[items.length - 1];
      if (!drawer!.contains(document.activeElement)) {
        event.preventDefault();
        (event.shiftKey ? last : first).focus();
        return;
      }
      if (event.shiftKey && document.activeElement === first) {
        event.preventDefault();
        last.focus();
      } else if (!event.shiftKey && document.activeElement === last) {
        event.preventDefault();
        first.focus();
      }
    }

    window.addEventListener("keydown", handleKeyDown);
    return () => {
      window.removeEventListener("keydown", handleKeyDown);
      document.body.style.overflow = previousOverflow;
      if (content) content.style.overflowY = previousContentOverflow;
      window.requestAnimationFrame(() => {
        if (isPersistentProjectShellViewport()) {
          const persistentTarget = openDrawer === "navigation"
            ? document.querySelector<HTMLElement>(
              '.project-shell__navigation [aria-current="page"], .project-shell__navigation a[href], .project-shell__navigation button'
            )
            : document.querySelector<HTMLElement>(
              '.project-shell__action-panel a[href], .project-shell__action-panel button:not([disabled])'
            );
          persistentTarget?.focus();
          return;
        }
        returnTarget?.focus();
      });
    };
  }, [
    actionDrawerRef,
    actionToggleRef,
    contentRef,
    enabled,
    navigationDrawerRef,
    navigationToggleRef,
    onClose,
    openDrawer
  ]);
}

function getFocusableElements(root: HTMLElement) {
  return Array.from(root.querySelectorAll<HTMLElement>(
    'a[href], button:not([disabled]), input:not([disabled]), select:not([disabled]), textarea:not([disabled]), [tabindex]:not([tabindex="-1"])'
  )).filter((element) => (
    !element.hasAttribute("aria-hidden")
    && !element.closest('[inert], [aria-hidden="true"]')
    && element.getClientRects().length > 0
    && window.getComputedStyle(element).visibility !== "hidden"
  ));
}
