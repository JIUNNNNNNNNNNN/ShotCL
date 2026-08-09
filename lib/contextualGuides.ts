import type { SharedProjectRole } from "@/lib/projectAccess/core";

export type ContextualGuidePage =
  | "home"
  | "basicInfo"
  | "dailyPlan"
  | "progress"
  | "sceneList"
  | "staff"
  | "scenario"
  | "wardrobe"
  | "archive";

export type ContextualGuideId =
  | "home.intro"
  | "home.calendar-create"
  | "home.calendar-range"
  | "home.invite-staff"
  | "basic-info.intro"
  | "daily-plan.intro"
  | "daily-plan.round-select"
  | "daily-plan.pdf"
  | "progress.intro"
  | "progress.status"
  | "scene-list.desktop-intro"
  | "scene-list.mobile-intro"
  | "staff.intro"
  | "staff.participation"
  | "staff.participation-summary"
  | "scenario.intro"
  | "scenario.actions"
  | "wardrobe.intro"
  | "archive.intro"
  | "archive.upload"
  | "archive.selection.desktop"
  | "archive.selection.mobile"
  | "archive.folder-upload";

export type ContextualGuideAnchorKey =
  | "home.calendar-grid"
  | "home.invite-action"
  | "basic-info.form"
  | "shell.navigation.daily-plans"
  | "shell.navigation-toggle"
  | "daily-plan.pdf-actions"
  | "shell.action-toggle"
  | "progress.cut-list"
  | "progress.status-controls"
  | "scene-list.desktop"
  | "scene-list.mobile"
  | "staff.main"
  | "staff.participation"
  | "scenario.actions"
  | "wardrobe.main"
  | "archive.upload"
  | "archive.selection"
  | "archive.folder-upload";

export type ContextualGuidePlacement = "auto" | "left" | "right" | "top" | "bottom";

type ContextualGuideDefinitionBase = {
  id: ContextualGuideId;
  version: number;
  page: ContextualGuidePage;
  trigger: "page" | "feature";
  priority: number;
  title: string;
  description: string;
  readOnlyDescription?: string;
  compactDescription?: string;
  permission: "any" | "manage" | "admin";
  capability?: "fine-pointer" | "touch";
  replayLabel: string;
};

export type ContextualGuideDefinition = ContextualGuideDefinitionBase & (
  | {
      type: "page";
      persistentAnchor?: never;
      compactAnchor?: never;
      preferredPlacement?: never;
    }
  | {
      type: "anchor";
      persistentAnchor: ContextualGuideAnchorKey;
      compactAnchor: ContextualGuideAnchorKey;
      preferredPlacement?: ContextualGuidePlacement;
    }
);

