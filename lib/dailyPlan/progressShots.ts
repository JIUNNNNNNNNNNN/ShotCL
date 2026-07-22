import type { DailyPlan, DailyPlanDraft, DailyPlanShot, DailyPlanShotDraft, ShotDraft } from "@/lib/types";

/** 일촬표 행을 회차별 컷 진행 데이터로 변환합니다. 기타 일정과 비어 있는 씬은 제외합니다. */
export function buildProgressShotDrafts(
  plan: DailyPlanDraft | DailyPlan,
  shots: Array<DailyPlanShotDraft | DailyPlanShot>
): ShotDraft[] {
  const groupedShots = new Map<string, Array<DailyPlanShotDraft | DailyPlanShot>>();

  shots.forEach((shot) => {
    const sceneNumber = String(shot.sceneNumber ?? "").trim();
    const cutNumber = String(shot.cutNumber ?? "").trim();
    if (!sceneNumber || !/^\d+$/.test(cutNumber) || Number(cutNumber) < 1) return;
    const sceneShots = groupedShots.get(sceneNumber) ?? [];
    sceneShots.push(shot);
    groupedShots.set(sceneNumber, sceneShots);
  });

  let orderIndex = 0;
  return [...groupedShots.entries()].flatMap(([sceneNumber, sceneShots]) =>
    sceneShots.map((shot, index) => {
      const cutNumber = String(index + 1);
      const location = findDailyPlanLocation(plan.shootingLocations ?? [], shot);
      const locationAddress = formatDailyPlanLocationAddress(location);
      const locationMapUrl = location?.naverMapUrl ?? "";
      const timeMemo = [shot.startTime, shot.endTime].filter(Boolean).join("~");
      const sceneMemo = stripShootingOrderMetadata(shot.sceneMemo ?? "");
      const extraMemo = [
        timeMemo ? `시간: ${timeMemo}` : "",
        shot.dayNight ? `D/N: ${shot.dayNight}` : "",
        locationAddress ? `주소: ${locationAddress}` : "",
        locationMapUrl ? `지도: ${locationMapUrl}` : "",
        shot.props ? `소품: ${shot.props}` : "",
        shot.costumeMakeup ? `의상/분장: ${shot.costumeMakeup}` : "",
        sceneMemo ? `씬 메모: ${sceneMemo}` : "",
        shot.memo
      ]
        .filter(Boolean)
        .join("\n");

      orderIndex += 1;
      return {
        sceneNumber,
        cutNumber,
        title: shot.description.trim().slice(0, 40) || `씬 ${sceneNumber} 컷 ${cutNumber}`,
        description: shot.description,
        location: shot.locationName || shot.subLocation || plan.shootingLocation,
        characters: splitPeople(shot.subject),
        memo: extraMemo,
        orderIndex,
        status: "pending" as const
      };
    })
  );
}

function stripShootingOrderMetadata(value: string) {
  return value.replace(/^\[\[SHOTCL_SHOOTING_ORDER:[^\]]*\]\](?:\n)?/, "");
}

function splitPeople(value: string) {
  return value
    .split(/[,/·]/)
    .map((item) => item.trim())
    .filter(Boolean);
}

function findDailyPlanLocation(locations: DailyPlan["shootingLocations"], shot: DailyPlanShotDraft | DailyPlanShot) {
  return locations.find((location) => location.id === shot.locationId)
    ?? locations.find((location) => location.name && location.name === (shot.locationName || shot.subLocation));
}

function formatDailyPlanLocationAddress(location: DailyPlan["shootingLocations"][number] | undefined) {
  if (!location) return "";
  return [location.roadAddress, location.address].find((value) => value?.trim()) ?? location.detail ?? "";
}
