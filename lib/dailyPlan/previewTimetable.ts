// Node's type-stripping tests need an explicit extension, while Next resolves
// the same module during application builds.
// @ts-ignore -- explicit .ts import is intentional for the pure node tests.
import { hasMeaningfulRowValue } from "./previewDisplay.ts";

export type DailyPlanPreviewTimetableRow =
  | {
      type: "scene";
      start: string;
      end: string;
      runtime: string;
      location: string;
      dayNight: string;
      sceneNumber: string;
      totalCut: string;
      cast: string;
      description: string;
      shootingOrder: string;
      notes: string;
    }
  | {
      type: "additionalSchedule";
      start: string;
      end: string;
      runtime: string;
      location: string;
      memo: string;
    };

export const DAILY_PLAN_TIMETABLE_COLUMN_COUNT = 16;
export const DAILY_PLAN_TIMETABLE_TIME_COLUMN_SPAN = 3;
export const DAILY_PLAN_TIMETABLE_LOCATION_COLUMN_SPAN = 2;
export const DAILY_PLAN_TIMETABLE_ADDITIONAL_CONTENT_SPAN =
  DAILY_PLAN_TIMETABLE_COLUMN_COUNT - DAILY_PLAN_TIMETABLE_TIME_COLUMN_SPAN;

export type DailyPlanAdditionalScheduleCellLayout = {
  hasLocation: boolean;
  locationSpan: number;
  contentSpan: number;
};

/**
 * 기타일정은 실제 table leaf column을 그대로 사용합니다. 장소가 없으면
 * LOCATION부터 끝까지, 있으면 LOCATION 1칸 뒤의 나머지를 내용에 줍니다.
 */
export function getDailyPlanAdditionalScheduleCellLayout(
  location: unknown,
  availableSpan = DAILY_PLAN_TIMETABLE_ADDITIONAL_CONTENT_SPAN
): DailyPlanAdditionalScheduleCellLayout {
  const hasLocation = hasMeaningfulRowValue(location);
  const locationSpan = hasLocation ? DAILY_PLAN_TIMETABLE_LOCATION_COLUMN_SPAN : 0;
  return {
    hasLocation,
    locationSpan,
    contentSpan: availableSpan - locationSpan
  };
}

/**
 * 데스크톱 화면 미리보기와 PDF가 함께 사용하는 16개 leaf column의 상대 폭입니다.
 * 기존 colSpan은 유지하면서 LOCATION/D/N/SCENE/Total Cut을 줄이고 긴 정보 열에 폭을 돌려줍니다.
 */
export const DAILY_PLAN_TIMETABLE_COLUMN_WEIGHTS = [
  50, 50, 50,
  36, 36,
  32,
  40,
  40,
  61, 61, 62,
  72,
  50, 50,
  55, 55
] as const;
