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
  | "home.calendar-create"
  | "home.calendar-range"
  | "home.invite-staff"
  | "basic-info.intro"
  | "daily-plan.intro"
  | "daily-plan.pdf"
  | "progress.intro"
  | "progress.status"
  | "scene-list.desktop-intro"
  | "scene-list.mobile-intro"
  | "staff.intro"
  | "staff.participation"
  | "staff.participation-summary"
  | "scenario.actions"
  | "wardrobe.intro"
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

export type ContextualGuideDefinition = {
  id: ContextualGuideId;
  version: number;
  page: ContextualGuidePage;
  trigger: "page" | "feature";
  priority: number;
  title: string;
  description: string;
  readOnlyDescription?: string;
  compactDescription?: string;
  persistentAnchor: ContextualGuideAnchorKey;
  compactAnchor: ContextualGuideAnchorKey;
  permission: "any" | "manage" | "admin";
  capability?: "fine-pointer" | "touch";
  replayLabel: string;
};

export const CONTEXTUAL_GUIDES: Record<ContextualGuideId, ContextualGuideDefinition> = {
  "home.calendar-create": {
    id: "home.calendar-create",
    version: 1,
    page: "home",
    trigger: "page",
    priority: 50,
    title: "일정 추가",
    description: "날짜를 클릭해 일정을 추가하세요. 여러 날짜는 드래그해서 기간으로 선택할 수 있습니다.",
    compactDescription: "날짜를 눌러 일정을 추가하세요.",
    persistentAnchor: "home.calendar-grid",
    compactAnchor: "home.calendar-grid",
    permission: "manage",
    replayLabel: "일정 추가"
  },
  "home.calendar-range": {
    id: "home.calendar-range",
    version: 1,
    page: "home",
    trigger: "feature",
    priority: 100,
    title: "기간 일정",
    description: "시작일부터 종료일까지 드래그하면 여러 날짜를 한 번에 선택할 수 있습니다.",
    persistentAnchor: "home.calendar-grid",
    compactAnchor: "home.calendar-grid",
    permission: "manage",
    capability: "fine-pointer",
    replayLabel: "기간 일정"
  },
  "home.invite-staff": {
    id: "home.invite-staff",
    version: 1,
    page: "home",
    trigger: "feature",
    priority: 100,
    title: "스탭 초대",
    description: "카카오톡으로 복사하면 프로젝트 이름과 초대 링크를 바로 전달할 수 있습니다.",
    persistentAnchor: "home.invite-action",
    compactAnchor: "home.invite-action",
    permission: "admin",
    replayLabel: "스탭 초대"
  },
  "basic-info.intro": {
    id: "basic-info.intro",
    version: 1,
    page: "basicInfo",
    trigger: "page",
    priority: 50,
    title: "프로젝트 기본정보",
    description: "촬영 기간과 프로젝트 정보를 입력한 뒤 저장하세요.",
    persistentAnchor: "basic-info.form",
    compactAnchor: "basic-info.form",
    permission: "manage",
    replayLabel: "기본정보 입력"
  },
  "daily-plan.intro": {
    id: "daily-plan.intro",
    version: 1,
    page: "dailyPlan",
    trigger: "page",
    priority: 50,
    title: "회차별 일촬표",
    description: "왼쪽 메뉴에서 촬영 회차를 선택하고 일촬표를 확인할 수 있습니다. 저장과 PDF 기능은 오른쪽 메뉴에서 사용할 수 있습니다.",
    compactDescription: "메뉴에서 촬영 회차를 선택할 수 있습니다. 저장과 PDF 기능은 오른쪽 메뉴에서 사용할 수 있습니다.",
    persistentAnchor: "shell.navigation.daily-plans",
    compactAnchor: "shell.navigation-toggle",
    permission: "manage",
    replayLabel: "일촬표 메뉴"
  },
  "daily-plan.pdf": {
    id: "daily-plan.pdf",
    version: 1,
    page: "dailyPlan",
    trigger: "feature",
    priority: 100,
    title: "PDF 저장",
    description: "기본 PDF와 세로형 PDF를 필요에 맞게 선택할 수 있습니다.",
    persistentAnchor: "daily-plan.pdf-actions",
    compactAnchor: "shell.action-toggle",
    permission: "manage",
    replayLabel: "PDF 저장"
  },
  "progress.intro": {
    id: "progress.intro",
    version: 1,
    page: "progress",
    trigger: "page",
    priority: 50,
    title: "촬영 진행도",
    description: "컷별 촬영 상태를 현장에서 바로 확인하고 변경할 수 있습니다.",
    persistentAnchor: "progress.cut-list",
    compactAnchor: "progress.cut-list",
    permission: "any",
    replayLabel: "진행도 보기"
  },
  "progress.status": {
    id: "progress.status",
    version: 1,
    page: "progress",
    trigger: "feature",
    priority: 100,
    title: "컷 상태",
    description: "촬영 상황에 맞게 상태를 변경하면 프로젝트 구성원에게 반영됩니다.",
    persistentAnchor: "progress.status-controls",
    compactAnchor: "progress.status-controls",
    permission: "any",
    replayLabel: "컷 상태"
  },
  "scene-list.desktop-intro": {
    id: "scene-list.desktop-intro",
    version: 1,
    page: "sceneList",
    trigger: "page",
    priority: 50,
    title: "씬리스트 편집",
    description: "셀을 선택해 수정하고 여러 셀을 드래그해서 선택할 수 있습니다.",
    persistentAnchor: "scene-list.desktop",
    compactAnchor: "scene-list.desktop",
    permission: "manage",
    replayLabel: "씬리스트 편집"
  },
  "scene-list.mobile-intro": {
    id: "scene-list.mobile-intro",
    version: 1,
    page: "sceneList",
    trigger: "page",
    priority: 50,
    title: "씬 확인하기",
    description: "각 씬을 눌러 상세 내용을 펼쳐볼 수 있습니다.",
    persistentAnchor: "scene-list.mobile",
    compactAnchor: "scene-list.mobile",
    permission: "any",
    replayLabel: "모바일 씬 확인"
  },
  "staff.intro": {
    id: "staff.intro",
    version: 1,
    page: "staff",
    trigger: "page",
    priority: 50,
    title: "스탭 관리",
    description: "스탭 정보와 촬영 회차별 참여 여부를 확인할 수 있습니다.",
    readOnlyDescription: "스탭 정보와 촬영 회차별 참여 여부를 확인할 수 있습니다.",
    persistentAnchor: "staff.main",
    compactAnchor: "staff.main",
    permission: "any",
    replayLabel: "스탭 관리"
  },
  "staff.participation": {
    id: "staff.participation",
    version: 1,
    page: "staff",
    trigger: "feature",
    priority: 100,
    title: "참여 회차",
    description: "번호를 눌러 해당 스탭의 촬영 참여 여부를 변경합니다.",
    persistentAnchor: "staff.participation",
    compactAnchor: "staff.participation",
    permission: "manage",
    replayLabel: "참여 회차"
  },
  "staff.participation-summary": {
    id: "staff.participation-summary",
    version: 1,
    page: "staff",
    trigger: "feature",
    priority: 100,
    title: "참여 회차 보기",
    description: "참여 요약을 누르면 전체 회차를 확인하고 수정할 수 있습니다.",
    persistentAnchor: "staff.participation",
    compactAnchor: "staff.participation",
    permission: "manage",
    replayLabel: "참여 회차 요약"
  },
  "scenario.actions": {
    id: "scenario.actions",
    version: 1,
    page: "scenario",
    trigger: "page",
    priority: 50,
    title: "시나리오 보기",
    description: "오른쪽 메뉴에서 씬별 보기, 전체 보기, 편집과 공유 기능을 사용할 수 있습니다.",
    compactDescription: "오른쪽 메뉴를 열어 보기 방식과 공유 기능을 사용할 수 있습니다.",
    persistentAnchor: "scenario.actions",
    compactAnchor: "shell.action-toggle",
    permission: "any",
    replayLabel: "시나리오 메뉴"
  },
  "wardrobe.intro": {
    id: "wardrobe.intro",
    version: 1,
    page: "wardrobe",
    trigger: "page",
    priority: 50,
    title: "의상 자료",
    description: "씬별 의상 사진과 정보를 여기에서 확인할 수 있습니다.",
    persistentAnchor: "wardrobe.main",
    compactAnchor: "wardrobe.main",
    permission: "any",
    replayLabel: "의상 자료"
  },
  "archive.upload": {
    id: "archive.upload",
    version: 1,
    page: "archive",
    trigger: "page",
    priority: 50,
    title: "자료 추가",
    description: "이미지와 PDF뿐 아니라 폴더 전체도 업로드할 수 있습니다. 하위 폴더의 파일도 자동으로 가져옵니다.",
    persistentAnchor: "archive.upload",
    compactAnchor: "archive.upload",
    permission: "manage",
    replayLabel: "자료 추가"
  },
  "archive.selection.desktop": {
    id: "archive.selection.desktop",
    version: 1,
    page: "archive",
    trigger: "feature",
    priority: 100,
    title: "여러 장 선택",
    description: "Shift 범위 선택 · ⌘ / Ctrl 개별 선택",
    persistentAnchor: "archive.selection",
    compactAnchor: "archive.selection",
    permission: "any",
    capability: "fine-pointer",
    replayLabel: "여러 장 선택"
  },
  "archive.selection.mobile": {
    id: "archive.selection.mobile",
    version: 1,
    page: "archive",
    trigger: "feature",
    priority: 100,
    title: "여러 장 선택",
    description: "항목을 눌러 여러 장을 선택하거나 해제할 수 있습니다.",
    persistentAnchor: "archive.selection",
    compactAnchor: "archive.selection",
    permission: "any",
    capability: "touch",
    replayLabel: "모바일 여러 장 선택"
  },
  "archive.folder-upload": {
    id: "archive.folder-upload",
    version: 1,
    page: "archive",
    trigger: "feature",
    priority: 100,
    title: "폴더 업로드",
    description: "폴더 안의 이미지와 PDF를 하위 폴더까지 찾아 자동으로 업로드합니다.",
    persistentAnchor: "archive.folder-upload",
    compactAnchor: "archive.folder-upload",
    permission: "manage",
    replayLabel: "폴더 업로드"
  }
};

const PAGE_GUIDES: Record<ContextualGuidePage, ContextualGuideId[]> = {
  home: ["home.calendar-create", "home.calendar-range", "home.invite-staff"],
  basicInfo: ["basic-info.intro"],
  dailyPlan: ["daily-plan.intro", "daily-plan.pdf"],
  progress: ["progress.intro", "progress.status"],
  sceneList: ["scene-list.desktop-intro", "scene-list.mobile-intro"],
  staff: ["staff.intro", "staff.participation", "staff.participation-summary"],
  scenario: ["scenario.actions"],
  wardrobe: ["wardrobe.intro"],
  archive: [
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
