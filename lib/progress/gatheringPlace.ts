import {
  normalizeGatheringLocationName,
  selectDailyPlanGatheringPoints
} from "@/lib/dailyPlan/gatheringPoints";
import { resolveEffectiveGatheringLocation } from "@/lib/dailyPlan/locationReferences";
import {
  decodeDailyPlanMemo,
  type DailyPlanGatheringPhoto
} from "@/lib/dailyPlan/printMeta";
import type { DailyPlan } from "@/lib/types";

export type ProgressGatheringPlace = {
  id: string;
  persistedId: string | null;
  locationId: string | null;
  locationName: string;
  address: string;
  departmentIds: string[];
  photos: DailyPlanGatheringPhoto[];
};

/** Progress의 편집/읽기 UI가 같은 stable-location 우선순위를 사용합니다. */
export function selectProgressGatheringPlace(plan: DailyPlan): ProgressGatheringPlace | null {
  const meta = decodeDailyPlanMemo(plan.memo);
  const canonicalPoints = selectDailyPlanGatheringPoints(plan);
  const effectiveLocation = resolveEffectiveGatheringLocation(plan.shootingLocations);

  if (effectiveLocation) {
    const matchingPoint = canonicalPoints.find((point) => (
      point.locationId === effectiveLocation.id
    )) ?? null;
    if (matchingPoint) {
      return {
        id: matchingPoint.id,
        persistedId: matchingPoint.persistedId,
        locationId: effectiveLocation.id,
        locationName: effectiveLocation.label,
        address: effectiveLocation.address,
        departmentIds: matchingPoint.departments.map((department) => department.id),
        photos: matchingPoint.photos
      };
    }

    const storedPoint = meta.gatheringPoints.find((point) => (
      point.locationId === effectiveLocation.id
    )) ?? null;
    if (storedPoint) {
      const currentDepartmentIds = new Set(meta.teams.map((team) => team.id));
      return {
        id: storedPoint.id,
        persistedId: storedPoint.id,
        locationId: effectiveLocation.id,
        locationName: effectiveLocation.label,
        address: effectiveLocation.address,
        departmentIds: storedPoint.departmentIds.filter((id) => currentDepartmentIds.has(id)),
        photos: storedPoint.photos
      };
    }

    return {
      id: `location:${effectiveLocation.id}`,
      persistedId: null,
      locationId: effectiveLocation.id,
      locationName: effectiveLocation.label,
      address: effectiveLocation.address,
      departmentIds: [],
      photos: []
    };
  }

  // 실제 촬영 장소가 없는 과거 일촬표에서만 legacy metadata로 fallback합니다.
  const canonicalPoint = canonicalPoints[0] ?? null;
  if (canonicalPoint) {
    return {
      id: canonicalPoint.id,
      persistedId: canonicalPoint.persistedId,
      locationId: canonicalPoint.locationId,
      locationName: canonicalPoint.locationName,
      address: canonicalPoint.address,
      departmentIds: canonicalPoint.departments.map((department) => department.id),
      photos: canonicalPoint.photos
    };
  }

  const fallbackLocationName = normalizeGatheringLocationName(plan.meetingLocation);
  const point = meta.gatheringPoints.find((item) => item.photos.length > 0)
    ?? meta.gatheringPoints[0]
    ?? null;
  const locationName = fallbackLocationName || normalizeGatheringLocationName(point?.locationName);
  if (!locationName && !point) return null;

  return {
    id: point?.id ?? "legacy:gathering",
    persistedId: point?.id ?? null,
    locationId: point?.locationId ?? null,
    locationName,
    address: String(point?.address ?? "").trim(),
    departmentIds: point?.departmentIds ?? [],
    photos: point?.photos ?? []
  };
}
