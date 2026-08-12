import {
  decodeDailyPlanMemo,
  normalizeDailyPlanPrintMeta,
  type DailyPlanGatheringPhoto,
  type DailyPlanGatheringPoint,
  type DailyPlanPrintMeta,
  type TeamCallSheetRow
} from "@/lib/dailyPlan/printMeta";
import {
  getDailyPlanLocationOutputAddress,
  resolveDailyPlanLocationReference
} from "@/lib/dailyPlan/locationReferences";
import { getDailyPlanLocationDisplayName } from "@/lib/dailyPlan/sceneLocations";
import type { DailyPlan, DailyPlanLocation } from "@/lib/types";

export type DerivedGatheringDepartment = {
  id: string;
  name: string;
  time: string;
  note: string;
};

export type DerivedDailyPlanGatheringPoint = {
  id: string;
  persistedId: string | null;
  locationId: string | null;
  locationName: string;
  address: string;
  mapUrl: string;
  note: string;
  departments: DerivedGatheringDepartment[];
  photos: DailyPlanGatheringPhoto[];
};

type TeamGroup = {
  key: string;
  preferredPointId: string;
  locationId: string;
  locationName: string;
  teams: TeamCallSheetRow[];
};

/** 표시용 장소 비교에만 사용하며 사진 relation key로는 사용하지 않습니다. */
export function normalizeGatheringLocationName(value: unknown) {
  return String(value ?? "").trim().replace(/\s+/g, " ");
}

function normalizedLocationKey(value: unknown) {
  return normalizeGatheringLocationName(value).toLocaleLowerCase("ko-KR");
}

export function selectDailyPlanGatheringPoints(
  plan: Pick<DailyPlan, "memo" | "shootingLocations">
): DerivedDailyPlanGatheringPoint[] {
  return deriveDailyPlanGatheringPoints(
    decodeDailyPlanMemo(plan.memo),
    plan.shootingLocations
  );
}

export function deriveDailyPlanGatheringPoints(
  meta: DailyPlanPrintMeta,
  locations: DailyPlanLocation[]
): DerivedDailyPlanGatheringPoint[] {
  const storedPoints = new Map(meta.gatheringPoints.map((point) => [point.id, point]));
  const namesByPointId = new Map<string, Set<string>>();

  meta.teams.forEach((team) => {
    const name = resolveTeamLocationReference(team, locations).locationName;
    if (!name || !team.gatheringPointId) return;
    const names = namesByPointId.get(team.gatheringPointId) ?? new Set<string>();
    names.add(normalizedLocationKey(name));
    namesByPointId.set(team.gatheringPointId, names);
  });

  const groups = new Map<string, DerivedDailyPlanGatheringPoint>();
  meta.teams.forEach((team) => {
    const resolvedLocation = resolveTeamLocationReference(team, locations);
    const locationName = resolvedLocation.locationName;
    if (!locationName) return;
    const storedPoint = team.gatheringPointId
      ? storedPoints.get(team.gatheringPointId) ?? null
      : null;
    const hasSplitNames = team.gatheringPointId
      ? (namesByPointId.get(team.gatheringPointId)?.size ?? 0) > 1
      : false;
    const matchesStoredName = Boolean(
      storedPoint
      && normalizedLocationKey(storedPoint.locationName) === normalizedLocationKey(locationName)
    );
    const locationId = resolvedLocation.locationId;
    const relationId = storedPoint && (!hasSplitNames || matchesStoredName)
      ? storedPoint.id
      : null;
    const groupKey = relationId
      ? `point:${relationId}`
      : locationId
        ? `location:${locationId}`
        : `legacy:${normalizedLocationKey(locationName)}`;
    const location = resolvedLocation.location ?? findLocation(locations, locationId, locationName);
    const current = groups.get(groupKey);
    const department = {
      id: team.id,
      name: normalizeGatheringLocationName(team.team) || "미분류",
      time: String(team.callTime ?? "").trim(),
      note: String(team.notes ?? "").trim()
    };

    if (current) {
      current.departments.push(department);
      current.note = uniqueText([...current.departments.map((item) => item.note), storedPoint?.note]);
      return;
    }

    groups.set(groupKey, {
      id: relationId ?? `pending:${team.id}`,
      persistedId: relationId,
      locationId: locationId || null,
      locationName,
      address: location ? getDailyPlanLocationOutputAddress(location) : String(storedPoint?.address ?? "").trim(),
      mapUrl: location?.inputMode === "manual" ? "" : location?.naverMapUrl?.trim() || "",
      note: uniqueText([department.note, storedPoint?.note]),
      departments: [department],
      photos: storedPoint?.photos ?? []
    });
  });

  return [...groups.values()];
}

