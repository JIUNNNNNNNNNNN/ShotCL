import type {
  DailyPlanGatheringPoint,
  DailyPlanPrintMeta
} from "@/lib/dailyPlan/printMeta";

export const DEFAULT_GATHERING_PHOTO_PARENT_NAME = "집합장소";

export type GatheringPhotoMutationItem = {
  id: string;
  sortOrder: number;
};

export type EnsureGatheringPhotoParentInput = {
  pointId: string;
  locationId: string;
  locationName: string;
  address: string;
  departmentIds: string[];
};

export type EnsureGatheringPhotoParentResult = {
  meta: DailyPlanPrintMeta;
  point: DailyPlanGatheringPoint;
  created: boolean;
};

/**
 * 명시적 사진 선택 요청이 이미 검증된 뒤에만 호출하는 순수 parent seed입니다.
 * ID는 client가 아니라 server route가 생성해 전달하며, 기존 point/사진은 건드리지 않습니다.
 */
export function ensureGatheringPhotoParent(
  meta: DailyPlanPrintMeta,
  input: EnsureGatheringPhotoParentInput
): EnsureGatheringPhotoParentResult {
  const existing = meta.gatheringPoints.find((point) => point.id === input.pointId);
  if (existing) return { meta, point: existing, created: false };

  const requestedDepartmentIds = new Set(input.departmentIds);
  const matchingTeams = meta.teams.filter((team) => requestedDepartmentIds.has(team.id));
  const point: DailyPlanGatheringPoint = {
    id: input.pointId,
    locationName: normalizeParentText(input.locationName) || DEFAULT_GATHERING_PHOTO_PARENT_NAME,
    locationId: normalizeParentText(input.locationId) || undefined,
    address: normalizeParentText(input.address) || undefined,
    departmentIds: matchingTeams.map((team) => team.id),
    departmentTimes: matchingTeams.map((team) => ({
      departmentId: team.id,
      time: normalizeParentText(team.callTime)
    })),
    photos: []
  };
  return {
    meta: {
      ...meta,
      teams: meta.teams.map((team) => (
        requestedDepartmentIds.has(team.id)
          ? { ...team, gatheringPointId: point.id }
          : team
      )),
      gatheringPoints: [...meta.gatheringPoints, point]
    },
    point,
    created: true
  };
}

/** 같은 upload body 재시도는 새 parent를 만들기 전에 기존 photo의 parent를 재사용합니다. */
export function findGatheringPhotoParentId(
  meta: Pick<DailyPlanPrintMeta, "gatheringPoints">,
  photoId: string
) {
  const matches = meta.gatheringPoints.filter((point) => (
    point.photos.some((photo) => photo.id === photoId)
  ));
  return matches.length === 1 ? matches[0].id : "";
}

export type GatheringPhotoReplacementResult<T extends GatheringPhotoMutationItem> =
  | {
      status: "apply";
      photos: T[];
      replacedPhoto: T;
    }
  | {
      status: "idempotent";
      photo: T;
    }
  | {
      status: "conflict" | "missing";
    };

/**
 * 한 장 교체의 metadata 결과를 계산합니다.
 *
 * 새 사진은 기존 사진의 정확한 위치를 이어받고 legacy sibling은 그대로
 * 보존합니다. 동일한 새 photo ID로 재시도했을 때 old ID가 이미 사라졌다면
 * 이전 요청이 확정된 것으로 처리할 수 있습니다.
 */
export function resolveGatheringPhotoReplacement<T extends GatheringPhotoMutationItem>(
  photos: readonly T[],
  replacedPhotoId: string,
  replacementPhoto: T
): GatheringPhotoReplacementResult<T> {
  const replacedIndex = photos.findIndex((photo) => photo.id === replacedPhotoId);
  const existingReplacement = photos.find((photo) => photo.id === replacementPhoto.id);

  if (existingReplacement) {
    return replacedIndex < 0
      ? { status: "idempotent", photo: existingReplacement }
      : { status: "conflict" };
  }
  if (replacedIndex < 0) return { status: "missing" };

  const replacedPhoto = photos[replacedIndex];
  const nextPhotos = photos.map((photo, index) => (
    index === replacedIndex ? replacementPhoto : photo
  )).map((photo, index) => ({ ...photo, sortOrder: index }));

  return {
    status: "apply",
    photos: nextPhotos,
    replacedPhoto
  };
}

function normalizeParentText(value: unknown) {
  return String(value ?? "").trim().replace(/\s+/g, " ");
}
