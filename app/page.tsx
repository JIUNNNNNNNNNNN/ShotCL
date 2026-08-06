"use client";

import { FormEvent, useEffect, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { InlineLoader } from "@/components/PixelDogLoader";
import {
  RememberedProjectActions,
  RememberedProjectCard
} from "@/components/RememberedProjectCard";
import { MotionPresence } from "@/components/ui/MotionPresence";
import { listAccessibleProjects, verifyProjectAccess } from "@/lib/data/projects";
import { projectFromRow } from "@/lib/data/mappers";
import { cleanProjectName, sanitizePasscode } from "@/lib/projectAccess/core";
import {
  dismissJoinedProject,
  isProjectDismissed,
  readDismissedProjectIds,
  resolveDismissedProjectOwnerId,
  restoreDismissedProject
} from "@/lib/projectAccess/dismissedProjects";
import {
  forgetProjectSelection,
  readRememberedProjectSelection,
  rememberProjectSelection
} from "@/lib/projectAccess/recentProject";
import type { Project } from "@/lib/types";

type ContextualAction = "new" | "join";
type HomeAction = ContextualAction | "go";
type AccessibleProjectSnapshot = {
  allProjects: Project[];
  visibleProjects: Project[];
  dismissedProjectIds: Set<string>;
  preferenceOwnerId: string;
};
type RememberedProjectMenuTarget = {
  project: Project;
  left: number;
  top: number;
  triggerElement: HTMLButtonElement;
};

const NAVIGATION_LOCK_RELEASE_MS = 1500;
const PROJECT_CONTEXT_MENU_WIDTH = 176;
const PROJECT_CONTEXT_MENU_HEIGHT = 52;
const PROJECT_CONTEXT_MENU_EDGE = 8;

const homeActions = [
  {
    id: "new",
    label: "New",
    description: "프로젝트 만들기",
    ariaLabel: "New Project"
  },
  {
    id: "join",
    label: "Join",
    description: "프로젝트 참여",
    ariaLabel: "Join Project"
  },
  {
    id: "go",
    label: "Go",
    description: "진행 화면 열기",
    ariaLabel: "Go"
  }
] as const satisfies ReadonlyArray<{
  id: HomeAction;
  label: string;
  description: string;
  ariaLabel: string;
}>;

/** New, Join, Go를 고정 카드로 제공하는 앱 진입 화면입니다. */
export default function HomePage() {
  const router = useRouter();
  const [projects, setProjects] = useState<Project[]>([]);
  const [isLoading, setIsLoading] = useState(false);
  const [hasLoadedProjects, setHasLoadedProjects] = useState(false);
  const [errorMessage, setErrorMessage] = useState("");
  const [selectedAction, setSelectedAction] = useState<ContextualAction | null>(null);
  const [newProjectName, setNewProjectName] = useState("");
  const [adminPassword, setAdminPassword] = useState("");
  const [progressPassword, setProgressPassword] = useState("");
  const [joinProjectName, setJoinProjectName] = useState("");
  const [joinPassword, setJoinPassword] = useState("");
  const [newProjectError, setNewProjectError] = useState("");
  const [joinProjectError, setJoinProjectError] = useState("");
  const [statusMessage, setStatusMessage] = useState("");
  const [isCreatingProject, setIsCreatingProject] = useState(false);
  const [isResolvingGo, setIsResolvingGo] = useState(false);
  const [selectedProjectId, setSelectedProjectId] = useState<string | null>(null);
  const [rememberedProjectMenu, setRememberedProjectMenu] = useState<RememberedProjectMenuTarget | null>(null);
  const [pendingProjectDismissal, setPendingProjectDismissal] = useState<Project | null>(null);

  const newProjectNameRef = useRef<HTMLInputElement | null>(null);
  const joinProjectNameRef = useRef<HTMLInputElement | null>(null);
  const selectedActionTriggerRef = useRef<HTMLButtonElement | null>(null);
  const projectActionsRef = useRef<HTMLDivElement | null>(null);
  const rememberedProjectTriggerRef = useRef<HTMLButtonElement | null>(null);
  const statusTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const projectNavigationTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const projectsLoadPromiseRef = useRef<Promise<AccessibleProjectSnapshot> | null>(null);
  const allAccessibleProjectsRef = useRef<Project[]>([]);
  const dismissedProjectIdsRef = useRef(new Set<string>());
  const preferenceOwnerIdRef = useRef("");
  const projectNavigationRef = useRef(false);
  const navigationAttemptRef = useRef(0);
  const joinSubmissionRef = useRef(false);
  const isMountedRef = useRef(true);

  const interactionLocked = isCreatingProject
    || isResolvingGo
    || Boolean(selectedProjectId);

  useEffect(() => {
    function resetNavigationState() {
      navigationAttemptRef.current += 1;
      projectNavigationRef.current = false;
      joinSubmissionRef.current = false;
      setSelectedAction(null);
      setSelectedProjectId(null);
      setIsCreatingProject(false);
      setIsResolvingGo(false);
      setRememberedProjectMenu(null);
      setPendingProjectDismissal(null);
      rememberedProjectTriggerRef.current = null;
    }

    resetNavigationState();
    window.addEventListener("pageshow", resetNavigationState);
    return () => window.removeEventListener("pageshow", resetNavigationState);
  }, []);

  useEffect(() => {
    isMountedRef.current = true;
    return () => {
      isMountedRef.current = false;
      if (statusTimerRef.current) clearTimeout(statusTimerRef.current);
      if (projectNavigationTimerRef.current) clearTimeout(projectNavigationTimerRef.current);
    };
  }, []);

  useEffect(() => {
    if (!selectedAction || !window.matchMedia("(min-width: 1180px)").matches) return;
    const input = selectedAction === "new"
      ? newProjectNameRef.current
      : joinProjectNameRef.current;
    input?.focus({ preventScroll: true });
  }, [selectedAction]);

  useEffect(() => {
    function handleDocumentPointerDown(event: PointerEvent) {
      if (!rememberedProjectMenu || !(event.target instanceof Node)) return;
      if (projectActionsRef.current?.contains(event.target)) return;
      closeRememberedProjectMenu();
    }

    function handleEscape(event: KeyboardEvent) {
      if (event.key !== "Escape") return;
      if (pendingProjectDismissal) {
        cancelProjectDismissal();
        return;
      }
      if (rememberedProjectMenu) {
        closeRememberedProjectMenu(true);
        return;
      }
      if (selectedAction) closeContextualUi();
    }

    document.addEventListener("pointerdown", handleDocumentPointerDown);
    window.addEventListener("keydown", handleEscape);
    return () => {
      document.removeEventListener("pointerdown", handleDocumentPointerDown);
      window.removeEventListener("keydown", handleEscape);
    };
  }, [pendingProjectDismissal, rememberedProjectMenu, selectedAction]);

  function showStatus(message: string) {
    if (statusTimerRef.current) clearTimeout(statusTimerRef.current);
    setStatusMessage(message);
    statusTimerRef.current = setTimeout(() => {
      statusTimerRef.current = null;
      if (isMountedRef.current) setStatusMessage("");
    }, 2000);
  }

  function loadAccessibleProjectList(force = false): Promise<AccessibleProjectSnapshot> {
    if (!force && hasLoadedProjects) {
      return Promise.resolve({
        allProjects: allAccessibleProjectsRef.current,
        visibleProjects: projects,
        dismissedProjectIds: new Set(dismissedProjectIdsRef.current),
        preferenceOwnerId: preferenceOwnerIdRef.current
      });
    }
    if (projectsLoadPromiseRef.current) return projectsLoadPromiseRef.current;

    setIsLoading(true);
    setErrorMessage("");
    const request = listAccessibleProjects()
      .then(async ({ projects: accessibleProjects, preferenceScope }) => {
        const preferenceOwnerId = await resolveDismissedProjectOwnerId(preferenceScope);
        const dismissedProjectIds = readDismissedProjectIds(preferenceOwnerId);
        const visibleProjects = accessibleProjects.filter(
          (project) => !isProjectDismissed(dismissedProjectIds, project.id)
        );
        const snapshot: AccessibleProjectSnapshot = {
          allProjects: accessibleProjects,
          visibleProjects,
          dismissedProjectIds,
          preferenceOwnerId
        };
        if (isMountedRef.current) {
          allAccessibleProjectsRef.current = accessibleProjects;
          dismissedProjectIdsRef.current = dismissedProjectIds;
          preferenceOwnerIdRef.current = preferenceOwnerId;
          setProjects(visibleProjects);
          setHasLoadedProjects(true);
        }
        return snapshot;
      })
      .catch((error) => {
        if (isMountedRef.current) {
          setErrorMessage(error instanceof Error ? error.message : "참여한 프로젝트를 불러오지 못했습니다.");
        }
        throw error;
      })
      .finally(() => {
        projectsLoadPromiseRef.current = null;
        if (isMountedRef.current) setIsLoading(false);
      });
    projectsLoadPromiseRef.current = request;
    return request;
  }

  function selectContextualAction(
    action: ContextualAction,
    triggerElement?: HTMLButtonElement
  ) {
    if (interactionLocked || projectNavigationRef.current || joinSubmissionRef.current) return;
    if (triggerElement) selectedActionTriggerRef.current = triggerElement;
    setSelectedAction(action);
    setNewProjectError("");
    setJoinProjectError("");
    setStatusMessage("");
    if (action === "join") {
      void loadAccessibleProjectList(true).catch(() => undefined);
    }
  }

  function showJoinPicker(message = "", refreshProjects = true) {
    navigationAttemptRef.current += 1;
    projectNavigationRef.current = false;
    setSelectedProjectId(null);
    setIsResolvingGo(false);
    setSelectedAction("join");
    setNewProjectError("");
    setJoinProjectError(message);
    if (refreshProjects) {
      void loadAccessibleProjectList(true).catch(() => undefined);
    }
  }

  function closeContextualUi() {
    if (projectNavigationRef.current || joinSubmissionRef.current || isCreatingProject) return;
    const triggerElement = selectedActionTriggerRef.current;
    setSelectedAction(null);
    setNewProjectError("");
    setJoinProjectError("");
    triggerElement?.focus({ preventScroll: true });
  }

  function releaseProjectNavigation(attemptId?: number) {
    if (attemptId !== undefined && navigationAttemptRef.current !== attemptId) return;
    projectNavigationRef.current = false;
    if (!isMountedRef.current) return;
    setSelectedProjectId(null);
    setIsResolvingGo(false);
    setIsCreatingProject(false);
  }

  function pushProjectRoute(
    projectId: string,
    projectPath: string,
    attemptId = navigationAttemptRef.current
  ) {
    if (navigationAttemptRef.current !== attemptId) return;
    setSelectedProjectId(projectId);
    try {
      router.prefetch(projectPath);
      router.push(projectPath);
    } catch {
      releaseProjectNavigation(attemptId);
      showStatus("프로젝트를 열지 못했습니다");
      return;
    }

    if (projectNavigationTimerRef.current) clearTimeout(projectNavigationTimerRef.current);
    projectNavigationTimerRef.current = setTimeout(() => {
      projectNavigationTimerRef.current = null;
      releaseProjectNavigation(attemptId);
    }, NAVIGATION_LOCK_RELEASE_MS);
  }

  async function resolveGoProject() {
    if (projectNavigationRef.current) return;
    const attemptId = navigationAttemptRef.current + 1;
    navigationAttemptRef.current = attemptId;
    projectNavigationRef.current = true;
    setIsResolvingGo(true);
    setErrorMessage("");
    setStatusMessage("");

    try {
      const {
        allProjects,
        visibleProjects,
        dismissedProjectIds
      } = await loadAccessibleProjectList(true);
      if (!isMountedRef.current || navigationAttemptRef.current !== attemptId) return;
      const accessibleById = new Map(allProjects.map((project) => [project.id, project]));
      const visibleById = new Map(visibleProjects.map((project) => [project.id, project]));
      const { activeProjectId, lastProjectId } = readRememberedProjectSelection();

      let revokedProjectFound = false;
      [activeProjectId, lastProjectId].forEach((projectId) => {
        if (projectId && isProjectDismissed(dismissedProjectIds, projectId)) {
          forgetProjectSelection(projectId);
          return;
        }
        if (projectId && !accessibleById.has(projectId)) {
          revokedProjectFound = true;
          forgetProjectSelection(projectId);
        }
      });

      const candidateIds: string[] = [];
      if (activeProjectId && visibleById.has(activeProjectId)) candidateIds.push(activeProjectId);
      if (
        lastProjectId
        && lastProjectId !== activeProjectId
        && visibleById.has(lastProjectId)
      ) {
        candidateIds.push(lastProjectId);
      }

      for (const projectId of candidateIds) {
        const verifiedProject = visibleById.get(projectId);
        if (!verifiedProject) continue;
        rememberProjectSelection(verifiedProject.id);
        pushProjectRoute(
          verifiedProject.id,
          `/projects/${encodeURIComponent(verifiedProject.id)}?view=progress`,
          attemptId
        );
        return;
      }

      showJoinPicker(
        revokedProjectFound ? "접근 권한이 만료되었습니다. 비밀번호로 다시 참여해주세요." : "",
        false
      );
    } catch (error) {
      if (!isMountedRef.current || navigationAttemptRef.current !== attemptId) return;
      setErrorMessage(error instanceof Error ? error.message : "프로젝트 접근 권한을 확인하지 못했습니다.");
      showJoinPicker("", false);
    }
  }

  function handleActionClick(action: HomeAction, triggerElement: HTMLButtonElement) {
    if (interactionLocked || projectNavigationRef.current || joinSubmissionRef.current) return;
    selectedActionTriggerRef.current = triggerElement;
    if (action === "new" || action === "join") {
      selectContextualAction(action, triggerElement);
      return;
    }
    setSelectedAction(null);
    setNewProjectError("");
    setJoinProjectError("");
    void resolveGoProject();
  }

  function openRememberedProjectMenu(
    project: Project,
    clientX: number,
    clientY: number,
    triggerElement: HTMLButtonElement
  ) {
    const visualViewport = window.visualViewport;
    const viewportLeft = visualViewport?.offsetLeft ?? 0;
    const viewportTop = visualViewport?.offsetTop ?? 0;
    const viewportRight = viewportLeft + (visualViewport?.width ?? window.innerWidth);
    const viewportBottom = viewportTop + (visualViewport?.height ?? window.innerHeight);
    const left = Math.max(
      viewportLeft + PROJECT_CONTEXT_MENU_EDGE,
      Math.min(
        clientX,
        viewportRight - PROJECT_CONTEXT_MENU_WIDTH - PROJECT_CONTEXT_MENU_EDGE
      )
    );
    const top = Math.max(
      viewportTop + PROJECT_CONTEXT_MENU_EDGE,
      Math.min(
        clientY,
        viewportBottom - PROJECT_CONTEXT_MENU_HEIGHT - PROJECT_CONTEXT_MENU_EDGE
      )
    );
    setPendingProjectDismissal(null);
    rememberedProjectTriggerRef.current = triggerElement;
    setRememberedProjectMenu({ project, left, top, triggerElement });
  }

  function restoreRememberedProjectTriggerFocus() {
    const triggerElement = rememberedProjectTriggerRef.current;
    rememberedProjectTriggerRef.current = null;
    if (triggerElement?.isConnected) triggerElement.focus({ preventScroll: true });
  }

  function closeRememberedProjectMenu(restoreFocus = false) {
    setRememberedProjectMenu(null);
    if (restoreFocus) {
      restoreRememberedProjectTriggerFocus();
    } else {
      rememberedProjectTriggerRef.current = null;
    }
  }

  function requestProjectDismissal(project: Project) {
    setRememberedProjectMenu(null);
    setPendingProjectDismissal(project);
  }

  function cancelProjectDismissal() {
    setPendingProjectDismissal(null);
    restoreRememberedProjectTriggerFocus();
  }

  function confirmProjectDismissal(project: Project) {
    projectNavigationRef.current = false;
    navigationAttemptRef.current += 1;

    const preferenceOwnerId = preferenceOwnerIdRef.current;
    const dismissedProjectIds = preferenceOwnerId
      ? dismissJoinedProject(preferenceOwnerId, project.id)
      : new Set(dismissedProjectIdsRef.current).add(project.id);
    dismissedProjectIdsRef.current = dismissedProjectIds;
    forgetProjectSelection(project.id);
    setProjects((current) => current.filter((item) => item.id !== project.id));
    setSelectedProjectId((current) => current === project.id ? null : current);
    setIsResolvingGo(false);
    setRememberedProjectMenu(null);
    setPendingProjectDismissal(null);
    rememberedProjectTriggerRef.current = null;
  }

  function restoreProjectToRememberedList(projectId: string) {
    const preferenceOwnerId = preferenceOwnerIdRef.current;
    if (!preferenceOwnerId) return;
    dismissedProjectIdsRef.current = restoreDismissedProject(preferenceOwnerId, projectId);
    setProjects(
      allAccessibleProjectsRef.current.filter(
        (project) => !isProjectDismissed(dismissedProjectIdsRef.current, project.id)
      )
    );
  }

  async function restoreProjectAfterJoin(projectId: string) {
    if (!preferenceOwnerIdRef.current) {
      try {
        await loadAccessibleProjectList(true);
      } catch {
        // 이동 후 ProjectAccessGate가 서버 권한을 다시 확인하고 동일한 복구를 수행합니다.
      }
    }
    restoreProjectToRememberedList(projectId);
  }

  async function openPreviouslyJoinedProject(project: Project | undefined) {
    if (!project || projectNavigationRef.current) return;
    const attemptId = navigationAttemptRef.current + 1;
    navigationAttemptRef.current = attemptId;
    projectNavigationRef.current = true;
    setSelectedProjectId(project.id);
    setJoinProjectError("");

    try {
      const grant = await verifyProjectAccess(project.id);
      if (!isMountedRef.current || navigationAttemptRef.current !== attemptId) return;
      if (!grant) {
        forgetProjectSelection(project.id);
        setProjects((current) => current.filter((item) => item.id !== project.id));
        setJoinProjectError("접근 권한이 만료되었습니다. 비밀번호로 다시 참여해주세요.");
        releaseProjectNavigation(attemptId);
        return;
      }

      rememberProjectSelection(grant.projectId);
      pushProjectRoute(
        grant.projectId,
        `/projects/${encodeURIComponent(grant.projectId)}`,
        attemptId
      );
    } catch (error) {
      if (!isMountedRef.current || navigationAttemptRef.current !== attemptId) return;
      setJoinProjectError(error instanceof Error ? error.message : "프로젝트 접근 권한을 확인하지 못했습니다.");
      releaseProjectNavigation(attemptId);
    }
  }

  async function handleCreateProject(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (isCreatingProject || projectNavigationRef.current) return;
    const name = cleanProjectName(newProjectName);
    if (!name) {
      setNewProjectError("프로젝트 이름을 입력하세요.");
      return;
    }
    if (!/^\d{4}$/.test(adminPassword) || !/^\d{4}$/.test(progressPassword)) {
      setNewProjectError("Key staff와 Staff 비밀번호를 각각 4자리 숫자로 입력하세요.");
      return;
    }
    if (adminPassword === progressPassword) {
      setNewProjectError("Key staff 비밀번호와 Staff 비밀번호는 서로 달라야 합니다.");
      return;
    }

    setNewProjectError("");
    setIsCreatingProject(true);
    try {
      const response = await fetch("/api/projects/create", {
        method: "POST",
        credentials: "same-origin",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ projectName: name, adminPassword, progressPassword })
      });
      const payload = (await response.json()) as { project?: Record<string, unknown>; error?: string };
      if (!response.ok || !payload.project) {
        throw new Error(payload.error || "프로젝트를 만들지 못했습니다.");
      }
      const project = projectFromRow(payload.project);
      restoreProjectToRememberedList(project.id);
      rememberProjectSelection(project.id);
      router.push(`/projects/${project.id}/basic-info`);
    } catch (error) {
      setNewProjectError(error instanceof Error ? error.message : "프로젝트를 만들지 못했습니다.");
      setIsCreatingProject(false);
    }
  }

  async function handleJoinProject(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (joinSubmissionRef.current || projectNavigationRef.current) return;
    const projectName = cleanProjectName(joinProjectName);
    if (!projectName || !/^\d{4}$/.test(joinPassword)) {
      setJoinProjectError("프로젝트 이름과 4자리 비밀번호를 입력하세요");
      return;
    }

    joinSubmissionRef.current = true;
    setJoinProjectError("");
    setIsCreatingProject(true);
    try {
      const response = await fetch("/api/projects/join", {
        method: "POST",
        credentials: "same-origin",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ projectName, password: joinPassword })
      });
      const payload = (await response.json()) as {
        projectId?: string;
        role?: "admin" | "progress";
        error?: string;
      };
      if (!response.ok || !payload.projectId || !payload.role) {
        throw new Error(payload.error || "프로젝트 이름 또는 비밀번호가 올바르지 않습니다");
      }
      await restoreProjectAfterJoin(payload.projectId);
      setJoinPassword("");
      rememberProjectSelection(payload.projectId);
      const attemptId = navigationAttemptRef.current + 1;
      navigationAttemptRef.current = attemptId;
      projectNavigationRef.current = true;
      pushProjectRoute(
        payload.projectId,
        `/projects/${encodeURIComponent(payload.projectId)}`,
        attemptId
      );
    } catch (error) {
      setJoinProjectError(error instanceof Error ? error.message : "프로젝트 이름 또는 비밀번호가 올바르지 않습니다");
      setIsCreatingProject(false);
    } finally {
      joinSubmissionRef.current = false;
    }
  }

  function renderNewProjectForm() {
    return (
      <section
        id="new-project-panel"
        aria-labelledby="new-project-panel-title"
        className="ui-motion-surface min-w-0 max-w-full rounded-[var(--radius-card)] border border-field-divider bg-field-panel p-4 shadow-card"
      >
        <h2 id="new-project-panel-title" className="font-display text-center text-sm font-black text-field-text">
          새 프로젝트
        </h2>
        <form onSubmit={handleCreateProject} className="mt-4 grid min-w-0 gap-3">
          <label className="grid min-w-0 gap-1.5 text-xs font-bold text-field-subtle" htmlFor="new-project-name">
            프로젝트 이름
            <input
              ref={newProjectNameRef}
              id="new-project-name"
              value={newProjectName}
              onChange={(event) => {
                setNewProjectName(event.target.value);
                if (newProjectError) setNewProjectError("");
              }}
              placeholder="프로젝트 이름"
              aria-invalid={Boolean(newProjectError)}
              aria-describedby={newProjectError ? "new-project-error" : undefined}
              className="min-h-11 w-full min-w-0 rounded-[10px] border border-field-border bg-field-input px-3 text-sm text-field-text outline-none placeholder:text-field-muted"
            />
          </label>
          <label className="grid min-w-0 gap-1.5 text-xs font-bold text-field-subtle" htmlFor="new-project-admin-password">
            Key staff 비밀번호
            <input
              id="new-project-admin-password"
              type="password"
              inputMode="numeric"
              autoComplete="off"
              value={adminPassword}
              onChange={(event) => {
                setAdminPassword(sanitizePasscode(event.target.value));
                if (newProjectError) setNewProjectError("");
              }}
              placeholder="4자리 숫자"
              aria-invalid={Boolean(newProjectError)}
              aria-describedby={newProjectError ? "new-project-error" : undefined}
              className="min-h-11 w-full min-w-0 rounded-[10px] border border-field-border bg-field-input px-3 text-sm tracking-[0.2em] text-field-text outline-none placeholder:tracking-normal placeholder:text-field-muted"
            />
          </label>
          <label className="grid min-w-0 gap-1.5 text-xs font-bold text-field-subtle" htmlFor="new-project-progress-password">
            Staff 비밀번호
            <input
              id="new-project-progress-password"
              type="password"
              inputMode="numeric"
              autoComplete="off"
              value={progressPassword}
              onChange={(event) => {
                setProgressPassword(sanitizePasscode(event.target.value));
                if (newProjectError) setNewProjectError("");
              }}
              placeholder="4자리 숫자"
              aria-invalid={Boolean(newProjectError)}
              aria-describedby={newProjectError ? "new-project-error" : undefined}
              className="min-h-11 w-full min-w-0 rounded-[10px] border border-field-border bg-field-input px-3 text-sm tracking-[0.2em] text-field-text outline-none placeholder:tracking-normal placeholder:text-field-muted"
            />
          </label>
          {newProjectError ? (
            <p id="new-project-error" role="alert" className="break-words text-xs font-bold leading-5 text-field-danger">
              {newProjectError}
            </p>
          ) : null}
          <button
            type="submit"
            disabled={isCreatingProject}
            className="neon-primary min-h-11 w-full rounded-[10px] border px-4 text-sm font-black transition-[transform,background-color,border-color] duration-150 active:scale-[0.99] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-field-primary focus-visible:ring-offset-2 focus-visible:ring-offset-field-bg"
          >
            <span className="font-display">{isCreatingProject ? "만드는 중" : "프로젝트 만들기"}</span>
          </button>
        </form>
      </section>
    );
  }

  function renderJoinForm() {
    return (
      <section
        id="join-project-panel"
        aria-labelledby="join-project-panel-title"
        className="ui-motion-surface min-w-0 max-w-full rounded-[var(--radius-card)] border border-field-divider bg-field-panel p-4 shadow-card"
      >
        <h2 id="join-project-panel-title" className="font-display text-center text-sm font-black text-field-text">
          프로젝트 참여
        </h2>
        <form onSubmit={handleJoinProject} className="mt-4 grid min-w-0 gap-3">
          <label className="grid min-w-0 gap-1.5 text-xs font-bold text-field-subtle" htmlFor="join-project-name">
            프로젝트 이름
            <input
              ref={joinProjectNameRef}
              id="join-project-name"
              value={joinProjectName}
              onChange={(event) => {
                setJoinProjectName(event.target.value);
                if (joinProjectError) setJoinProjectError("");
              }}
              placeholder="프로젝트 이름"
              aria-invalid={Boolean(joinProjectError)}
              aria-describedby={joinProjectError ? "join-project-error" : undefined}
              className="min-h-11 w-full min-w-0 rounded-[10px] border border-field-border bg-field-input px-3 text-sm text-field-text outline-none placeholder:text-field-muted"
            />
          </label>
          <label className="grid min-w-0 gap-1.5 text-xs font-bold text-field-subtle" htmlFor="join-project-password">
            비밀번호
            <input
              id="join-project-password"
              type="password"
              inputMode="numeric"
              autoComplete="off"
              value={joinPassword}
              onChange={(event) => {
                setJoinPassword(sanitizePasscode(event.target.value));
                if (joinProjectError) setJoinProjectError("");
              }}
              placeholder="4자리 숫자"
              aria-invalid={Boolean(joinProjectError)}
              aria-describedby={joinProjectError ? "join-project-error" : undefined}
              className="min-h-11 w-full min-w-0 rounded-[10px] border border-field-border bg-field-input px-3 text-sm tracking-[0.2em] text-field-text outline-none placeholder:tracking-normal placeholder:text-field-muted"
            />
          </label>
          {joinProjectError ? (
            <p id="join-project-error" role="alert" className="break-words text-xs font-bold leading-5 text-field-danger">
              {joinProjectError}
            </p>
          ) : null}
          <button
            type="submit"
            disabled={isCreatingProject || Boolean(selectedProjectId)}
            className="neon-primary min-h-11 w-full rounded-[10px] border px-4 text-sm font-black transition-[transform,background-color,border-color] duration-150 active:scale-[0.99] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-field-primary focus-visible:ring-offset-2 focus-visible:ring-offset-field-bg"
          >
            <span className="font-display">{isCreatingProject ? "확인 중" : "참여하기"}</span>
          </button>
        </form>
      </section>
    );
  }

  function renderRememberedProjects() {
    return (
      <section
        id="remembered-projects-panel"
        aria-labelledby="remembered-projects-title"
        className="ui-motion-surface min-w-0 max-w-full rounded-[var(--radius-card)] border border-field-divider bg-field-panel p-4 text-center shadow-card min-[1180px]:max-h-[min(34rem,calc(100dvh-7rem))] min-[1180px]:overflow-y-auto"
      >
        <h2 id="remembered-projects-title" className="font-display text-sm font-black text-field-text">
          이전에 참여한 프로젝트
        </h2>
        <div className="mt-3 min-w-0">
          {isLoading ? (
            <div className="flex min-h-14 items-center justify-center">
              <InlineLoader />
            </div>
          ) : errorMessage ? (
            <p role="alert" className="break-words py-2 text-xs font-bold leading-5 text-field-danger">
              {errorMessage}
            </p>
          ) : hasLoadedProjects && projects.length === 0 ? (
            <p className="py-2 text-xs font-bold leading-5 text-field-muted">
              참여한 프로젝트가 없습니다.
            </p>
          ) : (
            <div className="grid min-w-0 gap-2">
              {projects.map((project) => (
                <RememberedProjectCard
                  key={project.id}
                  project={project}
                  disabled={isCreatingProject || Boolean(selectedProjectId)}
                  isOpening={selectedProjectId === project.id}
                  onOpen={(targetProject) => {
                    void openPreviouslyJoinedProject(targetProject);
                  }}
                  onOpenMenu={openRememberedProjectMenu}
                />
              ))}
            </div>
          )}
        </div>
      </section>
    );
  }

  return (
    <section
      aria-labelledby="home-actions-title"
      className="relative flex min-h-[100dvh] w-full min-w-0 items-center overflow-x-clip px-4 pb-[max(1.5rem,env(safe-area-inset-bottom))] pt-[max(1.5rem,env(safe-area-inset-top))] sm:px-6 min-[1180px]:px-8"
      onContextMenu={(event) => {
        event.preventDefault();
        closeRememberedProjectMenu();
      }}
    >
      <h1 id="home-actions-title" className="sr-only">프로젝트 시작</h1>
      <div
        className="mx-auto grid w-full min-w-0 max-w-3xl content-center gap-3 min-[1180px]:max-w-[86rem] min-[1180px]:grid-cols-[minmax(220px,0.85fr)_minmax(340px,1.2fr)_minmax(260px,0.95fr)] min-[1180px]:grid-rows-[repeat(3,minmax(7rem,auto))] min-[1180px]:gap-x-[clamp(1rem,2vw,1.75rem)] min-[1180px]:gap-y-3"
      >
        {homeActions.map((action, index) => {
          const isSelected = action.id !== "go" && selectedAction === action.id;
          const isGoPending = action.id === "go" && isResolvingGo;
          const desktopRowClass = index === 0
            ? "min-[1180px]:row-start-1"
            : index === 1
              ? "min-[1180px]:row-start-2"
              : "min-[1180px]:row-start-3";

          return (
            <div key={action.id} className="contents">
              <button
                type="button"
                disabled={interactionLocked}
                aria-label={action.ariaLabel}
                aria-pressed={action.id === "go" ? undefined : isSelected}
                aria-expanded={action.id === "go" ? undefined : isSelected}
                aria-controls={action.id === "new"
                    ? "new-project-panel"
                  : action.id === "join"
                    ? "join-project-panel remembered-projects-panel"
                    : undefined}
                aria-busy={isGoPending || undefined}
                onClick={(event) => handleActionClick(action.id, event.currentTarget)}
                className={`ui-motion-surface group min-h-[7.25rem] min-w-0 max-w-full rounded-[var(--radius-card)] border px-5 py-5 text-center shadow-card outline-none transition-[transform,background-color,border-color,box-shadow] duration-[var(--motion-fast)] min-[1180px]:col-start-2 ${desktopRowClass} ${
                  isSelected || isGoPending
                    ? "neon-selected-strong"
                    : "border-field-divider bg-field-panel hover:border-field-subtle hover:bg-field-hover"
                } active:scale-[0.99] disabled:cursor-wait disabled:opacity-65 focus-visible:ring-2 focus-visible:ring-field-primary focus-visible:ring-offset-2 focus-visible:ring-offset-field-bg`}
              >
                <span className={`font-display-strong block text-2xl font-black leading-none ${isSelected || isGoPending ? "text-field-primary" : "text-field-text"}`}>
                  {action.label}
                </span>
                <span className="mt-3 flex min-h-5 items-center justify-center text-center text-xs font-bold text-field-muted">
                  {isGoPending ? <InlineLoader /> : action.description}
                </span>
              </button>

              {action.id === "new" ? (
                <MotionPresence
                  show={selectedAction === "new"}
                  className="min-[1180px]:col-start-3 min-[1180px]:row-span-3 min-[1180px]:row-start-1 min-[1180px]:self-center"
                >
                  {renderNewProjectForm()}
                </MotionPresence>
              ) : null}
              {action.id === "join" ? (
                <>
                  <MotionPresence
                    show={selectedAction === "join"}
                    className="min-[1180px]:col-start-1 min-[1180px]:row-span-3 min-[1180px]:row-start-1 min-[1180px]:self-center"
                  >
                    {renderJoinForm()}
                  </MotionPresence>
                  <MotionPresence
                    show={selectedAction === "join"}
                    className="min-[1180px]:col-start-3 min-[1180px]:row-span-3 min-[1180px]:row-start-1 min-[1180px]:self-center"
                  >
                    {renderRememberedProjects()}
                  </MotionPresence>
                </>
              ) : null}
            </div>
          );
        })}
      </div>

      {statusMessage ? (
        <p
          role="status"
          className="fixed bottom-[max(1rem,env(safe-area-inset-bottom))] left-1/2 z-30 max-w-[calc(100vw-2rem)] -translate-x-1/2 rounded-[10px] border border-field-divider bg-field-elevated px-4 py-2 text-center text-xs font-bold text-field-subtle shadow-dialog"
        >
          {statusMessage}
        </p>
      ) : null}

      <div ref={projectActionsRef} className="contents">
        <RememberedProjectActions
          menuTarget={rememberedProjectMenu}
          confirmationTarget={pendingProjectDismissal}
          onRequestRemoval={requestProjectDismissal}
          onCancelRemoval={cancelProjectDismissal}
          onConfirmRemoval={confirmProjectDismissal}
        />
      </div>
    </section>
  );
}
