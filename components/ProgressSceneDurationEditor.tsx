"use client";

import { useEffect, useId, useMemo, useState } from "react";

export const MAX_PROGRESS_SCENE_DURATION_MINUTES = 1440;

export type ProgressSceneDurationRow = {
  /** daily plan timetable scene row의 안정적인 rowId입니다. */
  rowId: string;
  /** 화면에 표시할 씬 이름입니다. 예: `S#1`. */
  sceneLabel: string;
  runtimeMinutes: number | null;
};

export type ProgressSceneDurationSaveInput = {
  rowId: string;
  runtimeMinutes: number | null;
};

export type ProgressSceneDurationEditorProps = {
  rows: readonly ProgressSceneDurationRow[];
  canEdit: boolean;
  onSave: (input: ProgressSceneDurationSaveInput) => Promise<void>;
  showTitle?: boolean;
  className?: string;
};

/** timetable의 stable rowId별 예정 소요시간을 한 번씩 표시하고 명시적으로 저장합니다. */
export function ProgressSceneDurationEditor({
  rows,
  canEdit,
  onSave,
  showTitle = true,
  className = ""
}: ProgressSceneDurationEditorProps) {
  const titleId = useId();
  const uniqueRows = useMemo(() => uniqueSceneDurationRows(rows), [rows]);

  if (uniqueRows.length === 0) return null;

  return (
    <section
      className={`border border-field-border bg-field-section ${className}`}
      aria-labelledby={showTitle ? titleId : undefined}
      aria-label={showTitle ? undefined : `${uniqueRows[0]?.sceneLabel || "씬"} 예정 소요시간`}
    >
      {showTitle ? (
        <h2 id={titleId} className="border-b border-field-border px-3 py-2.5 text-sm font-bold text-field-text">
          씬별 예정 소요시간
        </h2>
      ) : null}
      <div className="divide-y divide-field-border">
        {uniqueRows.map((row) => (
          <SceneDurationRow key={row.rowId} row={row} canEdit={canEdit} onSave={onSave} />
        ))}
      </div>
    </section>
  );
}

