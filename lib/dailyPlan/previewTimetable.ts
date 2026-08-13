// Node's type-stripping tests need an explicit extension, while Next resolves
// the same module during application builds.
// @ts-ignore -- explicit .ts import is intentional for the pure node tests.
import { filterRenderablePreviewRows, hasMeaningfulRowValue } from "./previewDisplay.ts";
// @ts-ignore -- explicit .ts import keeps this canonical builder directly testable in Node.
import { decodeDailyPlanMemo, mergeDailyPlanTimetableRows, resolveDailyPlanTimetableSceneValues, type CallSheetPerson, type DailyPlanPrintMeta } from "./printMeta.ts";
// @ts-ignore -- explicit .ts import keeps this canonical builder directly testable in Node.
import { formatDailyPlanTimetableLocation } from "./sceneLocations.ts";
// @ts-ignore -- explicit .ts import keeps this canonical builder directly testable in Node.
import { getDailyPlanLocationReferenceAddress } from "./locationReferences.ts";
// @ts-ignore -- explicit .ts import keeps this canonical builder directly testable in Node.
import { normalizeDailyPlanDayNight } from "./dayNight.ts";
// @ts-ignore -- explicit .ts import keeps this canonical builder directly testable in Node.
import { formatTimetableCutDisplay, normalizeAllocatedCutNumbers, resolveAllocatedCutNumbers } from "./cutAllocation.ts";
// @ts-ignore -- explicit .ts import keeps this canonical builder directly testable in Node.
import { formatShootingOrderForOutput } from "./shootingOrder.ts";
// @ts-ignore -- explicit .ts import keeps this canonical builder directly testable in Node.
import { getTimetableRuntimeMinutes, normalizeTimetableTime } from "./timetableStartTimes.ts";
import type { DailyPlan, DailyPlanDraft, DailyPlanMealTime, DailyPlanShot } from "../types.ts";

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

type DailyPlanPreviewSceneRow = Extract<DailyPlanPreviewTimetableRow, { type: "scene" }>;

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
 * 기존 colSpan은 유지하면서 짧은 시간·메타정보 열을 압축하고 Description에 폭을 돌려줍니다.
 */
export const DAILY_PLAN_TIMETABLE_COLUMN_WEIGHTS = [
  40, 40, 48,
  36, 36,
  30,
  38,
  38,
  80, 80, 80,
  64,
  48, 48,
  47, 47
] as const;

/**
 * 저장된 일촬표에서 화면 미리보기와 Home이 함께 소비하는 canonical 표 행을 만듭니다.
 *
 * 최신 데이터는 memo의 versioned timetableScenes를 단일 원본으로 사용합니다. 이
 * 스냅샷이 없는 과거 일촬표에 한해서만 선택 시 불러온 daily_plan_shots를 복원
 * 입력으로 사용하므로, 최신 행이 legacy shot 데이터로 덮이지 않습니다.
 */
export function buildDailyPlanPreviewTimetableRows(
  plan: DailyPlan | DailyPlanDraft,
  legacyShots: readonly DailyPlanShot[] = []
): DailyPlanPreviewTimetableRow[] {
  const meta = decodeDailyPlanMemo(plan.memo);
  const hasPersistedScenes = meta.timetableScenes.length > 0;
  const sceneRows = hasPersistedScenes
    ? buildPersistedSceneRows(meta)
    : buildLegacyShotSceneRows(legacyShots, meta);
  const additionalScheduleRows = buildAdditionalScheduleRows(plan);
  const hasExplicitTimetableOrder = meta.timetableRowOrder.length > 0;
  const orderedSceneRows = hasExplicitTimetableOrder
    ? sceneRows
    : sortSceneRowsNaturally(sceneRows);

  return hasExplicitTimetableOrder
    ? mergeDailyPlanTimetableRows(
      orderedSceneRows,
      additionalScheduleRows,
      meta.timetableRowOrder
    )
    : [...orderedSceneRows, ...additionalScheduleRows];
}

function buildPersistedSceneRows(meta: DailyPlanPrintMeta) {
  const rows = meta.timetableScenes.map((scene): DailyPlanPreviewSceneRow => {
    const snapshot = scene.rowSnapshot;
    const effective = resolveDailyPlanTimetableSceneValues(scene);
    const totalCuts = effective.totalCuts;
    const selectedCutNumbers = Object.prototype.hasOwnProperty.call(scene, "selectedCutNumbers")
      ? normalizeAllocatedCutNumbers(scene.selectedCutNumbers, totalCuts)
      : null;
    const allocatedCutNumbers = resolveAllocatedCutNumbers(selectedCutNumbers, totalCuts);
    const firstAllocatedCutMemo = allocatedCutNumbers.length > 0
      ? snapshot.cuts[allocatedCutNumbers[0] - 1]?.memo ?? ""
      : "";
    const start = formatTimetableTime(snapshot.startTime);
    const end = formatTimetableTime(snapshot.endTime);

    return {
      type: "scene",
      start,
      end,
      runtime: formatRuntimeMinutes(getTimetableRuntimeMinutes(
        snapshot.runtimeMinutes,
        snapshot.runtime,
        start,
        end
      )),
      location: formatDailyPlanTimetableLocation(
        effective.mainLocation,
        effective.subLocation
      ),
      dayNight: normalizeDailyPlanDayNight(snapshot.dayNight),
      sceneNumber: formatSceneNumber(snapshot.sceneNumber),
      totalCut: formatTimetableCutDisplay(selectedCutNumbers, totalCuts),
      cast: getValidSceneCastValue(effective.characters, meta.starring),
      description: effective.sceneContent,
      shootingOrder: formatShootingOrderForOutput(
        snapshot.shootingOrder,
        totalCuts,
        selectedCutNumbers
      ),
      notes: snapshot.notes || firstAllocatedCutMemo
    };
  });

  return filterRenderablePreviewRows(rows, getSceneRowDisplayValues);
}

