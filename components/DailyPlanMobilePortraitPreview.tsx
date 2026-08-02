import {
  formatDailyPlanWeatherSummary,
  type DailyPlanPrintMeta
} from "@/lib/dailyPlan/printMeta";
import {
  filterRenderablePreviewRows,
  getPreviewCellText,
  hasMeaningfulRowValue,
  type PreviewDisplayField
} from "@/lib/dailyPlan/previewDisplay";
import type { DailyPlanPreviewTimetableRow } from "@/lib/dailyPlan/previewTimetable";
import {
  buildDailyPlanPreviewLocationRows,
  type DailyPlanPreviewLocationRow
} from "@/lib/dailyPlan/sceneLocations";
import type { DailyPlanDraft, DailyPlanLocation } from "@/lib/types";

type DailyPlanMobilePortraitPreviewProps = {
  plan: DailyPlanDraft;
  locations: DailyPlanLocation[];
  meta: DailyPlanPrintMeta;
  timetableRows: DailyPlanPreviewTimetableRow[];
  totalCutCount: number;
};

const sheetColumnCount = 10;
const cellClass = "border border-black px-0.5 py-1 align-middle break-words [overflow-wrap:anywhere]";
const headerCellClass = "daily-plan-preview-header border border-black px-0.5 py-1 align-middle font-bold break-words [overflow-wrap:anywhere]";
const accentCellClass = "daily-plan-preview-accent";
const crewCellClass = "daily-plan-preview-summary";
const eventRowClass = "daily-plan-preview-event";