/**
 * 현재 부서 행을 stable gathering point metadata와 맞춥니다.
 * 기존 장소명이 유지되는 그룹을 먼저 배정해 부분 분리 시 사진이 엉뚱한 새 장소로 이동하지 않게 합니다.
 */
export function reconcileDailyPlanGatheringPoints(
  sourceMeta: DailyPlanPrintMeta,
  locations: DailyPlanLocation[]
): DailyPlanPrintMeta {
  const meta = normalizeDailyPlanPrintMeta(sourceMeta);
  const existingPoints = new Map(meta.gatheringPoints.map((point) => [point.id, point]));
  const groups = collectTeamGroups(meta.teams, locations, existingPoints);
  const assignedPointIds = new Set<string>();
  const assignments = new Map<string, string>();

  // 저장된 장소명과 동일한 그룹이 기존 사진/ID를 우선 이어받습니다.
  groups.forEach((group) => {
    const candidateIds = unique([
      group.preferredPointId,
      ...group.teams.map((team) => team.gatheringPointId)
    ]);
    const matchedId = candidateIds.find((id) => {
      const point = existingPoints.get(id);
      return point
        && !assignedPointIds.has(id)
        && normalizedLocationKey(point.locationName) === normalizedLocationKey(group.locationName);
    });
    if (!matchedId) return;
    assignments.set(group.key, matchedId);
    assignedPointIds.add(matchedId);
  });

  groups.forEach((group) => {
    if (assignments.has(group.key)) return;
    const candidateIds = unique([
      group.preferredPointId,
      ...group.teams.map((team) => team.gatheringPointId)
    ]);
    const matchedTeamPointId = candidateIds.find((id) => existingPoints.has(id) && !assignedPointIds.has(id));
    const matchedLocationPointId = [...existingPoints.values()].find((point) => (
      !assignedPointIds.has(point.id)
      && group.locationId
      && point.locationId === group.locationId
    ))?.id;
    const pointId = matchedTeamPointId ?? matchedLocationPointId ?? createGatheringPointId();
    assignments.set(group.key, pointId);
    assignedPointIds.add(pointId);
  });

  const absorbedPointIds = new Set<string>();
  const activePoints = groups.map((group) => {
    const pointId = assignments.get(group.key)!;
    const previous = existingPoints.get(pointId);
    const candidatePointIds = unique([
      pointId,
      group.preferredPointId,
      ...group.teams.map((team) => team.gatheringPointId)
    ]);
    const previousPoints = candidatePointIds
      .filter((candidateId) => (
        candidateId === pointId || !assignedPointIds.has(candidateId)
      ))
      .map((candidateId) => existingPoints.get(candidateId))
      .filter((point): point is DailyPlanGatheringPoint => Boolean(point));
    previousPoints.forEach((point) => absorbedPointIds.add(point.id));
    const location = findLocation(locations, group.locationId, group.locationName);
    const notes = group.teams.map((team) => String(team.notes ?? "").trim());
    return {
      id: pointId,
      locationName: group.locationName,
      locationId: group.locationId || undefined,
      address: (location ? getDailyPlanLocationOutputAddress(location) : previous?.address) || undefined,
      note: uniqueText([...notes, previous?.note]) || undefined,
      departmentIds: group.teams.map((team) => team.id),
      departmentTimes: group.teams.map((team) => ({
        departmentId: team.id,
        time: String(team.callTime ?? "").trim()
      })),
      photos: mergeGatheringPhotos(previousPoints)
    } satisfies DailyPlanGatheringPoint;
  });
  const activePointIds = new Set(activePoints.map((point) => point.id));
  // 장소를 잠시 비운 경우에도 사진을 즉시 파기하지 않습니다. 같은 부서 행이 다시 연결되면 복원됩니다.
  const preservedOrphans = meta.gatheringPoints
    .filter((point) => (
      !activePointIds.has(point.id)
      && !absorbedPointIds.has(point.id)
      && point.photos.length > 0
    ))
    .map((point) => ({ ...point, departmentIds: [], departmentTimes: [] }));
  const pointById = new Map([...activePoints, ...preservedOrphans].map((point) => [point.id, point]));
  const groupByTeamId = new Map<string, TeamGroup>();
  groups.forEach((group) => group.teams.forEach((team) => groupByTeamId.set(team.id, group)));
  const teams = meta.teams.map((team) => {
    const group = groupByTeamId.get(team.id);
    if (!group) return team;
    const pointId = assignments.get(group.key);
    return {
      ...team,
      callLocation: group.locationName,
      callLocationId: group.locationId || undefined,
      gatheringPointId: pointId
    };
  });

  return normalizeDailyPlanPrintMeta({
    ...meta,
    teams,
    gatheringPoints: [...pointById.values()]
  });
}