export const CONTEXTUAL_GUIDES: Record<ContextualGuideId, ContextualGuideDefinition> = {
  "home.intro": {
    id: "home.intro",
    version: 1,
    page: "home",
    type: "page",
    trigger: "page",
    priority: 50,
    title: "프로젝트 Home",
    description: "촬영 일정과 프로젝트 현황을 한눈에 확인할 수 있습니다.",
    permission: "any",
    replayLabel: "프로젝트 Home"
  },
  "home.calendar-create": {
    id: "home.calendar-create",
    version: 1,
    page: "home",
    type: "anchor",
    trigger: "feature",
    priority: 100,
    title: "일정 추가",
    description: "날짜를 누르거나 드래그해 일정을 만들 수 있습니다.",
    compactDescription: "날짜를 눌러 일정을 만들 수 있습니다.",
    persistentAnchor: "home.calendar-grid",
    compactAnchor: "home.calendar-grid",
    preferredPlacement: "bottom",
    permission: "manage",
    replayLabel: "일정 추가"
  },
  "home.calendar-range": {
    id: "home.calendar-range",
    version: 1,
    page: "home",
    type: "anchor",
    trigger: "feature",
    priority: 100,
    title: "기간 일정",
    description: "시작일부터 종료일까지 드래그하면 여러 날짜를 한 번에 선택할 수 있습니다.",
    persistentAnchor: "home.calendar-grid",
    compactAnchor: "home.calendar-grid",
    preferredPlacement: "bottom",
    permission: "manage",
    capability: "fine-pointer",
    replayLabel: "기간 일정"
  },
  "home.invite-staff": {
    id: "home.invite-staff",
    version: 1,
    page: "home",
    type: "anchor",
    trigger: "feature",
    priority: 100,
    title: "스탭 초대",
    description: "카카오톡으로 초대 링크를 바로 복사할 수 있습니다.",
    persistentAnchor: "home.invite-action",
    compactAnchor: "home.invite-action",
    preferredPlacement: "left",
    permission: "admin",
    replayLabel: "스탭 초대"
  },
  "basic-info.intro": {
    id: "basic-info.intro",
    version: 1,
    page: "basicInfo",
    type: "page",
    trigger: "page",
    priority: 50,
    title: "기본정보",
    description: "프로젝트와 촬영에 필요한 기본 정보를 관리합니다.",
    permission: "manage",
    replayLabel: "기본정보 입력"
  },
  "daily-plan.intro": {
    id: "daily-plan.intro",
    version: 1,
    page: "dailyPlan",
    type: "page",
    trigger: "page",
    priority: 50,
    title: "일촬표",
    description: "회차별 촬영 일정과 인원 정보를 확인하고 관리합니다.",
    permission: "manage",
    replayLabel: "일촬표 메뉴"
  },
  "daily-plan.pdf": {
    id: "daily-plan.pdf",
    version: 1,
    page: "dailyPlan",
    type: "anchor",
    trigger: "feature",
    priority: 100,
    title: "PDF 저장",
    description: "기본 또는 세로형 PDF로 저장할 수 있습니다.",
    persistentAnchor: "daily-plan.pdf-actions",
    compactAnchor: "shell.action-toggle",
    preferredPlacement: "left",
    permission: "manage",
    replayLabel: "PDF 저장"
  },
  "daily-plan.round-select": {
    id: "daily-plan.round-select",
    version: 1,
    page: "dailyPlan",
    type: "anchor",
    trigger: "feature",
    priority: 100,
    title: "회차 선택",
    description: "일촬표를 확인하거나 편집할 촬영 회차를 선택합니다.",
    persistentAnchor: "shell.navigation.daily-plans",
    compactAnchor: "shell.navigation-toggle",
    preferredPlacement: "right",
    permission: "manage",
    replayLabel: "일촬표 회차 선택"
  },
  "progress.intro": {
    id: "progress.intro",
    version: 1,
    page: "progress",
    type: "page",
    trigger: "page",
    priority: 50,
    title: "진행도",
    description: "현재 촬영 중인 컷과 완료 상태를 확인합니다.",
    permission: "any",
    replayLabel: "진행도 보기"
  },
  "progress.status": {
    id: "progress.status",
    version: 1,
    page: "progress",
    type: "anchor",
    trigger: "feature",
    priority: 100,
    title: "컷 상태",
    description: "촬영 상황에 맞게 상태를 변경하면 프로젝트 구성원에게 반영됩니다.",
    persistentAnchor: "progress.status-controls",
    compactAnchor: "progress.status-controls",
    preferredPlacement: "left",
    permission: "any",
    replayLabel: "컷 상태"
  },
  "scene-list.desktop-intro": {
    id: "scene-list.desktop-intro",
    version: 1,
    page: "sceneList",
    type: "page",
    trigger: "page",
    priority: 50,
    title: "씬리스트",
    description: "씬별 촬영 정보를 한눈에 확인할 수 있습니다.",
    permission: "manage",
    replayLabel: "씬리스트 편집"
  },
  "scene-list.mobile-intro": {
    id: "scene-list.mobile-intro",
    version: 1,
    page: "sceneList",
    type: "page",
    trigger: "page",
    priority: 50,
    title: "씬리스트",
    description: "씬별 촬영 정보를 한눈에 확인할 수 있습니다.",
    permission: "any",
    replayLabel: "모바일 씬 확인"
  },
  "staff.intro": {
    id: "staff.intro",
    version: 1,
    page: "staff",
    type: "page",
    trigger: "page",
    priority: 50,
    title: "스탭리스트",
    description: "스탭 정보와 회차별 참여 여부를 관리합니다.",
    readOnlyDescription: "스탭 정보와 회차별 참여 여부를 확인할 수 있습니다.",
    permission: "any",
    replayLabel: "스탭 관리"
  },
  "staff.participation": {
    id: "staff.participation",
    version: 1,
    page: "staff",
    type: "anchor",
    trigger: "feature",
    priority: 100,
    title: "참여 회차",
    description: "번호를 눌러 해당 스탭의 촬영 참여 여부를 변경합니다.",
    persistentAnchor: "staff.participation",
    compactAnchor: "staff.participation",
    preferredPlacement: "top",
    permission: "manage",
    replayLabel: "참여 회차"
  },
  "staff.participation-summary": {
    id: "staff.participation-summary",
    version: 1,
    page: "staff",
    type: "anchor",
    trigger: "feature",
    priority: 100,
    title: "참여 회차 보기",
    description: "참여 요약을 누르면 전체 회차를 확인하고 수정할 수 있습니다.",
    persistentAnchor: "staff.participation",
    compactAnchor: "staff.participation",
    preferredPlacement: "top",
    permission: "manage",
    replayLabel: "참여 회차 요약"
  },
  "scenario.intro": {
    id: "scenario.intro",
    version: 1,
    page: "scenario",
    type: "page",
    trigger: "page",
    priority: 50,
    title: "시나리오",
    description: "시나리오를 씬별 또는 전체 형태로 확인할 수 있습니다.",
    permission: "any",
    replayLabel: "시나리오"
  },
  "scenario.actions": {
    id: "scenario.actions",
    version: 1,
    page: "scenario",
    type: "anchor",
    trigger: "feature",
    priority: 100,
    title: "시나리오 기능",
    description: "씬별 보기, 편집과 공유 기능을 사용할 수 있습니다.",
    compactDescription: "메뉴를 열어 보기와 공유 기능을 사용할 수 있습니다.",
    persistentAnchor: "scenario.actions",
    compactAnchor: "shell.action-toggle",
    preferredPlacement: "left",
    permission: "any",
    replayLabel: "시나리오 메뉴"
  },
  "wardrobe.intro": {
    id: "wardrobe.intro",
    version: 1,
    page: "wardrobe",
    type: "page",
    trigger: "page",
    priority: 50,
    title: "의상 자료",
    description: "씬별 의상 사진과 정보를 여기에서 확인할 수 있습니다.",
    permission: "any",
    replayLabel: "의상 자료"
  },
  "archive.intro": {
    id: "archive.intro",
    version: 1,
    page: "archive",
    type: "page",
    trigger: "page",
    priority: 50,
    title: "부감도 & 콘티",
    description: "촬영 자료를 씬과 컷별로 정리하고 확인할 수 있습니다.",
    permission: "any",
    replayLabel: "부감도 & 콘티"
  },
  "archive.upload": {
    id: "archive.upload",
    version: 1,
    page: "archive",
    type: "anchor",
    trigger: "feature",
    priority: 100,
    title: "자료 업로드",
    description: "이미지·PDF 또는 폴더 전체를 올릴 수 있습니다.",
    persistentAnchor: "archive.upload",
    compactAnchor: "archive.upload",
    preferredPlacement: "bottom",
    permission: "manage",
    replayLabel: "자료 추가"
  },
  "archive.selection.desktop": {
    id: "archive.selection.desktop",
    version: 1,
    page: "archive",
    type: "anchor",
    trigger: "feature",
    priority: 100,
    title: "여러 장 선택",
    description: "Shift 범위 선택 · ⌘ / Ctrl 개별 선택",
    persistentAnchor: "archive.selection",
    compactAnchor: "archive.selection",
    preferredPlacement: "top",
    permission: "any",
    capability: "fine-pointer",
    replayLabel: "여러 장 선택"
  },
  "archive.selection.mobile": {
    id: "archive.selection.mobile",
    version: 1,
    page: "archive",
    type: "anchor",
    trigger: "feature",
    priority: 100,
    title: "여러 장 선택",
    description: "항목을 눌러 여러 장을 선택하거나 해제할 수 있습니다.",
    persistentAnchor: "archive.selection",
    compactAnchor: "archive.selection",
    preferredPlacement: "top",
    permission: "any",
    capability: "touch",
    replayLabel: "모바일 여러 장 선택"
  },
  "archive.folder-upload": {
    id: "archive.folder-upload",
    version: 1,
    page: "archive",
    type: "anchor",
    trigger: "feature",
    priority: 100,
    title: "폴더 업로드",
    description: "하위 폴더의 이미지와 PDF도 자동으로 가져옵니다.",
    persistentAnchor: "archive.folder-upload",
    compactAnchor: "archive.folder-upload",
    preferredPlacement: "bottom",
    permission: "manage",
    replayLabel: "폴더 업로드"
  }
};