/** Google Sheet의 `세로` 시트와 같은 10열 구성으로 모바일 일촬표를 표시합니다. */
export function DailyPlanMobilePortraitPreview({ plan, locations, meta, timetableRows, totalCutCount }: DailyPlanMobilePortraitPreviewProps) {
  const locationRows = buildDailyPlanPreviewLocationRows(meta.selectedSceneLocations, locations);
  const sheetTimetableRows = filterRenderablePreviewRows(timetableRows, getTimetableRowDisplayValues);
  const sceneDetailRows = sheetTimetableRows.filter(
    (row): row is Extract<DailyPlanPreviewTimetableRow, { type: "scene" }> => row.type === "scene"
  );
  const starringRows = filterRenderablePreviewRows(meta.starring, getPersonDisplayValues);
  const teamRows = filterRenderablePreviewRows(meta.teams, getTeamDisplayValues);
  const mainStaffRows = filterRenderablePreviewRows(getPreviewMainStaffRows(plan, meta), (member) => [
    member.role,
    member.name,
    member.contact
  ]);
  const weatherRows = filterRenderablePreviewRows(
    chunkRows(createWeatherFields(meta), 3),
    (row) => row.map((field) => field.value)
  );
  const timetableSummaryFields = createTimetableSummaryFields();
  const timetableDetailFields = createTimetableDetailFields();

  return (
    <article
      data-testid="daily-plan-mobile-portrait-preview"
      className="daily-plan-preview-surface mt-4 w-full overflow-hidden bg-white [font-family:inherit] text-[10px] leading-[1.4] text-black md:hidden"
    >
      <table className="w-full table-fixed border-collapse border-2 border-black text-center">
        <SheetColumns />
        <tbody>
          <tr className="h-[54px]">
            <td className={`${cellClass} whitespace-nowrap font-bold`}>
              <span className="text-[8px]">DAY</span>
              <span className="ml-0.5 text-[22px] leading-[1.2]">{getPreviewCellText(meta.day)}</span>
            </td>
            <td
              colSpan={sheetColumnCount - 1}
              className={`${cellClass} ${accentCellClass} px-1`}
            >
              <span className="text-[16px] font-bold">
                {hasMeaningfulRowValue(plan.title) ? `〈${plan.title}〉` : "기본정보가 없습니다."}
              </span>
              <span className="ml-1.5 text-[14px] font-normal">TIME TABLE</span>
            </td>
          </tr>
          {hasMeaningfulRowValue([plan.shootingDate, plan.callTime]) ? (
            <tr className="h-8">
              <td className={`${cellClass} text-[8px] font-bold`}>CALL TIME</td>
              <td colSpan={9} className={`${cellClass} ${accentCellClass}`}>
                <div className="flex items-baseline justify-center gap-1.5 whitespace-nowrap">
                  <span className="text-[8px] font-bold">Day</span>
                  <span className="text-[15px] font-bold">{formatDate(plan.shootingDate)}</span>
                  <span className="text-[8px] font-bold">Time</span>
                  <span className="text-[15px] font-bold">{getPreviewCellText(plan.callTime)}</span>
                </div>
              </td>
            </tr>
          ) : null}
          {mainStaffRows.length > 0 ? mainStaffRows.map((member) => (
            <tr key={`portrait-main-staff-${member.id}`}>
              <FixedCells fields={createMainStaffFields(member)} />
            </tr>
          )) : (
            <tr><td colSpan={sheetColumnCount} className={cellClass}>등록된 메인 스태프가 없습니다.</td></tr>
          )}
          {hasMeaningfulRowValue(meta.totalCrew) ? (
            <tr>
              <td colSpan={5} className={cellClass}>Total Crew</td>
              <td colSpan={5} className={`${cellClass} ${crewCellClass} font-bold`}>{formatCrewTotal(meta.totalCrew)}</td>
            </tr>
          ) : null}
        </tbody>
      </table>

      <table className="mt-1 w-full table-fixed border-collapse border-y-2 border-black text-center">
        <SheetColumns />
        <tbody>
          {weatherRows.length > 0 ? weatherRows.map((row, rowIndex) => (
            <tr key={`portrait-weather-${rowIndex}`}>
              {spreadFields(row, sheetColumnCount).map((field) => (
                <td key={field.key} colSpan={field.span} className={cellClass}>
                  <span className="font-bold">{field.label}</span>
                  <span className="ml-1">{getPreviewCellText(field.value)}</span>
                </td>
              ))}
            </tr>
          )) : (
            <tr><td colSpan={sheetColumnCount} className={cellClass}>날씨 정보가 없습니다.</td></tr>
          )}
        </tbody>
      </table>

      <table className="mt-1 w-full table-fixed border-collapse border-y-2 border-black text-center">
        <SheetColumns />
        <tbody>
          {locationRows.length > 0 ? locationRows.map((location, index) => (
            <tr key={location?.id || `portrait-location-${index}`} className="h-[21px]">
              <td colSpan={2} className={cellClass}>LOCATION {index + 1}</td>
              <FixedCells fields={createLocationFields(location)} />
            </tr>
          )) : (
            <tr><td colSpan={sheetColumnCount} className={cellClass}>등록된 장소가 없습니다.</td></tr>
          )}
        </tbody>
      </table>

      <table className="mt-1 w-full table-fixed border-collapse border-y-2 border-black text-center">
        <SheetColumns />
        <thead>
          <tr>
            {timetableSummaryFields.map((field) => (
              <th key={field.key} colSpan={field.span} className={headerCellClass}>{field.label}</th>
            ))}
          </tr>
        </thead>
        <tbody>
          {sheetTimetableRows.length > 0 ? sheetTimetableRows.map((row, index) => (
            <tr key={`portrait-time-${index}`} className={`${row.type === "additionalSchedule" ? eventRowClass : ""} h-[21px]`}>
              {row.type === "additionalSchedule" ? (
                <AdditionalScheduleSummaryCells row={row} />
              ) : (
                <FixedCells
                  fields={timetableSummaryFields.map((field) => ({
                    ...field,
                    value: getTimetableFieldValue(row, field.key)
                  }))}
                />
              )}
            </tr>
          )) : (
            <tr><td colSpan={sheetColumnCount} className={cellClass}>등록된 일정이 없습니다.</td></tr>
          )}
        </tbody>
      </table>

      <table className="mt-1 w-full table-fixed border-collapse border-y-2 border-black text-center">
        <SheetColumns />
        <thead>
          <tr>
            {timetableDetailFields.map((field) => (
              <th key={field.key} colSpan={field.span} className={headerCellClass}>{field.label}</th>
            ))}
          </tr>
        </thead>
        <tbody>
          {sceneDetailRows.map((row, index) => (
            <tr key={`portrait-detail-${index}`} className="h-[21px]">
              <FixedCells
                fields={timetableDetailFields.map((field) => ({
                  ...field,
                  value: getTimetableFieldValue(row, field.key)
                }))}
              />
            </tr>
          ))}
          <tr>
            <td colSpan={sheetColumnCount} className={`${cellClass} ${crewCellClass} py-1 text-center font-bold`}>
              총 컷수 {totalCutCount}컷
            </td>
          </tr>
        </tbody>
      </table>

      <SheetMemoSection title="Notice" value={plan.safetyNotice} />
      <SheetMemoSection title="Memo" value={meta.memoText} />

      <CallSheetTable
        title="Starring"
        emptyMessage="등록된 배우가 없습니다."
        fields={[
          { key: "name", label: "Starring", span: 1 },
          { key: "role", label: "Actor", span: 1 },
          { key: "callTime", label: "CALL", span: 1 },
          { key: "callLocation", label: "Call Location", span: 2 },
          { key: "notes", label: "Notes", span: 5 }
        ]}
        rows={starringRows.map((row) => ({
          name: row.name,
          role: row.role,
          callTime: row.callTime,
          callLocation: row.callLocation,
          notes: row.notes
        }))}
      />
      <CallSheetTable
        title="Team"
        emptyMessage="등록된 스태프 부서가 없습니다."
        fields={[
          { key: "team", label: "Team", span: 1 },
          { key: "total", label: "Total", span: 1 },
          { key: "callTime", label: "CALL", span: 1 },
          { key: "callLocation", label: "Call Location", span: 2 },
          { key: "notes", label: "Notes", span: 5 }
        ]}
        rows={teamRows.map((row) => ({
          team: row.team,
          total: row.total,
          callTime: row.callTime,
          callLocation: row.callLocation,
          notes: row.notes
        }))}
      />
    </article>
  );
}