/**
 * 일반 일촬표 저장이 진행도 화면에서 더 최근에 수정한 위치 사진을 덮어쓰지 않도록,
 * DB의 최신 사진 metadata와 stable point ID를 편집 중인 metadata에 합칩니다.
 */
export function mergeLatestGatheringPhotoMetadata(
  sourceMeta: DailyPlanPrintMeta,
  latestMeta: DailyPlanPrintMeta,
  locations: DailyPlanLocation[]
) {
  const incoming = normalizeDailyPlanPrintMeta(sourceMeta);
  const latest = normalizeDailyPlanPrintMeta(latestMeta);
  const latestPoints = new Map(latest.gatheringPoints.map((point) => [point.id, point]));
  const latestTeamById = new Map(latest.teams.map((team) => [team.id, team]));
  const latestTeamsByName = new Map<string, TeamCallSheetRow[]>();
  latest.teams.forEach((team) => {
    const name = normalizedLocationKey(team.team);
    if (!name) return;
    const rows = latestTeamsByName.get(name) ?? [];
    rows.push(team);
    latestTeamsByName.set(name, rows);
  });

  const teams = incoming.teams.map((team) => {
    const directMatch = latestTeamById.get(team.id);
    const nameMatches = latestTeamsByName.get(normalizedLocationKey(team.team)) ?? [];
    const latestTeam = directMatch ?? (nameMatches.length === 1 ? nameMatches[0] : null);
    const latestPointId = String(latestTeam?.gatheringPointId ?? "").trim();
    return latestPointId && latestPoints.has(latestPointId)
      ? { ...team, gatheringPointId: latestPointId }
      : team;
  });

  const incomingPointIds = new Set(incoming.gatheringPoints.map((point) => point.id));
  const gatheringPoints = [
    ...incoming.gatheringPoints.map((point) => {
      const latestPoint = latestPoints.get(point.id);
      return latestPoint ? { ...point, photos: latestPoint.photos } : point;
    }),
    ...latest.gatheringPoints.filter((point) => !incomingPointIds.has(point.id))
  ];

  return reconcileDailyPlanGatheringPoints({
    ...incoming,
    teams,
    gatheringPoints
  }, locations);
}

export function appendGatheringPhoto(
  meta: DailyPlanPrintMeta,
  pointId: string,
  photo: DailyPlanGatheringPhoto
) {
  return normalizeDailyPlanPrintMeta({
    ...meta,
    gatheringPoints: meta.gatheringPoints.map((point) => (
      point.id === pointId
        ? { ...point, photos: [...point.photos, { ...photo, sortOrder: point.photos.length }] }
        : point
    ))
  });
}

export function removeGatheringPhoto(meta: DailyPlanPrintMeta, pointId: string, photoId: string) {
  return normalizeDailyPlanPrintMeta({
    ...meta,
    gatheringPoints: meta.gatheringPoints.map((point) => (
      point.id === pointId
        ? {
            ...point,
            photos: point.photos
              .filter((photo) => photo.id !== photoId)
              .map((photo, index) => ({ ...photo, sortOrder: index }))
          }
        : point
    ))
  });
}

export function reorderGatheringPhotos(
  meta: DailyPlanPrintMeta,
  pointId: string,
  orderedPhotoIds: string[]
) {
  const order = new Map(orderedPhotoIds.map((id, index) => [id, index]));
  return normalizeDailyPlanPrintMeta({
    ...meta,
    gatheringPoints: meta.gatheringPoints.map((point) => {
      if (point.id !== pointId) return point;
      const photos = [...point.photos].sort((left, right) => (
        (order.get(left.id) ?? Number.MAX_SAFE_INTEGER)
        - (order.get(right.id) ?? Number.MAX_SAFE_INTEGER)
      ));
      return { ...point, photos: photos.map((photo, index) => ({ ...photo, sortOrder: index })) };
    })
  });
}

export function createGatheringPointId() {
  if (typeof globalThis.crypto?.randomUUID === "function") {
    return `gathering_${globalThis.crypto.randomUUID()}`;
  }
  return `gathering_${Date.now().toString(36)}_${Math.random().toString(36).slice(2)}`;
}

export function createGatheringPhotoId() {
  if (typeof globalThis.crypto?.randomUUID === "function") return globalThis.crypto.randomUUID();
  return `${Date.now().toString(36)}-${Math.random().toString(36).slice(2)}-${Math.random().toString(36).slice(2)}`;
}

