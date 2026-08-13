import type { ComponentPropsWithoutRef } from "react";
import {
  DAILY_PLAN_TIMETABLE_LOCATION_COLUMN_SPAN,
  DAILY_PLAN_TIMETABLE_TIME_COLUMN_SPAN,
  getDailyPlanAdditionalScheduleCellLayout,
  type DailyPlanPreviewTimetableRow
} from "@/lib/dailyPlan/previewTimetable";
import {
  getPreviewCellText,
  type PreviewDisplayField
} from "@/lib/dailyPlan/previewDisplay";

const timetableColumnCount = 10;
const cellClass = "daily-plan-cell border border-black text-center align-middle";
const headerCellClass = `${cellClass} daily-plan-preview-header font-black`;
const eventRowClass = "daily-plan-preview-event";
const defaultTableClass = "daily-plan-section-table mt-1 w-full table-fixed border-collapse border-2 border-black text-center";

export type DailyPlanTimetableProps = Omit<ComponentPropsWithoutRef<"table">, "children"> & {
  rows: readonly DailyPlanPreviewTimetableRow[];
  emptyMessage?: string;
};

/**
 * 화면의 모바일 일촬표와 세로 문서가 함께 사용하는 보기 전용 8필드 표입니다.
 * Home 같은 소비자는 row나 cell을 다시 만들지 않고 canonical preview row만 전달합니다.
 */
export function DailyPlanTimetable({
  rows,
  emptyMessage = "등록된 일정이 없습니다.",
  className = defaultTableClass,
  ...tableProps
}: DailyPlanTimetableProps) {
  const summaryFields = createTimetableSummaryFields(rows);

  return (
    <table {...tableProps} className={className}>
      <EqualColumns count={timetableColumnCount} />
      <thead>
        <tr>
          {summaryFields.map((field) => (
            <th key={field.key} colSpan={field.span} className={`${headerCellClass} ${getTimetableCompactClass(field.key)}`}>
              {field.label}
            </th>
          ))}
        </tr>
      </thead>
      <tbody>
        {rows.length > 0 ? rows.map((row, index) => (
          <tr key={`portrait-summary-${index}`} className={row.type === "additionalSchedule" ? eventRowClass : undefined}>
            {row.type === "additionalSchedule" ? (
              <AdditionalScheduleSummaryCells row={row} />
            ) : (
              <TimetableCells
                fields={summaryFields.map((field) => ({
                  ...field,
                  value: getTimetableFieldValue(row, field.key)
                }))}
              />
            )}
          </tr>
        )) : (
          <tr><td colSpan={timetableColumnCount} className={cellClass}>{emptyMessage}</td></tr>
        )}
      </tbody>
    </table>
  );
}

function EqualColumns({ count }: { count: number }) {
  const safeCount = Math.max(1, count);
  return (
    <colgroup>
      {Array.from({ length: safeCount }, (_, index) => (
        <col key={index} style={{ width: `${100 / safeCount}%` }} />
      ))}
    </colgroup>
  );
}

function TimetableCells({ fields }: { fields: PreviewDisplayField[] }) {
  return fields.map((field) => (
    <td
      key={field.key}
      colSpan={field.span}
      className={`${cellClass} ${getTimetableCompactClass(field.key)} ${isTimetableShortValue(field.key) ? "" : "daily-plan-cell--wrap"}`}
    >
      {getPreviewCellText(field.value)}
    </td>
  ));
}

function AdditionalScheduleSummaryCells({
  row
}: {
  row: Extract<DailyPlanPreviewTimetableRow, { type: "additionalSchedule" }>;
}) {
  const layout = getDailyPlanAdditionalScheduleCellLayout(
    row.location,
    timetableColumnCount - DAILY_PLAN_TIMETABLE_TIME_COLUMN_SPAN
  );
  return (
    <>
      {[row.start, row.end, row.runtime].map((value, index) => (
        <td key={`portrait-additional-time-${index}`} className={`${cellClass} daily-plan-cell--nowrap daily-plan-timetable-cell--time`}>
          {getPreviewCellText(value)}
        </td>
      ))}
      {layout.hasLocation ? (
        <td colSpan={layout.locationSpan} className={`${cellClass} !p-0`}>
          <AdditionalScheduleCellContent value={row.location} />
        </td>
      ) : null}
      <td colSpan={layout.contentSpan} className={`${cellClass} !p-0`}>
        <AdditionalScheduleCellContent value={row.memo} />
      </td>
    </>
  );
}

function AdditionalScheduleCellContent({ value }: { value: unknown }) {
  return (
    <div
      className="daily-plan-additional-grid daily-plan-additional-cell daily-plan-cell--wrap flex min-h-7 min-w-0 items-center justify-center text-center"
    >
      {getPreviewCellText(value)}
    </div>
  );
}

/** 세로형 summary의 10개 leaf column에 배치되는 canonical 8필드입니다. */
function createTimetableSummaryFields(rows: readonly DailyPlanPreviewTimetableRow[]): PreviewDisplayField[] {
  return [
    { key: "start", label: "START", span: 1, value: rows.map((row) => row.start) },
    { key: "end", label: "END", span: 1, value: rows.map((row) => row.end) },
    { key: "runtime", label: "RT", span: 1, value: rows.map((row) => row.runtime) },
    { key: "location", label: "LOCATION", span: DAILY_PLAN_TIMETABLE_LOCATION_COLUMN_SPAN, value: rows.map((row) => row.location) },
    {
      key: "dayNight",
      label: "D/N/S",
      span: 1,
      value: rows.map((row) => row.type === "scene" ? row.dayNight : "")
    },
    {
      key: "sceneNumber",
      label: "SCENE",
      span: 1,
      value: rows.map((row) => row.type === "scene" ? row.sceneNumber : "")
    },
    {
      key: "totalCut",
      label: "Total CUT",
      span: 1,
      value: rows.map((row) => row.type === "scene" ? row.totalCut : "")
    },
    {
      key: "shootingOrder",
      label: "Shooting order",
      span: 2,
      value: rows.map((row) => row.type === "scene" ? row.shootingOrder : "")
    }
  ];
}

function getTimetableFieldValue(row: DailyPlanPreviewTimetableRow, key: string) {
  if (row.type === "additionalSchedule") return "";
  if (key in row) return row[key as keyof typeof row];
  return "";
}

function getTimetableCompactClass(key: string) {
  return isTimetableShortValue(key)
    ? `daily-plan-cell--nowrap ${isTimetableTimeValue(key) ? "daily-plan-timetable-cell--time" : "daily-plan-timetable-cell--compact"}`
    : "";
}

function isTimetableShortValue(key: string) {
  // Cut 셀은 회차별 subset range를 함께 표시하므로 2줄 wrapping을 허용합니다.
  return ["start", "end", "runtime", "dayNight", "sceneNumber"].includes(key);
}

function isTimetableTimeValue(key: string) {
  return ["start", "end", "runtime"].includes(key);
}
