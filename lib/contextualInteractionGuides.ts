// Node's type-stripping test runner requires the explicit extension; Next's
// bundler resolves the same source module. Keep permission decisions in the
// canonical contextual-guide helper instead of duplicating role rules here.
// @ts-ignore -- explicit .ts import is intentional for the pure node tests.
import { canUseGuidePermission, type ContextualGuideAnchorKey, type ContextualGuidePage, type ContextualGuidePermission, type ContextualGuidePlacement } from "./contextualGuides.ts";
import type { SharedProjectRole } from "@/lib/projectAccess/core";

export type InteractionGuideInputMode = "fine" | "coarse";

export type ContextualInteractionType =
  | "right-click"
  | "long-press"
  | "drag"
  | "drag-trash"
  | "swipe"
  | "shift-range"
  | "modifier-toggle"
  | "range-drag"
  | "tap";

export type ContextualInteractionGuideId =
  | "main.interaction-remembered-project"
  | "home.interaction-calendar-create"
  | "home.interaction-calendar-range"
  | "daily-plan.interaction-round-actions"
  | "daily-plan.interaction-row-actions"
  | "daily-plan.interaction-multi-round"
  | "daily-plan.interaction-row-reorder"
  | "daily-plan.interaction-actor-reorder-trash"
  | "progress.interaction-media-gallery"
  | "progress.interaction-shot-reorder"
  | "scene-list.interaction-merge-range"
  | "scene-list.interaction-merge-menu"
  | "scene-list.interaction-scene-reorder"
  | "scene-list.interaction-scene-delete"
  | "scene-list.interaction-actor-note"
  | "staff.interaction-member-reorder"
  | "staff.interaction-member-delete"
  | "archive.interaction-asset-info"
  | "archive.interaction-touch-selection"
  | "archive.interaction-shift-range"
  | "archive.interaction-additive-selection"
  | "archive.interaction-asset-reorder"
  | "archive.interaction-asset-delete";

export type ContextualInteractionGuideVariant = {
  title: string;
  description: string;
  detail?: string;
  demo: ContextualInteractionType;
  /** Actual hold threshold when the described gesture uses one. */
  durationMs?: number;
  modifierLabel?: string;
  direction?: "left" | "right";
};

export type ContextualInteractionGuideDefinition = {
  id: ContextualInteractionGuideId;
  page: ContextualGuidePage;
  anchor: ContextualGuideAnchorKey;
  /** Compact App Shell에서 실제 기능을 여는 대표 target이 다를 때 사용합니다. */
  compactAnchor?: ContextualGuideAnchorKey;
  permission: ContextualGuidePermission;
  preferredPlacement: ContextualGuidePlacement;
  priority: number;
  /** Interaction tours are Help-launched and never enter automatic eligibility. */
  manualOnly: true;
  variants: Partial<Record<InteractionGuideInputMode, ContextualInteractionGuideVariant>>;
};

const MAIN_INTERACTION_GUIDES = [
  "main.interaction-remembered-project"
] as const satisfies readonly ContextualInteractionGuideId[];

const HOME_INTERACTION_GUIDES = [
  "home.interaction-calendar-create",
  "home.interaction-calendar-range"
] as const satisfies readonly ContextualInteractionGuideId[];

const DAILY_PLAN_INTERACTION_GUIDES = [
  "daily-plan.interaction-round-actions",
  "daily-plan.interaction-row-actions",
  "daily-plan.interaction-multi-round",
  "daily-plan.interaction-row-reorder",
  "daily-plan.interaction-actor-reorder-trash"
] as const satisfies readonly ContextualInteractionGuideId[];

const PROGRESS_INTERACTION_GUIDES = [
  "progress.interaction-media-gallery",
  "progress.interaction-shot-reorder"
] as const satisfies readonly ContextualInteractionGuideId[];

const SCENE_LIST_INTERACTION_GUIDES = [
  "scene-list.interaction-merge-range",
  "scene-list.interaction-merge-menu",
  "scene-list.interaction-scene-reorder",
  "scene-list.interaction-scene-delete",
  "scene-list.interaction-actor-note"
] as const satisfies readonly ContextualInteractionGuideId[];

