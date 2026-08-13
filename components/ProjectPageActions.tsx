import {
  Clapperboard,
  Download,
  FileText,
  List,
  Map,
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

export type ProjectPageActionGroup = "view" | "document" | "manage";
export type ProjectPageActionTone = "default" | "danger";

export type ProjectPageActionId =
  | "dailyPlanPdf"
  | "dailyPlanPortraitPdf"
  | "dailyPlanSave"
  | "archiveDiagram"
  | "archiveStoryboard"
  | "progressAddCut"
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
    actionIds: ["progressAddCut"]
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

/** Resolve page-owned actions without registering them in the project shell. */
export function resolveProjectPageActionMenu(
  registration: ProjectPageActionMenuRegistration | null
): ResolvedProjectPageActionMenu | null {
  if (!registration) return null;
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
}
