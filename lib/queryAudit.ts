"use client";

export const QUERY_AUDIT_STORAGE_KEY = "shotcl:debugQueries";
export const QUERY_AUDIT_EVENT = "shotcl:query-audit";

export type QueryAuditStatus = "success" | "failure";

export type QueryAuditEntry = {
  id: number;
  label: string;
  source: string;
  startedAt: string;
  endedAt: string;
  durationMs: number;
  status: QueryAuditStatus;
  callCount: number;
  duplicateCount: number;
  error?: string;
};

export type QueryAuditSummary = {
  label: string;
  source: string;
  calls: number;
  duplicates: number;
  failures: number;
  totalDurationMs: number;
  lastDurationMs: number;
  lastStatus: QueryAuditStatus;
};

const entries: QueryAuditEntry[] = [];
const counts = new Map<string, number>();
let nextId = 1;
let nextMeasureId = 1;

/** URL 또는 localStorage로 명시적으로 켠 개발 환경에서만 audit를 활성화합니다. */
export function isQueryAuditEnabled() {
  if (process.env.NODE_ENV === "production" || typeof window === "undefined") return false;
  const debugParam = new URLSearchParams(window.location.search).get("debugQueries");
  try {
    if (debugParam === "1") {
      window.localStorage.setItem(QUERY_AUDIT_STORAGE_KEY, "1");
      return true;
    }
    if (debugParam === "0") {
      window.localStorage.removeItem(QUERY_AUDIT_STORAGE_KEY);
      return false;
    }
    return window.localStorage.getItem(QUERY_AUDIT_STORAGE_KEY) === "1";
  } catch {
    return debugParam === "1";
  }
}

/** 비활성 상태에서는 원래 Promise만 실행해 production 동작과 비용을 바꾸지 않습니다. */
export async function auditQuery<T>(
  label: string,
  source: string,
  operation: () => Promise<T>
): Promise<T> {
  if (!isQueryAuditEnabled()) return operation();

  const startedAt = new Date();
  const started = performance.now();
  const measureId = nextMeasureId;
  nextMeasureId += 1;
  const startMark = `shotcl:query:${measureId}:start`;
  const endMark = `shotcl:query:${measureId}:end`;
  performance.mark(startMark);
  const callCount = (counts.get(label) ?? 0) + 1;
  counts.set(label, callCount);

  try {
    const result = await operation();
    recordEntry({
      label,
      source,
      startedAt,
      started,
      status: "success",
      callCount
    });
    recordPerformanceMeasure(label, startMark, endMark);
    return result;
  } catch (error) {
    recordEntry({
      label,
      source,
      startedAt,
      started,
      status: "failure",
      callCount,
      error: error instanceof Error ? error.message : String(error)
    });
    recordPerformanceMeasure(label, startMark, endMark);
    throw error;
  }
}

export function getQueryAuditEntries() {
  return [...entries];
}

export function getQueryAuditSummary(): QueryAuditSummary[] {
  const summary = new Map<string, QueryAuditSummary>();
  entries.forEach((entry) => {
    const current = summary.get(entry.label);
    if (!current) {
      summary.set(entry.label, {
        label: entry.label,
        source: entry.source,
        calls: 1,
        duplicates: 0,
        failures: entry.status === "failure" ? 1 : 0,
        totalDurationMs: entry.durationMs,
        lastDurationMs: entry.durationMs,
        lastStatus: entry.status
      });
      return;
    }
    current.calls += 1;
    current.duplicates = current.calls - 1;
    current.failures += entry.status === "failure" ? 1 : 0;
    current.totalDurationMs = roundMs(current.totalDurationMs + entry.durationMs);
    current.lastDurationMs = entry.durationMs;
    current.lastStatus = entry.status;
  });
  return [...summary.values()].sort((left, right) => (
    right.calls - left.calls || right.totalDurationMs - left.totalDurationMs
  ));
}

export function clearQueryAudit() {
  entries.length = 0;
  counts.clear();
  dispatchAuditEvent();
}

function recordEntry(value: {
  label: string;
  source: string;
  startedAt: Date;
  started: number;
  status: QueryAuditStatus;
  callCount: number;
  error?: string;
}) {
  const entry: QueryAuditEntry = {
    id: nextId,
    label: value.label,
    source: value.source,
    startedAt: value.startedAt.toISOString(),
    endedAt: new Date().toISOString(),
    durationMs: roundMs(performance.now() - value.started),
    status: value.status,
    callCount: value.callCount,
    duplicateCount: Math.max(0, value.callCount - 1),
    error: value.error
  };
  nextId += 1;
  entries.push(entry);
  if (entries.length > 300) entries.splice(0, entries.length - 300);
  console.table(getQueryAuditSummary());
  dispatchAuditEvent();
}

function dispatchAuditEvent() {
  if (typeof window === "undefined") return;
  window.dispatchEvent(new CustomEvent(QUERY_AUDIT_EVENT));
}

function roundMs(value: number) {
  return Math.round(value * 10) / 10;
}

function recordPerformanceMeasure(label: string, startMark: string, endMark: string) {
  performance.mark(endMark);
  performance.measure(`shotcl:query:${label}`, startMark, endMark);
  performance.clearMarks(startMark);
  performance.clearMarks(endMark);
}
