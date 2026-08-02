import {
  formatDailyPlanWeatherSummary,
  type DailyPlanPrintMeta
} from "@/lib/dailyPlan/printMeta";
import {
  DAILY_PLAN_TIMETABLE_ADDITIONAL_CONTENT_SPAN,
  DAILY_PLAN_TIMETABLE_COLUMN_COUNT,
  type DailyPlanPreviewTimetableRow
} from "@/lib/dailyPlan/previewTimetable";
import {
  filterRenderablePreviewRows,
  getPreviewCellText,
  hasMeaningfulRowValue,
  type PreviewDisplayField
} from "@/lib/dailyPlan/previewDisplay";
import {
  buildDailyPlanPreviewLocationRows,
  type DailyPlanPreviewLocationRow
} from "@/lib/dailyPlan/sceneLocations";
import type { DailyPlanDraft, DailyPlanLocation } from "@/lib/types";

type DailyPlanDesktopLandscapePreviewProps = {
  plan: DailyPlanDraft;
  locations: DailyPlanLocation[];
  meta: DailyPlanPrintMeta;
  timetableRows: DailyPlanPreviewTimetableRow[];
  totalCutCount: number;
};

const sectionTableClass = "daily-plan-section-table mt-1 w-full table-fixed border-collapse border-2 border-black text-center";
const halfTableClass = "daily-plan-section-table w-full table-fixed border-collapse border-2 border-black text-center";
const cellClass = "border border-black px-1.5 py-1 text-center align-middle";
const headerCellClass = `${cellClass} daily-plan-preview-header font-black`;
const accentCellClass = "daily-plan-preview-accent";
const crewCellClass = "daily-plan-preview-summary";
const eventRowClass = "daily-plan-preview-event";
const timetableColumnCount = DAILY_PLAN_TIMETABLE_COLUMN_COUNT;
const callSheetColumnCount = 8;

