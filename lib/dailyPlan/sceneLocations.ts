import { getDailyPlanLocationAddress } from "@/lib/dailyPlan/location";
import type { DailyPlanLocation, ProjectSceneItem } from "@/lib/types";

export type DailyPlanSceneLocationSelection = {
  key: string;
  name: string;
};

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

    const key = normalizeSceneLocationName(record.key) || createSceneLocationKey(name);
    const dedupeKey = key.toLocaleLowerCase("ko-KR");
    if (seen.has(dedupeKey)) return [];
    seen.add(dedupeKey);
    return [{ key, name }];
  });
}

/**
 * 상단 미리보기에서는 씬 대장소와 촬영 주소를 서로 다른 행으로 유지합니다.
 * 대장소는 사용자가 정한 순서, 주소는 기존 shootingLocations 순서입니다.
 */
export function buildDailyPlanPreviewLocationRows(
  selectedSceneLocations: DailyPlanSceneLocationSelection[] | undefined,
  shootingLocations: DailyPlanLocation[]
): DailyPlanPreviewLocationRow[] {
  const sceneRows = normalizeSceneLocationSelections(selectedSceneLocations).map((location) => ({
    id: `scene:${location.key}`,
    name: location.name,
    address: ""
  }));
  const addressRows = shootingLocations.flatMap((location, index) => {
    const address = getDailyPlanLocationAddress(location) || location.detail;
    if (!location.name.trim() && !address.trim()) return [];
    const name = normalizeSceneLocationName(location.name);
    const displayName = name.toLocaleLowerCase("ko-KR") === normalizeSceneLocationName(address).toLocaleLowerCase("ko-KR")
      ? ""
      : location.name;
    return [{
      id: `address:${location.id || index}`,
      name: displayName,
      address
    }];
  });

  return [...sceneRows, ...addressRows];
}
