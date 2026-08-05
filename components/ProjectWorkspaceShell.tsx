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
    const closeDrawerWhenItBecomesPersistent = () => {
      setOpenDrawer((current) => {
        if (current === "navigation" && window.matchMedia("(min-width: 900px)").matches) return null;
        if (current === "actions" && window.matchMedia("(min-width: 1360px)").matches) return null;
        return current;
      });
    };
    closeDrawerWhenItBecomesPersistent();
    window.addEventListener("resize", closeDrawerWhenItBecomesPersistent);
    return () => window.removeEventListener("resize", closeDrawerWhenItBecomesPersistent);
  }, []);

  const pageTitle = getProjectPageTitle(pathname, searchParams);
  const hasActions = Boolean(menu);

  return (
    <div
      className={`project-shell ${hasActions ? "project-shell--has-actions" : ""}`}
      data-project-shell
      data-project-shell-actions={hasActions ? "true" : "false"}
    >
      <aside className="project-shell__navigation no-print" aria-label="프로젝트 전체 메뉴" inert={openDrawer !== null}>
        <ProjectNavigation />
      </aside>

      <header className="project-shell__app-bar no-print" inert={openDrawer !== null}>
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
        <div className="min-w-0 text-center">
          <p className="truncate text-[11px] font-semibold text-field-muted">{projectName}</p>
          <h1 className="truncate text-sm font-black text-field-text">{pageTitle}</h1>
        </div>
        {hasActions ? (
          <button
            ref={actionToggleRef}
            type="button"
            className="project-shell__bar-button"
            aria-label={openDrawer === "actions" ? "페이지 작업 닫기" : "페이지 작업 열기"}
            aria-controls="project-action-drawer"
            aria-expanded={openDrawer === "actions"}
            onClick={() => setOpenDrawer((current) => current === "actions" ? null : "actions")}
          >
            {openDrawer === "actions" ? <X aria-hidden /> : <PanelRight aria-hidden />}
          </button>
        ) : <span className="project-shell__bar-spacer" aria-hidden />}
      </header>

      <main ref={contentRef} className="project-shell__content" id="project-main-content" inert={openDrawer !== null}>
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

      {openDrawer === "navigation" ? (
        <div className="project-shell__drawer-layer no-print">
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
            aria-modal="true"
            aria-label="프로젝트 전체 메뉴"
            tabIndex={-1}
            className="project-shell__navigation-drawer"
          >
            <div className="flex min-h-14 items-center justify-between border-b border-field-divider px-3">
              <p className="min-w-0 truncate text-sm font-black text-field-text">프로젝트 메뉴</p>
              <button
                type="button"
                onClick={closeDrawer}
                aria-label="프로젝트 메뉴 닫기"
                className="project-shell__bar-button"
              >
                <X aria-hidden />
              </button>
            </div>
            <ProjectNavigation drawer onNavigate={() => setOpenDrawer(null)} />
          </aside>
        </div>
      ) : null}
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
      window.requestAnimationFrame(() => returnTarget?.focus());
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
    && element.getClientRects().length > 0
    && window.getComputedStyle(element).visibility !== "hidden"
  ));
}
