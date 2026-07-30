import type { MobileDailyPlanTimetableRow } from "@/components/DailyPlanMobilePortraitPreview";
import {
  formatDailyPlanWeatherSummary,
  type DailyPlanPrintMeta
} from "@/lib/dailyPlan/printMeta";
import {
  compactPreviewFields,
  compactPreviewRowCells,
  compactPreviewRows,
  getPreviewColumnCount,
  hasDisplayValue,
  type PreviewDisplayField
} from "@/lib/dailyPlan/previewDisplay";
import { getDailyPlanLocationAddress } from "@/lib/dailyPlan/location";
import type { DailyPlanDraft, DailyPlanLocation } from "@/lib/types";

type DailyPlanDesktopLandscapePreviewProps = {
  plan: DailyPlanDraft;
  locations: DailyPlanLocation[];
  meta: DailyPlanPrintMeta;
  timetableRows: MobileDailyPlanTimetableRow[];
  totalCutCount: number;
};

const sectionTableClass = "daily-plan-section-table mt-1 w-full table-fixed border-collapse border-2 border-black text-center";
const halfTableClass = "daily-plan-section-table w-full table-fixed border-collapse border-2 border-black text-center";
const cellClass = "border border-black px-1.5 py-1 text-center align-middle";
const headerCellClass = `${cellClass} daily-plan-preview-header font-black`;
const accentCellClass = "daily-plan-preview-accent";
const crewCellClass = "daily-plan-preview-summary";
const eventRowClass = "daily-plan-preview-event";

