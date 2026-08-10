import type { ShotOverheadDiagram } from "./types";

export const SHOT_OVERHEAD_HISTORY_LIMIT = 75;

export type ShotOverheadHistory = Readonly<{
  past: ShotOverheadDiagram[];
  current: ShotOverheadDiagram;
  future: ShotOverheadDiagram[];
}>;

type JsonObject = { [key: string]: unknown };

/**
 * Diagram documents are JSON values persisted in a jsonb column. Clone every
 * nested array/object so future polygon and movement-path point arrays cannot
 * leak mutations into history snapshots.
 */
export function cloneShotOverheadDiagram(diagram: ShotOverheadDiagram): ShotOverheadDiagram {
  return cloneJsonValue(diagram) as ShotOverheadDiagram;
}

export function createShotOverheadHistory(
  initial: ShotOverheadDiagram
): ShotOverheadHistory {
  return {
    past: [],
    current: cloneShotOverheadDiagram(initial),
    future: []
  };
}

/**
 * Commit a document change. For a pointer gesture, keep the gesture-start
 * document and pass it as `previousSnapshot` after using
 * `replaceShotOverheadHistoryCurrent` during pointer moves. That records the
 * whole gesture as exactly one undo entry.
 */
export function pushShotOverheadHistory(
  history: ShotOverheadHistory,
  next: ShotOverheadDiagram,
  previousSnapshot: ShotOverheadDiagram = history.current
): ShotOverheadHistory {
  if (diagramEquals(previousSnapshot, next)) return history;

  return {
    past: [
      ...history.past,
      cloneShotOverheadDiagram(previousSnapshot)
    ].slice(-SHOT_OVERHEAD_HISTORY_LIMIT),
    current: cloneShotOverheadDiagram(next),
    future: []
  };
}

/** Replace the live document without creating an undo entry. */
export function replaceShotOverheadHistoryCurrent(
  history: ShotOverheadHistory,
  current: ShotOverheadDiagram
): ShotOverheadHistory {
  if (diagramEquals(history.current, current)) return history;
  return {
    ...history,
    current: cloneShotOverheadDiagram(current)
  };
}

export function undoShotOverheadHistory(
  history: ShotOverheadHistory
): ShotOverheadHistory {
  const previous = history.past.at(-1);
  if (!previous) return history;

  return {
    past: history.past.slice(0, -1),
    current: cloneShotOverheadDiagram(previous),
    future: [
      cloneShotOverheadDiagram(history.current),
      ...history.future
    ].slice(0, SHOT_OVERHEAD_HISTORY_LIMIT)
  };
}

export function redoShotOverheadHistory(
  history: ShotOverheadHistory
): ShotOverheadHistory {
  const next = history.future[0];
  if (!next) return history;

  return {
    past: [
      ...history.past,
      cloneShotOverheadDiagram(history.current)
    ].slice(-SHOT_OVERHEAD_HISTORY_LIMIT),
    current: cloneShotOverheadDiagram(next),
    future: history.future.slice(1)
  };
}

export function canUndoShotOverheadHistory(history: ShotOverheadHistory) {
  return history.past.length > 0;
}

export function canRedoShotOverheadHistory(history: ShotOverheadHistory) {
  return history.future.length > 0;
}

function cloneJsonValue<T>(value: T): T {
  if (Array.isArray(value)) {
    return value.map((item) => cloneJsonValue(item)) as T;
  }
  if (value && typeof value === "object") {
    return Object.fromEntries(
      Object.entries(value as JsonObject).map(([key, item]) => [key, cloneJsonValue(item)])
    ) as T;
  }
  return value;
}

function diagramEquals(left: ShotOverheadDiagram, right: ShotOverheadDiagram) {
  return jsonValueEquals(left, right);
}

function jsonValueEquals(left: unknown, right: unknown): boolean {
  if (Object.is(left, right)) return true;
  if (Array.isArray(left) || Array.isArray(right)) {
    if (!Array.isArray(left) || !Array.isArray(right) || left.length !== right.length) return false;
    return left.every((item, index) => jsonValueEquals(item, right[index]));
  }
  if (!left || !right || typeof left !== "object" || typeof right !== "object") return false;

  const leftRecord = left as JsonObject;
  const rightRecord = right as JsonObject;
  const leftKeys = Object.keys(leftRecord).sort();
  const rightKeys = Object.keys(rightRecord).sort();
  if (leftKeys.length !== rightKeys.length) return false;
  return leftKeys.every((key, index) => (
    key === rightKeys[index]
    && jsonValueEquals(leftRecord[key], rightRecord[key])
  ));
}
