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
  | "range-drag"
  | "context-scene-cut"
  | "filename-archive"
  | "crop-ratio"
  | "crop-scene-cut"
  | "object-drag"
  | "object-context-menu"
  | "movement-create"
  | "movement-curve"
  | "camera-pan"
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
  | "progress.interaction-gathering-photo"
  | "progress.interaction-shot-reorder"
  | "scene-list.interaction-merge-range"
  | "scene-list.interaction-merge-menu"
  | "scene-list.interaction-scene-reorder"
  | "scene-list.interaction-scene-delete"
  | "scene-list.interaction-actor-note"
  | "staff.interaction-member-reorder"
  | "staff.interaction-member-delete"
  | "archive.interaction-upload"
  | "archive.interaction-filename-classification"
  | "archive.interaction-asset-info"
  | "archive.interaction-crop-ratio"
  | "archive.interaction-crop-scene-cut"
  | "archive.interaction-touch-selection"
  | "archive.interaction-shift-range"
  | "archive.interaction-asset-reorder"
  | "archive.interaction-asset-delete"
  | "archive.interaction-diagram-person-add"
  | "archive.interaction-diagram-person-move"
  | "archive.interaction-diagram-object-menu"
  | "archive.interaction-diagram-camera-move"
  | "archive.interaction-diagram-rotate"
  | "archive.interaction-diagram-room"
  | "archive.interaction-diagram-path"
  | "archive.interaction-diagram-curve"
  | "archive.interaction-diagram-undo";

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
  /**
   * 실제 target이 아직 열리지 않은 수동 workflow step을 현재 화면에만
   * standalone으로 남겨 두는 context target입니다.
   */
  standaloneContextAnchors?: readonly ContextualGuideAnchorKey[];
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
  "progress.interaction-gathering-photo",
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
  "archive.interaction-upload",
  "archive.interaction-filename-classification",
  "archive.interaction-asset-info",
  "archive.interaction-crop-ratio",
  "archive.interaction-crop-scene-cut",
  "archive.interaction-touch-selection",
  "archive.interaction-shift-range",
  "archive.interaction-asset-reorder",
  "archive.interaction-asset-delete",
  "archive.interaction-diagram-person-add",
  "archive.interaction-diagram-person-move",
  "archive.interaction-diagram-object-menu",
  "archive.interaction-diagram-camera-move",
  "archive.interaction-diagram-rotate",
  "archive.interaction-diagram-room",
  "archive.interaction-diagram-path",
  "archive.interaction-diagram-curve",
  "archive.interaction-diagram-undo"
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
  "progress.interaction-gathering-photo": {
    id: "progress.interaction-gathering-photo",
    page: "progress",
    anchor: "progress.gathering-photo-add",
    standaloneContextAnchors: ["progress.gathering-photo-context"],
    permission: "manage",
    preferredPlacement: "left",
    priority: 15,
    manualOnly: true,
    variants: {
      coarse: {
        title: "집합장소 사진",
        description: "사진 추가에서 바로 촬영하거나 앨범의 사진을 선택할 수 있습니다.",
        demo: "tap"
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
  "archive.interaction-upload": {
    id: "archive.interaction-upload",
    page: "archive",
    anchor: "archive.upload",
    permission: "manage",
    preferredPlacement: "bottom",
    priority: 10,
    manualOnly: true,
    variants: {
      fine: {
        title: "자료 올리기",
        description: "이미지, PDF 또는 폴더를 선택해 부감도와 콘티 자료를 가져올 수 있습니다.",
        demo: "tap"
      },
      coarse: {
        title: "자료 올리기",
        description: "이미지, PDF 또는 폴더를 선택해 부감도와 콘티 자료를 가져올 수 있습니다.",
        demo: "tap"
      }
    }
  },
  "archive.interaction-filename-classification": {
    id: "archive.interaction-filename-classification",
    page: "archive",
    anchor: "archive.upload",
    permission: "manage",
    preferredPlacement: "bottom",
    priority: 20,
    manualOnly: true,
    variants: {
      fine: {
        title: "파일명 자동 분류",
        description: "부감도 파일명이 S12C3.jpg처럼 씬과 컷을 포함하면 업로드할 때 S12/C3 자료로 자동 분류됩니다.",
        detail: "Scene12Cut3, 씬12컷3, S12(3), 폴더의 S12/C3도 읽습니다. 씬리스트의 씬과 유효한 컷 번호가 일치해야 완전히 연결되며, 미분류 자료는 정보 수정에서 지정하세요.",
        demo: "filename-archive"
      },
      coarse: {
        title: "파일명 자동 분류",
        description: "부감도 파일명이 S12C3.jpg처럼 씬과 컷을 포함하면 업로드할 때 S12/C3 자료로 자동 분류됩니다.",
        detail: "Scene12Cut3, 씬12컷3, S12(3), 폴더의 S12/C3도 읽습니다. 씬리스트의 씬과 유효한 컷 번호가 일치해야 완전히 연결되며, 미분류 자료는 정보 수정에서 지정하세요.",
        demo: "filename-archive"
      }
    }
  },
  "archive.interaction-asset-info": {
    id: "archive.interaction-asset-info",
    page: "archive",
    anchor: "archive.asset",
    permission: "manage",
    preferredPlacement: "top",
    priority: 30,
    manualOnly: true,
    variants: {
      fine: {
        title: "씬 · 컷 지정",
        description: "자료를 우클릭하면 정보 수정 창이 바로 열립니다. 창의 씬과 컷 필드에서 보관 위치를 바꿀 수 있습니다.",
        demo: "context-scene-cut"
      },
      coarse: {
        title: "씬 · 컷 지정",
        description: "자료를 약 0.55초 동안 길게 눌러 선택 모드로 전환한 뒤, 한 장만 선택하고 화면 아래 정보 수정을 눌러 씬과 컷을 바꿀 수 있습니다.",
        demo: "context-scene-cut",
        durationMs: 550
      }
    }
  },
  "archive.interaction-crop-ratio": {
    id: "archive.interaction-crop-ratio",
    page: "archive",
    anchor: "archive.crop-ratio",
    standaloneContextAnchors: ["archive.upload"],
    permission: "manage",
    preferredPlacement: "bottom",
    priority: 40,
    manualOnly: true,
    variants: {
      fine: {
        title: "콘티 비율 맞추기",
        description: "콘티 PDF나 이미지를 올린 뒤 첫 그림칸을 직접 드래그하고 기준 비율로 적용하면 같은 격자의 후보를 만들 수 있습니다.",
        detail: "그림칸을 자동 판독하는 단계가 아니라, 사용자가 첫 칸의 범위를 정해 나머지 후보에 적용하는 방식입니다.",
        demo: "crop-ratio"
      },
      coarse: {
        title: "콘티 비율 맞추기",
        description: "콘티 PDF나 이미지를 올린 뒤 첫 그림칸의 범위를 손가락으로 지정하고 기준 비율로 적용하면 같은 격자의 후보를 만들 수 있습니다.",
        detail: "그림칸을 자동 판독하는 단계가 아니라, 사용자가 첫 칸의 범위를 정해 나머지 후보에 적용하는 방식입니다.",
        demo: "crop-ratio"
      }
    }
  },
  "archive.interaction-crop-scene-cut": {
    id: "archive.interaction-crop-scene-cut",
    page: "archive",
    anchor: "archive.crop-scene-cut",
    standaloneContextAnchors: ["archive.upload", "archive.crop-ratio"],
    permission: "manage",
    preferredPlacement: "bottom",
    priority: 50,
    manualOnly: true,
    variants: {
      fine: {
        title: "씬 · 컷 입력",
        description: "각 후보의 왼쪽 위 씬과 오른쪽 위 컷을 지정한 뒤 추출 확정을 누르면 해당 씬 · 컷 자료로 보관됩니다.",
        detail: "이전 · 다음 화살표는 크롭 후보가 아니라 원본 PDF 또는 이미지 페이지를 이동합니다.",
        demo: "crop-scene-cut"
      },
      coarse: {
        title: "씬 · 컷 입력",
        description: "각 후보의 왼쪽 위 씬과 오른쪽 위 컷을 지정한 뒤 추출 확정을 누르면 해당 씬 · 컷 자료로 보관됩니다.",
        detail: "이전 · 다음 화살표는 크롭 후보가 아니라 원본 PDF 또는 이미지 페이지를 이동합니다.",
        demo: "crop-scene-cut"
      }
    }
  },
  "archive.interaction-touch-selection": {
    id: "archive.interaction-touch-selection",
    page: "archive",
    anchor: "archive.asset",
    permission: "manage",
    preferredPlacement: "top",
    priority: 60,
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
    priority: 60,
    manualOnly: true,
    variants: {
      fine: {
        title: "여러 장 선택",
        description: "선택 모드에서 Shift+클릭하면 연속 범위를 선택하고, macOS는 ⌘+클릭, Windows는 Ctrl+클릭으로 떨어진 자료를 추가하거나 해제할 수 있습니다.",
        demo: "shift-range",
        modifierLabel: "Shift · ⌘ / Ctrl"
      }
    }
  },
  "archive.interaction-asset-reorder": {
    id: "archive.interaction-asset-reorder",
    page: "archive",
    anchor: "archive.asset-reorder",
    permission: "manage",
    preferredPlacement: "top",
    priority: 70,
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
    priority: 80,
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
  },
  "archive.interaction-diagram-person-add": {
    id: "archive.interaction-diagram-person-add",
    page: "archive",
    anchor: "archive.diagram-person-tool",
    compactAnchor: "archive.diagram-canvas",
    permission: "manage",
    preferredPlacement: "bottom",
    priority: 60,
    manualOnly: true,
    variants: {
      fine: {
        title: "인물 만들기",
        description: "인물 도구를 누르면 작은 top-view 인물이 추가되고 바로 선택됩니다.",
        demo: "tap"
      },
      coarse: {
        title: "인물 만들기",
        description: "인물 도구를 누르면 작은 top-view 인물이 추가되고 바로 선택됩니다.",
        demo: "tap"
      }
    }
  },
  "archive.interaction-diagram-person-move": {
    id: "archive.interaction-diagram-person-move",
    page: "archive",
    anchor: "archive.diagram-canvas",
    permission: "manage",
    preferredPlacement: "top",
    priority: 70,
    manualOnly: true,
    variants: {
      fine: {
        title: "오브젝트 위치 이동",
        description: "인물·카메라·공간 오브젝트를 끌어 원하는 위치로 이동할 수 있습니다.",
        detail: "일반 드래그는 오브젝트 위치만 바꾸며 무빙 경로를 만들지 않습니다.",
        demo: "object-drag"
      },
      coarse: {
        title: "오브젝트 위치 이동",
        description: "인물·카메라·공간 오브젝트를 끌어 원하는 위치로 이동할 수 있습니다.",
        detail: "일반 드래그는 오브젝트 위치만 바꾸며 무빙 경로를 만들지 않습니다.",
        demo: "object-drag"
      }
    }
  },
  "archive.interaction-diagram-object-menu": {
    id: "archive.interaction-diagram-object-menu",
    page: "archive",
    anchor: "archive.diagram-canvas",
    permission: "manage",
    preferredPlacement: "top",
    priority: 80,
    manualOnly: true,
    variants: {
      fine: {
        title: "오브젝트 편집 메뉴",
        description: "오브젝트를 우클릭하면 이름·색상과 오브젝트별 동작을 편집할 수 있습니다.",
        detail: "브라우저 메뉴 대신 부감도 전용 편집 메뉴가 열립니다.",
        demo: "object-context-menu"
      },
      coarse: {
        title: "오브젝트 편집 메뉴",
        description: "오브젝트를 길게 누르면 편집 메뉴가 열립니다. 메뉴에서 이름·색상과 오브젝트별 동작을 편집할 수 있습니다.",
        detail: "길게 누르기는 편집 메뉴만 열며 무빙 경로를 바로 만들지 않습니다.",
        demo: "object-context-menu",
        durationMs: 520
      }
    }
  },
  "archive.interaction-diagram-camera-move": {
    id: "archive.interaction-diagram-camera-move",
    page: "archive",
    anchor: "archive.diagram-canvas",
    permission: "manage",
    preferredPlacement: "top",
    priority: 90,
    manualOnly: true,
    variants: {
      fine: {
        title: "카메라 무빙 · 패닝",
        description: "카메라를 우클릭하면 위치가 변하는 무빙과, 제자리에서 방향만 바뀌는 패닝을 각각 설정할 수 있습니다.",
        detail: "무빙은 경로와 도착 카메라로, 패닝은 카메라 주변 회전 화살표로 구분됩니다. 두 열린 선은 현재 화각입니다.",
        demo: "camera-pan"
      },
      coarse: {
        title: "카메라 무빙 · 패닝",
        description: "카메라를 길게 눌러 편집 메뉴를 열면 위치가 변하는 무빙과, 제자리에서 방향만 바뀌는 패닝을 각각 설정할 수 있습니다.",
        detail: "무빙은 경로와 도착 카메라로, 패닝은 카메라 주변 회전 화살표로 구분됩니다. 두 열린 선은 현재 화각입니다.",
        demo: "camera-pan",
        durationMs: 520
      }
    }
  },
  "archive.interaction-diagram-rotate": {
    id: "archive.interaction-diagram-rotate",
    page: "archive",
    anchor: "archive.diagram-canvas",
    permission: "manage",
    preferredPlacement: "top",
    priority: 100,
    manualOnly: true,
    variants: {
      fine: {
        title: "방향 회전",
        description: "선택한 인물이나 카메라의 회전 컨트롤 포인트를 끌어 방향을 조정할 수 있습니다.",
        demo: "drag"
      },
      coarse: {
        title: "방향 회전",
        description: "선택한 인물이나 카메라의 회전 컨트롤 포인트를 끌어 방향을 조정할 수 있습니다.",
        demo: "drag"
      }
    }
  },
  "archive.interaction-diagram-room": {
    id: "archive.interaction-diagram-room",
    page: "archive",
    anchor: "archive.diagram-room-tool",
    compactAnchor: "archive.diagram-canvas",
    permission: "manage",
    preferredPlacement: "bottom",
    priority: 110,
    manualOnly: true,
    variants: {
      fine: {
        title: "공간 만들기",
        description: "공간 도구로 점을 이어 벽을 만들고, 시작점에 연결하면 닫힌 공간이 됩니다.",
        detail: "Enter로 닫고, 더블클릭이나 Escape로 열린 벽을 끝낼 수 있습니다. 만든 공간은 모서리 컨트롤 포인트를 끌어 형태를 조정할 수 있습니다.",
        demo: "tap"
      },
      coarse: {
        title: "공간 만들기",
        description: "공간 도구로 점을 이어 벽을 만들고, 시작점에 연결하면 닫힌 공간이 됩니다.",
        detail: "완료 동작으로 닫힌 공간을 만들거나 열린 벽으로 끝낼 수 있습니다. 만든 공간은 모서리 컨트롤 포인트를 끌어 형태를 조정할 수 있습니다.",
        demo: "tap"
      }
    }
  },
  "archive.interaction-diagram-path": {
    id: "archive.interaction-diagram-path",
    page: "archive",
    anchor: "archive.diagram-canvas",
    permission: "manage",
    preferredPlacement: "bottom",
    priority: 120,
    manualOnly: true,
    variants: {
      fine: {
        title: "인물 · 카메라 무빙 만들기",
        description: "인물이나 카메라를 우클릭하고 무빙 만들기를 선택한 뒤, 오브젝트에서 목적지까지 끌어 이동 경로를 만드세요.",
        detail: "무빙을 만들어도 원본 오브젝트 위치는 그대로이며 목적지에는 연한 오브젝트가 표시됩니다.",
        demo: "movement-create"
      },
      coarse: {
        title: "인물 · 카메라 무빙 만들기",
        description: "인물이나 카메라를 길게 눌러 무빙 만들기를 선택한 뒤, 오브젝트에서 목적지까지 끌어 이동 경로를 만드세요.",
        detail: "무빙을 만들어도 원본 오브젝트 위치는 그대로이며 목적지에는 연한 오브젝트가 표시됩니다.",
        demo: "movement-create"
      }
    }
  },
  "archive.interaction-diagram-curve": {
    id: "archive.interaction-diagram-curve",
    page: "archive",
    anchor: "archive.diagram-canvas",
    permission: "manage",
    preferredPlacement: "top",
    priority: 130,
    manualOnly: true,
    variants: {
      fine: {
        title: "곡선 무빙 편집",
        description: "무빙 선을 우클릭해 포인트를 추가하고, 컨트롤 포인트를 끌어 경로 형태를 조정할 수 있습니다.",
        detail: "무빙 선의 도착점을 옮기면 연한 도착 오브젝트도 함께 이동합니다.",
        demo: "movement-curve"
      },
      coarse: {
        title: "곡선 무빙 편집",
        description: "무빙 선을 길게 눌러 포인트를 추가하고, 컨트롤 포인트를 끌어 경로 형태를 조정할 수 있습니다.",
        detail: "무빙 선의 도착점을 옮기면 연한 도착 오브젝트도 함께 이동합니다.",
        demo: "movement-curve",
        durationMs: 520
      }
    }
  },
  "archive.interaction-diagram-undo": {
    id: "archive.interaction-diagram-undo",
    page: "archive",
    anchor: "archive.diagram-history",
    compactAnchor: "archive.diagram-canvas",
    permission: "manage",
    preferredPlacement: "bottom",
    priority: 140,
    manualOnly: true,
    variants: {
      fine: {
        title: "실행 취소",
        description: "실행 취소 버튼이나 ⌘Z / Ctrl+Z로 마지막 편집을 되돌릴 수 있습니다.",
        demo: "tap",
        modifierLabel: "⌘Z / Ctrl+Z"
      },
      coarse: {
        title: "실행 취소",
        description: "실행 취소 버튼으로 마지막 편집을 되돌리고, 다시 실행으로 복구할 수 있습니다.",
        demo: "tap"
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