function buildAdditionalScheduleRows(plan: DailyPlan | DailyPlanDraft) {
  const meals = getPersistedAdditionalSchedules(plan);
  const renderableMeals = filterRenderablePreviewRows(meals, (meal) => [
    meal.startTime,
    meal.endTime,
    meal.runtimeMinutes,
    meal.runtime,
    meal.locationId,
    meal.memo
  ]);

  return renderableMeals.map((meal): DailyPlanPreviewTimetableRow => {
    const start = formatTimetableTime(meal.startTime);
    const end = formatTimetableTime(meal.endTime);
    return {
      type: "additionalSchedule",
      start,
      end,
      runtime: formatRuntimeMinutes(getTimetableRuntimeMinutes(
        meal.runtimeMinutes,
        meal.runtime,
        start,
        end
      )),
      location: getDailyPlanLocationReferenceAddress({
        locations: plan.shootingLocations ?? [],
        locationId: meal.locationId
      }),
      memo: String(meal.memo ?? "")
    };
  });
}

function getPersistedAdditionalSchedules(
  plan: DailyPlan | DailyPlanDraft
): DailyPlanMealTime[] {
  if (plan.mealTimes?.length) return plan.mealTimes;
  const legacyMemo = String(plan.mealTime ?? "").trim();
  if (!legacyMemo) return [];
  return [{
    id: "legacy-meal-time",
    startTime: "",
    endTime: "",
    runtimeMinutes: null,
    runtime: "",
    memo: legacyMemo
  }];
}

type LegacyScene = {
  startTime: string;
  endTime: string;
  mainLocation: string;
  subLocation: string;
  dayNight: string;
  sceneNumber: string;
  description: string;
  subject: string;
  shootingOrder: string;
  notes: string;
  cutNumbers: string[];
};

function buildLegacyShotSceneRows(
  legacyShots: readonly DailyPlanShot[],
  meta: DailyPlanPrintMeta
) {
  const scenes: LegacyScene[] = [];
  const sceneMap = new Map<string, LegacyScene>();
  const sortedShots = legacyShots
    .map((shot, sourceIndex) => ({ shot, sourceIndex }))
    .sort((left, right) => (
      left.shot.orderIndex - right.shot.orderIndex || left.sourceIndex - right.sourceIndex
    ))
    .map(({ shot }) => shot);

  sortedShots.forEach((shot) => {
    const key = [
      shot.sceneNumber || String(scenes.length + 1),
      shot.sceneTitle || "",
      shot.startTime || "",
      shot.endTime || "",
      shot.locationId || shot.locationName || shot.subLocation || ""
    ].join("|");
    let scene = sceneMap.get(key);
    if (!scene) {
      const sceneMemo = decodeLegacySceneMemo(shot.sceneMemo ?? "");
      scene = {
        startTime: shot.startTime ?? "",
        endTime: shot.endTime ?? "",
        mainLocation: shot.locationName ?? "",
        subLocation: shot.subLocation ?? "",
        dayNight: shot.dayNight ?? "",
        sceneNumber: shot.sceneNumber ?? "",
        description: shot.description ?? "",
        subject: shot.subject ?? "",
        shootingOrder: sceneMemo.shootingOrder,
        notes: shot.memo ?? "",
        cutNumbers: []
      };
      sceneMap.set(key, scene);
      scenes.push(scene);
    }

    expandLegacyCutNumbers(shot.cutNumber).forEach((cutNumber) => {
      if (!scene?.cutNumbers.includes(cutNumber)) scene?.cutNumbers.push(cutNumber);
    });
    if (!scene.shootingOrder && /[-,/\s]/.test(shot.cutNumber)) {
      scene.shootingOrder = shot.cutNumber.trim();
    }
    scene.description = scene.description || shot.description || "";
    scene.subject = scene.subject || shot.subject || "";
    scene.notes = scene.notes || shot.memo || "";
  });

  const rows = scenes.map((scene): DailyPlanPreviewSceneRow => {
    const totalCuts = scene.cutNumbers.length;
    const start = formatTimetableTime(scene.startTime);
    const end = formatTimetableTime(scene.endTime);
    return {
      type: "scene",
      start,
      end,
      runtime: formatRuntimeMinutes(getTimetableRuntimeMinutes(null, "", start, end)),
      location: formatDailyPlanTimetableLocation(scene.mainLocation, scene.subLocation),
      dayNight: normalizeDailyPlanDayNight(scene.dayNight),
      sceneNumber: formatSceneNumber(scene.sceneNumber),
      totalCut: formatTimetableCutDisplay(null, totalCuts),
      cast: getValidSceneCastValue(scene.subject, meta.starring),
      description: scene.description,
      shootingOrder: formatShootingOrderForOutput(scene.shootingOrder, totalCuts, null),
      notes: scene.notes
    };
  });
  return filterRenderablePreviewRows(rows, getSceneRowDisplayValues);
}