function SheetColumns() {
  return (
    <colgroup>
      {Array.from({ length: sheetColumnCount }, (_, index) => (
        <col key={index} style={{ width: `${100 / sheetColumnCount}%` }} />
      ))}
    </colgroup>
  );
}

function FixedCells({ fields }: { fields: PreviewDisplayField[] }) {
  return fields.map((field) => (
    <td key={field.key} colSpan={field.span} className={cellClass}>
      {getPreviewCellText(field.value)}
    </td>
  ));
}

function AdditionalScheduleSummaryCells({
  row
}: {
  row: Extract<DailyPlanPreviewTimetableRow, { type: "additionalSchedule" }>;
}) {
  return (
    <>
      {[row.start, row.end, row.runtime].map((value, index) => (
        <td key={`portrait-additional-time-${index}`} className={cellClass}>
          {getPreviewCellText(value)}
        </td>
      ))}
      <td colSpan={sheetColumnCount - 3} className="border border-black !p-0 align-middle">
        <div className="grid min-h-[21px] grid-cols-2">
          <div className="flex min-w-0 items-center justify-center border-r border-black px-0.5 py-1 text-center break-words [overflow-wrap:anywhere]" aria-label="기타 일정 장소">
            {getPreviewCellText(row.location)}
          </div>
          <div className="flex min-w-0 items-center justify-center px-0.5 py-1 text-center break-words [overflow-wrap:anywhere]" aria-label="기타 일정 메모">
            {getPreviewCellText(row.memo)}
          </div>
        </div>
      </td>
    </>
  );
}

function getPreviewMainStaffRows(plan: DailyPlanDraft, meta: DailyPlanPrintMeta) {
  if (meta.mainStaff.length > 0) return meta.mainStaff;
  return [
    { id: "legacy-director", role: "Director", name: plan.director, contact: meta.directorContact },
    { id: "legacy-assistant-director", role: "A.D", name: plan.assistantDirector, contact: meta.assistantDirectorContact },
    { id: "legacy-producer", role: "Producer", name: plan.production, contact: meta.producerContact }
  ].filter((member) => member.name.trim() || member.contact.trim());
}

function chunkRows<T>(rows: T[], size: number) {
  const chunks: T[][] = [];
  for (let index = 0; index < rows.length; index += size) {
    chunks.push(rows.slice(index, index + size));
  }
  return chunks;
}

function SheetMemoSection({ title, value }: { title: string; value: string }) {
  return (
    <section className="mt-1 border-2 border-black">
      <h3 className="daily-plan-preview-header border-b border-black py-1 text-center text-[11px] font-normal">{title}</h3>
      <p className="min-h-[88px] whitespace-pre-wrap break-words px-1 py-1 text-left [overflow-wrap:anywhere]">{value || ""}</p>
    </section>
  );
}

function CallSheetTable({
  title,
  emptyMessage,
  fields,
  rows
}: {
  title: string;
  emptyMessage: string;
  fields: Array<Omit<PreviewDisplayField, "value">>;
  rows: Array<Record<string, string>>;
}) {
  return (
    <section className="mt-1">
      <h3 className="sr-only">{title}</h3>
      <table className="w-full table-fixed border-collapse border-y-2 border-black text-center">
        <SheetColumns />
        <thead>
          <tr>
            {fields.map((field) => (
              <th key={field.key} colSpan={field.span} className={headerCellClass}>{field.label}</th>
            ))}
          </tr>
        </thead>
        <tbody>
          {rows.length > 0 ? rows.map((row, rowIndex) => (
            <tr key={`${title}-${rowIndex}`} className="h-[21px]">
              <FixedCells fields={fields.map((field) => ({ ...field, value: row[field.key] }))} />
            </tr>
          )) : (
            <tr><td colSpan={sheetColumnCount} className={cellClass}>{emptyMessage}</td></tr>
          )}
        </tbody>
      </table>
    </section>
  );
}

