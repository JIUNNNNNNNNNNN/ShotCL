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
  type DailyPlanDocumentDensity,
  type DailyPlanDocumentOrientation,
  type DailyPlanPageLayout
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
  pageLayout?: DailyPlanPageLayout;
};

export type { DailyPlanDocumentOrientation, DailyPlanPageLayout } from "@/lib/dailyPlan/documentLayout";

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
const portraitColumnCount = 10;

type DailyPlanDocumentMainStaffRow = {
  id: string;
  role: string;
  name: string;
  contact: string;
};

/** 가로·세로 문서가 함께 소비하는 단일 정규화 결과입니다. */
export type DailyPlanDocumentData = {
  plan: DailyPlanDraft;
  meta: DailyPlanPrintMeta;
  locations: DailyPlanPreviewLocationRow[];
  timetableRows: DailyPlanPreviewTimetableRow[];
  starringRows: DailyPlanPrintMeta["starring"];
  teamRows: DailyPlanPrintMeta["teams"];
  compactMainStaffRows: DailyPlanDocumentMainStaffRow[];
  allWeatherFields: PreviewDisplayField[];
  weatherFields: PreviewDisplayField[];
  memoFields: PreviewDisplayField[];
  totalCutCount: number;
};

/** query나 저장 데이터를 복제하지 않고 두 방향 문서에 같은 값을 공급합니다. */
export function buildDailyPlanDocumentData({
  plan,
  locations,
  meta,
  timetableRows,
  totalCutCount
}: Pick<DailyPlanDocumentProps, "plan" | "locations" | "meta" | "timetableRows" | "totalCutCount">): DailyPlanDocumentData {
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
  const memoFields: PreviewDisplayField[] = [
    { key: "notice", label: "Notice", span: 1, value: plan.safetyNotice },
    { key: "memo", label: "Memo", span: 1, value: meta.memoText }
  ];

  return {
    plan,
    meta,
    locations: printableLocations,
    timetableRows: printableTimetableRows,
    starringRows,
    teamRows,
    compactMainStaffRows,
    allWeatherFields,
    weatherFields,
    memoFields,
    totalCutCount
  };
}

/** 화면 미리보기와 PDF 출력이 함께 사용하는 canonical 일촬표 문서 진입점입니다. */
export function DailyPlanDocument(props: DailyPlanDocumentProps) {
  const orientation = props.orientation ?? "landscape";
  const density = props.density ?? "normal";
  const pageLayout = props.pageLayout ?? "single";
  const data = buildDailyPlanDocumentData(props);

  return orientation === "portrait" ? (
    <DailyPlanPortraitDocument data={data} density={density} pageLayout={pageLayout} />
  ) : (
    <DailyPlanLandscapeDocument data={data} density={density} pageLayout={pageLayout} />
  );
}