function collectTeamGroups(
  teams: TeamCallSheetRow[],
  locations: DailyPlanLocation[],
  existingPoints: Map<string, DailyPlanGatheringPoint>
) {
  const groups = new Map<string, TeamGroup>();
  const currentNamesByPointId = new Map<string, Set<string>>();
  const pointIdsByLocationId = new Map<string, string[]>();
  const pointIdsByName = new Map<string, string[]>();

  teams.forEach((team) => {
    const pointId = String(team.gatheringPointId ?? "").trim();
    const name = normalizedLocationKey(resolveTeamLocationReference(team, locations).locationName);
    if (!pointId || !name || !existingPoints.has(pointId)) return;
    const names = currentNamesByPointId.get(pointId) ?? new Set<string>();
    names.add(name);
    currentNamesByPointId.set(pointId, names);
  });
  existingPoints.forEach((point) => {
    if (point.locationId) appendMappedValue(pointIdsByLocationId, point.locationId, point.id);
    const name = normalizedLocationKey(point.locationName);
    if (name) appendMappedValue(pointIdsByName, name, point.id);
  });

  teams.forEach((team) => {
    const resolvedLocation = resolveTeamLocationReference(team, locations);
    const locationName = resolvedLocation.locationName;
    if (!locationName) return;
    const locationId = resolvedLocation.locationId;
    const normalizedName = normalizedLocationKey(locationName);
    const requestedPointId = String(team.gatheringPointId ?? "").trim();
    const existingPointId = existingPoints.has(requestedPointId)
      ? requestedPointId
      : uniqueMappedValue(pointIdsByLocationId, locationId)
        || uniqueMappedValue(pointIdsByName, normalizedName);
    const pointWasSplit = existingPointId
      ? (currentNamesByPointId.get(existingPointId)?.size ?? 0) > 1
      : false;
    const key = locationId
      ? `location:${locationId}`
      : existingPointId
        ? pointWasSplit
          ? `point:${existingPointId}:name:${normalizedName}`
          : `point:${existingPointId}`
        : `name:${normalizedName}`;
    const existing = groups.get(key);
    if (existing) {
      existing.teams.push(team);
      return;
    }
    groups.set(key, {
      key,
      preferredPointId: existingPointId,
      locationId,
      locationName,
      teams: [team]
    });
  });
  return [...groups.values()];
}

function appendMappedValue(map: Map<string, string[]>, key: string, value: string) {
  const values = map.get(key) ?? [];
  if (!values.includes(value)) values.push(value);
  map.set(key, values);
}

function uniqueMappedValue(map: Map<string, string[]>, key: string) {
  if (!key) return "";
  const values = map.get(key) ?? [];
  return values.length === 1 ? values[0] : "";
}

function resolveTeamLocationReference(
  team: TeamCallSheetRow,
  locations: DailyPlanLocation[]
) {
  const resolution = resolveDailyPlanLocationReference({
    locations,
    locationId: team.callLocationId,
    legacyText: team.callLocation
  });
  return {
    locationId: resolution.kind === "location" ? resolution.locationId : "",
    locationName: resolution.kind === "location" || resolution.kind === "legacy"
      ? resolution.label
      : "",
    location: resolution.option?.location ?? null
  };
}

function findLocation(locations: DailyPlanLocation[], locationId: string, locationName: string) {
  if (locationId) {
    const byId = locations.find((location) => location.id === locationId);
    if (byId) return byId;
  }
  const normalizedName = normalizedLocationKey(locationName);
  const matches = locations.filter((location) => (
    normalizedLocationKey(getDailyPlanLocationDisplayName(location)) === normalizedName
  ));
  if (matches.length === 1) return matches[0];
  const legacyMatches = locations.filter((location) => (
    normalizedLocationKey(location.providerPlaceName || location.name) === normalizedName
  ));
  return legacyMatches.length === 1 ? legacyMatches[0] : null;
}

function unique(values: Array<string | undefined>) {
  return [...new Set(values.map((value) => String(value ?? "").trim()).filter(Boolean))];
}

function uniqueText(values: Array<string | undefined>) {
  return unique(values).join(" · ");
}

function mergeGatheringPhotos(points: DailyPlanGatheringPoint[]) {
  const seen = new Set<string>();
  return points
    .flatMap((point) => [...point.photos].sort((left, right) => left.sortOrder - right.sortOrder))
    .filter((photo) => {
      if (seen.has(photo.id)) return false;
      seen.add(photo.id);
      return true;
    })
    .map((photo, index) => ({ ...photo, sortOrder: index }));
}
