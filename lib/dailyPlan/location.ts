import type { DailyPlanLocation } from "@/lib/types";

export function getDailyPlanSearchAddress(location: Partial<DailyPlanLocation> | undefined) {
  if (!location) return "";
  return [location.roadAddress, location.address].find((value) => value?.trim())?.trim() ?? "";
}

export function getDailyPlanManualAddress(location: Partial<DailyPlanLocation> | undefined) {
  if (!location) return "";
  const manualAddress = location.manualAddress?.trim();
  if (manualAddress) return manualAddress;
  return location.inputMode === "manual" ? getDailyPlanSearchAddress(location) : "";
}

export function getDailyPlanLocationAddress(location: Partial<DailyPlanLocation> | undefined) {
  if (!location) return "";
  const searchAddress = getDailyPlanSearchAddress(location);
  const manualAddress = getDailyPlanManualAddress(location);

  if (location.inputMode === "manual") return manualAddress || searchAddress;
  if (location.inputMode === "search") return searchAddress || manualAddress;
  return searchAddress || manualAddress;
}

export function hasDailyPlanLocationSearchMetadata(location: Partial<DailyPlanLocation> | undefined) {
  if (!location) return false;
  return Boolean(
    location.searchQuery?.trim()
    || location.category?.trim()
    || location.naverMapUrl?.trim()
    || location.mapx?.trim()
    || location.mapy?.trim()
    || Number.isFinite(location.lat)
    || Number.isFinite(location.lng)
    || (
      location.roadAddress?.trim()
      && location.address?.trim()
      && location.roadAddress.trim() !== location.address.trim()
    )
  );
}
