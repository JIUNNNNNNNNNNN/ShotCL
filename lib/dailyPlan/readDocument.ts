// @ts-ignore -- explicit .ts imports keep this persisted read model directly testable in Node.
import { decodeDailyPlanMemo, type DailyPlanPrintMeta } from "./printMeta.ts";
// @ts-ignore -- explicit .ts imports keep Guest and authenticated previews on one timetable transform.
import { buildDailyPlanPreviewTimetableRows, getDailyPlanPreviewTotalCutCount, type DailyPlanPreviewTimetableRow } from "./previewTimetable.ts";
// @ts-ignore -- explicit .ts imports keep stable location references directly testable in Node.
import { getDailyPlanLocationReferenceAddress } from "./locationReferences.ts";
// @ts-ignore -- explicit .ts imports keep stored HHMM normalization directly testable in Node.
import { normalizeTimetableTime } from "./timetableStartTimes.ts";
import type {
  DailyPlan,
  DailyPlanDraft,
  DailyPlanLocation,
  DailyPlanShot
} from "../types.ts";

export type DailyPlanReadDocumentModel = {
  plan: DailyPlanDraft;
  locations: DailyPlanLocation[];
  meta: DailyPlanPrintMeta;
  timetableRows: DailyPlanPreviewTimetableRow[];
  totalCutCount: number;
};

/**
 * 저장된 일촬표 한 건을 canonical 보기 문서 입력으로 바꿉니다.
 *
 * 선택 회차의 plan snapshot만으로 header, 장소, 배우/스태프, Notice/Memo를
 * 구성하며, 과거 데이터의 timetable에만 함께 받은 shots를 fallback으로 씁니다.
 * 프로젝트 staff/scene 목록을 다시 조회하거나 현재 값으로 덮어쓰지 않습니다.
 */
export function buildDailyPlanReadDocumentModel(
  plan: DailyPlan,
  legacyShots: readonly DailyPlanShot[] = []
): DailyPlanReadDocumentModel {
  const locations = plan.shootingLocations ?? [];
  const decodedMeta = decodeDailyPlanMemo(plan.memo);
  const timetableRows = buildDailyPlanPreviewTimetableRows(plan, legacyShots);
  const meta: DailyPlanPrintMeta = {
    ...decodedMeta,
    sunrise: formatStoredTime(decodedMeta.sunrise),
    sunset: formatStoredTime(decodedMeta.sunset),
    starring: decodedMeta.starring.map((person) => ({
      ...person,
      callTime: formatStoredTime(person.callTime),
      callLocation: getDailyPlanLocationReferenceAddress({
        locations,
        locationId: person.callLocationId,
        legacyText: person.callLocation
      })
    })),
    teams: decodedMeta.teams.map((team) => ({
      ...team,
      callTime: formatStoredTime(team.callTime),
      callLocation: getDailyPlanLocationReferenceAddress({
        locations,
        locationId: team.callLocationId,
        legacyText: team.callLocation
      })
    }))
  };

  return {
    plan: {
      title: plan.title,
      sourceType: plan.sourceType,
      sourceFileName: plan.sourceFileName,
      shootingDate: plan.shootingDate,
      episode: plan.episode,
      director: plan.director,
      dop: plan.dop,
      assistantDirector: plan.assistantDirector,
      production: plan.production,
      callTime: formatStoredTime(plan.callTime),
      shootStartTime: formatStoredTime(plan.shootStartTime),
      shootEndTime: formatStoredTime(plan.shootEndTime),
      meetingLocation: plan.meetingLocation,
      shootingLocation: plan.shootingLocation,
      shootingLocations: locations,
      mealTime: plan.mealTime,
      mealTimes: plan.mealTimes ?? [],
      safetyNotice: plan.safetyNotice,
      memo: plan.memo
    },
    locations,
    meta,
    timetableRows,
    totalCutCount: getDailyPlanPreviewTotalCutCount(timetableRows)
  };
}

function formatStoredTime(value: string) {
  return normalizeTimetableTime(String(value ?? "")) ?? "";
}