const STAFF_INTERACTION_GUIDES = [
  "staff.interaction-member-reorder",
  "staff.interaction-member-delete"
] as const satisfies readonly ContextualInteractionGuideId[];

const ARCHIVE_INTERACTION_GUIDES = [
  "archive.interaction-asset-info",
  "archive.interaction-touch-selection",
  "archive.interaction-shift-range",
  "archive.interaction-additive-selection",
  "archive.interaction-asset-reorder",
  "archive.interaction-asset-delete"
] as const satisfies readonly ContextualInteractionGuideId[];

export const INTERACTION_GUIDES: Record<
  ContextualInteractionGuideId,
  ContextualInteractionGuideDefinition
> = {
  "main.interaction-remembered-project": {
    id: "main.interaction-remembered-project",
    page: "main",
    anchor: "main.remembered-project",
    permission: "any",
    preferredPlacement: "bottom",
    priority: 10,
    manualOnly: true,
    variants: {
      fine: {
        title: "이전 프로젝트 관리",
        description: "이전에 참여한 프로젝트 카드를 우클릭하면 목록에서 제거하는 메뉴를 열 수 있습니다.",
        detail: "키보드에서는 Context Menu 키 또는 Shift+F10으로도 열 수 있습니다.",
        demo: "right-click"
      },
      coarse: {
        title: "이전 프로젝트 관리",
        description: "이전에 참여한 프로젝트 카드를 약 0.6초 동안 길게 누르면 목록에서 제거하는 메뉴를 열 수 있습니다.",
        demo: "long-press",
        durationMs: 600
      }
    }
  },
  "home.interaction-calendar-create": {
    id: "home.interaction-calendar-create",
    page: "home",
    anchor: "home.calendar-grid",
    permission: "manage",
    preferredPlacement: "bottom",
    priority: 10,
    manualOnly: true,
    variants: {
      fine: {
        title: "날짜에서 일정 만들기",
        description: "날짜를 약 0.5초 동안 길게 누르면 그 날짜의 새 일정을 만들 수 있습니다. 짧게 누르면 날짜 정보만 확인합니다.",
        demo: "long-press",
        durationMs: 500
      },
      coarse: {
        title: "날짜에서 일정 만들기",
        description: "날짜를 약 0.5초 동안 길게 누르면 그 날짜의 새 일정을 만들 수 있습니다. 짧게 누르면 날짜 정보만 확인합니다.",
        demo: "long-press",
        durationMs: 500
      }
    }
  },
  "home.interaction-calendar-range": {
    id: "home.interaction-calendar-range",
    page: "home",
    anchor: "home.calendar-grid",
    permission: "manage",
    preferredPlacement: "bottom",
    priority: 20,
    manualOnly: true,
    variants: {
      fine: {
        title: "기간 일정 만들기",
        description: "시작 날짜를 약 0.5초 동안 누른 뒤 다른 날짜까지 끌면 기간 일정으로 선택됩니다.",
        demo: "range-drag",
        durationMs: 500
      },
      coarse: {
        title: "기간 일정 만들기",
        description: "시작 날짜를 약 0.5초 동안 누른 뒤 다른 날짜까지 끌면 기간 일정으로 선택됩니다.",
        demo: "range-drag",
        durationMs: 500
      }
    }
  },
  "daily-plan.interaction-round-actions": {
    id: "daily-plan.interaction-round-actions",
    page: "dailyPlan",
    anchor: "daily-plan.round-card",
    compactAnchor: "shell.navigation-toggle",
    permission: "manage",
    preferredPlacement: "right",
    priority: 10,
    manualOnly: true,
    variants: {
      fine: {
        title: "회차 카드 관리",
        description: "프로젝트 메뉴를 열고 회차 카드를 우클릭하면 복사와 삭제 메뉴를 열 수 있습니다.",
        detail: "키보드에서는 Shift+F10으로도 메뉴를 열 수 있습니다.",
        demo: "right-click"
      },
      coarse: {
        title: "회차 카드 관리",
        description: "프로젝트 메뉴를 열고 회차 카드를 약 0.6초 동안 길게 누르면 복사와 삭제 메뉴를 열 수 있습니다.",
        demo: "long-press",
        durationMs: 600
      }
    }
  },
  "daily-plan.interaction-row-actions": {
    id: "daily-plan.interaction-row-actions",
    page: "dailyPlan",
    anchor: "daily-plan.timetable-row",
    permission: "manage",
    preferredPlacement: "top",
    priority: 20,
    manualOnly: true,
    variants: {
      fine: {
        title: "분할 촬영 메뉴",
        description: "여러 회차로 나눌 수 있는 촬영 행을 우클릭하면 분할 촬영 메뉴를 열 수 있습니다.",
        demo: "right-click"
      },
      coarse: {
        title: "분할 촬영 메뉴",
        description: "여러 회차로 나눌 수 있는 촬영 행을 약 0.575초 동안 길게 누르면 분할 촬영 메뉴가 열립니다.",
        demo: "long-press",
        durationMs: 575
      }
    }
  },
  "daily-plan.interaction-multi-round": {
    id: "daily-plan.interaction-multi-round",
    page: "dailyPlan",
    anchor: "daily-plan.timetable-row",
    permission: "manage",
    preferredPlacement: "top",
    priority: 30,
    manualOnly: true,
    variants: {
      fine: {
        title: "분할 촬영",
        description: "한 씬을 여러 회차로 나눠 찍을 때 촬영 행을 우클릭하고 분할 촬영을 선택하세요.",
        detail: "10/29는 전체 29컷 중 이번 회차에 10컷을 촬영한다는 뜻이며, 선택한 컷만 촬영 순서에 입력할 수 있습니다.",
        demo: "right-click"
      },
      coarse: {
        title: "분할 촬영",
        description: "한 씬을 여러 회차로 나눠 찍을 때 촬영 행을 약 0.575초 길게 누르고 분할 촬영을 선택하세요.",
        detail: "10/29는 전체 29컷 중 이번 회차에 10컷을 촬영한다는 뜻이며, 선택한 컷만 촬영 순서에 입력할 수 있습니다.",
        demo: "long-press",
        durationMs: 575
      }
    }
  },
  "daily-plan.interaction-row-reorder": {
    id: "daily-plan.interaction-row-reorder",
    page: "dailyPlan",
    anchor: "daily-plan.timetable-reorder-row",
    permission: "manage",
    preferredPlacement: "top",
    priority: 40,
    manualOnly: true,
    variants: {
      fine: {
        title: "촬영 순서 이동",
        description: "촬영 행을 약 0.575초 동안 누른 뒤 끌어 촬영 순서를 바꿀 수 있습니다.",
        demo: "drag",
        durationMs: 575
      },
      coarse: {
        title: "촬영 순서 이동",
        description: "촬영 행을 약 0.575초 동안 누른 뒤 끌어 촬영 순서를 바꿀 수 있습니다.",
        demo: "drag",
        durationMs: 575
      }
    }
  },
  "daily-plan.interaction-actor-reorder-trash": {
    id: "daily-plan.interaction-actor-reorder-trash",
    page: "dailyPlan",
    anchor: "daily-plan.actor-row",
    permission: "manage",
    preferredPlacement: "top",
    priority: 50,
    manualOnly: true,
    variants: {
      fine: {
        title: "배우 카드 이동",
        description: "배우 카드를 약 0.575초 동안 누른 뒤 끌어 순서를 바꾸거나, 휴지통에 놓아 삭제 확인을 열 수 있습니다.",
        demo: "drag-trash",
        durationMs: 575
      },
      coarse: {
        title: "배우 카드 이동",
        description: "배우 카드를 약 0.575초 동안 누른 뒤 끌어 순서를 바꾸거나, 휴지통에 놓아 삭제 확인을 열 수 있습니다.",
        demo: "drag-trash",
        durationMs: 575
      }
    }
  },
  "progress.interaction-media-gallery": {
    id: "progress.interaction-media-gallery",
    page: "progress",
    anchor: "progress.media-gallery",
    permission: "any",
    preferredPlacement: "top",
    priority: 10,
    manualOnly: true,
    variants: {
      fine: {
        title: "콘티 · 부감도 넘겨보기",
        description: "대표 이미지를 눌러 크게 연 뒤 화면의 화살표나 키보드 ←/→ 키로 다음 이미지를 확인할 수 있습니다.",
        demo: "tap"
      },
      coarse: {
        title: "콘티 · 부감도 넘겨보기",
        description: "대표 이미지를 눌러 크게 연 뒤 좌우로 밀어 다음 이미지를 확인할 수 있습니다.",
        demo: "swipe",
        direction: "left"
      }
    }
  },
  "progress.interaction-shot-reorder": {
    id: "progress.interaction-shot-reorder",
    page: "progress",
    anchor: "progress.shot-card",
    permission: "admin",
    preferredPlacement: "top",
    priority: 20,
    manualOnly: true,
    variants: {
      fine: {
        title: "컷 순서 바꾸기",
        description: "컷 카드를 약 0.22초 동안 누른 뒤 위아래로 끌어 순서를 바꿀 수 있습니다.",
        demo: "drag",
        durationMs: 220
      },
      coarse: {
        title: "컷 순서 바꾸기",
        description: "컷 카드를 약 0.33초 동안 누른 뒤 위아래로 끌어 순서를 바꿀 수 있습니다.",
        demo: "drag",
        durationMs: 330
      }
    }
  },
  "scene-list.interaction-merge-range": {
    id: "scene-list.interaction-merge-range",
    page: "sceneList",
    anchor: "scene-list.merge-range-cell",
    permission: "manage",
    preferredPlacement: "top",
    priority: 10,
    manualOnly: true,
    variants: {
      fine: {
        title: "셀 범위 선택",
        description: "병합 가능한 셀을 누른 채 끌어 여러 칸을 한 번에 선택할 수 있습니다.",
        demo: "range-drag"
      },
      coarse: {
        title: "셀 범위 선택",
        description: "편집 표에서 셀을 약 0.52초 동안 누른 뒤 끌어 여러 칸을 한 번에 선택할 수 있습니다.",
        demo: "range-drag",
        durationMs: 520
      }
    }
  },
  "scene-list.interaction-merge-menu": {
    id: "scene-list.interaction-merge-menu",
    page: "sceneList",
    anchor: "scene-list.merge-cell",
    permission: "manage",
    preferredPlacement: "top",
    priority: 20,
    manualOnly: true,
    variants: {
      fine: {
        title: "셀 병합 메뉴",
        description: "병합 가능한 셀을 우클릭하면 병합, 병합 해제와 내용 지우기 메뉴를 열 수 있습니다.",
        demo: "right-click"
      },
      coarse: {
        title: "셀 병합 메뉴",
        description: "편집 표에서 셀을 약 0.52초 동안 길게 누르면 선택 범위의 병합 메뉴가 열립니다.",
        demo: "long-press",
        durationMs: 520
      }
    }
  },
  "scene-list.interaction-scene-reorder": {
    id: "scene-list.interaction-scene-reorder",
    page: "sceneList",
    anchor: "scene-list.scene-reorder",
    permission: "manage",
    preferredPlacement: "right",
    priority: 30,
    manualOnly: true,
    variants: {
      fine: {
        title: "씬 순서 이동",
        description: "Scene 숫자를 잡아 끌면 씬 순서를 바꿀 수 있습니다.",
        demo: "drag"
      },
      coarse: {
        title: "씬 순서 이동",
        description: "편집 표에서 Scene 숫자를 약 0.48초 동안 누른 뒤 끌면 씬 순서를 바꿀 수 있습니다.",
        demo: "drag",
        durationMs: 480
      }
    }
  },
  "scene-list.interaction-scene-delete": {
    id: "scene-list.interaction-scene-delete",
    page: "sceneList",
    anchor: "scene-list.scene-number",
    permission: "manage",
    preferredPlacement: "right",
    priority: 40,
    manualOnly: true,
    variants: {
      fine: {
        title: "씬 삭제 메뉴",
        description: "Scene 숫자를 우클릭하면 해당 씬의 삭제 메뉴를 열 수 있습니다.",
        demo: "right-click"
      }
    }
  },
  "scene-list.interaction-actor-note": {
    id: "scene-list.interaction-actor-note",
    page: "sceneList",
    anchor: "scene-list.actor-cell",
    permission: "manage",
    preferredPlacement: "top",
    priority: 50,
    manualOnly: true,
    variants: {
      fine: {
        title: "배우 칸 메모",
        description: "배우 칸을 우클릭하면 V.O., 실루엣, 대역 같은 짧은 메모를 입력할 수 있습니다.",
        demo: "right-click"
      },
      coarse: {
        title: "배우 칸 메모",
        description: "편집 표에서 배우 칸을 약 0.54초 동안 길게 누르면 짧은 메모를 입력할 수 있습니다.",
        demo: "long-press",
        durationMs: 540
      }
    }
  },
  "staff.interaction-member-reorder": {
    id: "staff.interaction-member-reorder",
    page: "staff",
    anchor: "staff.member-reorder-row",
    permission: "manage",
    preferredPlacement: "top",
    priority: 10,
    manualOnly: true,
    variants: {
      fine: {
        title: "스탭 순서 바꾸기",
        description: "스탭 카드를 약 0.575초 동안 누른 뒤 끌어 같은 부서 안에서 순서를 바꿀 수 있습니다.",
        demo: "drag",
        durationMs: 575
      },
      coarse: {
        title: "스탭 순서 바꾸기",
        description: "스탭 카드를 약 0.575초 동안 누른 뒤 끌어 같은 부서 안에서 순서를 바꿀 수 있습니다.",
        demo: "drag",
        durationMs: 575
      }
    }
  },
  "staff.interaction-member-delete": {
    id: "staff.interaction-member-delete",
    page: "staff",
    anchor: "staff.member-row",
    permission: "manage",
    preferredPlacement: "top",
    priority: 20,
    manualOnly: true,
    variants: {
      fine: {
        title: "스탭 삭제",
        description: "스탭 카드를 약 0.575초 동안 누른 뒤 휴지통에 놓으면 삭제 확인이 열립니다.",
        demo: "drag-trash",
        durationMs: 575
      },
      coarse: {
        title: "스탭 삭제",
        description: "스탭 카드를 약 0.575초 동안 누른 뒤 휴지통에 놓으면 삭제 확인이 열립니다.",
        demo: "drag-trash",
        durationMs: 575
      }
    }
  },
  "archive.interaction-asset-info": {
    id: "archive.interaction-asset-info",
    page: "archive",
    anchor: "archive.asset",
    permission: "manage",
    preferredPlacement: "top",
    priority: 10,
    manualOnly: true,
    variants: {
      fine: {
        title: "씬 · 컷 정보 수정",
        description: "자료를 우클릭하면 씬과 컷 정보를 수정하는 창을 열 수 있습니다.",
        demo: "right-click"
      }
    }
  },
  "archive.interaction-touch-selection": {
    id: "archive.interaction-touch-selection",
    page: "archive",
    anchor: "archive.asset",
    permission: "manage",
    preferredPlacement: "top",
    priority: 20,
    manualOnly: true,
    variants: {
      coarse: {
        title: "여러 장 선택",
        description: "자료를 약 0.55초 동안 길게 눌러 선택을 시작한 뒤 다른 자료를 눌러 추가하거나 해제할 수 있습니다.",
        demo: "long-press",
        durationMs: 550
      }
    }
  },
  "archive.interaction-shift-range": {
    id: "archive.interaction-shift-range",
    page: "archive",
    anchor: "archive.asset-multi-select",
    permission: "manage",
    preferredPlacement: "top",
    priority: 20,
    manualOnly: true,
    variants: {
      fine: {
        title: "연속 범위 선택",
        description: "선택 모드에서 Shift를 누른 채 자료를 클릭하면 연속 범위를 선택할 수 있습니다.",
        demo: "shift-range",
        modifierLabel: "Shift"
      }
    }
  },
  "archive.interaction-additive-selection": {
    id: "archive.interaction-additive-selection",
    page: "archive",
    anchor: "archive.asset-multi-select",
    permission: "manage",
    preferredPlacement: "top",
    priority: 30,
    manualOnly: true,
    variants: {
      fine: {
        title: "개별 자료 추가 선택",
        description: "선택 모드에서 ⌘ 또는 Ctrl을 누른 채 클릭하면 떨어진 자료를 개별적으로 추가하거나 해제할 수 있습니다.",
        demo: "modifier-toggle",
        modifierLabel: "⌘ / Ctrl"
      }
    }
  },
  "archive.interaction-asset-reorder": {
    id: "archive.interaction-asset-reorder",
    page: "archive",
    anchor: "archive.asset-reorder",
    permission: "manage",
    preferredPlacement: "top",
    priority: 40,
    manualOnly: true,
    variants: {
      fine: {
        title: "자료 순서 바꾸기",
        description: "같은 씬과 컷에 있는 자료를 끌어 원하는 순서로 이동할 수 있습니다.",
        demo: "drag"
      },
      coarse: {
        title: "자료 순서 바꾸기",
        description: "자료를 약 0.55초 동안 누른 뒤 끌어 같은 씬과 컷 안에서 순서를 바꿀 수 있습니다.",
        demo: "drag",
        durationMs: 550
      }
    }
  },
  "archive.interaction-asset-delete": {
    id: "archive.interaction-asset-delete",
    page: "archive",
    anchor: "archive.asset",
    permission: "manage",
    preferredPlacement: "top",
    priority: 50,
    manualOnly: true,
    variants: {
      fine: {
        title: "휴지통으로 삭제",
        description: "자료를 화면 아래 휴지통에 끌어놓으면 삭제 확인이 열립니다.",
        demo: "drag-trash"
      },
      coarse: {
        title: "휴지통으로 삭제",
        description: "자료를 약 0.55초 동안 누른 뒤 화면 아래 휴지통에 끌어놓으면 삭제 확인이 열립니다.",
        demo: "drag-trash",
        durationMs: 550
      }
    }
  }
};

