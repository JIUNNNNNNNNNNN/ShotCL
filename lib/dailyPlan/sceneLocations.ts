import { getDailyPlanLocationAddress } from "@/lib/dailyPlan/location";
import type {
  DailyPlanLocation,
  DailyPlanSceneLocationSelection,
  ProjectSceneItem
} from "@/lib/types";

export type { DailyPlanSceneLocationSelection } from "@/lib/types";

export type DailyPlanPreviewLocationRow = {
  id: string;
  name: string;
  address: string;
};

/** 씬리스트 표기 순서를 유지하며 실제 대장소만 중복 없이 추립니다. */
export function buildSceneLocationOptions(
  sceneListItems: ProjectSceneItem[]
): DailyPlanSceneLocationSelection[] {
  const seen = new Set<string>();

  return sceneListItems.flatMap((item) => {
    const name = normalizeSceneLocationName(item.mainLocation);
    if (!name) return [];

    const key = createSceneLocationKey(name);
    if (seen.has(key)) return [];
    seen.add(key);
    return [{ key, name }];
  });
}

/** 이름 기반 stable key라서 씬 행이 삭제·재정렬되어도 저장된 선택을 유지합니다. */
export function createSceneLocationKey(value: string) {
  const normalized = normalizeSceneLocationName(value).toLocaleLowerCase("ko-KR");
  return `scene-main-location:${encodeURIComponent(normalized)}`;
}

export function normalizeSceneLocationName(value: unknown) {
  return String(value ?? "").normalize("NFKC").trim().replace(/\s+/g, " ");
}

export function normalizeSceneLocationSelections(
  value: unknown
): DailyPlanSceneLocationSelection[] {
  if (!Array.isArray(value)) return [];

  const seen = new Set<string>();
  return value.flatMap((candidate) => {
    if (!candidate || typeof candidate !== "object") return [];
    const record = candidate as Record<string, unknown>;
    const name = normalizeSceneLocationName(record.name);
    if (!name) return [];

    // 현재 씬리스트에는 별도 location entity id가 없으므로 이름 정규화 key를 단일 기준으로 사용합니다.
    const key = createSceneLocationKey(name);
    const dedupeKey = key.toLocaleLowerCase("ko-KR");
    if (seen.has(dedupeKey)) return [];
    seen.add(dedupeKey);
    return [{ key, name }];
  });
}

/**
 * 실제 촬영지 카드 ID와 대장소 소유권을 일관되게 정리합니다.
 * 중복된 대장소는 촬영지 카드 배열에서 먼저 나온 카드가 소유합니다.
 */
export function normalizeDailyPlanLocationAssignments(
  locations: DailyPlanLocation[]
): DailyPlanLocation[] {
  const usedLocationIds = new Set<string>();
  const ownedSceneLocationKeys = new Set<string>();

  return locations.map((location, index) => {
    const baseId = normalizeLocationCardId(location.id) || `loc_${index + 1}`;
    const id = createUniqueLocationCardId(baseId, usedLocationIds);
    const address = getDailyPlanLocationAddress(location);
    const legacyName = normalizeSceneLocationName(location.name);
    const providerPlaceName = normalizeProviderPlaceName(
      location.providerPlaceName
      || (legacyName && legacyName !== normalizeSceneLocationName(address) ? legacyName : "")
    );
    const selectedMajorLocations = normalizeSceneLocationSelections(location.selectedMajorLocations)
      .filter((selection) => {
        const ownershipKey = normalizeOwnershipKey(selection.key);
        if (ownedSceneLocationKeys.has(ownershipKey)) return false;
        ownedSceneLocationKeys.add(ownershipKey);
        return true;
      });

    return {
      ...location,
      id,
      providerPlaceName,
      selectedMajorLocations
    };
  });
}

