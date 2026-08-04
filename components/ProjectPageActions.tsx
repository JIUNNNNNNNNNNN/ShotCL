"use client";

import {
  createContext,
  useCallback,
  useContext,
  useLayoutEffect,
  useMemo,
  useRef,
  useState
} from "react";
import {
  CalendarDays,
  Clapperboard,
  Map,
  Plus,
  Printer,
  Save,
  type LucideIcon
} from "lucide-react";

export type ProjectPageActionMenuKey = "dailyPlan" | "archive" | "progressDetail";

export type ProjectPageActionId =
  | "dailyPlanPdf"
  | "dailyPlanSave"
  | "dailyPlanRounds"
  | "archiveDiagram"
  | "archiveStoryboard"
  | "progressRounds"
  | "progressAddCut";

export type ProjectPageActionOverride = {
  href?: string;
  onSelect?: () => void;
  active?: boolean;
  disabled?: boolean;
  pending?: boolean;
  hidden?: boolean;
};

export type ProjectPageActionMenuRegistration = {
  key: ProjectPageActionMenuKey;
  scopeKey: string;
  actions: Partial<Record<ProjectPageActionId, ProjectPageActionOverride>>;
};

export type ResolvedProjectPageAction = ProjectPageActionOverride & {
  id: ProjectPageActionId;
  label: string;
  icon: LucideIcon;
};

export type ResolvedProjectPageActionMenu = {
  key: ProjectPageActionMenuKey;
  scopeKey: string;
  title: string;
  ariaLabel: string;
  actions: ResolvedProjectPageAction[];
};

type ActionDefinition = {
  label: string;
  icon: LucideIcon;
};

type MenuDefinition = {
  title: string;
  ariaLabel: string;
  actionIds: ProjectPageActionId[];
};

const ACTION_DEFINITIONS: Record<ProjectPageActionId, ActionDefinition> = {
  dailyPlanPdf: { label: "PDF 저장", icon: Printer },
  dailyPlanSave: { label: "일촬표 저장", icon: Save },
  dailyPlanRounds: { label: "회차 선택", icon: CalendarDays },
  archiveDiagram: { label: "부감도", icon: Map },
  archiveStoryboard: { label: "콘티", icon: Clapperboard },
  progressRounds: { label: "회차 선택", icon: CalendarDays },
  progressAddCut: { label: "새 컷 추가", icon: Plus }
};

const MENU_DEFINITIONS: Record<ProjectPageActionMenuKey, MenuDefinition> = {
  dailyPlan: {
    title: "일촬표 작업",
    ariaLabel: "일촬표 작업 메뉴",
    actionIds: ["dailyPlanPdf", "dailyPlanSave", "dailyPlanRounds"]
  },
  archive: {
    title: "자료 유형",
    ariaLabel: "부감도 및 콘티 유형 메뉴",
    actionIds: ["archiveDiagram", "archiveStoryboard"]
  },
  progressDetail: {
    title: "진행도 작업",
    ariaLabel: "진행도 작업 메뉴",
    actionIds: ["progressRounds", "progressAddCut"]
  }
};

type ActiveRegistration = {
  token: number;
  registration: ProjectPageActionMenuRegistration;
};

type RegisterProjectPageActionMenu = (
  registration: ProjectPageActionMenuRegistration
) => () => void;

const ProjectPageActionRegistrationContext = createContext<RegisterProjectPageActionMenu | null>(null);
const ProjectPageActionMenuContext = createContext<ResolvedProjectPageActionMenu | null>(null);

export function ProjectPageActionsProvider({ children }: { children: React.ReactNode }) {
  const tokenRef = useRef(0);
  const [activeRegistration, setActiveRegistration] = useState<ActiveRegistration | null>(null);

  const register = useCallback<RegisterProjectPageActionMenu>((registration) => {
    const token = tokenRef.current + 1;
    tokenRef.current = token;
    setActiveRegistration({ token, registration });

    return () => {
      setActiveRegistration((current) => current?.token === token ? null : current);
    };
  }, []);

  const menu = useMemo<ResolvedProjectPageActionMenu | null>(() => {
    if (!activeRegistration) return null;
    const { registration } = activeRegistration;
    const definition = MENU_DEFINITIONS[registration.key];
    const actions = definition.actionIds.flatMap<ResolvedProjectPageAction>((id) => {
      const override = registration.actions[id];
      if (!override || override.hidden) return [];
      return [{
        ...ACTION_DEFINITIONS[id],
        ...override,
        id,
        disabled: Boolean(override.disabled || override.pending)
      }];
    });
    if (actions.length === 0) return null;
    return {
      key: registration.key,
      scopeKey: registration.scopeKey,
      title: definition.title,
      ariaLabel: definition.ariaLabel,
      actions
    };
  }, [activeRegistration]);

  return (
    <ProjectPageActionRegistrationContext.Provider value={register}>
      <ProjectPageActionMenuContext.Provider value={menu}>
        {children}
      </ProjectPageActionMenuContext.Provider>
    </ProjectPageActionRegistrationContext.Provider>
  );
}

export function useProjectPageActionMenu(
  registration: ProjectPageActionMenuRegistration | null
) {
  const register = useContext(ProjectPageActionRegistrationContext);
  if (!register) {
    throw new Error("useProjectPageActionMenu must be used inside ProjectPageActionsProvider.");
  }

  useLayoutEffect(() => {
    if (!registration) return undefined;
    return register(registration);
  }, [register, registration]);
}

export function useCurrentProjectPageActionMenu() {
  return useContext(ProjectPageActionMenuContext);
}