const INTERACTION_GUIDE_IDS_BY_PAGE: Record<
  ContextualGuidePage,
  readonly ContextualInteractionGuideId[]
> = {
  main: MAIN_INTERACTION_GUIDES,
  home: HOME_INTERACTION_GUIDES,
  basicInfo: [],
  dailyPlan: DAILY_PLAN_INTERACTION_GUIDES,
  progress: PROGRESS_INTERACTION_GUIDES,
  sceneList: SCENE_LIST_INTERACTION_GUIDES,
  staff: STAFF_INTERACTION_GUIDES,
  scenario: [],
  wardrobe: [],
  archive: ARCHIVE_INTERACTION_GUIDES
};

export function getInteractionGuideIdsForPage(page: ContextualGuidePage | null) {
  return page ? INTERACTION_GUIDE_IDS_BY_PAGE[page] : [];
}

export function getInteractionGuideVariant(
  definition: ContextualInteractionGuideDefinition,
  inputMode: InteractionGuideInputMode
) {
  return definition.variants[inputMode] ?? null;
}

export function getInteractionGuideInputMode(finePointer: boolean): InteractionGuideInputMode {
  return finePointer ? "fine" : "coarse";
}

export function canUseInteractionGuide(
  definition: ContextualInteractionGuideDefinition,
  role: SharedProjectRole | null
) {
  return canUseGuidePermission(definition.permission, role);
}

export function getInteractionGuideDefinitionsForPage(page: ContextualGuidePage | null) {
  return getInteractionGuideIdsForPage(page).map((id) => INTERACTION_GUIDES[id]);
}

export type ResolvedContextualInteractionGuide = ContextualInteractionGuideDefinition & {
  inputMode: InteractionGuideInputMode;
  variant: ContextualInteractionGuideVariant;
};

/** Pure filtering used by the Help menu before DOM-anchor availability is applied. */
export function getInteractionGuideStepsForPage(
  page: ContextualGuidePage | null,
  {
    inputMode,
    role
  }: {
    inputMode: InteractionGuideInputMode;
    role: SharedProjectRole | null;
  }
): ResolvedContextualInteractionGuide[] {
  return getInteractionGuideDefinitionsForPage(page).flatMap((definition) => {
    if (!canUseInteractionGuide(definition, role)) return [];
    const variant = getInteractionGuideVariant(definition, inputMode);
    if (!variant) return [];
    return [{ ...definition, inputMode, variant }];
  });
}