function createMainStaffFields(member: { role: string; name: string; contact: string }): PreviewDisplayField[] {
  return [
    { key: "role", label: "역할", span: 2, value: member.role },
    { key: "name", label: "이름", span: 3, value: member.name },
    { key: "contact", label: "연락처", span: 5, value: member.contact }
  ];
}

function createWeatherFields(meta: DailyPlanPrintMeta): PreviewDisplayField[] {
  return [
    { key: "sunrise", label: "일출", span: 1, value: meta.sunrise },
    { key: "weather", label: "날씨", span: 1, value: formatDailyPlanWeatherSummary(meta) },
    { key: "maxTemperature", label: "최고 기온", span: 1, value: formatTemperature(meta.maxTemperature) },
    { key: "sunset", label: "일몰", span: 1, value: meta.sunset },
    { key: "rainProbability", label: "강수 확률", span: 1, value: formatPercent(meta.rainProbability) },
    { key: "minTemperature", label: "최저 기온", span: 1, value: formatTemperature(meta.minTemperature) }
  ];
}

function createLocationFields(location: DailyPlanPreviewLocationRow): PreviewDisplayField[] {
  return [
    { key: "name", label: "장소명", span: 2, value: location.name },
    { key: "address", label: "주소", span: 6, value: location.address }
  ];
}

function createTimetableSummaryFields(): PreviewDisplayField[] {
  return [
    { key: "start", label: "START", span: 1, value: "" },
    { key: "end", label: "END", span: 1, value: "" },
    { key: "runtime", label: "RT", span: 1, value: "" },
    { key: "location", label: "LOCATION", span: 2, value: "" },
    {
      key: "dayNight",
      label: "D/N/S",
      span: 1,
      value: ""
    },
    {
      key: "sceneNumber",
      label: "SCENE",
      span: 1,
      value: ""
    },
    {
      key: "totalCut",
      label: "Total CUT",
      span: 1,
      value: ""
    },
    {
      key: "shootingOrder",
      label: "Shooting order",
      span: 2,
      value: ""
    }
  ];
}

function createTimetableDetailFields(): PreviewDisplayField[] {
  return [
    {
      key: "sceneNumber",
      label: "SCENE",
      span: 1,
      value: ""
    },
    {
      key: "description",
      label: "Description",
      span: 3,
      value: ""
    },
    {
      key: "shootingOrder",
      label: "Shooting order",
      span: 2,
      value: ""
    },
    {
      key: "cast",
      label: "Actor",
      span: 1,
      value: ""
    },
    {
      key: "notes",
      label: "Notes",
      span: 3,
      value: ""
    }
  ];
}

function getTimetableFieldValue(
  row: Extract<DailyPlanPreviewTimetableRow, { type: "scene" }>,
  key: string
) {
  if (key in row) return row[key as keyof typeof row];
  return "";
}

function getTimetableRowDisplayValues(row: DailyPlanPreviewTimetableRow) {
  return row.type === "additionalSchedule"
    ? [row.start, row.end, row.runtime, row.location, row.memo]
    : [
        row.start,
        row.end,
        row.runtime,
        row.location,
        row.dayNight,
        row.sceneNumber,
        row.totalCut,
        row.cast,
        row.description,
        row.shootingOrder,
        row.notes
      ];
}

function getPersonDisplayValues(person: DailyPlanPrintMeta["starring"][number]) {
  return [person.name, person.role, person.callTime, person.callLocation, person.notes];
}

function getTeamDisplayValues(team: DailyPlanPrintMeta["teams"][number]) {
  return [team.team, team.total, team.callTime, team.callLocation, team.notes];
}

function spreadFields(fields: PreviewDisplayField[], totalColumns: number) {
  const baseSpan = Math.floor(totalColumns / fields.length);
  const remainder = totalColumns % fields.length;
  return fields.map((field, index) => ({
    ...field,
    span: baseSpan + (index < remainder ? 1 : 0)
  }));
}

function formatDate(value: string) {
  return value ? value.replace(/-/g, ".") : "";
}

function formatCrewTotal(value: string) {
  const trimmed = value.trim();
  if (!trimmed) return "";
  return /명$/.test(trimmed) ? trimmed : `${trimmed}명`;
}

function formatTemperature(value: string) {
  const trimmed = value.trim();
  if (!trimmed) return "";
  return /[°℃]$/.test(trimmed) ? trimmed : `${trimmed}°`;
}

function formatPercent(value: string) {
  const trimmed = value.trim();
  if (!trimmed) return "";
  return /%$/.test(trimmed) ? trimmed : `${trimmed}%`;
}