/**
 * 이전 전역 selectedSceneLocations 값을 첫 촬영지 카드로 한 번만 옮깁니다.
 * 이미 어느 카드가 소유한 key는 다시 붙이지 않으므로 반복 호출해도 안전합니다.
 */
export function migrateLegacySceneLocationsToLocationCards(
  locations: DailyPlanLocation[],
  legacySelections: DailyPlanSceneLocationSelection[] | undefined
): DailyPlanLocation[] {
  const normalizedLocations = normalizeDailyPlanLocationAssignments(locations);
  if (normalizedLocations.length === 0) return normalizedLocations;

  const ownedKeys = new Set(
    normalizedLocations.flatMap((location) => (
      location.selectedMajorLocations ?? []
    )).map((selection) => normalizeOwnershipKey(selection.key))
  );
  const unassignedLegacySelections = normalizeSceneLocationSelections(legacySelections)
    .filter((selection) => !ownedKeys.has(normalizeOwnershipKey(selection.key)));
  if (unassignedLegacySelections.length === 0) return normalizedLocations;

  return normalizedLocations.map((location, index) => index === 0
    ? {
        ...location,
        selectedMajorLocations: [
          ...(location.selectedMajorLocations ?? []),
          ...unassignedLegacySelections
        ]
      }
    : location
  );
}

/** 실제 촬영지 카드마다 극 중 대장소와 실제 주소를 한 행으로 만듭니다. */
export function buildDailyPlanPreviewLocationRows(
  shootingLocations: DailyPlanLocation[]
): DailyPlanPreviewLocationRow[] {
  return normalizeDailyPlanLocationAssignments(shootingLocations).flatMap((location) => {
    const selections = location.selectedMajorLocations ?? [];
    const address = getDailyPlanLocationAddress(location) || location.detail.trim();
    const hasStoredCardData = Boolean(
      selections.length
      || address.trim()
      || location.providerPlaceName?.trim()
      || location.name.trim()
    );
    if (!hasStoredCardData) return [];

    return [{
      id: `location:${location.id}`,
      name: selections.map((selection) => selection.name).join(" / ") || "장소명 미지정",
      address
    }];
  });
}

/** 대표 표기에는 극 중 대장소를 쓰고, 미지정일 때만 실제 주소를 사용합니다. */
export function getDailyPlanLocationDisplayName(location: DailyPlanLocation) {
  const sceneNames = (location.selectedMajorLocations ?? [])
    .map((selection) => normalizeSceneLocationName(selection.name))
    .filter(Boolean);
  return sceneNames.join(" / ") || getDailyPlanLocationAddress(location).trim();
}

/** 타임테이블에는 극 중 대장소/소장소만 표시하고 실제 주소는 사용하지 않습니다. */
export function formatDailyPlanTimetableLocation(
  mainLocation: unknown,
  subLocation: unknown
) {
  const main = normalizeSceneLocationName(mainLocation);
  const sub = normalizeSceneLocationName(subLocation);
  if (!main) return sub;
  if (!sub || normalizeOwnershipKey(main) === normalizeOwnershipKey(sub)) return main;
  return `${main} / ${sub}`;
}

function normalizeLocationCardId(value: unknown) {
  return String(value ?? "").normalize("NFKC").trim().slice(0, 200);
}

function createUniqueLocationCardId(baseId: string, usedIds: Set<string>) {
  if (!usedIds.has(baseId)) {
    usedIds.add(baseId);
    return baseId;
  }

  let suffix = 2;
  while (usedIds.has(`${baseId}_${suffix}`)) suffix += 1;
  const id = `${baseId}_${suffix}`;
  usedIds.add(id);
  return id;
}

function normalizeOwnershipKey(value: unknown) {
  return normalizeSceneLocationName(value).toLocaleLowerCase("ko-KR");
}

function normalizeProviderPlaceName(value: unknown) {
  const normalized = String(value ?? "").normalize("NFKC").trim().replace(/\s+/g, " ");
  return normalized || undefined;
}
