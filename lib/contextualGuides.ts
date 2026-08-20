// Node's type-stripping tests need an explicit extension, while Next resolves
// the same module during application builds.
// @ts-ignore -- explicit .ts import is intentional for the pure node tests.
import { isKeyStaffProjectRole, type SharedProjectRole } from "./projectAccess/core.ts";

export type ContextualGuidePage =
  | "main"
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
  | "main.intro-new"
  | "main.intro-join"
  | "main.intro-go"
  | "main.new-key-staff-password"
  | "main.new-staff-password"
  | "main.join-fields"
  | "main.go-first-use"
  | "home.intro"
  | "home.calendar-create"
  | "home.calendar-range"
  | "home.invite-staff"
  | "home.google-account-connect"
  | "home.key-staff-google-required"
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
  | "archive.folder-upload"
  | "archive.diagram-editor-first-use";

export type ContextualGuideAnchorKey =
  | "main.action-new"
  | "main.action-join"
  | "main.action-go"
  | "main.remembered-project"
  | "main.new-key-staff-password"
  | "main.new-staff-password"
  | "main.join-fields"
  | "home.calendar-grid"
  | "home.invite-action"
  | "shell.google-account"
  | "basic-info.form"
  | "shell.navigation.daily-plans"
  | "shell.navigation-toggle"
  | "daily-plan.round-card"
  | "daily-plan.timetable-row"
  | "daily-plan.timetable-reorder-row"
  | "daily-plan.actor-row"
  | "daily-plan.pdf-actions"
  | "progress.cut-list"
  | "progress.shot-card"
  | "progress.media-gallery"
  | "progress.gathering-photo-context"
  | "progress.status-controls"
  | "scene-list.desktop"
  | "scene-list.mobile"
  | "scene-list.merge-cell"
  | "scene-list.merge-range-cell"
  | "scene-list.scene-number"
  | "scene-list.scene-reorder"
  | "scene-list.actor-cell"
  | "staff.main"
  | "staff.member-row"
  | "staff.member-reorder-row"
  | "staff.participation"
  | "scenario.actions"
  | "wardrobe.main"
  | "archive.upload"
  | "archive.asset"
  | "archive.asset-reorder"
  | "archive.asset-multi-select"
  | "archive.selection"
  | "archive.folder-upload"
  | "archive.crop-ratio"
  | "archive.crop-scene-cut"
  | "archive.diagram-canvas"
  | "archive.diagram-person-tool"
  | "archive.diagram-camera-tool"
  | "archive.diagram-room-tool"
  | "archive.diagram-path-tool"
  | "archive.diagram-history";

export type ContextualGuidePlacement = "auto" | "left" | "right" | "top" | "bottom";
export type ContextualGuidePermission = "any" | "manage" | "admin";

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
  permission: ContextualGuidePermission;
  capability?: "fine-pointer" | "touch";
  replayLabel: string;
  replayHidden?: boolean;
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

/** Main의 첫 방문 소개는 이 순서를 변경하지 않고 한 항목씩 진행합니다. */
export const MAIN_INTRO_GUIDE_IDS = [
  "main.intro-new",
  "main.intro-join",
  "main.intro-go"
] as const satisfies readonly ContextualGuideId[];

/** New form이 실제로 열린 뒤 password field에 순서대로 연결합니다. */
export const MAIN_NEW_FEATURE_GUIDE_IDS = [
  "main.new-key-staff-password",
  "main.new-staff-password"
] as const satisfies readonly ContextualGuideId[];

