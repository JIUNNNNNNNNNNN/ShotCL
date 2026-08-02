import {
  decodeDailyPlanMemo,
  encodeDailyPlanMemo,
  type DailyPlanPrintMeta
} from "@/lib/dailyPlan/printMeta";
import type {
  DailyPlan,
  DailyPlanDraft,
  DailyPlanLocation,
  DailyPlanMealTime,
  DailyPlanShot,
  DailyPlanShotDraft
} from "@/lib/types";

type DailyPlanDuplicateInput = {
  plan: DailyPlan;
  shots: DailyPlanShot[];
  existingEpisodes: unknown[];
};

type DailyPlanDuplicateDraft = {
  plan: DailyPlanDraft;
  shots: DailyPlanShotDraft[];
};

/** 프로젝트에 저장된 숫자 회차 중 가장 큰 값의 다음 정수 회차를 반환합니다. */
export function getNextDailyPlanEpisode(existingEpisodes: unknown[]) {
  const maximumEpisode = existingEpisodes.reduce<number>((maximum, value) => {
    const match = String(value ?? "").normalize("NFKC").match(/\d+/u);
    if (!match) return maximum;
    const episode = Number(match[0]);
    return Number.isSafeInteger(episode) && episode > maximum ? episode : maximum;
  }, 0);

  return String(maximumEpisode + 1);
}

/**
 * 복사본 안에서만 의미가 있는 ID를 새로 발급하고 연결된 참조를 함께 바꿉니다.
 * 씬리스트 sourceSceneId 같은 프로젝트 공용 식별자는 그대로 유지합니다.
 */
export function buildDailyPlanDuplicateDraft(input: DailyPlanDuplicateInput): DailyPlanDuplicateDraft {
  const locationIds = new Map<string, string>();
  const locations = input.plan.shootingLocations.map((location) => cloneLocation(location, locationIds));
  const mealIds = new Map<string, string>();
  const mealTimes = input.plan.mealTimes.map((meal) => cloneMealTime(meal, locationIds, mealIds));
  const memo = cloneDailyPlanMemo(input.plan.memo, locationIds, mealIds);
  const shots = [...input.shots]
    .sort(compareDailyPlanShotOrder)
    .map((shot, index) => ({
      orderIndex: index + 1,
      startTime: shot.startTime,
      endTime: shot.endTime,
      sceneNumber: shot.sceneNumber,
      sceneTitle: shot.sceneTitle ?? "",
      locationId: remapId(shot.locationId, locationIds),
      locationName: shot.locationName ?? shot.subLocation ?? "",
      cutNumber: shot.cutNumber,
      subject: shot.subject,
      subLocation: shot.subLocation,
      dayNight: shot.dayNight,
      liveSync: shot.liveSync,
      cutType: shot.cutType,
      storyDay: shot.storyDay,
      description: shot.description,
      props: shot.props,
      costumeMakeup: shot.costumeMakeup,
      sceneMemo: shot.sceneMemo ?? "",
      memo: shot.memo,
      status: shot.status
    }));

  return {
    plan: {
      title: `${input.plan.title || "일촬표"} 복사본`,
      sourceType: "web_editor",
      sourceFileName: input.plan.sourceFileName,
      shootingDate: input.plan.shootingDate,
      episode: getNextDailyPlanEpisode(input.existingEpisodes),
      director: input.plan.director,
      dop: input.plan.dop,
      assistantDirector: input.plan.assistantDirector,
      production: input.plan.production,
      callTime: input.plan.callTime,
      shootStartTime: input.plan.shootStartTime,
      shootEndTime: input.plan.shootEndTime,
      meetingLocation: input.plan.meetingLocation,
      shootingLocation: input.plan.shootingLocation,
      shootingLocations: locations,
      mealTime: input.plan.mealTime,
      mealTimes,
      safetyNotice: input.plan.safetyNotice,
      memo
    },
    shots
  };
}

function cloneLocation(location: DailyPlanLocation, idMap: Map<string, string>): DailyPlanLocation {
  const sourceId = String(location.id ?? "").trim();
  const id = createNestedId("location");
  if (sourceId) idMap.set(sourceId, id);
  return {
    ...location,
    id,
    selectedMajorLocations: location.selectedMajorLocations?.map((selection) => ({ ...selection }))
  };
}

function cloneMealTime(
  meal: DailyPlanMealTime,
  locationIds: Map<string, string>,
  mealIds: Map<string, string>
): DailyPlanMealTime {
  const sourceId = String(meal.id ?? "").trim();
  const id = createNestedId("event");
  if (sourceId) mealIds.set(sourceId, id);
  return {
    ...meal,
    id,
    locationId: remapId(meal.locationId, locationIds)
  };
}

