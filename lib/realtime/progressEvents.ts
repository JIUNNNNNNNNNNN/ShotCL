export type ProgressShotStreamEvent = {
  type: "shot";
  eventType: "INSERT" | "UPDATE" | "DELETE";
  newRow: Record<string, unknown>;
  oldRow: Record<string, unknown>;
};

export type ProgressDailyPlanStreamEvent = {
  type: "daily-plan";
  eventType: "UPDATE";
  newRow: Record<string, unknown>;
  oldRow: Record<string, unknown>;
};

export type ProgressSnapshotStreamEvent = {
  type: "snapshot";
  shots: Record<string, unknown>[];
  dailyPlan: Record<string, unknown> | null;
};

/** Terminal access event emitted when permanent deletion acquires its DB lock. */
export type ProgressProjectDeletedStreamEvent = {
  type: "project-deleted";
  projectId: string;
};

export type ProgressStreamEvent =
  | ProgressShotStreamEvent
  | ProgressDailyPlanStreamEvent
  | ProgressSnapshotStreamEvent
  | ProgressProjectDeletedStreamEvent;

export function parseProgressStreamEvent(value: unknown): ProgressStreamEvent | null {
  if (!value || typeof value !== "object" || Array.isArray(value)) return null;
  const source = value as Record<string, unknown>;
  if (source.type === "project-deleted") {
    if (typeof source.projectId !== "string" || !source.projectId.trim()) return null;
    return {
      type: "project-deleted",
      projectId: source.projectId.trim()
    };
  }
  if (source.type === "snapshot") {
    if (!Array.isArray(source.shots)) return null;
    const shots = source.shots.filter(isRecord);
    if (shots.length !== source.shots.length) return null;
    return {
      type: "snapshot",
      shots,
      dailyPlan: isRecord(source.dailyPlan) ? source.dailyPlan : null
    };
  }
  if (source.type === "shot") {
    if (
      source.eventType !== "INSERT"
      && source.eventType !== "UPDATE"
      && source.eventType !== "DELETE"
    ) return null;
    return {
      type: "shot",
      eventType: source.eventType,
      newRow: isRecord(source.newRow) ? source.newRow : {},
      oldRow: isRecord(source.oldRow) ? source.oldRow : {}
    };
  }
  if (source.type === "daily-plan" && source.eventType === "UPDATE") {
    return {
      type: "daily-plan",
      eventType: "UPDATE",
      newRow: isRecord(source.newRow) ? source.newRow : {},
      oldRow: isRecord(source.oldRow) ? source.oldRow : {}
    };
  }
  return null;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === "object" && !Array.isArray(value);
}