/** 앱 화면에서만 사용하는 Google Sheet 기반 가로형 미리보기입니다. */
export function DailyPlanDesktopLandscapePreview({ plan, locations, meta, timetableRows, totalCutCount }: DailyPlanDesktopLandscapePreviewProps) {
  const printableLocations = buildDailyPlanPreviewLocationRows(locations);
  const printableTimetableRows = filterRenderablePreviewRows(timetableRows, getTimetableRowDisplayValues);
  const starringRows = filterRenderablePreviewRows(meta.starring, getPersonDisplayValues);
  const teamRows = filterRenderablePreviewRows(meta.teams, getTeamDisplayValues);
  const printableMainStaffRows = filterRenderablePreviewRows(getPreviewMainStaffRows(plan, meta), (member) => [
    member.role,
    member.name,
    member.contact
  ]);
  const weatherFields = filterRenderablePreviewRows(createWeatherFields(meta), (field) => field.value);
  const timetableFields = createTimetableFields(printableTimetableRows);
  const memoFields: PreviewDisplayField[] = [
    { key: "notice", label: "Notice", span: 1, value: plan.safetyNotice },
    { key: "memo", label: "Memo", span: 1, value: meta.memoText }
  ];

  return (
    <article data-testid="daily-plan-desktop-landscape-preview" className="daily-plan-template text-[11px] leading-tight text-black">
      <div className="grid grid-cols-[minmax(0,3fr)_minmax(0,1.08fr)] gap-1">
        <table className="daily-plan-section-table w-full table-fixed border-collapse border-2 border-black text-center">
          <EqualColumns count={12} />
          <tbody>
            <tr>
              <td className={`${cellClass} font-black`}>
                <span className="text-[9px]">DAY</span>
                <span className="ml-1 text-2xl leading-none">{getPreviewCellText(meta.day)}</span>
              </td>
              <td colSpan={9} className={cellClass}>
                <span className="text-2xl font-black">
                  {getPreviewCellText(plan.title).trim() ? `〈${plan.title}〉` : "기본정보가 없습니다."}
                </span>
                <span className="ml-2 text-lg font-normal">TIME TABLE</span>
              </td>
              <td colSpan={2} className={`${cellClass} ${crewCellClass}`}>
                <span className="block text-[9px] font-bold">Total Crew</span>
                <span className="text-lg font-black">{getPreviewCellText(meta.totalCrew)}</span>
              </td>
            </tr>
            {hasMeaningfulRowValue([plan.shootingDate, plan.callTime]) ? (
              <tr>
                <td colSpan={2} className={`${cellClass} font-black`}>CALL TIME</td>
                <td colSpan={10} className={`${cellClass} ${accentCellClass}`}>
                  <span className="mr-1 text-[9px] font-bold">Day</span>
                  <span className="text-lg font-black">{formatDate(plan.shootingDate)}</span>
                  <span className="ml-3 mr-1 text-[9px] font-bold">Time</span>
                  <span className="text-lg font-black">{getPreviewCellText(plan.callTime)}</span>
                </td>
              </tr>
            ) : null}
            {printableMainStaffRows.length > 0 ? printableMainStaffRows.map((member) => (
              <tr key={member.id}>
                <FixedCells fields={createMainStaffFields(member)} />
              </tr>
            )) : (
              <tr><td colSpan={12} className={cellClass}>등록된 메인 스태프가 없습니다.</td></tr>
            )}
          </tbody>
        </table>

        <table className="daily-plan-section-table w-full table-fixed border-collapse border-2 border-black text-center">
          <EqualColumns count={2} />
          <tbody>
            {weatherFields.length > 0 ? weatherFields.map((field) => (
              <tr key={field.key}>
                <td className={`${cellClass} font-bold`}>{field.label}</td>
                <td className={cellClass}>{getPreviewCellText(field.value)}</td>
              </tr>
            )) : (
              <tr><td colSpan={2} className={cellClass}>날씨 정보가 없습니다.</td></tr>
            )}
          </tbody>
        </table>
      </div>

      <table className={sectionTableClass}>
        <EqualColumns count={16} />
        <tbody>
          {printableLocations.length > 0 ? printableLocations.map((location, index) => (
            <tr key={location.id || `landscape-location-${index}`}>
              <td colSpan={2} className={`${cellClass} whitespace-nowrap font-black`}>LOCATION {index + 1}</td>
              <FixedCells fields={createLocationFields(location)} />
            </tr>
          )) : (
            <tr><td colSpan={16} className={cellClass}>등록된 장소가 없습니다.</td></tr>
          )}
        </tbody>
      </table>

      <table className={sectionTableClass}>
        <EqualColumns count={timetableColumnCount} />
        <thead>
          <tr>
            {timetableFields.map((field) => (
              <th key={field.key} colSpan={field.span} className={headerCellClass}>{field.label}</th>
            ))}
          </tr>
        </thead>
        <tbody>
          {printableTimetableRows.length > 0 ? printableTimetableRows.map((row, index) => (
            <tr key={`landscape-row-${index}`} className={row.type === "additionalSchedule" ? eventRowClass : undefined}>
              {row.type === "additionalSchedule" ? (
                <AdditionalScheduleCells row={row} />
              ) : (
                <FixedCells
                  fields={timetableFields.map((field) => ({
                    ...field,
                    value: getTimetableFieldValue(row, field.key)
                  }))}
                />
              )}
            </tr>
          )) : (
            <tr><td colSpan={timetableColumnCount} className={cellClass}>등록된 일정이 없습니다.</td></tr>
          )}
          <tr>
            <td colSpan={timetableColumnCount} className={`${cellClass} ${crewCellClass} py-1 text-center font-black`}>
              총 컷수 {totalCutCount}컷
            </td>
          </tr>
        </tbody>
      </table>

      <div className="mt-1 grid grid-cols-2 gap-1">
        {memoFields.map((field) => (
          <table key={field.key} className={halfTableClass}>
            <tbody>
              <tr><td className={`${headerCellClass} font-black`}>{field.label}</td></tr>
              <tr><td className={`${cellClass} min-h-20 whitespace-pre-wrap align-top`}>{getPreviewCellText(field.value)}</td></tr>
            </tbody>
          </table>
        ))}
      </div>

      <div className="mt-1 grid grid-cols-2 gap-1">
        <FixedCallSheetTable
          title="Starring"
          emptyMessage="등록된 배우가 없습니다."
          fields={[
            { key: "name", label: "Starring", span: 2 },
            { key: "role", label: "Actor", span: 2 },
            { key: "callTime", label: "CALL", span: 1 },
            { key: "callLocation", label: "Call Location", span: 2 },
            { key: "notes", label: "Notes", span: 1 }
          ]}
          rows={starringRows.map((person) => ({
            name: person.name,
            role: person.role,
            callTime: person.callTime,
            callLocation: person.callLocation,
            notes: person.notes
          }))}
        />
        <FixedCallSheetTable
          title="Team"
          emptyMessage="등록된 스태프 부서가 없습니다."
          fields={[
            { key: "team", label: "Team", span: 2 },
            { key: "total", label: "Total", span: 1 },
            { key: "callTime", label: "CALL", span: 1 },
            { key: "callLocation", label: "Call Location", span: 2 },
            { key: "notes", label: "Notes", span: 2 }
          ]}
          rows={teamRows.map((team) => ({
            team: team.team,
            total: team.total,
            callTime: team.callTime,
            callLocation: team.callLocation,
            notes: team.notes
          }))}
        />
      </div>
    </article>
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

function FixedCells({ fields }: { fields: PreviewDisplayField[] }) {
  return fields.map((field) => (
    <td key={field.key} colSpan={field.span} className={`${cellClass} break-words [overflow-wrap:anywhere]`}>
      {getPreviewCellText(field.value)}
    </td>
  ));
}

function AdditionalScheduleCells({
  row
}: {
  row: Extract<DailyPlanPreviewTimetableRow, { type: "additionalSchedule" }>;
}) {
  return (
    <>
      {[row.start, row.end, row.runtime].map((value, index) => (
        <td key={`additional-time-${index}`} className={cellClass}>
          {getPreviewCellText(value)}
        </td>
      ))}
      <td
        colSpan={DAILY_PLAN_TIMETABLE_ADDITIONAL_CONTENT_SPAN}
        className="border border-black !p-0 align-middle"
      >
        <div className="grid min-h-7 grid-cols-2">
          <div className="flex min-w-0 items-center justify-center border-r border-black px-1.5 py-1 text-center break-words [overflow-wrap:anywhere]" aria-label="기타 일정 장소">
            {getPreviewCellText(row.location)}
          </div>
          <div className="flex min-w-0 items-center justify-center px-1.5 py-1 text-center break-words [overflow-wrap:anywhere]" aria-label="기타 일정 메모">
            {getPreviewCellText(row.memo)}
          </div>
        </div>
      </td>
    </>
  );
}

function FixedCallSheetTable({
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
    <table className={halfTableClass}>
      <EqualColumns count={callSheetColumnCount} />
      <thead>
        <tr>
          {fields.map((field) => (
            <th key={field.key} colSpan={field.span} className={headerCellClass}>{field.label}</th>
          ))}
        </tr>
      </thead>
      <tbody>
        {rows.length > 0 ? rows.map((row, index) => (
          <tr key={`${title}-${index}`}>
            <FixedCells
              fields={fields.map((field) => ({ ...field, value: row[field.key] }))}
            />
          </tr>
        )) : (
          <tr><td colSpan={callSheetColumnCount} className={cellClass}>{emptyMessage}</td></tr>
        )}
      </tbody>
    </table>
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

function createMainStaffFields(member: { role: string; name: string; contact: string }): PreviewDisplayField[] {
  return [
    { key: "role", label: "역할", span: 2, value: member.role },
    { key: "name", label: "이름", span: 4, value: member.name },
    { key: "contact", label: "연락처", span: 6, value: member.contact }
  ];
}

function createWeatherFields(meta: DailyPlanPrintMeta): PreviewDisplayField[] {
  return [
    { key: "sunrise", label: "일출", span: 1, value: meta.sunrise },
    { key: "sunset", label: "일몰", span: 1, value: meta.sunset },
    { key: "weather", label: "날씨", span: 1, value: formatDailyPlanWeatherSummary(meta) },
    { key: "rainProbability", label: "강수 확률", span: 1, value: meta.rainProbability },
    { key: "minTemperature", label: "최저 기온", span: 1, value: meta.minTemperature },
    { key: "maxTemperature", label: "최고 기온", span: 1, value: meta.maxTemperature }
  ];
}

function createLocationFields(location: DailyPlanPreviewLocationRow): PreviewDisplayField[] {
  return [
    { key: "name", label: "장소명", span: 6, value: location.name },
    { key: "address", label: "주소", span: 8, value: location.address }
  ];
}

function createTimetableFields(rows: DailyPlanPreviewTimetableRow[]): PreviewDisplayField[] {
  return [
    { key: "start", label: "START", span: 1, value: rows.map((row) => row.start) },
    { key: "end", label: "END", span: 1, value: rows.map((row) => row.end) },
    { key: "runtime", label: "RT", span: 1, value: rows.map((row) => row.runtime) },
    { key: "location", label: "LOCATION", span: 2, value: rows.map((row) => row.location) },
    {
      key: "dayNight",
      label: "D/N",
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
    { key: "description", label: "Description", span: 3, value: rows.map((row) => row.type === "scene" ? row.description : "") },
    {
      key: "cast",
      label: "Actor",
      span: 1,
      value: rows.map((row) => row.type === "scene" ? row.cast : "")
    },
    {
      key: "shootingOrder",
      label: "Shooting order",
      span: 2,
      value: rows.map((row) => row.type === "scene" ? row.shootingOrder : "")
    },
    {
      key: "notes",
      label: "Notes",
      span: 2,
      value: rows.map((row) => row.type === "scene" ? row.notes : "")
    }
  ];
}

function getTimetableFieldValue(row: DailyPlanPreviewTimetableRow, key: string) {
  if (row.type === "additionalSchedule") return key === "notes" ? row.memo : "";
  if (key === "cast") return row.cast;
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
        row.description,
        row.cast,
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


function formatDate(value: string) {
  return value ? value.replace(/-/g, ".") : "";
}