function cloneDailyPlanMemo(
  memo: string,
  locationIds: Map<string, string>,
  mealIds: Map<string, string>
) {
  const source = decodeDailyPlanMemo(memo);
  const mainStaff = source.mainStaff.map((row) => ({
    ...row,
    id: createNestedId("main_staff")
  }));
  const starringIds = new Map<string, string>();
  const starring = source.starring.map((row) => {
    const id = createNestedId("star");
    if (row.id) starringIds.set(row.id, id);
    return { ...row, id };
  });
  const sceneIds = new Map<string, string>();
  const timetableScenes = source.timetableScenes.map((scene) => {
    const rowId = createNestedId("scene");
    sceneIds.set(scene.rowId, rowId);
    return {
      ...scene,
      rowId,
      characterIdsOverride: scene.characterIdsOverride
        ? scene.characterIdsOverride.map((id) => starringIds.get(id) ?? id)
        : undefined,
      sourceSnapshot: scene.sourceSnapshot ? { ...scene.sourceSnapshot } : null,
      rowSnapshot: {
        ...scene.rowSnapshot,
        locationId: remapId(scene.rowSnapshot.locationId, locationIds),
        cuts: scene.rowSnapshot.cuts.map((cut) => ({
          ...cut,
          id: createNestedId("cut")
        }))
      }
    };
  });

  const gatheringPointIds = new Map<string, string>();
  const gatheringPoints = source.gatheringPoints.map((point) => {
    const id = createNestedId("gathering");
    gatheringPointIds.set(point.id, id);
    return {
      ...point,
      id,
      locationId: remapOptionalId(point.locationId, locationIds),
      departmentIds: [...point.departmentIds],
      departmentTimes: point.departmentTimes.map((item) => ({ ...item })),
      photos: point.photos.map((photo) => ({
        ...photo,
        // URL/path는 같은 파일을 읽되 child identity는 복사본과 분리합니다.
        id: createNestedId("photo")
      }))
    };
  });

  const cloned: DailyPlanPrintMeta = {
    ...source,
    timetableScenes,
    automaticTimetableRowIds: source.automaticTimetableRowIds.map((rowKey) => (
      remapTimetableRowKey(rowKey, sceneIds, mealIds)
    )),
    timetableRowOrder: [...source.timetableRowOrder],
    mainStaff,
    starring,
    teams: source.teams.map((row) => ({
      ...row,
      id: createNestedId("team"),
      callLocationId: remapOptionalId(row.callLocationId, locationIds),
      gatheringPointId: remapOptionalId(row.gatheringPointId, gatheringPointIds)
    })),
    selectedSceneLocations: source.selectedSceneLocations.map((selection) => ({ ...selection })),
    gatheringPoints
  };

  return encodeDailyPlanMemo(cloned);
}

function remapTimetableRowKey(
  rowKey: string,
  sceneIds: Map<string, string>,
  mealIds: Map<string, string>
) {
  const separator = rowKey.indexOf(":");
  if (separator < 0) return rowKey;
  const type = rowKey.slice(0, separator);
  const sourceId = rowKey.slice(separator + 1);
  if (type === "scene") return `scene:${sceneIds.get(sourceId) ?? sourceId}`;
  if (type === "event") return `event:${mealIds.get(sourceId) ?? sourceId}`;
  return rowKey;
}

function remapId(value: string | undefined, idMap: Map<string, string>) {
  const sourceId = String(value ?? "").trim();
  return sourceId ? idMap.get(sourceId) ?? sourceId : "";
}

function remapOptionalId(value: string | undefined, idMap: Map<string, string>) {
  const remapped = remapId(value, idMap);
  return remapped || undefined;
}

function compareDailyPlanShotOrder(left: DailyPlanShot, right: DailyPlanShot) {
  const orderDifference = normalizeOrderIndex(left.orderIndex) - normalizeOrderIndex(right.orderIndex);
  if (orderDifference !== 0) return orderDifference;
  const createdDifference = String(left.createdAt ?? "").localeCompare(String(right.createdAt ?? ""));
  if (createdDifference !== 0) return createdDifference;
  return left.id.localeCompare(right.id);
}

function normalizeOrderIndex(value: unknown) {
  const normalized = Number(value);
  return Number.isFinite(normalized) ? normalized : Number.MAX_SAFE_INTEGER;
}

function createNestedId(prefix: string) {
  const id = typeof globalThis.crypto?.randomUUID === "function"
    ? globalThis.crypto.randomUUID()
    : `${Date.now()}-${Math.random().toString(16).slice(2)}`;
  return `${prefix}_${id}`;
}