function SceneDurationRow({
  row,
  canEdit,
  onSave
}: {
  row: ProgressSceneDurationRow;
  canEdit: boolean;
  onSave: (input: ProgressSceneDurationSaveInput) => Promise<void>;
}) {
  const inputId = useId();
  const normalizedRuntime = normalizeStoredRuntime(row.runtimeMinutes);
  const [committedMinutes, setCommittedMinutes] = useState<number | null>(normalizedRuntime);
  const [draft, setDraft] = useState(() => formatDraftValue(normalizedRuntime));
  const [isSaving, setIsSaving] = useState(false);
  const [errorMessage, setErrorMessage] = useState("");
  const [savedMessage, setSavedMessage] = useState("");

  useEffect(() => {
    const nextRuntime = normalizeStoredRuntime(row.runtimeMinutes);
    setCommittedMinutes(nextRuntime);
    setDraft(formatDraftValue(nextRuntime));
    setErrorMessage("");
    setSavedMessage("");
  }, [row.rowId, row.runtimeMinutes]);

  const hasChanges = draft.trim() !== formatDraftValue(committedMinutes);

  function handleCancel() {
    if (isSaving) return;
    setDraft(formatDraftValue(committedMinutes));
    setErrorMessage("");
    setSavedMessage("");
  }

  async function handleSave() {
    if (isSaving) return;
    const parsedRuntime = parseRuntimeDraft(draft);
    if (!parsedRuntime.valid) {
      setErrorMessage(`0~${MAX_PROGRESS_SCENE_DURATION_MINUTES} 사이의 정수로 입력해주세요.`);
      setSavedMessage("");
      return;
    }
    const runtimeMinutes = parsedRuntime.value;

    setIsSaving(true);
    setErrorMessage("");
    setSavedMessage("");
    try {
      await onSave({ rowId: row.rowId, runtimeMinutes });
      setCommittedMinutes(runtimeMinutes);
      setDraft(formatDraftValue(runtimeMinutes));
      setSavedMessage("저장되었습니다.");
    } catch (error) {
      setErrorMessage(getSaveErrorMessage(error));
    } finally {
      setIsSaving(false);
    }
  }

  return (
    <div className="grid min-w-0 gap-2 px-3 py-2.5 sm:grid-cols-[minmax(0,1fr)_auto] sm:items-center">
      <div className="min-w-0">
        <p className="truncate text-sm font-bold text-field-text">{row.sceneLabel || "씬"}</p>
        {!canEdit ? (
          <p className="mt-0.5 text-xs text-field-muted">
            {committedMinutes === null ? "예정 시간 미입력" : `예정 ${committedMinutes}분`}
          </p>
        ) : null}
      </div>

      {canEdit ? (
        <div className="min-w-0">
          <div className="flex min-w-0 flex-wrap items-center gap-1.5 sm:flex-nowrap sm:justify-end">
            <label htmlFor={inputId} className="sr-only">{row.sceneLabel || "씬"} 예정 소요시간</label>
            <div className="flex h-9 min-w-0 items-center border border-field-border bg-field-input focus-within:border-field-primary focus-within:ring-1 focus-within:ring-field-primary/30">
              <input
                id={inputId}
                type="number"
                inputMode="numeric"
                min={0}
                max={MAX_PROGRESS_SCENE_DURATION_MINUTES}
                step={1}
                value={draft}
                disabled={isSaving}
                onChange={(event) => {
                  setDraft(event.target.value);
                  setErrorMessage("");
                  setSavedMessage("");
                }}
                className="h-full w-20 min-w-0 border-0 bg-transparent px-2 text-right text-sm tabular-nums text-field-text outline-none disabled:opacity-60"
                aria-describedby={`${inputId}-message`}
                aria-invalid={Boolean(errorMessage)}
              />
              <span className="shrink-0 pr-2 text-xs text-field-muted" aria-hidden>분</span>
            </div>
            <button
              type="button"
              onClick={handleCancel}
              disabled={isSaving || (!hasChanges && !errorMessage)}
              className="min-h-9 shrink-0 border border-field-border bg-field-input px-2.5 text-xs font-bold text-field-subtle transition-colors hover:bg-field-hover disabled:cursor-not-allowed disabled:opacity-45"
            >
              취소
            </button>
            <button
              type="button"
              onClick={handleSave}
              disabled={isSaving || !hasChanges}
              className="min-h-9 shrink-0 border border-field-primary bg-field-primary px-2.5 text-xs font-bold text-field-accent-foreground transition-colors hover:bg-field-secondary disabled:cursor-not-allowed disabled:border-field-disabled disabled:bg-field-disabled disabled:text-field-muted"
            >
              {isSaving ? "저장 중" : "저장"}
            </button>
          </div>
          <p
            id={`${inputId}-message`}
            className={`mt-1 min-h-4 text-right text-[11px] ${errorMessage ? "text-field-danger" : "text-field-muted"}`}
            role={errorMessage ? "alert" : undefined}
            aria-live="polite"
          >
            {errorMessage || savedMessage}
          </p>
        </div>
      ) : null}
    </div>
  );
}

function uniqueSceneDurationRows(rows: readonly ProgressSceneDurationRow[]) {
  const seenRowIds = new Set<string>();
  const result: ProgressSceneDurationRow[] = [];
  rows.forEach((row) => {
    const rowId = row.rowId.trim();
    if (!rowId || seenRowIds.has(rowId)) return;
    seenRowIds.add(rowId);
    result.push({ ...row, rowId });
  });
  return result;
}

function normalizeStoredRuntime(value: number | null) {
  if (!Number.isInteger(value) || value === null || value < 0 || value > MAX_PROGRESS_SCENE_DURATION_MINUTES) {
    return null;
  }
  return value;
}

function formatDraftValue(value: number | null) {
  return value === null ? "" : String(value);
}

function parseRuntimeDraft(value: string) {
  const trimmed = value.trim();
  if (!trimmed) return { valid: true as const, value: null };
  if (!/^\d+$/.test(trimmed)) return { valid: false as const, value: null };
  const parsed = Number(trimmed);
  if (!Number.isInteger(parsed) || parsed < 0 || parsed > MAX_PROGRESS_SCENE_DURATION_MINUTES) {
    return { valid: false as const, value: null };
  }
  return { valid: true as const, value: parsed };
}

function getSaveErrorMessage(error: unknown) {
  if (error instanceof Error && error.message.trim()) return error.message;
  return "예정 소요시간을 저장하지 못했습니다.";
}