export const CONTEXTUAL_GUIDES: Record<ContextualGuideId, ContextualGuideDefinition> = {
  "main.intro-new": {
    id: "main.intro-new",
    version: 1,
    page: "main",
    type: "anchor",
    trigger: "page",
    priority: 50,
    title: "New",
    description: "프로젝트를 만들 수 있습니다.",
    persistentAnchor: "main.action-new",
    compactAnchor: "main.action-new",
    preferredPlacement: "auto",
    permission: "any",
    replayLabel: "Main 안내 (New → Join → Go)"
  },
  "main.intro-join": {
    id: "main.intro-join",
    version: 1,
    page: "main",
    type: "anchor",
    trigger: "page",
    priority: 50,
    title: "Join",
    description: "만들어진 프로젝트에 참여할 수 있습니다. 처음 프로젝트 이름과 비밀번호로 참여하면 참여 권한이 저장됩니다.",
    persistentAnchor: "main.action-join",
    compactAnchor: "main.action-join",
    preferredPlacement: "auto",
    permission: "any",
    replayLabel: "Join 안내",
    replayHidden: true
  },
  "main.intro-go": {
    id: "main.intro-go",
    version: 1,
    page: "main",
    type: "anchor",
    trigger: "page",
    priority: 50,
    title: "Go",
    description: "가장 최근에 참여한 프로젝트의 현장 진행도를 확인할 수 있습니다.",
    persistentAnchor: "main.action-go",
    compactAnchor: "main.action-go",
    preferredPlacement: "auto",
    permission: "any",
    replayLabel: "Go 안내",
    replayHidden: true
  },
  "main.new-key-staff-password": {
    id: "main.new-key-staff-password",
    version: 1,
    page: "main",
    type: "anchor",
    trigger: "feature",
    priority: 100,
    title: "Key staff 비밀번호",
    description: "프로젝트의 모든 내용을 수정 및 관리할 수 있습니다.",
    persistentAnchor: "main.new-key-staff-password",
    compactAnchor: "main.new-key-staff-password",
    preferredPlacement: "auto",
    permission: "any",
    replayLabel: "Key staff 비밀번호"
  },
  "main.new-staff-password": {
    id: "main.new-staff-password",
    version: 1,
    page: "main",
    type: "anchor",
    trigger: "feature",
    priority: 100,
    title: "Staff 비밀번호",
    description: "프로젝트의 내용을 확인할 수 있습니다.",
    persistentAnchor: "main.new-staff-password",
    compactAnchor: "main.new-staff-password",
    preferredPlacement: "auto",
    permission: "any",
    replayLabel: "Staff 비밀번호"
  },
  "main.join-fields": {
    id: "main.join-fields",
    version: 1,
    page: "main",
    type: "anchor",
    trigger: "feature",
    priority: 100,
    title: "프로젝트 참여",
    description: "프로젝트 이름과 비밀번호로 처음 참여하면 참여 권한이 저장되어 다음부터 목록에서 빠르게 열 수 있습니다.",
    persistentAnchor: "main.join-fields",
    compactAnchor: "main.join-fields",
    preferredPlacement: "auto",
    permission: "any",
    replayLabel: "프로젝트 참여 입력"
  },
  // Legacy definition: keep old completion tokens readable without exposing or triggering
  // a second Go guide after the canonical main.intro-go introduction.
  "main.go-first-use": {
    id: "main.go-first-use",
    version: 1,
    page: "main",
    type: "anchor",
    trigger: "feature",
    priority: 100,
    title: "Go",
    description: "가장 최근에 참여한 프로젝트의 현장 진행도를 확인할 수 있습니다.",
    persistentAnchor: "main.action-go",
    compactAnchor: "main.action-go",
    preferredPlacement: "auto",
    permission: "any",
    replayLabel: "Go 빠른 이동",
    replayHidden: true
  },
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
    description: "날짜를 길게 누르면 일정을 만들 수 있습니다.",
    compactDescription: "날짜를 길게 눌러 일정을 만드세요.",
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
    description: "날짜를 길게 누른 뒤 끌면 기간 일정으로 선택됩니다.",
    compactDescription: "길게 누른 뒤 끌어 기간을 선택하세요.",
    persistentAnchor: "home.calendar-grid",
    compactAnchor: "home.calendar-grid",
    preferredPlacement: "bottom",
    permission: "manage",
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
    description: "카카오톡 공유하기를 누르면 초대 문구와 링크를 복사할 수 있습니다.",
    persistentAnchor: "home.invite-action",
    compactAnchor: "home.invite-action",
    preferredPlacement: "left",
    permission: "admin",
    replayLabel: "스탭 초대"
  },
  "home.google-account-connect": {
    id: "home.google-account-connect",
    version: 1,
    page: "home",
    type: "anchor",
    trigger: "feature",
    priority: 110,
    title: "Google 계정 연결",
    description: "Google 로그인으로 참여한 프로젝트를 계정에 저장하고 권한을 확인할 수 있습니다.",
    compactDescription: "프로젝트 메뉴를 열어 Google 계정을 연결할 수 있습니다.",
    persistentAnchor: "shell.google-account",
    compactAnchor: "shell.navigation-toggle",
    preferredPlacement: "right",
    permission: "any",
    replayLabel: "Google 계정 연결",
    replayHidden: true
  },
  "home.key-staff-google-required": {
    id: "home.key-staff-google-required",
    version: 1,
    page: "home",
    type: "anchor",
    trigger: "feature",
    priority: 115,
    title: "Google 로그인이 필요합니다.",
    description: "Key staff 비밀번호가 확인되었습니다. 수정·관리 기능은 승인된 Google 계정으로 로그인한 뒤 사용할 수 있습니다.",
    compactDescription: "프로젝트 메뉴를 열어 승인된 Google 계정으로 로그인하면 수정·관리 기능을 사용할 수 있습니다.",
    persistentAnchor: "shell.google-account",
    compactAnchor: "shell.navigation-toggle",
    preferredPlacement: "right",
    permission: "any",
    replayLabel: "Key staff Google 로그인",
    replayHidden: true
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
    description: "가로 PDF 또는 모바일용 PDF로 저장할 수 있습니다.",
    persistentAnchor: "daily-plan.pdf-actions",
    compactAnchor: "daily-plan.pdf-actions",
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
    version: 2,
    page: "progress",
    type: "page",
    trigger: "page",
    priority: 50,
    title: "진행도",
    description: "현재 촬영 중인 컷을 확인하고, 카드 왼쪽 영역은 OMIT, 오른쪽 영역은 OK로 변경합니다.",
    compactDescription: "현재 촬영 중인 컷을 확인하고, 카드를 오른쪽으로 밀면 OK, 왼쪽으로 밀면 OMIT로 변경합니다.",
    permission: "any",
    replayLabel: "진행도 보기"
  },
  "progress.status": {
    id: "progress.status",
    version: 3,
    page: "progress",
    type: "anchor",
    trigger: "feature",
    priority: 100,
    title: "컷 상태",
    description: "카드의 왼쪽 빈 영역을 누르면 OMIT, 오른쪽 빈 영역을 누르면 OK로 변경됩니다.",
    compactDescription: "카드를 오른쪽으로 밀면 OK, 왼쪽으로 밀면 OMIT로 변경됩니다.",
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
    compactAnchor: "scenario.actions",
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
  },
  "archive.diagram-editor-first-use": {
    id: "archive.diagram-editor-first-use",
    version: 3,
    page: "archive",
    type: "anchor",
    trigger: "feature",
    priority: 120,
    title: "부감도 오브젝트 편집",
    description: "오브젝트를 끌어 위치를 이동할 수 있습니다. 데스크톱에서는 우클릭하고 터치 화면에서는 길게 눌러 이름·색상과 동작을 편집하며, 모서리나 컨트롤 포인트를 끌어 형태와 방향을 조정하세요.",
    compactDescription: "오브젝트를 끌어 위치를 이동할 수 있습니다. 터치 화면에서는 오브젝트를 길게 눌러 편집 메뉴를 열고, 모서리나 컨트롤 포인트를 끌어 형태와 방향을 조정하세요.",
    persistentAnchor: "archive.diagram-canvas",
    compactAnchor: "archive.diagram-canvas",
    preferredPlacement: "top",
    permission: "manage",
    replayLabel: "부감도 편집기"
  }
};

const PAGE_GUIDES: Record<ContextualGuidePage, ContextualGuideId[]> = {
  main: [
    ...MAIN_INTRO_GUIDE_IDS,
    ...MAIN_NEW_FEATURE_GUIDE_IDS,
    "main.join-fields"
  ],
  home: [
    "home.intro",
    "home.calendar-create",
    "home.calendar-range",
    "home.invite-staff",
    "home.google-account-connect",
    "home.key-staff-google-required"
  ],
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
    "archive.folder-upload",
    "archive.diagram-editor-first-use"
  ]
};

export function getGuidePage(pathname: string, searchParams: Pick<URLSearchParams, "get">) {
  if (pathname === "/") return "main";
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
  return canUseGuidePermission(definition.permission, role);
}

/** Page guides and manual interaction guides share this canonical role gate. */
export function canUseGuidePermission(
  permission: ContextualGuidePermission,
  role: SharedProjectRole | null
) {
  if (permission === "admin") return role === "admin";
  if (permission === "manage") return isKeyStaffProjectRole(role);
  return true;
}
