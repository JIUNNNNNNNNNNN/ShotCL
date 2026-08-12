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
  Clapperboard,
  Download,
  FileText,
  ImagePlus,
  Images,
  List,
  Map,
  MapPin,
  Pencil,
  Plus,
  Printer,
  RefreshCw,
  Save,
  Share2,
  Trash2,
  type LucideIcon
} from "lucide-react";

export type ProjectPageActionMenuKey = "dailyPlan" | "archive" | "progressDetail" | "scenario";

export type ProjectPageActionGroup = "view" | "document" | "manage" | "gatheringPlace";
export type ProjectPageActionTone = "default" | "danger";

export type ProjectPageActionId =
  | "dailyPlanPdf"
  | "dailyPlanPortraitPdf"
  | "dailyPlanSave"
  | "archiveDiagram"
  | "archiveStoryboard"
  | "progressAddCut"
  | "progressGatheringPhotoAdd"
  | "progressGatheringPhotoManage"
  | "progressGatheringAddressEdit"
  | "scenarioScenesView"
  | "scenarioFullView"
  | "scenarioEdit"
  | "scenarioShare"
  | "scenarioDownload"
  | "scenarioRefresh"
  | "scenarioDelete";

export type ProjectPageActionOverride = {
  label?: string;
  href?: string;
  onSelect?: () => void;
  active?: boolean;
  disabled?: boolean;
  pending?: boolean;
  hidden?: boolean;
  /** Keep an action in the persistent panel while omitting a duplicate compact-drawer entry. */
  hiddenInDrawer?: boolean;
  closeDrawerOnSelect?: boolean;
  emphasis?: "primary" | "secondary";
  group?: ProjectPageActionGroup;
  tone?: ProjectPageActionTone;
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
  emphasis?: "primary" | "secondary";
  group?: ProjectPageActionGroup;
  tone?: ProjectPageActionTone;
};

type MenuDefinition = {
  title: string;
  ariaLabel: string;
  actionIds: ProjectPageActionId[];
};

const ACTION_DEFINITIONS: Record<ProjectPageActionId, ActionDefinition> = {
  dailyPlanPdf: { label: "PDF 저장", icon: Printer },
  dailyPlanPortraitPdf: { label: "모바일용 PDF", icon: Printer },
  dailyPlanSave: { label: "일촬표 저장", icon: Save, emphasis: "primary" },
  archiveDiagram: { label: "부감도", icon: Map },
  archiveStoryboard: { label: "콘티", icon: Clapperboard },
  progressAddCut: { label: "새 컷 추가", icon: Plus, emphasis: "primary" },
  progressGatheringPhotoAdd: { label: "사진 추가", icon: ImagePlus, group: "gatheringPlace" },
  progressGatheringPhotoManage: { label: "사진 관리", icon: Images, group: "gatheringPlace" },
  progressGatheringAddressEdit: { label: "주소 수정", icon: MapPin, group: "gatheringPlace" },
  scenarioScenesView: { label: "씬별 보기", icon: List, group: "view" },
  scenarioFullView: { label: "전체 보기", icon: FileText, group: "view" },
  scenarioEdit: { label: "편집", icon: Pencil, group: "document" },
  scenarioShare: { label: "공유", icon: Share2, group: "document" },
  scenarioDownload: { label: "다운로드", icon: Download, group: "document" },
  scenarioRefresh: { label: "새로고침", icon: RefreshCw, group: "document" },
  scenarioDelete: { label: "삭제", icon: Trash2, group: "manage", tone: "danger" }
};

const MENU_DEFINITIONS: Record<ProjectPageActionMenuKey, MenuDefinition> = {
  dailyPlan: {
    title: "일촬표 작업",
    ariaLabel: "일촬표 작업 메뉴",
    actionIds: ["dailyPlanPdf", "dailyPlanPortraitPdf", "dailyPlanSave"]
  },
  archive: {
    title: "자료 유형",
    ariaLabel: "부감도 및 콘티 유형 메뉴",
    actionIds: ["archiveDiagram", "archiveStoryboard"]
  },
  progressDetail: {
    title: "진행도 작업",
    ariaLabel: "진행도 작업 메뉴",
    actionIds: [
      "progressAddCut",
      "progressGatheringPhotoAdd",
      "progressGatheringPhotoManage",
      "progressGatheringAddressEdit"
    ]
  },
  scenario: {
    title: "시나리오 작업",
    ariaLabel: "시나리오 작업 메뉴",
    actionIds: [
      "scenarioScenesView",
      "scenarioFullView",
      "scenarioEdit",
      "scenarioShare",
      "scenarioDownload",
      "scenarioRefresh",
      "scenarioDelete"
    ]
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