/** 기존 데스크톱 가로 문서 구조는 세로 문서와 독립적으로 유지합니다. */
export function DailyPlanLandscapeDocument({
  data,
  density,
  pageLayout
}: {
  data: DailyPlanDocumentData;
  density: DailyPlanDocumentDensity;
  pageLayout: DailyPlanPageLayout;
}) {
  const {
    plan,
    meta,
    locations,
    timetableRows,
    starringRows,
    teamRows,
    compactMainStaffRows,
    weatherFields,
    memoFields,
    totalCutCount
  } = data;
  const timetableFields = createTimetableFields(timetableRows);

  return (
    <article
      data-testid="daily-plan-document"
      data-orientation="landscape"
      data-density={density}
      data-page-layout={pageLayout}
      className="daily-plan-template daily-plan-document daily-plan-document--landscape text-black"
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
          fields={weatherFields}
        />
      </div>

      <table className={sectionTableClass}>
        <EqualColumns count={16} />
        <tbody>
          {locations.length > 0 ? locations.map((location, index) => (
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
        <TimetableColumns />
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
          {timetableRows.length > 0 ? timetableRows.map((row, index) => (
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

/** Google Sheet `세로` 탭의 10열·2페이지 구조를 그대로 따르는 모바일/PDF 문서입니다. */
export function DailyPlanPortraitDocument({
  data,
  density,
  pageLayout
}: {
  data: DailyPlanDocumentData;
  density: DailyPlanDocumentDensity;
  pageLayout: DailyPlanPageLayout;
}) {
  const {
    plan,
    meta,
    locations,
    timetableRows,
    starringRows,
    teamRows,
    compactMainStaffRows,
    allWeatherFields,
    memoFields,
    totalCutCount
  } = data;
  const summaryFields = createPortraitSummaryFields(timetableRows);
  const detailFields = createPortraitDetailFields(timetableRows);
  const paddedStarringRows = padPortraitCallSheetRows(starringRows.map((person) => ({
    name: person.name,
    role: person.role,
    callTime: person.callTime,
    callLocation: person.callLocation,
    notes: person.notes
  })), 10);
  const paddedTeamRows = padPortraitCallSheetRows(teamRows.map((team) => ({
    team: team.team,
    total: team.total,
    callTime: team.callTime,
    callLocation: team.callLocation,
    notes: team.notes
  })), 10);

  return (
    <article
      data-testid="daily-plan-document"
      data-orientation="portrait"
      data-density={density}
      data-page-layout={pageLayout}
      className="daily-plan-template daily-plan-document daily-plan-document--portrait text-black"
    >
      <section className="daily-plan-portrait-page daily-plan-portrait-page--primary">
        <div data-daily-plan-page-primary-content className="daily-plan-portrait-page-content">
          <table data-portrait-table="header" className="daily-plan-section-table w-full table-fixed border-collapse border-2 border-black text-center">
            <EqualColumns count={portraitColumnCount} />
            <tbody>
              <tr className="daily-plan-portrait-title-row">
                <td rowSpan={3} className={`${cellClass} font-black`}>
                  <span className="daily-plan-document-kicker">DAY</span>
                  <span className="daily-plan-document-day ml-1">{getPreviewCellText(meta.day)}</span>
                </td>
                <td rowSpan={3} colSpan={9} className={cellClass}>
                  <span className="daily-plan-document-title block font-black">
                    {getPreviewCellText(plan.title).trim() ? `〈${plan.title}〉` : "기본정보가 없습니다."}
                  </span>
                  <span className="daily-plan-document-subtitle block font-normal">TIME TABLE</span>
                </td>
              </tr>
              <tr aria-hidden="true" />
              <tr aria-hidden="true" />
              <tr className="daily-plan-portrait-call-row">
                <td rowSpan={2} className={`${cellClass} daily-plan-cell--nowrap daily-plan-document-kicker font-black`}>CALL TIME</td>
                <td rowSpan={2} colSpan={9} className={`${cellClass} ${accentCellClass}`}>
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
              </tr>
              <tr aria-hidden="true" />
              <tr>
                <PortraitMainStaffCells member={compactMainStaffRows[0]} />
                <PortraitMainStaffCells member={compactMainStaffRows[1]} />
              </tr>
              <tr>
                <PortraitMainStaffCells member={compactMainStaffRows[2]} />
                <td colSpan={2} className={`${cellClass} ${crewCellClass} font-black`}>Total Crew</td>
                <td colSpan={3} className={`${cellClass} ${crewCellClass} daily-plan-document-stat font-black`}>
                  {getPreviewCellText(meta.totalCrew)}
                </td>
              </tr>
            </tbody>
          </table>

          <PortraitWeatherTable fields={allWeatherFields} />

          <table data-portrait-table="locations" className={sectionTableClass}>
            <EqualColumns count={portraitColumnCount} />
            <tbody>
              {locations.length > 0 ? locations.map((location, index) => (
                <tr key={location.id || `portrait-location-${index}`}>
                  <td className={`${cellClass} daily-plan-cell--nowrap font-black`}>LOCATION {index + 1}</td>
                  <td colSpan={3} className={`${cellClass} daily-plan-cell--wrap`}>{getPreviewCellText(location.name)}</td>
                  <td colSpan={6} className={`${cellClass} daily-plan-cell--wrap`}>{getPreviewCellText(location.address)}</td>
                </tr>
              )) : (
                <tr><td colSpan={portraitColumnCount} className={cellClass}>등록된 장소가 없습니다.</td></tr>
              )}
            </tbody>
          </table>

          <table data-portrait-table="timetable-summary" className={sectionTableClass}>
            <EqualColumns count={portraitColumnCount} />
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
              {timetableRows.length > 0 ? timetableRows.map((row, index) => (
                <tr key={`portrait-summary-${index}`} className={row.type === "additionalSchedule" ? eventRowClass : undefined}>
                  {row.type === "additionalSchedule" ? (
                    <PortraitAdditionalScheduleSummaryCells row={row} />
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
                <tr><td colSpan={portraitColumnCount} className={cellClass}>등록된 일정이 없습니다.</td></tr>
              )}
            </tbody>
          </table>

          <table data-portrait-table="scene-details" className={sectionTableClass}>
            <EqualColumns count={portraitColumnCount} />
            <thead>
              <tr>
                {detailFields.map((field) => (
                  <th key={field.key} colSpan={field.span} className={headerCellClass}>{field.label}</th>
                ))}
              </tr>
            </thead>
            <tbody>
              {timetableRows.length > 0 ? timetableRows.map((row, index) => (
                <tr key={`portrait-detail-${index}`} className={row.type === "additionalSchedule" ? eventRowClass : undefined}>
                  {row.type === "additionalSchedule" ? (
                    <td colSpan={portraitColumnCount} className={`${cellClass} daily-plan-cell--wrap`}>
                      {joinPreviewValues(row.location, row.memo)}
                    </td>
                  ) : (
                    <TimetableCells
                      fields={detailFields.map((field) => ({
                        ...field,
                        value: getTimetableFieldValue(row, field.key)
                      }))}
                    />
                  )}
                </tr>
              )) : (
                <tr><td colSpan={portraitColumnCount} className={cellClass}>등록된 씬 상세가 없습니다.</td></tr>
              )}
              <tr>
                <td colSpan={portraitColumnCount} className={`${cellClass} ${crewCellClass} py-1 text-center font-black`}>
                  총 컷수 {totalCutCount}컷
                </td>
              </tr>
            </tbody>
          </table>
        </div>
      </section>

      <section
        data-daily-plan-notes-boundary
        className="daily-plan-notes-section daily-plan-portrait-page daily-plan-portrait-page--secondary"
      >
        <div data-daily-plan-page-secondary-content className="daily-plan-portrait-page-content">
          {memoFields.map((field) => (
            <table key={field.key} data-portrait-table={field.key} className={sectionTableClass}>
              <EqualColumns count={portraitColumnCount} />
              <tbody>
                <tr><td colSpan={portraitColumnCount} className={`${headerCellClass} font-black`}>{field.label}</td></tr>
                <tr>
                  <td colSpan={portraitColumnCount} className={`${cellClass} daily-plan-cell--wrap daily-plan-portrait-memo-cell whitespace-pre-wrap align-top`}>
                    {getPreviewCellText(field.value)}
                  </td>
                </tr>
              </tbody>
            </table>
          ))}

          <PortraitCallSheetTable
            title="Starring"
            fields={[
              { key: "name", label: "Starring", span: 1 },
              { key: "role", label: "Roll", span: 1 },
              { key: "callTime", label: "CALL", span: 1 },
              { key: "callLocation", label: "Call Location", span: 2 },
              { key: "notes", label: "Notes", span: 5 }
            ]}
            rows={paddedStarringRows}
          />
          <PortraitCallSheetTable
            title="Team"
            fields={[
              { key: "team", label: "Team", span: 1 },
              { key: "total", label: "Total", span: 1 },
              { key: "callTime", label: "CALL", span: 1 },
              { key: "callLocation", label: "Call Location", span: 2 },
              { key: "notes", label: "Notes", span: 5 }
            ]}
            rows={paddedTeamRows}
          />
        </div>
      </section>
    </article>
  );
}

function DailyPlanWeatherTable({
  fields
}: {
  fields: PreviewDisplayField[];
}) {
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

function PortraitWeatherTable({ fields }: { fields: PreviewDisplayField[] }) {
  const weather = getDisplayField(fields, "weather");
  const sunrise = getDisplayField(fields, "sunrise");
  const sunset = getDisplayField(fields, "sunset");
  const minTemperature = getDisplayField(fields, "minTemperature");
  const maxTemperature = getDisplayField(fields, "maxTemperature");
  const rainProbability = getDisplayField(fields, "rainProbability");

  return (
    <table
      data-testid="daily-plan-document-weather-table"
      data-portrait-table="weather"
      className={sectionTableClass}
    >
      <EqualColumns count={portraitColumnCount} />
      <tbody>
        <tr>
          <PortraitWeatherPair field={sunrise} labelSpan={2} valueSpan={2} />
          <PortraitWeatherPair field={weather} labelSpan={2} valueSpan={2} />
          <PortraitWeatherPair field={maxTemperature} labelSpan={1} valueSpan={1} />
        </tr>
        <tr>
          <PortraitWeatherPair field={sunset} labelSpan={2} valueSpan={2} />
          <PortraitWeatherPair field={rainProbability} labelSpan={2} valueSpan={2} />
          <PortraitWeatherPair field={minTemperature} labelSpan={1} valueSpan={1} />
        </tr>
      </tbody>
    </table>
  );
}

function PortraitWeatherPair({
  field,
  labelSpan,
  valueSpan
}: {
  field: PreviewDisplayField;
  labelSpan: number;
  valueSpan: number;
}) {
  return (
    <>
      <td colSpan={labelSpan} className={`${cellClass} daily-plan-cell--nowrap daily-plan-weather-label font-bold`}>
        {field.label}
      </td>
      <td colSpan={valueSpan} className={`${cellClass} daily-plan-cell--wrap daily-plan-weather-value`}>
        {getPreviewCellText(field.value) || "-"}
      </td>
    </>
  );
}

function getDisplayField(fields: PreviewDisplayField[], key: string): PreviewDisplayField {
  return fields.find((field) => field.key === key) ?? { key, label: "", span: 1, value: "" };
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

function TimetableColumns() {
  const weights: ReadonlyArray<number> = DAILY_PLAN_TIMETABLE_COLUMN_WEIGHTS;
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

function PortraitMainStaffCells({ member }: { member: DailyPlanDocumentMainStaffRow }) {
  return (
    <>
      <td className={`${compactStaffCellClass} daily-plan-cell--nowrap font-bold`}>{getPreviewCellText(member.role)}</td>
      <td className={`${compactStaffCellClass} daily-plan-cell--wrap`}>{getPreviewCellText(member.name)}</td>
      <td colSpan={3} className={`${compactStaffCellClass} daily-plan-cell--wrap`}>{getPreviewCellText(member.contact)}</td>
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

function PortraitAdditionalScheduleSummaryCells({
  row
}: {
  row: Extract<DailyPlanPreviewTimetableRow, { type: "additionalSchedule" }>;
}) {
  return (
    <>
      {[row.start, row.end, row.runtime].map((value, index) => (
        <td key={`portrait-additional-time-${index}`} className={`${cellClass} daily-plan-cell--nowrap daily-plan-timetable-cell--time`}>
          {getPreviewCellText(value)}
        </td>
      ))}
      <td colSpan={7} className={`${cellClass} daily-plan-cell--wrap`}>
        {joinPreviewValues(row.location, row.memo)}
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

function PortraitCallSheetTable({
  title,
  fields,
  rows
}: {
  title: string;
  fields: Array<Omit<PreviewDisplayField, "value">>;
  rows: Array<Record<string, string>>;
}) {
  return (
    <table data-portrait-table={title.toLowerCase()} className={sectionTableClass}>
      <EqualColumns count={portraitColumnCount} />
      <thead>
        <tr>
          {fields.map((field) => (
            <th key={field.key} colSpan={field.span} className={headerCellClass}>{field.label}</th>
          ))}
        </tr>
      </thead>
      <tbody>
        {rows.map((row, index) => (
          <tr key={`${title}-${index}`}>
            <FixedCells fields={fields.map((field) => ({ ...field, value: row[field.key] }))} />
          </tr>
        ))}
      </tbody>
    </table>
  );
}

function padPortraitCallSheetRows(
  rows: Array<Record<string, string>>,
  minimumRowCount: number
) {
  if (rows.length >= minimumRowCount) return rows;
  return [
    ...rows,
    ...Array.from({ length: minimumRowCount - rows.length }, () => ({} as Record<string, string>))
  ];
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

/** 세로 원본의 첫 번째 시간표: 10개 동일 폭 열에 시간·장소·씬·컷·촬영순서를 배치합니다. */
function createPortraitSummaryFields(rows: DailyPlanPreviewTimetableRow[]): PreviewDisplayField[] {
  return [
    { key: "start", label: "START", span: 1, value: rows.map((row) => row.start) },
    { key: "end", label: "END", span: 1, value: rows.map((row) => row.end) },
    { key: "runtime", label: "RT", span: 1, value: rows.map((row) => row.runtime) },
    { key: "location", label: "LOCATION", span: 2, value: rows.map((row) => row.location) },
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

/** 세로 원본의 두 번째 시간표: 긴 설명·배우·메모를 별도 10열 표에 읽기 좋게 배치합니다. */
function createPortraitDetailFields(rows: DailyPlanPreviewTimetableRow[]): PreviewDisplayField[] {
  return [
    {
      key: "sceneNumber",
      label: "SCENE",
      span: 1,
      value: rows.map((row) => row.type === "scene" ? row.sceneNumber : "")
    },
    {
      key: "description",
      label: "Description",
      span: 3,
      value: rows.map((row) => row.type === "scene" ? row.description : "")
    },
    {
      key: "shootingOrder",
      label: "Shooting order",
      span: 2,
      value: rows.map((row) => row.type === "scene" ? row.shootingOrder : "")
    },
    {
      key: "cast",
      label: "Actor",
      span: 1,
      value: rows.map((row) => row.type === "scene" ? row.cast : "")
    },
    {
      key: "notes",
      label: "Notes",
      span: 3,
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

function joinPreviewValues(...values: unknown[]) {
  return values
    .map((value) => getPreviewCellText(value).trim())
    .filter(Boolean)
    .join(" · ");
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