const PAGE_GUIDES: Record<ContextualGuidePage, ContextualGuideId[]> = {
  home: ["home.intro", "home.calendar-create", "home.calendar-range", "home.invite-staff"],
  basicInfo: ["basic-info.intro"],
  dailyPlan: ["daily-plan.intro", "daily-plan.round-select", "daily-plan.pdf"],
  progress: ["progress.intro", "progress.status"],
  sceneList: ["scene-list.desktop-intro", "scene-list.mobile-intro"],
  staff: ["staff.intro", "staff.participation", "staff.participation-summary"],
  scenario: ["scenario.intro", "scenario.actions"],
  wardrobe: ["wardrobe.intro"],
  archive: [
    "archive.intro",
    "archive.upload",
    "archive.selection.desktop",
    "archive.selection.mobile",
    "archive.folder-upload"
  ]
};

export function getGuidePage(pathname: string, searchParams: Pick<URLSearchParams, "get">) {
  if (/^\/projects\/[^/]+\/?$/u.test(pathname)) {
    return searchParams.get("view") === "progress" || Boolean(searchParams.get("dailyPlanId"))
      ? "progress"
      : "home";
  }
  if (/\/basic-info\/?$/u.test(pathname)) return "basicInfo";
  if (/\/daily-plans(?:\/|$)/u.test(pathname)) return "dailyPlan";
  if (/\/scene-list\/?$/u.test(pathname)) return "sceneList";
  if (/\/staff-list\/?$/u.test(pathname)) return "staff";
  if (/\/scenario\/?$/u.test(pathname)) return "scenario";
  if (/\/costumes\/?$/u.test(pathname)) return "wardrobe";
  if (/\/storyboard-overhead\/?$/u.test(pathname)) return "archive";
  return null;
}

export function getGuideIdsForPage(page: ContextualGuidePage | null) {
  return page ? PAGE_GUIDES[page] : [];
}

export function getGuideStorageToken(id: ContextualGuideId) {
  const guide = CONTEXTUAL_GUIDES[id];
  return `${guide.id}@${guide.version}`;
}

export function canUseGuide(definition: ContextualGuideDefinition, role: SharedProjectRole | null) {
  if (definition.permission === "admin") return role === "admin";
  if (definition.permission === "manage") return role !== "progress";
  return true;
}