/** 앱 화면에서만 사용하는 Google Sheet 기반 가로형 미리보기입니다. */
export function DailyPlanDesktopLandscapePreview({ plan, locations, meta, timetableRows, totalCutCount }: DailyPlanDesktopLandscapePreviewProps) {
  const printableLocations = locations.filter(isPrintableLocation);
  const printableTimetableRows = compactPreviewRows(timetableRows, getTimetableRowDisplayValues);
  const starringRows = compactPreviewRows(meta.starring, getPersonDisplayValues);
  const teamRows = compactPreviewRows(meta.teams, getTeamDisplayValues);
  const printableMainStaffRows = compactPreviewRows(getPreviewMainStaffRows(plan, meta), (member) => [
    member.role,
    member.name,
    member.contact
  ]);
  const weatherFields = compactPreviewFields(createWeatherFields(meta));
  const timetableFields = compactPreviewFields(createTimetableFields(printableTimetableRows));
  const timetableColumnCount = Math.max(1, getPreviewColumnCount(timetableFields));
  const memoFields = compactPreviewFields([
    { key: "notice", label: "Notice", span: 1, value: plan.safetyNotice },
    { key: "memo", label: "Memo", span: 1, value: meta.memoText }
  ]);

  return (
    <article data-testid="daily-plan-desktop-landscape-preview" className="daily-plan-template text-[11px] leading-tight text-black">
      <div className="grid grid-cols-[minmax(0,3fr)_minmax(0,1.08fr)] gap-1">
        <table className="daily-plan-section-table w-full table-fixed border-collapse border-2 border-black text-center">
          <EqualColumns count={12} />
          <tbody>
            <tr>
              {hasDisplayValue(meta.day) ? (
                <td className={`${cellClass} font-black`}>
                  <span className="text-[9px]">DAY</span>
                  <span className="ml-1 text-2xl leading-none">{meta.day}</span>
                </td>
              ) : null}
              <td
                colSpan={12 - (hasDisplayValue(meta.day) ? 1 : 0) - (hasDisplayValue(meta.totalCrew) ? 2 : 0)}
                className={cellClass}
              >
                <span className="text-2xl font-black">
                  {hasDisplayValue(plan.title) ? `〈${plan.title}〉` : "기본정보가 없습니다."}
                </span>
                <span className="ml-2 text-lg font-normal">TIME TABLE</span>
              </td>
              {hasDisplayValue(meta.totalCrew) ? (
                <td colSpan={2} className={`${cellClass} ${crewCellClass}`}>
                  <span className="block text-[9px] font-bold">Total Crew</span>
                  <span className="text-lg font-black">{meta.totalCrew}</span>
                </td>
              ) : null}
            </tr>
            {hasDisplayValue([plan.shootingDate, plan.callTime]) ? (
              <tr>
                <td colSpan={2} className={`${cellClass} font-black`}>CALL TIME</td>
                <td colSpan={10} className={`${cellClass} ${accentCellClass}`}>
                  {hasDisplayValue(plan.shootingDate) ? (
                    <>
                      <span className="mr-1 text-[9px] font-bold">Day</span>
                      <span className="text-lg font-black">{formatDate(plan.shootingDate)}</span>
                    </>
                  ) : null}
                  {hasDisplayValue(plan.callTime) ? (
                    <>
                      <span className="ml-3 mr-1 text-[9px] font-bold">Time</span>
                      <span className="text-lg font-black">{plan.callTime}</span>
                    </>
                  ) : null}
                </td>
              </tr>
            ) : null}
            {printableMainStaffRows.length > 0 ? printableMainStaffRows.map((member) => (
              <tr key={member.id}>
                <CompactCells fields={createMainStaffFields(member)} totalColumns={12} />
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
                <td className={cellClass}>{String(field.value)}</td>
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
              <CompactCells fields={createLocationFields(location)} totalColumns={14} />
            </tr>
          )) : (
            <tr><td colSpan={16} className={cellClass}>등록된 장소가 없습니다.</td></tr>
          )}
        </tbody>
      </table>

      <table className={sectionTableClass}>
        <EqualColumns count={timetableColumnCount} />
        {timetableFields.length > 0 ? (
          <thead>
            <tr>
              {timetableFields.map((field) => (
                <th key={field.key} colSpan={field.span} className={headerCellClass}>{field.label}</th>
              ))}
            </tr>
          </thead>
        ) : null}
        <tbody>
          {printableTimetableRows.length > 0 ? printableTimetableRows.map((row, index) => (
            <tr key={`landscape-row-${index}`} className={row.type === "break" ? eventRowClass : undefined}>
              <CompactCells
                fields={timetableFields.map((field) => ({
                  ...field,
                  value: getTimetableFieldValue(row, field.key)
                }))}
                totalColumns={timetableColumnCount}
              />
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

      <div className={`mt-1 grid gap-1 ${memoFields.length > 1 ? "grid-cols-2" : "grid-cols-1"}`}>
        {memoFields.length > 0 ? memoFields.map((field) => (
          <table key={field.key} className={halfTableClass}>
            <tbody>
              <tr><td className={`${headerCellClass} font-black`}>{field.label}</td></tr>
              <tr><td className={`${cellClass} min-h-20 whitespace-pre-wrap align-top`}>{String(field.value)}</td></tr>
            </tbody>
          </table>
        )) : (
          <table className={halfTableClass}>
            <tbody>
              <tr><td className={headerCellClass}>Notice / Memo</td></tr>
              <tr><td className={cellClass}>기재된 주의사항·메모가 없습니다.</td></tr>
            </tbody>
          </table>
        )}
      </div>

      <div className="mt-1 grid grid-cols-2 gap-1">
        <DynamicCallSheetTable
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
        <DynamicCallSheetTable
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

function CompactCells({
  fields,
  totalColumns
}: {
  fields: PreviewDisplayField[];
  totalColumns: number;
}) {
  const cells = compactPreviewRowCells(fields);
  if (cells.length === 0) {
    return <td colSpan={Math.max(1, totalColumns)} className={cellClass}>정보 없음</td>;
  }
  return cells.map((cell) => (
    <td key={cell.key} colSpan={cell.span} className={`${cellClass} break-words [overflow-wrap:anywhere]`}>
      {String(cell.value)}
    </td>
  ));
}

function DynamicCallSheetTable({
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
  const visibleFields = compactPreviewFields(fields.map((field) => ({
    ...field,
    value: rows.map((row) => row[field.key])
  })));
  const columnCount = Math.max(1, getPreviewColumnCount(visibleFields));
  return (
    <table className={halfTableClass}>
      <EqualColumns count={columnCount} />
      {visibleFields.length > 0 ? (
        <thead>
          <tr>
            {visibleFields.map((field) => (
              <th key={field.key} colSpan={field.span} className={headerCellClass}>{field.label}</th>
            ))}
          </tr>
        </thead>
      ) : null}
      <tbody>
        {rows.length > 0 ? rows.map((row, index) => (
          <tr key={`${title}-${index}`}>
            <CompactCells
              fields={visibleFields.map((field) => ({ ...field, value: row[field.key] }))}
              totalColumns={columnCount}
            />
          </tr>
        )) : (
          <tr><td colSpan={columnCount} className={cellClass}>{emptyMessage}</td></tr>
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

function createLocationFields(location: DailyPlanLocation): PreviewDisplayField[] {
  return [
    { key: "name", label: "장소명", span: 6, value: location.name },
    {
      key: "address",
      label: "주소",
      span: 8,
      value: getDailyPlanLocationAddress(location) || location.detail
    }
  ];
}

function createTimetableFields(rows: MobileDailyPlanTimetableRow[]): PreviewDisplayField[] {
  return [
    { key: "start", label: "START", span: 1, value: rows.map((row) => row.start) },
    { key: "end", label: "END", span: 1, value: rows.map((row) => row.end) },
    { key: "runtime", label: "RT", span: 1, value: rows.map((row) => row.runtime) },
    { key: "location", label: "LOCATION", span: 3, value: rows.map((row) => row.location) },
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
    { key: "description", label: "Description", span: 3, value: rows.map((row) => row.description) },
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
      span: 1,
      value: rows.map((row) => row.type === "scene" ? row.notes : "")
    }
  ];
}

function getTimetableFieldValue(row: MobileDailyPlanTimetableRow, key: string) {
  if (row.type === "break") {
    if (key === "start" || key === "end" || key === "runtime" || key === "location" || key === "description") {
      return row[key];
    }
    return "";
  }
  if (key === "cast") return row.cast;
  if (key in row) return row[key as keyof typeof row];
  return "";
}

function getTimetableRowDisplayValues(row: MobileDailyPlanTimetableRow) {
  return row.type === "break"
    ? [row.start, row.end, row.runtime, row.location, row.description]
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

function isPrintableLocation(location: DailyPlanLocation) {
  return Boolean(location.name.trim() || location.detail.trim() || getDailyPlanLocationAddress(location).trim());
}

function formatDate(value: string) {
  return value ? value.replace(/-/g, ".") : "";
}
