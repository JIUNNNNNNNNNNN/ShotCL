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
export const DAILY_PLAN_TIMETABLE_ADDITIONAL_CONTENT_SPAN =
  DAILY_PLAN_TIMETABLE_COLUMN_COUNT - DAILY_PLAN_TIMETABLE_TIME_COLUMN_SPAN;
