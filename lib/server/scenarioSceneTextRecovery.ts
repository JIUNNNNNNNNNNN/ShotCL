import { randomUUID } from "node:crypto";
import { MAX_SCENARIO_SCENE_TEXT_LENGTH } from "@/lib/scenarioSceneMarker";
import { normalizeSceneNumber } from "@/lib/sceneNumber";
import type { ProjectScenarioScene } from "@/lib/types";

const MAX_SCENARIO_SCENES = 2_000;
const MAX_SCENARIO_IMAGE_SEGMENTS = 5_000;

export type ScenarioSceneTextRecovery = {
  scenes: ProjectScenarioScene[];
  recoveredTextCount: number;
  changed: boolean;
};

/** Canonical persistence boundary shared by upload, edits, and text recovery. */
export function normalizeStoredProjectScenarioScenes(value: unknown): ProjectScenarioScene[] {
  if (!Array.isArray(value)) return [];
  return value.slice(0, MAX_SCENARIO_SCENES).flatMap((entry, index) => {
    if (!entry || typeof entry !== "object" || Array.isArray(entry)) return [];
    const source = entry as Record<string, unknown>;
    const pageStart = nullablePositiveInteger(source.pageStart);
    const pageEnd = nullablePositiveInteger(source.pageEnd);
    const rawSceneNo = cleanText(source.sceneNo, 100);
    return [{
      id: cleanText(source.id, 100) || randomUUID(),
      sceneNo: normalizeSceneNumber(rawSceneNo) || rawSceneNo || String(index + 1),
      title: cleanText(source.title, 240) || `Scene ${index + 1}`,
      pageStart,
      pageEnd: pageEnd ?? pageStart,
      text: normalizeScenarioSceneBodyText(source.text),
      imageSegments: normalizeScenarioImageSegments(source.imageSegments)
    }];
  });
}

export function normalizeScenarioSceneBodyText(value: unknown) {
  return String(value ?? "")
    .replace(/\r\n?/g, "\n")
    .slice(0, MAX_SCENARIO_SCENE_TEXT_LENGTH);
}

export function hasStoredScenarioSceneText(value: unknown) {
  return normalizeStoredProjectScenarioScenes(value).some((scene) => scene.text.trim().length > 0);
}

/**
 * Backfills only missing bodies. Existing IDs, manual titles/numbers, page
 * metadata, image segments, and every non-empty body remain authoritative.
 */
export function reconcileRecoveredScenarioSceneText(
  storedValue: unknown,
  recoveredValue: unknown
): ScenarioSceneTextRecovery {
  const stored = normalizeStoredProjectScenarioScenes(storedValue);
  const recovered = normalizeStoredProjectScenarioScenes(recoveredValue);

  if (stored.length === 0) {
    return {
      scenes: recovered,
      recoveredTextCount: recovered.filter((scene) => scene.text.trim()).length,
      changed: recovered.length > 0
    };
  }

  const recoveredByNumber = new Map<string, ProjectScenarioScene[]>();
  for (const scene of recovered) {
    const key = sceneNumberKey(scene.sceneNo);
    if (!key) continue;
    const matches = recoveredByNumber.get(key) ?? [];
    matches.push(scene);
    recoveredByNumber.set(key, matches);
  }

  let recoveredTextCount = 0;
  const scenes = stored.map((scene) => {
    const matches = recoveredByNumber.get(sceneNumberKey(scene.sceneNo));
    const recoveredScene = matches?.shift();
    if (scene.text.trim() || !recoveredScene?.text.trim()) return scene;
    recoveredTextCount += 1;
    return { ...scene, text: recoveredScene.text };
  });

  return {
    scenes,
    recoveredTextCount,
    changed: recoveredTextCount > 0
  };
}

function sceneNumberKey(value: unknown) {
  const raw = String(value ?? "").normalize("NFKC").trim();
  return normalizeSceneNumber(raw) || raw;
}

function normalizeScenarioImageSegments(value: unknown) {
  if (!Array.isArray(value)) return [];
  return value.slice(0, MAX_SCENARIO_IMAGE_SEGMENTS).flatMap((entry) => {
    if (!entry || typeof entry !== "object" || Array.isArray(entry)) return [];
    const source = entry as Record<string, unknown>;
    const pageIndex = Number(source.pageIndex);
    const startYRatio = Number(source.startYRatio);
    const endYRatio = Number(source.endYRatio);
    if (
      !Number.isInteger(pageIndex)
      || pageIndex < 0
      || !Number.isFinite(startYRatio)
      || !Number.isFinite(endYRatio)
    ) {
      return [];
    }
    const start = Math.min(1, Math.max(0, startYRatio));
    const end = Math.min(1, Math.max(0, endYRatio));
    return end > start ? [{ pageIndex, startYRatio: start, endYRatio: end }] : [];
  });
}

function nullablePositiveInteger(value: unknown) {
  if (value === null || value === undefined || value === "") return null;
  const number = Number(value);
  return Number.isInteger(number) && number > 0 ? number : null;
}

function cleanText(value: unknown, maxLength: number) {
  return String(value ?? "").trim().slice(0, maxLength);
}