function getSceneRowDisplayValues(
  row: DailyPlanPreviewSceneRow
) {
  return [
    row.start,
    row.end,
    row.runtime,
    row.location,
    row.dayNight,
    row.sceneNumber,
    row.totalCut,
    row.cast,
    row.description,
    row.shootingOrder,
    row.notes
  ];
}

function sortSceneRowsNaturally(
  rows: DailyPlanPreviewSceneRow[]
) {
  const collator = new Intl.Collator("ko-KR", { numeric: true, sensitivity: "base" });
  return rows
    .map((row, sourceIndex) => ({
      row,
      sourceIndex,
      numericValue: getSceneNaturalNumber(row.sceneNumber)
    }))
    .sort((left, right) => {
      if (left.numericValue !== null || right.numericValue !== null) {
        if (left.numericValue === null) return 1;
        if (right.numericValue === null) return -1;
        if (left.numericValue !== right.numericValue) return left.numericValue - right.numericValue;
      }
      return collator.compare(left.row.sceneNumber, right.row.sceneNumber)
        || left.sourceIndex - right.sourceIndex;
    })
    .map(({ row }) => row);
}

function getSceneNaturalNumber(value: string) {
  const match = String(value ?? "").match(/\d+(?:\.\d+)?/);
  if (!match) return null;
  const parsed = Number(match[0]);
  return Number.isFinite(parsed) ? parsed : null;
}

function formatSceneNumber(value: string) {
  const trimmed = String(value ?? "").trim();
  if (!trimmed) return "";
  return /^s#/i.test(trimmed) ? trimmed : `S#${trimmed}`;
}

function formatTimetableTime(value: string) {
  return normalizeTimetableTime(String(value ?? "")) ?? "";
}

function formatRuntimeMinutes(value: number | null | undefined) {
  if (value == null || !Number.isFinite(value) || value < 0) return "";
  if (value === 0) return "0M";
  const hours = Math.floor(value / 60);
  const minutes = value % 60;
  if (minutes === 0) return `${hours}H`;
  if (hours === 0) return `${minutes}M`;
  return `${hours}H${minutes}M`;
}

function getValidSceneCastValue(value: string, people: CallSheetPerson[]) {
  const normalizedRoles = parseSceneCastValues(value).flatMap((storedValue) => {
    const exactRole = people.find((person) => person.role.trim() === storedValue)?.role.trim();
    if (exactRole) return [exactRole];

    const legacyRoleAndName = people.find((person) => {
      const role = person.role.trim();
      const name = person.name.trim();
      return Boolean(role && name && `${role} (${name})` === storedValue);
    })?.role.trim();
    if (legacyRoleAndName) return [legacyRoleAndName];

    const knownActorName = people.find((person) => {
      const name = person.name.trim();
      return Boolean(name && (storedValue === name || storedValue.includes(name)));
    });
    if (knownActorName) {
      const role = knownActorName.role.trim();
      return role ? [role] : [];
    }

    const withoutLegacyActorName = storedValue.replace(/\s*\([^)]*\)\s*$/, "").trim();
    return withoutLegacyActorName ? [withoutLegacyActorName] : [];
  });
  return Array.from(new Set(normalizedRoles)).join(", ");
}

function parseSceneCastValues(value: string) {
  return Array.from(new Set(
    String(value ?? "")
      .split(/[,，]/)
      .map((item) => item.trim())
      .filter(Boolean)
  ));
}

function decodeLegacySceneMemo(value: string) {
  const match = String(value ?? "").match(/^\[\[SHOTCL_SHOOTING_ORDER:([^\]]*)\]\](?:\n)?/);
  if (!match) return { shootingOrder: "", sceneMemo: value };
  let shootingOrder = "";
  try {
    shootingOrder = decodeURIComponent(match[1]);
  } catch {
    shootingOrder = "";
  }
  return {
    shootingOrder,
    sceneMemo: value.slice(match[0].length)
  };
}

function expandLegacyCutNumbers(value: string) {
  const normalized = String(value ?? "").trim();
  if (/^\d+$/.test(normalized)) {
    const cutNumber = Number(normalized);
    return Number.isInteger(cutNumber) && cutNumber > 0 && cutNumber <= 80
      ? [String(cutNumber)]
      : [];
  }

  const tokens = normalized
    .split(/[-,/\s]+/)
    .map((item) => Number(item))
    .filter((item) => Number.isInteger(item) && item > 0 && item <= 80);
  const highestCut = Math.max(0, ...tokens);
  return Array.from({ length: highestCut }, (_, index) => String(index + 1));
}
