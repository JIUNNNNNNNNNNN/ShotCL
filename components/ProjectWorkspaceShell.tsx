"use client";

import { useCallback, useEffect, useLayoutEffect, useRef, useState } from "react";
import { Menu, PanelRight, TriangleAlert, X } from "lucide-react";
import { usePathname, useSearchParams } from "next/navigation";
import { HomeButton } from "@/components/HomeButton";
import { ProjectNavigation, getProjectPageTitle } from "@/components/ProjectNavigation";
import { useCurrentProjectPageActionMenu } from "@/components/ProjectPageActions";
import { RightProjectSidebar } from "@/components/RightProjectSidebar";
import { useProjectWorkspace } from "@/components/ProjectWorkspaceContext";
import { isDemoStorageMode } from "@/lib/runtimeMode";

type OpenDrawer = "navigation" | "actions" | null;
const PERSISTENT_PROJECT_SHELL_QUERY = "(min-width: 1440px) and (min-height: 700px)";

/** 프로젝트 내부만 좌측 navigation·중앙 page·우측 action으로 배치합니다. */
export function ProjectWorkspaceShell({ children }: { children: React.ReactNode }) {
  const pathname = usePathname();
  const searchParams = useSearchParams();
  const routeKey = `${pathname}?${searchParams.toString()}`;
  const menu = useCurrentProjectPageActionMenu();
  const { projectName } = useProjectWorkspace();
  const [openDrawer, setOpenDrawer] = useState<OpenDrawer>(null);
  const navigationToggleRef = useRef<HTMLButtonElement | null>(null);
  const actionToggleRef = useRef<HTMLButtonElement | null>(null);
  const navigationDrawerRef = useRef<HTMLElement | null>(null);
  const actionDrawerRef = useRef<HTMLElement | null>(null);
  const contentRef = useRef<HTMLElement | null>(null);
  const closeDrawer = useCallback(() => setOpenDrawer(null), []);

  useLayoutEffect(() => {
    setOpenDrawer(null);
  }, [menu?.key, menu?.scopeKey, routeKey]);

  useAccessibleProjectDrawer({
    openDrawer,
    onClose: closeDrawer,
    navigationDrawerRef,
    actionDrawerRef,
    contentRef,
    navigationToggleRef,
    actionToggleRef
  });

  useEffect(() => {
    const persistentShellQuery = window.matchMedia(PERSISTENT_PROJECT_SHELL_QUERY);
    const closeMobileDrawerWhenShellBecomesPersistent = () => {
      setOpenDrawer((current) => {
        if (current && persistentShellQuery.matches) return null;
        return current;
      });
    };
    closeMobileDrawerWhenShellBecomesPersistent();
    persistentShellQuery.addEventListener("change", closeMobileDrawerWhenShellBecomesPersistent);
    return () => persistentShellQuery.removeEventListener("change", closeMobileDrawerWhenShellBecomesPersistent);
  }, []);

  const pageTitle = getProjectPageTitle(pathname, searchParams);
  const hasActions = Boolean(menu);
  const modalDrawerOpen = openDrawer !== null;

  return (
    <div
      className={`project-shell ${hasActions ? "project-shell--has-actions" : ""}`}
      data-project-shell
      data-project-shell-actions={hasActions ? "true" : "false"}
    >
      <aside className="project-shell__navigation no-print" aria-label="프로젝트 전체 메뉴" inert={modalDrawerOpen}>
        <ProjectNavigation />
      </aside>

      <header className="project-shell__app-bar no-print" inert={modalDrawerOpen}>
        <div className="project-shell__mobile-home">
          <HomeButton embedded />
        </div>
        <button
          ref={navigationToggleRef}
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
        {hasActions ? (
          <button
            ref={actionToggleRef}
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
      </header>

      <main ref={contentRef} className="project-shell__content" id="project-main-content" inert={modalDrawerOpen}>
        {isDemoStorageMode() ? <ProjectTestModeWarning /> : null}
        <div className="project-shell__page">{children}</div>
      </main>

      <RightProjectSidebar
        projectName={projectName}
        menu={menu}
        drawerOpen={openDrawer === "actions"}
        onDrawerClose={closeDrawer}
        drawerRef={actionDrawerRef}
      />

      <div
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
            <ProjectNavigation drawer onNavigate={() => setOpenDrawer(null)} />
          </aside>
      </div>
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
  openDrawer,
  onClose,
  navigationDrawerRef,
  actionDrawerRef,
  contentRef,
  navigationToggleRef,
  actionToggleRef
}: {
  openDrawer: OpenDrawer;
  onClose: () => void;
  navigationDrawerRef: React.RefObject<HTMLElement | null>;
  actionDrawerRef: React.RefObject<HTMLElement | null>;
  contentRef: React.RefObject<HTMLElement | null>;
  navigationToggleRef: React.RefObject<HTMLButtonElement | null>;
  actionToggleRef: React.RefObject<HTMLButtonElement | null>;
}) {
  useEffect(() => {
    if (!openDrawer) return undefined;
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
        if (window.matchMedia(PERSISTENT_PROJECT_SHELL_QUERY).matches) {
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
