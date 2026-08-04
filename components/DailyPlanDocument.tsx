import {
  formatDailyPlanWeatherSummary,
  type DailyPlanPrintMeta
} from "@/lib/dailyPlan/printMeta";
import {
  DAILY_PLAN_TIMETABLE_ADDITIONAL_CONTENT_SPAN,
  DAILY_PLAN_TIMETABLE_COLUMN_WEIGHTS,
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
import {
  DAILY_PLAN_TIMETABLE_PORTRAIT_COLUMN_WEIGHTS,
  type DailyPlanDocumentDensity,
  type DailyPlanDocumentOrientation
} from "@/lib/dailyPlan/documentLayout";
import type { DailyPlanDraft, DailyPlanLocation } from "@/lib/types";

type DailyPlanDocumentProps = {
  plan: DailyPlanDraft;
  locations: DailyPlanLocation[];
  meta: DailyPlanPrintMeta;
  timetableRows: DailyPlanPreviewTimetableRow[];
  totalCutCount: number;
  orientation?: DailyPlanDocumentOrientation;
  density?: DailyPlanDocumentDensity;
};

export type { DailyPlanDocumentOrientation } from "@/lib/dailyPlan/documentLayout";

const sectionTableClass = "daily-plan-section-table mt-1 w-full table-fixed border-collapse border-2 border-black text-center";
const halfTableClass = "daily-plan-section-table w-full table-fixed border-collapse border-2 border-black text-center";
const cellClass = "daily-plan-cell border border-black text-center align-middle";
const compactStaffCellClass = "daily-plan-cell daily-plan-main-staff-cell min-w-0 border border-black text-center align-middle";
const headerCellClass = `${cellClass} daily-plan-preview-header font-black`;
const accentCellClass = "daily-plan-preview-accent";
const crewCellClass = "daily-plan-preview-summary";
const eventRowClass = "daily-plan-preview-event";
const timetableColumnCount = DAILY_PLAN_TIMETABLE_COLUMN_COUNT;
const callSheetColumnCount = 8;

/** 화면 미리보기와 PDF 출력이 함께 사용하는 canonical 일촬표 문서입니다. */
export function DailyPlanDocument({
  plan,
  locations,
  meta,
  timetableRows,
  totalCutCount,
  orientation = "landscape",
  density = "normal"
}: DailyPlanDocumentProps) {
  const printableLocations = buildDailyPlanPreviewLocationRows(locations);
  const printableTimetableRows = filterRenderablePreviewRows(timetableRows, getTimetableRowDisplayValues);
  const starringRows = filterRenderablePreviewRows(meta.starring, getPersonDisplayValues);
  const teamRows = filterRenderablePreviewRows(meta.teams, getTeamDisplayValues);
  const printableMainStaffRows = filterRenderablePreviewRows(getPreviewMainStaffRows(plan, meta), (member) => [
    member.role,
    member.name,
    member.contact
  ]);
  const compactMainStaffRows = Array.from({ length: 3 }, (_, index) => (
    printableMainStaffRows[index] ?? { id: `empty-main-staff-${index}`, role: "", name: "", contact: "" }
  ));
  const allWeatherFields = createWeatherFields(meta);
  const weatherFields = filterRenderablePreviewRows(allWeatherFields, (field) => field.value);
  const timetableFields = createTimetableFields(printableTimetableRows);
  const memoFields: PreviewDisplayField[] = [
    { key: "notice", label: "Notice", span: 1, value: plan.safetyNotice },
    { key: "memo", label: "Memo", span: 1, value: meta.memoText }
  ];

  return (
    <article
      data-testid="daily-plan-document"
      data-orientation={orientation}
      data-density={density}
      className={`daily-plan-template daily-plan-document daily-plan-document--${orientation} text-black`}
    >
      <div className="daily-plan-header-grid grid grid-cols-[minmax(0,3fr)_minmax(0,1.08fr)] gap-1">
        <table className="daily-plan-section-table w-full table-fixed border-collapse border-2 border-black text-center">
          <EqualColumns count={12} />
          <tbody>
            <tr>
              <td rowSpan={3} className={`${cellClass} font-black`}>
                <span className="daily-plan-document-kicker">DAY</span>
                <span className="daily-plan-document-day ml-1">{getPreviewCellText(meta.day)}</span>
              </td>
              <td rowSpan={3} colSpan={9} className={cellClass}>
                <span className="daily-plan-document-title font-black">
                  {getPreviewCellText(plan.title).trim() ? `〈${plan.title}〉` : "기본정보가 없습니다."}
                </span>
                <span className="daily-plan-document-subtitle ml-2 font-normal">TIME TABLE</span>
              </td>
              <td rowSpan={3} colSpan={2} className={`${cellClass} ${crewCellClass}`}>
                <span className="daily-plan-document-kicker block font-bold">Total Crew</span>
                <span className="daily-plan-document-stat font-black">{getPreviewCellText(meta.totalCrew)}</span>
              </td>
            </tr>
            <tr aria-hidden="true" />
            <tr aria-hidden="true" />
            <tr>
              <td rowSpan={3} className={`${cellClass} daily-plan-cell--nowrap daily-plan-document-kicker font-black`}>CALL TIME</td>
              <td rowSpan={3} colSpan={7} className={`${cellClass} ${accentCellClass}`}>
                {hasMeaningfulRowValue(plan.shootingDate) ? (
                  <>
                    <span className="daily-plan-document-kicker mr-1 font-bold">Day</span>
                    <span className="daily-plan-document-stat font-black">{formatDate(plan.shootingDate)}</span>
                  </>
                ) : null}
                {hasMeaningfulRowValue(plan.callTime) ? (
                  <>
                    <span className="daily-plan-document-kicker ml-3 mr-1 font-bold">Time</span>
                    <span className="daily-plan-document-stat font-black">{getPreviewCellText(plan.callTime)}</span>
                  </>
                ) : null}
              </td>
              <CompactMainStaffCells member={compactMainStaffRows[0]} />
            </tr>
            {compactMainStaffRows.slice(1).map((member) => (
              <tr key={member.id}><CompactMainStaffCells member={member} /></tr>
            ))}
          </tbody>
        </table>

        <DailyPlanWeatherTable
          fields={orientation === "portrait" ? allWeatherFields : weatherFields}
          orientation={orientation}
        />
      </div>

      <table className={sectionTableClass}>
        <EqualColumns count={16} />
        <tbody>
          {printableLocations.length > 0 ? printableLocations.map((location, index) => (
            <tr key={location.id || `document-location-${index}`}>
              <td colSpan={2} className={`${cellClass} daily-plan-cell--nowrap font-black`}>LOCATION {index + 1}</td>
              <FixedCells fields={createLocationFields(location)} />
            </tr>
          )) : (
            <tr><td colSpan={16} className={cellClass}>등록된 장소가 없습니다.</td></tr>
          )}
        </tbody>
      </table>

      <table className={sectionTableClass}>
        <TimetableColumns orientation={orientation} />
        <thead>
          <tr>
            {timetableFields.map((field) => (
              <th key={field.key} colSpan={field.span} className={`${headerCellClass} ${getTimetableCompactClass(field.key)}`}>
                <TimetableHeaderLabel field={field} />
              </th>
            ))}
          </tr>
        </thead>
        <tbody>
          {printableTimetableRows.length > 0 ? printableTimetableRows.map((row, index) => (
            <tr key={`document-row-${index}`} className={row.type === "additionalSchedule" ? eventRowClass : undefined}>
              {row.type === "additionalSchedule" ? (
                <AdditionalScheduleCells row={row} />
              ) : (
                <TimetableCells
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

      <section data-daily-plan-notes-boundary className="daily-plan-notes-section">
        <div className="daily-plan-notes-grid mt-1 grid grid-cols-2 gap-1">
          {memoFields.map((field) => (
            <table key={field.key} className={halfTableClass}>
              <tbody>
                <tr><td className={`${headerCellClass} font-black`}>{field.label}</td></tr>
                <tr><td className={`${cellClass} daily-plan-cell--wrap daily-plan-memo-cell whitespace-pre-wrap align-top`}>{getPreviewCellText(field.value)}</td></tr>
              </tbody>
            </table>
          ))}
        </div>

        <div className="daily-plan-notes-grid mt-1 grid grid-cols-2 gap-1">
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
      </section>
    </article>
  );
}

function DailyPlanWeatherTable({
  fields,
  orientation
}: {
  fields: PreviewDisplayField[];
  orientation: DailyPlanDocumentOrientation;
}) {
  if (orientation === "portrait") {
    return (
      <table
        data-testid="daily-plan-document-weather-row"
        className="daily-plan-weather-table daily-plan-weather-table--portrait daily-plan-section-table w-full table-fixed border-collapse border-2 border-black text-center"
      >
        <EqualColumns count={fields.length} />
        <tbody>
          <tr>
            {fields.map((field) => (
              <td key={field.key} data-weather-card className={`${cellClass} daily-plan-weather-cell`}>
                <span className="daily-plan-weather-label block font-bold">{field.label}</span>
                <span className="daily-plan-weather-value block">{getPreviewCellText(field.value) || "-"}</span>
              </td>
            ))}
          </tr>
        </tbody>
      </table>
    );
  }

  return (
    <table
      data-testid="daily-plan-document-weather-table"
      className="daily-plan-weather-table daily-plan-section-table w-full table-fixed border-collapse border-2 border-black text-center"
    >
      <EqualColumns count={2} />
      <tbody>
        {fields.length > 0 ? fields.map((field) => (
          <tr key={field.key}>
            <td className={`${cellClass} font-bold`}>{field.label}</td>
            <td className={cellClass}>{getPreviewCellText(field.value)}</td>
          </tr>
        )) : (
          <tr><td colSpan={2} className={cellClass}>날씨 정보가 없습니다.</td></tr>
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

function TimetableColumns({ orientation }: { orientation: DailyPlanDocumentOrientation }) {
  const weights: ReadonlyArray<number> = orientation === "portrait"
    ? DAILY_PLAN_TIMETABLE_PORTRAIT_COLUMN_WEIGHTS
    : DAILY_PLAN_TIMETABLE_COLUMN_WEIGHTS;
  const totalWeight = weights.reduce((sum, weight) => sum + weight, 0);
  return (
    <colgroup>
      {weights.map((weight, index) => (
        <col key={index} style={{ width: `${(weight / totalWeight) * 100}%` }} />
      ))}
    </colgroup>
  );
}

function FixedCells({ fields }: { fields: PreviewDisplayField[] }) {
  return fields.map((field) => (
    <td
      key={field.key}
      colSpan={field.span}
      className={`${cellClass} ${isFixedShortValue(field.key) ? "daily-plan-cell--nowrap" : "daily-plan-cell--wrap"}`}
    >
      {getPreviewCellText(field.value)}
    </td>
  ));
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

function TimetableHeaderLabel({ field }: { field: PreviewDisplayField }) {
  return <>{field.label}</>;
}

function getTimetableCompactClass(key: string) {
  return isTimetableShortValue(key)
    ? `daily-plan-cell--nowrap ${isTimetableTimeValue(key) ? "daily-plan-timetable-cell--time" : "daily-plan-timetable-cell--compact"}`
    : "";
}

function isTimetableShortValue(key: string) {
  return ["start", "end", "runtime", "dayNight", "sceneNumber", "totalCut"].includes(key);
}

function isTimetableTimeValue(key: string) {
  return ["start", "end", "runtime"].includes(key);
}

function isFixedShortValue(key: string) {
  return ["callTime", "total"].includes(key);
}

function CompactMainStaffCells({ member }: { member: { role: string; name: string; contact: string } }) {
  return (
    <>
      <td className={`${compactStaffCellClass} daily-plan-cell--nowrap font-bold`}>{getPreviewCellText(member.role)}</td>
      <td className={`${compactStaffCellClass} daily-plan-cell--wrap`}>
        {getPreviewCellText(member.name)}
      </td>
      <td colSpan={2} className={`${compactStaffCellClass} daily-plan-cell--wrap`}>
        {getPreviewCellText(member.contact)}
      </td>
    </>
  );
}

function AdditionalScheduleCells({
  row
}: {
  row: Extract<DailyPlanPreviewTimetableRow, { type: "additionalSchedule" }>;
}) {
  return (
    <>
      {[row.start, row.end, row.runtime].map((value, index) => (
        <td key={`additional-time-${index}`} className={`${cellClass} daily-plan-cell--nowrap daily-plan-timetable-cell--time`}>
          {getPreviewCellText(value)}
        </td>
      ))}
      <td
        colSpan={DAILY_PLAN_TIMETABLE_ADDITIONAL_CONTENT_SPAN}
        className="daily-plan-cell border border-black !p-0 align-middle"
      >
        <div className="daily-plan-additional-grid grid min-h-7 grid-cols-2">
          <div className="daily-plan-additional-cell daily-plan-cell--wrap flex min-w-0 items-center justify-center border-r border-black text-center" aria-label="기타 일정 장소">
            {getPreviewCellText(row.location)}
          </div>
          <div className="daily-plan-additional-cell daily-plan-cell--wrap flex min-w-0 items-center justify-center text-center" aria-label="기타 일정 메모">
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

function createWeatherFields(meta: DailyPlanPrintMeta): PreviewDisplayField[] {
  return [
    { key: "weather", label: "날씨", span: 1, value: formatDailyPlanWeatherSummary(meta) },
    { key: "sunrise", label: "일출", span: 1, value: meta.sunrise },
    { key: "sunset", label: "일몰", span: 1, value: meta.sunset },
    { key: "minTemperature", label: "최저 기온", span: 1, value: meta.minTemperature },
    { key: "maxTemperature", label: "최고 기온", span: 1, value: meta.maxTemperature },
    { key: "rainProbability", label: "강수 확률", span: 1, value: meta.rainProbability }
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
