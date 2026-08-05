"use client";

import { FormEvent, useCallback, useEffect, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { X } from "lucide-react";
import { PixelDogLoader } from "@/components/PixelDogLoader";
import {
  RememberedProjectActions,
  RememberedProjectCard
} from "@/components/RememberedProjectCard";
import { listAccessibleProjects, verifyProjectAccess } from "@/lib/data/projects";
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
import { projectFromRow } from "@/lib/data/mappers";
import type { Project } from "@/lib/types";
import {
  getBubbleTargetMeasurement,
  getSpinnerItemAngle,
  normalizeSpinnerAngle,
  useDragSpinner
} from "@/components/useDragSpinner";

type ProjectPickerMode = "new" | "progress" | "join";
type WheelItemId = (typeof wheelItems)[number]["id"];
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

const MAIN_SELECTION_FEEDBACK_MS = 90;
const NAVIGATION_LOCK_RELEASE_MS = 1500;
const PROJECT_CONTEXT_MENU_WIDTH = 176;
const PROJECT_CONTEXT_MENU_HEIGHT = 48;
const PROJECT_CONTEXT_MENU_EDGE = 8;

const wheelItems = [
  {
    id: "new",
    label: "New",
    ariaLabel: "New Project",
    colorClass: "bg-field-panel"
  },
  {
    id: "join",
    label: "Join",
    ariaLabel: "Join Project",
    colorClass: "bg-field-panel"
  },
  {
    id: "progress",
    label: "Go",
    ariaLabel: "Go",
    colorClass: "bg-field-panel"
  }
] as const;

/** 빈 종이 위 원형 메뉴만 제공하는 앱 진입 화면입니다. */
export default function HomePage() {
  const router = useRouter();
  const [projects, setProjects] = useState<Project[]>([]);
  const [isLoading, setIsLoading] = useState(false);
  const [hasLoadedProjects, setHasLoadedProjects] = useState(false);
  const [errorMessage, setErrorMessage] = useState("");
  const [pickerMode, setPickerMode] = useState<ProjectPickerMode | null>(null);
  const [newProjectName, setNewProjectName] = useState("");
  const [adminPassword, setAdminPassword] = useState("");
  const [progressPassword, setProgressPassword] = useState("");
  const [joinProjectName, setJoinProjectName] = useState("");
  const [joinPassword, setJoinPassword] = useState("");
  const [newProjectError, setNewProjectError] = useState("");
  const [isCreatingProject, setIsCreatingProject] = useState(false);
  const [isResolvingGo, setIsResolvingGo] = useState(false);
  const [feedback, setFeedback] = useState<{ target: WheelItemId; message: string } | null>(null);
  const [selectedMainId, setSelectedMainId] = useState<WheelItemId | null>(null);
  const [selectedProjectId, setSelectedProjectId] = useState<string | null>(null);
  const [rememberedProjectMenu, setRememberedProjectMenu] = useState<RememberedProjectMenuTarget | null>(null);
  const [pendingProjectDismissal, setPendingProjectDismissal] = useState<Project | null>(null);
  const isProgressMode = pickerMode === "progress";
  const isProjectRingOpen = isProgressMode && projects.length > 0;
  const wheelRef = useRef<HTMLDivElement | null>(null);
  const projectWheelRef = useRef<HTMLDivElement | null>(null);
  const mainTargetRef = useRef<HTMLDivElement | null>(null);
  const projectTargetRef = useRef<HTMLDivElement | null>(null);
  const mainBubbleRefs = useRef<Array<HTMLButtonElement | null>>([]);
  const mainOrbitRefs = useRef<Array<HTMLDivElement | null>>([]);
  const mainAnchorRefs = useRef<Array<HTMLDivElement | null>>([]);
  const projectBubbleRefs = useRef<Array<HTMLButtonElement | null>>([]);
  const projectOrbitRefs = useRef<Array<HTMLDivElement | null>>([]);
  const projectAnchorRefs = useRef<Array<HTMLDivElement | null>>([]);
  const canvasRef = useRef<HTMLDivElement | null>(null);
  const clusterRef = useRef<HTMLDivElement | null>(null);
  const compositionRef = useRef<HTMLDivElement | null>(null);
  const projectActionsRef = useRef<HTMLDivElement | null>(null);
  const rememberedProjectTriggerRef = useRef<HTMLButtonElement | null>(null);
  const feedbackTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const mainSelectionTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const projectSelectionTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const projectsLoadPromiseRef = useRef<Promise<AccessibleProjectSnapshot> | null>(null);
  const allAccessibleProjectsRef = useRef<Project[]>([]);
  const dismissedProjectIdsRef = useRef(new Set<string>());
  const preferenceOwnerIdRef = useRef("");
  const projectNavigationRef = useRef(false);
  const navigationAttemptRef = useRef(0);
  const joinSubmissionRef = useRef(false);
  const isMountedRef = useRef(true);
  const measureMainTarget = useCallback(
    (index: number) => getBubbleTargetMeasurement(mainBubbleRefs.current[index], mainTargetRef.current),
    []
  );
  const measureProjectTarget = useCallback(
    (index: number) => getBubbleTargetMeasurement(projectBubbleRefs.current[index], projectTargetRef.current),
    []
  );
  const applyMainRotationFrame = useCallback((rotation: number) => {
    mainOrbitRefs.current.forEach((orbit, index) => {
      if (!orbit) return;
      const itemAngle = getSpinnerItemAngle(index, wheelItems.length) + rotation;
      orbit.style.transform = `rotate(${itemAngle}deg)`;
      const anchor = mainAnchorRefs.current[index];
      if (anchor) {
        anchor.style.transform = `translate(-50%, -50%) rotate(${-itemAngle}deg)`;
      }
    });
  }, []);
  const applyProjectRotationFrame = useCallback((rotation: number) => {
    projectOrbitRefs.current.forEach((orbit, index) => {
      if (!orbit || projects.length === 0) return;
      const itemAngle = getSpinnerItemAngle(index, projects.length) + rotation;
      const distance = Math.abs(normalizeSpinnerAngle(itemAngle));
      const proximity = Math.max(0, 1 - distance / 180);
      orbit.style.transform = `rotate(${itemAngle}deg)`;
      orbit.style.zIndex = `${Math.max(1, Math.round(proximity * 10))}`;
      const anchor = projectAnchorRefs.current[index];
      if (anchor) {
        anchor.style.opacity = `${0.2 + proximity * 0.52}`;
        anchor.style.transform = `translate(-50%, -50%) rotate(${-itemAngle}deg) scale(${0.52 + proximity * 0.24})`;
      }
    });
  }, [projects.length]);
  const mainSpinner = useDragSpinner({
    itemCount: wheelItems.length,
    onCommit: (index) => commitWheelItem(wheelItems[index]?.id ?? "new"),
    onReject: () => closeProjectRing(),
    measureTarget: measureMainTarget,
    onRotationFrame: applyMainRotationFrame,
    activationKey: isProjectRingOpen
  });
  const projectSpinner = useDragSpinner({
    itemCount: projects.length,
    onCommit: (index) => openProject(projects[index]),
    onReject: () => closeProjectRing(),
    measureTarget: measureProjectTarget,
    onRotationFrame: applyProjectRotationFrame,
    activationKey: isProjectRingOpen
  });
  const previewItem = wheelItems[mainSpinner.activeIndex]?.id ?? "new";
  const activatedWheelItem = mainSpinner.activationIndex === null
    ? null
    : wheelItems[mainSpinner.activationIndex]?.id ?? null;
  const isProjectTargetEngaged = projectSpinner.activationIndex !== null
    && projectSpinner.activationState !== "outside";

  useEffect(() => {
    function resetHomeInteractions() {
      mainSpinner.resetInteraction();
      projectSpinner.resetInteraction();
      navigationAttemptRef.current += 1;
      projectNavigationRef.current = false;
      joinSubmissionRef.current = false;
      setSelectedMainId(null);
      setSelectedProjectId(null);
      setPickerMode(null);
      setFeedback(null);
      setIsResolvingGo(false);
      setRememberedProjectMenu(null);
      setPendingProjectDismissal(null);
      rememberedProjectTriggerRef.current = null;

      [document.body, document.documentElement].forEach((element) => {
        if (element.style.cursor === "grabbing" || element.style.cursor === "grab") {
          element.style.cursor = "";
        }
        if (element.style.userSelect === "none") element.style.userSelect = "";
      });
      document.body.classList.remove("cursor-grabbing", "select-none");
      document.documentElement.classList.remove("cursor-grabbing", "select-none");
    }

    resetHomeInteractions();
    window.addEventListener("pageshow", resetHomeInteractions);
    return () => {
      window.removeEventListener("pageshow", resetHomeInteractions);
      mainSpinner.resetInteraction();
      projectSpinner.resetInteraction();
    };
  }, [mainSpinner.resetInteraction, projectSpinner.resetInteraction]);

  useEffect(() => {
    isMountedRef.current = true;
    return () => {
      isMountedRef.current = false;
      if (feedbackTimerRef.current) clearTimeout(feedbackTimerRef.current);
      if (mainSelectionTimerRef.current) clearTimeout(mainSelectionTimerRef.current);
      if (projectSelectionTimerRef.current) clearTimeout(projectSelectionTimerRef.current);
    };
  }, []);

  useEffect(() => {
    if (!pickerMode) return;

    function closeOnOutsideClick(event: PointerEvent) {
      if (!(event.target instanceof Node)) return;
      if (projectActionsRef.current?.contains(event.target)) return;
      if (pendingProjectDismissal) return;
      if (rememberedProjectMenu) {
        closeRememberedProjectMenu();
        return;
      }
      const clickedWheel = wheelRef.current?.contains(event.target);
      const clickedSubmenu = clusterRef.current?.contains(event.target);
      const clickedProjectWheel = projectWheelRef.current?.contains(event.target);
      if (!clickedWheel && !clickedSubmenu && !clickedProjectWheel) {
        closeProjectRing();
      }
    }

    function closeOnEscape(event: KeyboardEvent) {
      if (event.key === "Escape") {
        if (pendingProjectDismissal) {
          cancelProjectDismissal();
          return;
        }
        if (rememberedProjectMenu) {
          closeRememberedProjectMenu(true);
          return;
        }
        closeProjectRing();
      }
    }

    document.addEventListener("pointerdown", closeOnOutsideClick);
    window.addEventListener("keydown", closeOnEscape);
    return () => {
      document.removeEventListener("pointerdown", closeOnOutsideClick);
      window.removeEventListener("keydown", closeOnEscape);
    };
  }, [
    mainSpinner.cancelPending,
    pendingProjectDismissal,
    pickerMode,
    projectSpinner.cancelPending,
    rememberedProjectMenu
  ]);

  useEffect(() => {
    if (pickerMode !== "progress") {
      projectSpinner.cancelPending();
      setSelectedProjectId(null);
    }
  }, [pickerMode, projectSpinner.cancelPending]);

  useEffect(() => {
    if (!pickerMode || !window.matchMedia("(max-width: 767px)").matches) return;
    let secondAnimationFrame = 0;
    const firstAnimationFrame = window.requestAnimationFrame(() => {
      secondAnimationFrame = window.requestAnimationFrame(() => {
        compositionRef.current?.scrollIntoView({
          block: "center",
          inline: "center",
          behavior: "smooth"
        });
      });
    });
    return () => {
      window.cancelAnimationFrame(firstAnimationFrame);
      if (secondAnimationFrame) window.cancelAnimationFrame(secondAnimationFrame);
    };
  }, [pickerMode]);

  function showFeedback(target: WheelItemId, message: string) {
    if (feedbackTimerRef.current) clearTimeout(feedbackTimerRef.current);
    setFeedback({ target, message });
    feedbackTimerRef.current = setTimeout(() => {
      if (isMountedRef.current) setFeedback(null);
    }, 1500);
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

  function showJoinPicker(message = "", refreshProjects = true) {
    const joinIndex = wheelItems.findIndex((item) => item.id === "join");
    if (joinIndex >= 0) {
      mainSpinner.snapToIndex(joinIndex, { commit: false });
      mainSelectionTimerRef.current = setTimeout(() => {
        mainSelectionTimerRef.current = null;
        if (isMountedRef.current) mainSpinner.snapToIndex(joinIndex, { commit: false });
      }, 300);
    }
    navigationAttemptRef.current += 1;
    projectNavigationRef.current = false;
    setIsResolvingGo(false);
    setSelectedMainId("join");
    setPickerMode("join");
    setNewProjectError(message);
    if (refreshProjects) {
      void loadAccessibleProjectList(true).catch(() => undefined);
    }
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
    feedbackTarget: WheelItemId,
    attemptId = navigationAttemptRef.current
  ) {
    if (navigationAttemptRef.current !== attemptId) return;
    setSelectedProjectId(projectId);
    try {
      router.prefetch(projectPath);
      router.push(projectPath);
    } catch {
      releaseProjectNavigation(attemptId);
      showFeedback(feedbackTarget, "프로젝트를 열지 못했습니다");
      return;
    }

    if (projectSelectionTimerRef.current) clearTimeout(projectSelectionTimerRef.current);
    projectSelectionTimerRef.current = setTimeout(() => {
      projectSelectionTimerRef.current = null;
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
        // 방금 access-list가 만료·공유 상태까지 서버에서 검증했으므로 같은
        // project_access_sessions를 즉시 한 번 더 조회하지 않습니다.
        rememberProjectSelection(verifiedProject.id);
        pushProjectRoute(
          verifiedProject.id,
          `/projects/${encodeURIComponent(verifiedProject.id)}?view=progress`,
          "progress",
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

  function commitWheelItem(id: WheelItemId) {
    if (
      pickerMode === id
      || mainSelectionTimerRef.current
      || projectNavigationRef.current
      || joinSubmissionRef.current
    ) return;
    setSelectedMainId(id);
    setFeedback(null);
    setNewProjectError("");
    setIsCreatingProject(false);

    mainSelectionTimerRef.current = setTimeout(() => {
      mainSelectionTimerRef.current = null;
      if (id === "new") {
        setPickerMode("new");
        return;
      }
      if (id === "join") {
        showJoinPicker();
        return;
      }
      setPickerMode(null);
      setJoinPassword("");
      void resolveGoProject();
    }, MAIN_SELECTION_FEEDBACK_MS);
  }

  function closeInputSubmenu(mode: "new" | "join") {
    if (projectNavigationRef.current || joinSubmissionRef.current) return;
    if (mode === "new") {
      setNewProjectName("");
      setAdminPassword("");
      setProgressPassword("");
    } else {
      setJoinProjectName("");
      setJoinPassword("");
    }
    setNewProjectError("");
    setIsCreatingProject(false);
    setSelectedMainId(null);
    setPickerMode(null);
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
    if (!triggerElement) return;
    window.requestAnimationFrame(() => {
      if (triggerElement.isConnected) triggerElement.focus();
    });
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
    projectSpinner.cancelPending();
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

  function handleWheelKeyDown(event: React.KeyboardEvent<HTMLDivElement>) {
    if (event.target !== event.currentTarget) return;
    if (event.key === "Enter" || event.key === " ") {
      event.preventDefault();
      if (mainSpinner.activationIndex === null) {
        closeProjectRing();
        return;
      }
      mainSpinner.activateIndex(mainSpinner.activationIndex);
      return;
    }
    if (event.key !== "ArrowLeft" && event.key !== "ArrowRight") return;

    event.preventDefault();
    const currentIndex = wheelItems.findIndex((item) => item.id === previewItem);
    const direction = event.key === "ArrowRight" ? 1 : -1;
    const nextIndex = (currentIndex + direction + wheelItems.length) % wheelItems.length;
    mainSpinner.snapToIndex(nextIndex);
  }

  function handleProjectSpinnerKeyDown(event: React.KeyboardEvent<HTMLDivElement>) {
    if (event.target !== event.currentTarget) return;
    if (projects.length === 0) return;
    if (event.key === "Enter" || event.key === " ") {
      event.preventDefault();
      if (projectSpinner.activationIndex === null) {
        closeProjectRing();
        return;
      }
      projectSpinner.activateIndex(projectSpinner.activationIndex);
      return;
    }
    if (event.key !== "ArrowLeft" && event.key !== "ArrowRight") return;

    event.preventDefault();
    const direction = event.key === "ArrowRight" ? 1 : -1;
    const nextIndex = (projectSpinner.activeIndex + direction + projects.length) % projects.length;
    projectSpinner.snapToIndex(nextIndex);
  }

  async function openPreviouslyJoinedProject(
    project: Project | undefined,
    destination: "home" | "progress" = "home"
  ) {
    if (!project || projectNavigationRef.current) return;
    const attemptId = navigationAttemptRef.current + 1;
    navigationAttemptRef.current = attemptId;
    projectNavigationRef.current = true;
    setSelectedProjectId(project.id);
    setNewProjectError("");

    try {
      const grant = await verifyProjectAccess(project.id);
      if (!isMountedRef.current || navigationAttemptRef.current !== attemptId) return;
      if (!grant) {
        forgetProjectSelection(project.id);
        if (isMountedRef.current) {
          setProjects((current) => current.filter((item) => item.id !== project.id));
          setNewProjectError("접근 권한이 만료되었습니다. 비밀번호로 다시 참여해주세요.");
        }
        releaseProjectNavigation(attemptId);
        return;
      }

      rememberProjectSelection(grant.projectId);
      const projectPath = destination === "progress"
        ? `/projects/${encodeURIComponent(grant.projectId)}?view=progress`
        : `/projects/${encodeURIComponent(grant.projectId)}`;
      pushProjectRoute(
        grant.projectId,
        projectPath,
        destination === "progress" ? "progress" : "join",
        attemptId
      );
    } catch (error) {
      if (!isMountedRef.current || navigationAttemptRef.current !== attemptId) return;
      if (isMountedRef.current) {
        setNewProjectError(error instanceof Error ? error.message : "프로젝트 접근 권한을 확인하지 못했습니다.");
      }
      releaseProjectNavigation(attemptId);
    }
  }

  function openProject(project: Project | undefined) {
    if (pickerMode !== "progress") return;
    void openPreviouslyJoinedProject(project, "progress");
  }

  function closeProjectRing() {
    if (projectNavigationRef.current || joinSubmissionRef.current) return;
    navigationAttemptRef.current += 1;
    mainSpinner.cancelPending();
    projectSpinner.cancelPending();
    if (mainSelectionTimerRef.current) clearTimeout(mainSelectionTimerRef.current);
    if (projectSelectionTimerRef.current) clearTimeout(projectSelectionTimerRef.current);
    mainSelectionTimerRef.current = null;
    projectSelectionTimerRef.current = null;
    projectNavigationRef.current = false;
    setSelectedMainId(null);
    setSelectedProjectId(null);
    setPickerMode(null);
    setFeedback(null);
    setIsResolvingGo(false);
  }

  async function handleCreateProject(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
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
      if (!response.ok || !payload.project) throw new Error(payload.error || "프로젝트를 만들지 못했습니다.");
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
      setNewProjectError("프로젝트 이름과 4자리 비밀번호를 입력하세요");
      return;
    }
    joinSubmissionRef.current = true;
    setNewProjectError("");
    setIsCreatingProject(true);
    try {
      const response = await fetch("/api/projects/join", {
        method: "POST",
        credentials: "same-origin",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ projectName, password: joinPassword })
      });
      const payload = (await response.json()) as { projectId?: string; role?: "admin" | "progress"; error?: string };
      if (!response.ok || !payload.projectId || !payload.role) throw new Error(payload.error || "프로젝트 이름 또는 비밀번호가 올바르지 않습니다");
      await restoreProjectAfterJoin(payload.projectId);
      setJoinPassword("");
      rememberProjectSelection(payload.projectId);
      const attemptId = navigationAttemptRef.current + 1;
      navigationAttemptRef.current = attemptId;
      projectNavigationRef.current = true;
      pushProjectRoute(
        payload.projectId,
        `/projects/${encodeURIComponent(payload.projectId)}`,
        "join",
        attemptId
      );
    } catch (error) {
      setNewProjectError(error instanceof Error ? error.message : "프로젝트 이름 또는 비밀번호가 올바르지 않습니다");
      setIsCreatingProject(false);
    } finally {
      joinSubmissionRef.current = false;
    }
  }

  const pickerTitle = pickerMode === "new" ? "New Project" : pickerMode === "join" ? "Join Project" : "Go";

  function renderProjectSpinner() {
    if (isLoading || errorMessage || projects.length === 0) return null;

    return (
      <div
        ref={projectWheelRef}
        role="group"
        tabIndex={0}
        aria-label="프로젝트 원형 메뉴. 좌우 방향키 또는 드래그로 회전"
        className="functional-circle absolute inset-0 z-10 touch-none select-none outline-none cursor-grab active:cursor-grabbing focus-visible:ring-2 focus-visible:ring-field-primary focus-visible:ring-offset-4 focus-visible:ring-offset-field-bg"
        {...projectSpinner.pointerHandlers}
        onClick={(event) => {
          if (event.target !== event.currentTarget) return;
          if (projectSpinner.consumeSuppressedClick()) return;
          closeProjectRing();
        }}
        onKeyDown={handleProjectSpinnerKeyDown}
      >
        <div
          className="functional-circle pointer-events-none absolute inset-[10%] border border-field-border bg-field-panel/50"
          aria-hidden
        />
        <div className="functional-circle pointer-events-none absolute inset-[14%] border border-dashed border-field-secondary/45" aria-hidden />
        <div
          ref={projectTargetRef}
          className="pointer-events-none absolute left-[89.5%] top-1/2 h-[4.25rem] w-[4.25rem] -translate-x-1/2 -translate-y-1/2 md:h-[5.5rem] md:w-[5.5rem]"
          aria-hidden
        >
          <div
            className={`functional-circle absolute inset-0 border-2 transition-[transform,background-color] duration-[260ms] ease-out ${
              selectedProjectId
                ? "neon-selected-strong scale-[1.18] motion-safe:animate-[project-target-confirm_420ms_ease-out]"
                : isProjectTargetEngaged
                  ? "neon-selected-strong scale-[1.1]"
                  : "neon-selected scale-100"
            }`}
          />
        </div>
        {projects.map((project, index) => {
          const itemAngle = getSpinnerItemAngle(index, projects.length) + projectSpinner.rotation;
          const distance = Math.abs(normalizeSpinnerAngle(itemAngle));
          const proximity = Math.max(0, 1 - distance / 180);
          const isActive = projectSpinner.activationIndex === index;
          const isSelectedProject = selectedProjectId === project.id;
          const scale = isActive ? 0.96 : 0.52 + proximity * 0.24;
          const opacity = isActive ? 1 : 0.2 + proximity * 0.52;

          return (
            <div
              key={project.id}
              ref={(element) => {
                projectOrbitRefs.current[index] = element;
              }}
              className={`pointer-events-none absolute inset-0 will-change-transform ${
                projectSpinner.isMoving
                  ? "transition-none"
                  : "transition-transform duration-[260ms] ease-out"
              }`}
              style={{
                transform: `rotate(${itemAngle}deg)`,
                zIndex: isActive ? 20 : Math.max(1, Math.round(proximity * 10))
              }}
            >
              <div
                ref={(element) => {
                  projectAnchorRefs.current[index] = element;
                }}
                className={`pointer-events-auto absolute left-[89.5%] top-1/2 h-[4.25rem] w-[4.25rem] will-change-[transform,opacity] md:h-[5.5rem] md:w-[5.5rem] ${
                  projectSpinner.isMoving ? "transition-none" : "transition-[transform,opacity] duration-[260ms] ease-out"
                }`}
                style={{
                  opacity,
                  transform: `translate(-50%, -50%) rotate(${-itemAngle}deg) scale(${scale})`
                }}
              >
                <button
                  ref={(element) => {
                    projectBubbleRefs.current[index] = element;
                  }}
                  type="button"
                  onClick={(event) => {
                    event.stopPropagation();
                    if (projectSpinner.consumeSuppressedClick()) return;
                    projectSpinner.activateIndex(index);
                  }}
                  className={`functional-circle flex h-full w-full flex-col items-center justify-center border bg-field-panel px-2 text-center text-field-text outline-none transition-[background-color,border-color] duration-[240ms] ease-out ${
                    isSelectedProject
                      ? "neon-selected-strong text-field-text"
                      : isActive
                      ? "neon-selected-strong text-field-text"
                      : "border-field-border hover:border-field-divider hover:bg-field-hover"
                  } focus-visible:ring-2 focus-visible:ring-field-primary focus-visible:ring-offset-2 focus-visible:ring-offset-field-bg`}
                  aria-label={`${project.name} ${pickerTitle}`}
                  aria-pressed={isActive || isSelectedProject}
                >
                  <span className="overflow-hidden text-[11px] font-bold leading-[1.4] text-field-text [display:-webkit-box] [-webkit-box-orient:vertical] [-webkit-line-clamp:2] md:text-xs">
                    <span className="font-display">{project.name}</span>
                  </span>
                  <span className={`mt-1 hidden max-w-full truncate text-[9px] md:block md:text-[10px] ${isActive || isSelectedProject ? "text-field-subtle" : "text-field-muted"}`}>
                    {project.accessRole === "progress" ? "Staff" : project.shareConfigured ? "Key staff" : "공유 설정 필요"}
                  </span>
                </button>
                <button
                  type="button"
                  onPointerDown={(event) => event.stopPropagation()}
                  onClick={(event) => {
                    event.stopPropagation();
                    requestProjectDismissal(project);
                  }}
                  className="absolute -right-1 -top-1 flex h-7 w-7 items-center justify-center text-field-muted transition-transform hover:scale-105 active:scale-90 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-field-primary"
                  aria-label={`${project.name} 목록에서 숨기기`}
                >
                  <span className="flex h-[22px] w-[22px] items-center justify-center border border-field-border bg-field-panel transition-colors hover:border-field-divider hover:bg-field-hover">
                    <X className="h-3 w-3" aria-hidden />
                  </span>
                </button>
              </div>
            </div>
          );
        })}
      </div>
    );
  }

  return (
    <div
      className="relative grid h-[100dvh] min-h-[100svh] w-full place-items-center overflow-hidden bg-transparent pt-[env(safe-area-inset-top)] pb-[env(safe-area-inset-bottom)]"
      onContextMenu={(event) => {
        event.preventDefault();
        closeRememberedProjectMenu();
      }}
    >
      <div ref={canvasRef} className="flex h-full w-full overflow-auto overscroll-contain px-4 py-6 [scrollbar-width:none] [-webkit-overflow-scrolling:touch] [&::-webkit-scrollbar]:hidden md:px-8">
        <div
          ref={compositionRef}
          className={`relative m-auto flex w-full items-center justify-center transition-[gap] duration-[360ms] ease-out ${
            isProjectRingOpen
              ? "max-w-[25rem] md:max-w-[36rem]"
              : isProgressMode
                ? "max-w-[24rem] flex-col gap-4"
                : pickerMode
                  ? "max-w-[42rem] flex-col gap-7 md:flex-row md:gap-12"
                  : "max-w-[24rem]"
          }`}
        >
          <div
            className={
              isProjectRingOpen
                ? "relative flex aspect-square w-[min(calc(100vw-2.5rem),25rem)] shrink-0 items-center justify-center motion-safe:animate-[project-ring-reveal_260ms_ease-out] md:w-[min(92vw,36rem)]"
                : "contents"
            }
          >
            {isProjectRingOpen ? renderProjectSpinner() : null}
            <div
              ref={wheelRef}
              role="group"
              tabIndex={0}
              aria-label="원형 기능 메뉴. 좌우 방향키 또는 드래그로 회전"
              aria-busy={isResolvingGo}
              className={`functional-circle relative z-20 aspect-square shrink-0 touch-none select-none outline-none cursor-grab active:cursor-grabbing transition-[width,opacity] duration-[360ms] ease-out focus-visible:ring-2 focus-visible:ring-field-primary focus-visible:ring-offset-4 focus-visible:ring-offset-field-bg ${
                isProjectRingOpen
                  ? "w-[46%] opacity-100 sm:w-[50%] md:w-[62%]"
                  : "w-[min(90vw,21rem)] md:w-[min(82vw,22rem)]"
              }`}
              {...mainSpinner.pointerHandlers}
              onClick={(event) => {
                if (event.target !== event.currentTarget) return;
                if (mainSpinner.consumeSuppressedClick()) return;
                closeProjectRing();
              }}
              onKeyDown={handleWheelKeyDown}
            >
              <div className="functional-circle pointer-events-none absolute inset-[15%] border border-field-border bg-field-panel/70" aria-hidden />
              <div className="functional-circle pointer-events-none absolute inset-[23%] border border-dashed border-field-secondary/40" aria-hidden />
              <div className="functional-circle pointer-events-none absolute left-1/2 top-1/2 h-7 w-7 -translate-x-1/2 -translate-y-1/2 border border-field-border bg-field-bg md:h-8 md:w-8" aria-hidden />
              <div
                ref={mainTargetRef}
                className={`neon-selected functional-circle pointer-events-none absolute top-1/2 -translate-x-1/2 -translate-y-1/2 border-2 ${
                  isProjectRingOpen
                    ? "left-[79%] h-16 w-16 md:h-[6.25rem] md:w-[6.25rem]"
                    : "left-[83%] h-[4.75rem] w-[4.75rem] md:h-[6.25rem] md:w-[6.25rem]"
                }`}
                aria-hidden
              />
              {wheelItems.map((item, index) => {
                const itemAngle = getSpinnerItemAngle(index, wheelItems.length) + mainSpinner.rotation;
                const isTargeted = activatedWheelItem === item.id;
                const isSelected = selectedMainId === item.id || pickerMode === item.id;
                const isEmphasized = isTargeted || isSelected;
                return (
                  <div
                    key={item.id}
                    ref={(element) => {
                      mainOrbitRefs.current[index] = element;
                    }}
                    className={`pointer-events-none absolute inset-0 will-change-transform ${
                      mainSpinner.isMoving
                        ? "transition-none"
                        : "transition-transform duration-[260ms] ease-out"
                    }`}
                    style={{
                      transform: `rotate(${itemAngle}deg)`,
                      zIndex: isEmphasized ? 20 : 10
                    }}
                  >
                    <div
                      ref={(element) => {
                        mainAnchorRefs.current[index] = element;
                      }}
                      className={`pointer-events-auto absolute top-1/2 will-change-transform ${
                        isProjectRingOpen ? "left-[79%]" : "left-[83%]"
                      } ${
                        mainSpinner.isMoving
                          ? "transition-none"
                          : "transition-transform duration-[260ms] ease-out"
                      }`}
                      style={{
                        transform: `translate(-50%, -50%) rotate(${-itemAngle}deg)`
                      }}
                    >
                      <button
                        ref={(element) => {
                          mainBubbleRefs.current[index] = element;
                        }}
                        type="button"
                        aria-label={item.ariaLabel}
                        aria-pressed={isTargeted || isSelected}
                        onClick={(event) => {
                          event.stopPropagation();
                          if (mainSpinner.consumeSuppressedClick()) return;
                          mainSpinner.activateIndex(index);
                        }}
                        className={`functional-circle flex items-center justify-center border px-2 text-center text-field-text outline-none transition-[transform,opacity,border-color,background-color] duration-[260ms] ease-out ${item.colorClass} ${
                          isProjectRingOpen
                            ? "h-14 w-14 md:h-20 md:w-20"
                            : "h-[4.25rem] w-[4.25rem] sm:h-24 sm:w-24"
                        } ${
                          isEmphasized
                            ? isProjectRingOpen
                              ? "neon-selected-strong z-20 scale-[0.86] !text-field-text opacity-100 md:scale-[0.94]"
                              : "neon-selected-strong z-20 scale-[0.94] !text-field-text opacity-100"
                            : isProjectRingOpen
                              ? "z-10 scale-[0.7] border-field-border opacity-55 hover:border-field-divider hover:opacity-75 md:scale-[0.82] md:opacity-70"
                              : "z-10 scale-[0.82] border-field-border opacity-70 hover:border-field-divider hover:opacity-90"
                        } active:scale-[0.9] focus-visible:ring-2 focus-visible:ring-field-primary focus-visible:ring-offset-2 focus-visible:ring-offset-field-bg`}
                      >
                        <span
                          className={`font-display-strong font-black leading-[1.2] transition-[font-size,font-weight,transform] duration-[240ms] ease-out ${
                            isEmphasized
                              ? isProjectRingOpen
                                ? "text-[11px] md:text-sm"
                                : "text-[15px] sm:text-lg"
                              : isProjectRingOpen
                                ? "text-[8px] md:text-[10px]"
                                : "text-[11px] sm:text-[13px]"
                          }`}
                        >
                          {item.label}
                        </span>
                      </button>
                    </div>
                  </div>
                );
              })}
            </div>
          </div>
          {isResolvingGo || (isProgressMode && isLoading) ? (
            <div className="pointer-events-none border border-field-border bg-field-panel px-4 py-2">
              <PixelDogLoader size="xs" compact />
            </div>
          ) : null}
          {isProgressMode && hasLoadedProjects && !isLoading && projects.length === 0 ? (
            <p className="pointer-events-none whitespace-nowrap border border-field-border bg-field-panel px-4 py-2 text-center text-[11px] text-field-muted">
              진행 볼 프로젝트가 없습니다
            </p>
          ) : null}

          {pickerMode && !isProgressMode ? (
          <>
          <div className="h-8 w-px shrink-0 bg-field-secondary/60 motion-safe:animate-[branch-reveal_220ms_ease-out] md:h-px md:w-12" aria-hidden />
          <div
            ref={clusterRef}
            role="region"
            aria-label={pickerTitle}
            className={`relative z-10 w-full shrink-0 motion-safe:animate-[branch-reveal_220ms_ease-out] ${
              pickerMode === "join" ? "max-w-[22rem] md:w-[20rem]" : "max-w-[20rem] md:w-[14rem]"
            }`}
          >
            <div className="mb-2 flex items-center justify-center gap-1.5">
              <h1 className="border border-field-border bg-field-panel px-3 py-1 text-[11px] font-bold text-field-text">
                <span className="font-display">{pickerTitle}</span>
              </h1>
            </div>
            {pickerMode === "new" ? (
              <form
                onSubmit={handleCreateProject}
                className="relative grid w-full gap-2 border border-field-border bg-field-panel p-3"
              >
                <button
                  type="button"
                  disabled={isCreatingProject}
                  onClick={(event) => {
                    event.stopPropagation();
                    closeInputSubmenu("new");
                  }}
                  className="absolute -right-2 -top-2 flex h-7 w-7 items-center justify-center text-field-muted transition-transform hover:scale-105 active:scale-90 disabled:cursor-not-allowed disabled:opacity-40 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-field-primary"
                  aria-label="새 프로젝트 입력 닫기"
                >
                  <span className="flex h-[22px] w-[22px] items-center justify-center border border-field-border bg-field-panel transition-colors hover:border-field-divider hover:bg-field-hover">
                    <X className="h-3 w-3" aria-hidden />
                  </span>
                </button>
                <input
                  value={newProjectName}
                  onChange={(event) => {
                    setNewProjectName(event.target.value);
                    if (newProjectError) setNewProjectError("");
                  }}
                  placeholder="프로젝트 이름"
                  aria-label="새 프로젝트 이름"
                  className="h-10 min-w-0 border border-field-border bg-field-input px-3 text-center text-xs text-field-text outline-none placeholder:text-field-muted focus:border-field-primary focus:ring-2 focus:ring-field-primary/30"
                />
                <input
                  type="password"
                  inputMode="numeric"
                  autoComplete="off"
                  value={adminPassword}
                  onChange={(event) => setAdminPassword(sanitizePasscode(event.target.value))}
                  placeholder="Key staff 비밀번호 4자리"
                  aria-label="Key staff 비밀번호"
                  className="h-10 min-w-0 border border-field-border bg-field-input px-3 text-center text-xs tracking-[0.25em] text-field-text outline-none placeholder:tracking-normal placeholder:text-field-muted focus:border-field-primary focus:ring-2 focus:ring-field-primary/30"
                />
                <input
                  type="password"
                  inputMode="numeric"
                  autoComplete="off"
                  value={progressPassword}
                  onChange={(event) => setProgressPassword(sanitizePasscode(event.target.value))}
                  placeholder="Staff 비밀번호 4자리"
                  aria-label="Staff 비밀번호"
                  className="h-10 min-w-0 border border-field-border bg-field-input px-3 text-center text-xs tracking-[0.25em] text-field-text outline-none placeholder:tracking-normal placeholder:text-field-muted focus:border-field-primary focus:ring-2 focus:ring-field-primary/30"
                />
                {newProjectError ? <p className="px-2 text-center text-[10px] font-bold leading-4 text-field-danger">{newProjectError}</p> : null}
                <button
                  type="submit"
                  disabled={isCreatingProject}
                  className="h-10 border border-field-primary bg-field-primary px-3 text-xs font-bold text-field-accent-foreground transition-[background-color,border-color,transform] hover:border-field-secondary hover:bg-field-secondary active:scale-[0.98] disabled:cursor-not-allowed disabled:opacity-50 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-field-primary focus-visible:ring-offset-2 focus-visible:ring-offset-field-bg"
                >
                  <span className="font-display">{isCreatingProject ? "만드는 중" : "만들기"}</span>
                </button>
              </form>
            ) : pickerMode === "join" ? (
              <form
                onSubmit={handleJoinProject}
                className="relative grid w-full gap-3 border border-field-border bg-field-panel p-3"
              >
                <button
                  type="button"
                  disabled={isCreatingProject || Boolean(selectedProjectId)}
                  onClick={(event) => {
                    event.stopPropagation();
                    closeInputSubmenu("join");
                  }}
                  className="absolute -right-2 -top-2 flex h-7 w-7 items-center justify-center text-field-muted transition-transform hover:scale-105 active:scale-90 disabled:cursor-not-allowed disabled:opacity-40 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-field-primary"
                  aria-label="프로젝트 참여 입력 닫기"
                >
                  <span className="flex h-[22px] w-[22px] items-center justify-center border border-field-border bg-field-panel transition-colors hover:border-field-divider hover:bg-field-hover">
                    <X className="h-3 w-3" aria-hidden />
                  </span>
                </button>
                <section className="grid gap-2" aria-labelledby="join-existing-project-title">
                  <p id="join-existing-project-title" className="px-1 text-[11px] font-black text-field-subtle">
                    기존 프로젝트 참여
                  </p>
                  <input
                    value={joinProjectName}
                    onChange={(event) => {
                      setJoinProjectName(event.target.value);
                      if (newProjectError) setNewProjectError("");
                    }}
                    placeholder="프로젝트 이름"
                    aria-label="참여할 프로젝트 이름"
                    className="h-10 min-w-0 border border-field-border bg-field-input px-3 text-center text-xs text-field-text outline-none placeholder:text-field-muted focus:border-field-primary focus:ring-2 focus:ring-field-primary/30"
                  />
                  <input
                    type="password"
                    inputMode="numeric"
                    autoComplete="off"
                    value={joinPassword}
                    onChange={(event) => setJoinPassword(sanitizePasscode(event.target.value))}
                    placeholder="비밀번호 4자리"
                    aria-label="프로젝트 참여 비밀번호"
                    className="h-10 min-w-0 border border-field-border bg-field-input px-3 text-center text-xs tracking-[0.25em] text-field-text outline-none placeholder:tracking-normal placeholder:text-field-muted focus:border-field-primary focus:ring-2 focus:ring-field-primary/30"
                  />
                  {newProjectError ? <p role="alert" className="px-2 text-center text-[10px] font-bold leading-4 text-field-danger">{newProjectError}</p> : null}
                  <button
                    type="submit"
                    disabled={isCreatingProject || Boolean(selectedProjectId)}
                    className="h-10 border border-field-primary bg-field-primary px-3 text-xs font-bold text-field-accent-foreground transition-[background-color,border-color,transform] hover:border-field-secondary hover:bg-field-secondary active:scale-[0.98] disabled:cursor-not-allowed disabled:opacity-50 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-field-primary focus-visible:ring-offset-2 focus-visible:ring-offset-field-bg"
                  >
                    <span className="font-display">{isCreatingProject ? "확인 중" : "참여"}</span>
                  </button>
                </section>

                <section className="grid gap-2 border-t border-field-border pt-3" aria-labelledby="joined-projects-title">
                  <p id="joined-projects-title" className="px-1 text-[11px] font-black text-field-subtle">
                    이전에 참여한 프로젝트
                  </p>
                  {isLoading ? (
                    <div className="flex min-h-10 items-center justify-center">
                      <PixelDogLoader size="xs" compact />
                    </div>
                  ) : errorMessage ? (
                    <p role="alert" className="px-1 text-center text-[10px] font-bold leading-4 text-field-danger">{errorMessage}</p>
                  ) : hasLoadedProjects && projects.length === 0 ? (
                    <p className="px-1 py-1 text-center text-[10px] font-bold text-field-muted">참여한 프로젝트가 없습니다.</p>
                  ) : (
                    <div className="grid max-h-44 gap-1.5 overflow-y-auto pr-0.5">
                      {projects.map((project) => {
                        const isOpening = selectedProjectId === project.id;
                        return (
                          <RememberedProjectCard
                            key={project.id}
                            project={project}
                            disabled={isCreatingProject || Boolean(selectedProjectId)}
                            isOpening={isOpening}
                            onOpen={(targetProject) => {
                              void openPreviouslyJoinedProject(targetProject);
                            }}
                            onOpenMenu={openRememberedProjectMenu}
                          />
                        );
                      })}
                    </div>
                  )}
                </section>
              </form>
            ) : null}
          </div>
          </>
        ) : null}
        {feedback ? (
          <p
            role="status"
            className={`absolute z-30 whitespace-nowrap border border-field-divider bg-field-elevated px-3 py-1.5 text-[11px] font-bold text-field-subtle ${
              feedback.target === "progress"
                ? "left-1/2 top-[calc(100%+0.5rem)] -translate-x-1/2"
                : "right-[calc(100%+0.5rem)] top-1/3"
            }`}
          >
            {feedback.message}
          </p>
        ) : null}
        </div>
      </div>
      <div ref={projectActionsRef} className="contents">
        <RememberedProjectActions
          menuTarget={rememberedProjectMenu}
          confirmationTarget={pendingProjectDismissal}
          onRequestRemoval={requestProjectDismissal}
          onCancelRemoval={cancelProjectDismissal}
          onConfirmRemoval={confirmProjectDismissal}
        />
      </div>
      <style jsx global>{`
        @keyframes branch-reveal {
          from { opacity: 0; transform: scale(0.98); }
          to { opacity: 1; transform: scale(1); }
        }
        @keyframes project-ring-reveal {
          from { opacity: 0; transform: scale(0.96); }
          to { opacity: 1; transform: scale(1); }
        }
        @keyframes project-target-confirm {
          0% { transform: scale(1.1); }
          55% { transform: scale(1.25); }
          100% { transform: scale(1.18); }
        }
      `}</style>
    </div>
  );
}
