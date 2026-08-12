// @ts-ignore -- explicit .ts import is intentional for the pure node tests.
import { getDailyPlanLocationAddress } from "./location.ts";
import type { DailyPlanLocation } from "@/lib/types";

export type DailyPlanLocationOption = {
  id: string;
  value: string;
  label: string;
  address: string;
  location: DailyPlanLocation;
};

export type DailyPlanLocationReference = {
  locations: DailyPlanLocation[];
  locationId?: string | null;
  legacyText?: string | null;
};

export type DailyPlanLocationReferenceResolution = {
  kind: "location" | "legacy" | "orphan" | "empty";
  option: DailyPlanLocationOption | null;
  locationId: string;
  label: string;
  address: string;
  legacyText: string;
};

/**
 * Daily Plan에 저장된 실제 촬영지 카드 순서로 compact 선택 옵션을 만듭니다.
 * `장소N`은 표시값일 뿐이며 value/id에는 항상 카드의 stable ID를 둡니다.
 */
export function buildDailyPlanLocationOptions(
  locations: DailyPlanLocation[]
): DailyPlanLocationOption[] {
  return locations
    .filter(isMeaningfulDailyPlanCanonicalLocation)
    .map((location, index) => ({
      id: String(location.id ?? "").trim(),
      value: String(location.id ?? "").trim(),
      label: `장소${index + 1}`,
      address: getDailyPlanLocationOutputAddress(location),
      location
    }))
    .filter((option) => Boolean(option.id));
}

/** 실제 주소 필드와 기존 상세주소 fallback을 한 곳에서 해석합니다. */
export function getDailyPlanLocationOutputAddress(location: DailyPlanLocation | undefined) {
  if (!location) return "";
  return getDailyPlanLocationAddress(location)
    || String(location.detail ?? "").trim()
    || String(location.providerPlaceName ?? "").trim()
    || String(location.name ?? "").trim();
}

/**
 * Stable ID가 있으면 언제나 ID를 우선합니다. 존재하지 않는 ID는 orphan으로
 * 닫아 cached label이나 UUID가 문서에 노출되지 않게 합니다. ID가 전혀 없는
 * 과거 자유 텍스트만 exact/unique match 후 주소로 복원하고, 나머지는 원문을
 * 읽기 호환합니다. `장소N`은 재정렬 시 오연결되므로 index로 추측하지 않습니다.
 */
export function resolveDailyPlanLocationReference(
  input: DailyPlanLocationReference
): DailyPlanLocationReferenceResolution {
  const options = buildDailyPlanLocationOptions(input.locations);
  const requestedId = String(input.locationId ?? "").trim();
  const legacyText = normalizeDisplayText(input.legacyText);

  if (requestedId) {
    const option = options.find((candidate) => candidate.id === requestedId) ?? null;
    return option
      ? resolvedLocation(option, legacyText)
      : {
          kind: "orphan",
          option: null,
          locationId: requestedId,
          label: "",
          address: "",
          legacyText: ""
        };
  }

  if (!legacyText) return {
    kind: "empty",
    option: null,
    locationId: "",
    label: "",
    address: "",
    legacyText: ""
  };

  if (!isOrdinalLocationLabel(legacyText)) {
    const normalizedLegacy = normalizeMatchText(legacyText);
    const matches = options.filter((option) => getLegacyMatchValues(option.location)
      .some((value) => normalizeMatchText(value) === normalizedLegacy));
    if (matches.length === 1) return resolvedLocation(matches[0], legacyText);
  }

  if (looksLikeRawLocationId(legacyText)) return {
    kind: "orphan",
    option: null,
    locationId: "",
    label: "",
    address: "",
    legacyText: ""
  };

  return {
    kind: "legacy",
    option: null,
    locationId: "",
    label: legacyText,
    address: legacyText,
    legacyText
  };
}

export function getDailyPlanLocationReferenceAddress(input: DailyPlanLocationReference) {
  return resolveDailyPlanLocationReference(input).address;
}

/** 명시한 대표 카드가 유효하면 보존하고, 미지정일 때만 현재 장소1을 파생합니다. */
export function resolveEffectiveGatheringLocation(
  locations: DailyPlanLocation[]
): DailyPlanLocationOption | null {
  const options = buildDailyPlanLocationOptions(locations);
  return options.find((option) => option.location.isPrimary) ?? options[0] ?? null;
}

export function isMeaningfulDailyPlanCanonicalLocation(location: DailyPlanLocation) {
  return Boolean(
    String(location.id ?? "").trim()
    && (
      location.selectedMajorLocations?.length
      || getDailyPlanLocationOutputAddress(location)
    )
  );
}

function resolvedLocation(
  option: DailyPlanLocationOption,
  legacyText: string
): DailyPlanLocationReferenceResolution {
  return {
    kind: "location",
    option,
    locationId: option.id,
    label: option.label,
    address: option.address,
    legacyText
  };
}

function getLegacyMatchValues(location: DailyPlanLocation) {
  return [
    getDailyPlanLocationOutputAddress(location),
    getDailyPlanLocationAddress(location),
    (location.selectedMajorLocations ?? []).map((item) => item.name).join(" / "),
    location.detail,
    location.providerPlaceName,
    location.name
  ].map((value) => String(value ?? "").trim()).filter(Boolean);
}

function normalizeDisplayText(value: unknown) {
  return String(value ?? "").normalize("NFKC").trim().replace(/\s+/g, " ");
}

function normalizeMatchText(value: unknown) {
  return normalizeDisplayText(value).toLocaleLowerCase("ko-KR");
}

function isOrdinalLocationLabel(value: string) {
  return /^(?:촬영\s*)?장소\s*\d+$/u.test(value);
}

function looksLikeRawLocationId(value: string) {
  return /^(?:loc(?:ation)?_|[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$)/iu.test(value);
}
