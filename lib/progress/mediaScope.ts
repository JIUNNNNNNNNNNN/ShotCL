import {
  decodeDailyPlanMemo,
  type DailyPlanTimetableSceneMeta
} from "@/lib/dailyPlan/printMeta";
import { normalizeSceneNumber } from "@/lib/sceneNumber";

const UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
export const MAX_PROGRESS_MEDIA_SCENE_SCOPE = 500;

export type ProgressMediaScopePlan = {
  id: string;
  episode: string;
  memo: string;
};

export type ProgressMediaScopeAsset = {
  dailyPlanId: string | null;
  sceneId: string | null;
  sceneNumber: string;
  cutNumber: number | null;
  episodeNumber: number | null;
};

type ProgressMediaSceneScope = {
  sceneIds: Set<string>;
  sceneNumbers: Set<string>;
  cutsBySceneId: Map<string, Set<number> | null>;
  cutsBySceneNumber: Map<string, Set<number> | null>;
};

export type ProgressMediaPlanScope = ProgressMediaScopePlan & ProgressMediaSceneScope & {
  episodeNumber: number | null;
  isWithinCandidateLimit: boolean;
};

/** Decode the selected plan once, regardless of the number of candidate assets. */
export function createProgressMediaPlanScope(
  plan: ProgressMediaScopePlan
): ProgressMediaPlanScope {
  const timetableScenes = decodeDailyPlanMemo(plan.memo).timetableScenes;
  return {
    ...plan,
    ...buildProgressMediaSceneScope(
      timetableScenes.slice(0, MAX_PROGRESS_MEDIA_SCENE_SCOPE)
    ),
    episodeNumber: parseEpisodeNumber(plan.episode),
    isWithinCandidateLimit:
      timetableScenes.length <= MAX_PROGRESS_MEDIA_SCENE_SCOPE
  };
}

/**
 * Keep the Storage metadata read bounded to the selected plan's Scene scope.
 * The values are canonical numeric Scene numbers and validated UUIDs, so they
 * are safe to embed in PostgREST's server-side logic expression.
 */
export function progressMediaCandidateDatabaseFilter(
  plan: ProgressMediaPlanScope
) {
  const filters = [`daily_plan_id.eq.${plan.id}`];
  const sceneIds = [...plan.sceneIds].sort();
  const sceneNumbers = [...plan.sceneNumbers].sort((left, right) => (
    Number(left) - Number(right)
  ));
  if (sceneIds.length > 0) {
    filters.push(
      `and(daily_plan_id.is.null,crop_data->>sceneId.in.(${sceneIds.join(",")}))`
    );
  }
  if (sceneNumbers.length > 0) {
    filters.push(
      `and(daily_plan_id.is.null,scene_no.in.(${sceneNumbers.join(",")}))`
    );
    filters.push(
      `and(daily_plan_id.is.null,crop_data->>sceneNumber.in.(${sceneNumbers.join(",")}))`
    );
  }
  return filters.join(",");
}

/**
 * Progress media is selected from the project archive, but the response is
 * restricted to links that belong to the requested Daily Plan. A stable Scene
 * ID wins; legacy Scene-number metadata is accepted only inside that same
 * plan/episode scope.
 */
export function isProgressMediaAssetInPlanScope(
  asset: ProgressMediaScopeAsset,
  input: ProgressMediaScopePlan | ProgressMediaPlanScope
) {
  const plan = "sceneIds" in input
    ? input
    : createProgressMediaPlanScope(input);
  if (asset.dailyPlanId && asset.dailyPlanId !== plan.id) return false;
  if (asset.dailyPlanId === plan.id) return true;

  const sceneId = cleanText(asset.sceneId);
  const sceneNumber = normalizeSceneNumber(asset.sceneNumber);
  const cutNumber = positiveInteger(asset.cutNumber);
  const episodeNumber = positiveInteger(asset.episodeNumber);
  const planEpisodeNumber = plan.episodeNumber;

  if (sceneId) {
    if (!plan.sceneIds.has(sceneId)) return false;
    return cutBelongsToScene(plan.cutsBySceneId.get(sceneId), cutNumber);
  }
  if (sceneNumber) {
    // Scene numbers are not stable project-wide. Mirror the client resolver:
    // a global legacy number link is safe only inside an explicit episode.
    if (episodeNumber === null || planEpisodeNumber === null) return false;
    if (episodeNumber !== planEpisodeNumber) return false;
    if (!plan.sceneNumbers.has(sceneNumber)) return false;
    return cutBelongsToScene(
      plan.cutsBySceneNumber.get(sceneNumber),
      cutNumber
    );
  }

  // Unclassified project-global media must remain in Archive, not leak into a
  // selected Progress round. A round-owned asset can still be an explicit
  // legacy link and is resolved by the existing batched shot-media link wave.
  return asset.dailyPlanId === plan.id;
}

function buildProgressMediaSceneScope(
  timetableScenes: DailyPlanTimetableSceneMeta[]
): ProgressMediaSceneScope {
  const scope: ProgressMediaSceneScope = {
    sceneIds: new Set(),
    sceneNumbers: new Set(),
    cutsBySceneId: new Map(),
    cutsBySceneNumber: new Map()
  };
  timetableScenes.forEach((scene) => {
    const candidateSceneId = cleanText(scene.sourceSceneId);
    const sceneId = UUID_PATTERN.test(candidateSceneId) ? candidateSceneId : "";
    const sceneNumber = normalizeSceneNumber(
      scene.rowSnapshot.sceneNumber || scene.sourceSnapshot?.sceneNumber
    );
    const selectedCuts = Array.isArray(scene.selectedCutNumbers)
      ? new Set(scene.selectedCutNumbers.flatMap((cut) => {
          const normalized = positiveInteger(cut);
          return normalized === null ? [] : [normalized];
        }))
      : null;
    if (sceneId) {
      scope.sceneIds.add(sceneId);
      mergeSceneCuts(
        scope.cutsBySceneId,
        sceneId,
        selectedCuts ? new Set(selectedCuts) : null
      );
    }
    if (sceneNumber) {
      scope.sceneNumbers.add(sceneNumber);
      mergeSceneCuts(
        scope.cutsBySceneNumber,
        sceneNumber,
        selectedCuts ? new Set(selectedCuts) : null
      );
    }
  });
  return scope;
}

function mergeSceneCuts(
  target: Map<string, Set<number> | null>,
  sceneKey: string,
  selectedCuts: Set<number> | null
) {
  if (!target.has(sceneKey)) {
    target.set(sceneKey, selectedCuts);
    return;
  }
  const current = target.get(sceneKey);
  if (current === undefined) {
    target.set(sceneKey, selectedCuts);
    return;
  }
  if (current === null || selectedCuts === null) {
    target.set(sceneKey, null);
    return;
  }
  selectedCuts.forEach((cut) => current.add(cut));
}

function cutBelongsToScene(
  selectedCuts: Set<number> | null | undefined,
  cutNumber: number | null
) {
  if (selectedCuts === undefined) return false;
  if (selectedCuts === null) return true;
  if (cutNumber === null) return false;
  return selectedCuts.has(cutNumber);
}

function parseEpisodeNumber(value: string) {
  const match = String(value ?? "").normalize("NFKC").match(/\d{1,3}/);
  return match ? positiveInteger(match[0]) : null;
}

function positiveInteger(value: unknown) {
  if (value === null || value === undefined || value === "") return null;
  const number = Number(value);
  return Number.isInteger(number) && number > 0 ? number : null;
}

function cleanText(value: unknown) {
  return typeof value === "string" ? value.trim().toLowerCase() : "";
}
