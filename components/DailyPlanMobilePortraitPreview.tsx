import type { DailyPlanPrintMeta } from "@/lib/dailyPlan/printMeta";
import type { DailyPlanDraft, DailyPlanLocation } from "@/lib/types";

export type MobileDailyPlanTimetableRow =
  | {
      type: "scene";
      start: string;
      end: string;
      runtime: string;
      location: string;
      dayNight: string;
      sceneNumber: string;
      totalCut: string;
      description: string;
      shootingOrder: string;
      notes: string;
    }
  | {
      type: "break";
      start: string;
      end: string;
      runtime: string;
      location: string;
      description: string;
    };

type DailyPlanMobilePortraitPreviewProps = {
  plan: DailyPlanDraft;
  locations: DailyPlanLocation[];
  meta: DailyPlanPrintMeta;
  timetableRows: MobileDailyPlanTimetableRow[];
};

const cellClass = "border border-black px-1 py-1 align-middle break-words [overflow-wrap:anywhere]";
const headerCellClass = "border border-black bg-[#d9d9d9] px-0.5 py-1 align-middle font-black break-words [overflow-wrap:anywhere]";
const sectionTitleClass = "border border-black px-1 py-1.5 text-center text-xs font-black";

/** 모바일 화면에서 캡처하기 좋은 세로형 엑셀 일촬표를 표시합니다. */
export function DailyPlanMobilePortraitPreview({ plan, locations, meta, timetableRows }: DailyPlanMobilePortraitPreviewProps) {
  const printableLocations = locations.filter(isPrintableLocation);
  const visibleRows = timetableRows.filter(isVisibleTimetableRow);
  const scheduleRows = visibleRows.filter((row) => row.type === "break");
  const starringRows = meta.starring.filter((row) => row.name || row.role || row.callTime || row.callLocation || row.notes);
  const teamRows = meta.teams.filter((row) => row.team || row.total || row.callTime || row.callLocation || row.notes);

  return (
    <article
      data-testid="daily-plan-mobile-portrait-preview"
      className="mt-4 w-full overflow-hidden bg-white text-[11px] leading-[1.35] text-black md:hidden"
    >
      <table className="w-full table-fixed border-collapse border-2 border-black text-center">
        <colgroup>
          <col className="w-[18%]" />
          <col className="w-[32%]" />
          <col className="w-[18%]" />
          <col className="w-[32%]" />
        </colgroup>
        <tbody>
          <tr>
            <td rowSpan={2} className={`${cellClass} font-black`}>
              <span className="block text-[9px]">DAY</span>
              <span className="text-xl leading-none">{meta.day || "-"}</span>
            </td>
            <td colSpan={3} className={`${cellClass} py-2 text-base font-black`}>
              {plan.title || "작품명"} TIME TABLE
            </td>
          </tr>
          <tr>
            <td className={`${cellClass} font-black`}>촬영일</td>
            <td colSpan={2} className={cellClass}>{formatDate(plan.shootingDate) || "-"}</td>
          </tr>
          <tr>
            <td className={`${cellClass} font-black`}>회차</td>
            <td className={cellClass}>{plan.episode || "-"}</td>
            <td className={`${cellClass} font-black`}>현장 집합</td>
            <td className={cellClass}>{plan.callTime || "-"}</td>
          </tr>
        </tbody>
      </table>

      <table className="mt-1 w-full table-fixed border-collapse border-2 border-black text-center">
        <colgroup>
          <col className="w-[22%]" />
          <col className="w-[28%]" />
          <col className="w-[50%]" />
        </colgroup>
        <tbody>
          <StaffRow label="Director" name={plan.director} contact={meta.directorContact} />
          <StaffRow label="A.D" name={plan.assistantDirector} contact={meta.assistantDirectorContact} />
          <StaffRow label="Producer" name={plan.production} contact={meta.producerContact} />
          <tr>
            <td className={`${cellClass} font-black`}>Total Crew</td>
            <td colSpan={2} className={cellClass}>{meta.totalCrew || "-"}</td>
          </tr>
        </tbody>
      </table>

      <table className="mt-1 w-full table-fixed border-collapse border-2 border-black text-center">
        <tbody>
          <tr>
            <td className={`${cellClass} w-1/4 font-black`}>Weather</td>
            <td className={`${cellClass} w-1/4`}>{meta.weather || "-"}</td>
            <td className={`${cellClass} w-1/4 font-black`}>Sunset</td>
            <td className={`${cellClass} w-1/4`}>{meta.sunset || "-"}</td>
          </tr>
          <tr>
            <td className={`${cellClass} font-black`}>최저 기온</td>
            <td className={cellClass}>{meta.minTemperature || "-"}</td>
            <td className={`${cellClass} font-black`}>최고 기온</td>
            <td className={cellClass}>{meta.maxTemperature || "-"}</td>
          </tr>
          <tr>
            <td className={`${cellClass} font-black`}>강수 확률</td>
            <td colSpan={3} className={cellClass}>{meta.rainProbability || "-"}</td>
          </tr>
        </tbody>
      </table>

      <section className="mt-2">
        <h3 className={sectionTitleClass}>LOCATION</h3>
        <table className="w-full table-fixed border-collapse border-x-2 border-b-2 border-black text-center">
          <tbody>
            {printableLocations.length > 0 ? printableLocations.map((location, index) => (
              <tr key={location.id || `portrait-location-${index}`}>
                <td className={`${cellClass} w-[26%] font-black`}>LOCATION {index + 1}</td>
                <td className={`${cellClass} w-[29%] font-bold`}>{location.name || "-"}</td>
                <td className={`${cellClass} w-[45%]`}>{getLocationAddress(location) || location.detail || "-"}</td>
              </tr>
            )) : (
              <tr><td className={cellClass}>등록된 장소가 없습니다.</td></tr>
            )}
          </tbody>
        </table>
      </section>

      {scheduleRows.length > 0 ? (
        <section className="mt-2">
          <h3 className={sectionTitleClass}>기타 일정</h3>
          <table className="w-full table-fixed border-collapse border-x-2 border-b-2 border-black text-center">
            <thead>
              <tr>
                <th className={`${headerCellClass} w-[18%]`}>START</th>
                <th className={`${headerCellClass} w-[18%]`}>END</th>
                <th className={`${headerCellClass} w-[14%]`}>RT</th>
                <th className={`${headerCellClass} w-[50%]`}>일정 / LOCATION</th>
              </tr>
            </thead>
            <tbody>
              {scheduleRows.map((row, index) => (
                <tr key={`portrait-schedule-${index}`} className="bg-[#fff2cc]">
                  <td className={cellClass}>{row.start || "-"}</td>
                  <td className={cellClass}>{row.end || "-"}</td>
                  <td className={cellClass}>{row.runtime || "-"}</td>
                  <td className={`${cellClass} font-bold`}>{[row.description, row.location].filter(Boolean).join(" / ") || "-"}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </section>
      ) : null}

      <section className="mt-2">
        <h3 className={sectionTitleClass}>TIME TABLE</h3>
        <table className="w-full table-fixed border-collapse border-x-2 border-b-2 border-black text-center">
          <colgroup>
            <col className="w-[16%]" />
            <col className="w-[13%]" />
            <col className="w-[9%]" />
            <col className="w-[23%]" />
            <col className="w-[14%]" />
            <col className="w-[15%]" />
            <col className="w-[10%]" />
          </colgroup>
          <thead>
            <tr>
              {['START', 'END', 'RT', 'LOCATION', 'D/N/S', 'SCENE', 'CUT'].map((label) => (
                <th key={label} className={headerCellClass}>{label}</th>
              ))}
            </tr>
          </thead>
          <tbody>
            {visibleRows.length > 0 ? visibleRows.map((row, index) => row.type === "break" ? (
              <tr key={`portrait-time-${index}`} className="bg-[#fff2cc]">
                <td className={cellClass}>{row.start}</td>
                <td className={cellClass}>{row.end}</td>
                <td className={cellClass}>{row.runtime}</td>
                <td colSpan={4} className={`${cellClass} font-bold`}>{[row.description, row.location].filter(Boolean).join(" / ")}</td>
              </tr>
            ) : (
              <tr key={`portrait-time-${index}`}>
                <td className={cellClass}>{row.start}</td>
                <td className={cellClass}>{row.end}</td>
                <td className={cellClass}>{row.runtime}</td>
                <td className={cellClass}>{row.location}</td>
                <td className={cellClass}>{row.dayNight}</td>
                <td className={cellClass}>{row.sceneNumber}</td>
                <td className={cellClass}>{row.totalCut}</td>
              </tr>
            )) : <tr><td colSpan={7} className={cellClass}>등록된 일정이 없습니다.</td></tr>}
          </tbody>
        </table>

        <table className="mt-1 w-full table-fixed border-collapse border-2 border-black text-center">
          <colgroup>
            <col className="w-[16%]" />
            <col className="w-[36%]" />
            <col className="w-[25%]" />
            <col className="w-[23%]" />
          </colgroup>
          <thead>
            <tr>
              <th className={headerCellClass}>SCENE</th>
              <th className={headerCellClass}>Description</th>
              <th className={headerCellClass}>Shooting order</th>
              <th className={headerCellClass}>Notes</th>
            </tr>
          </thead>
          <tbody>
            {visibleRows.length > 0 ? visibleRows.map((row, index) => row.type === "break" ? (
              <tr key={`portrait-detail-${index}`} className="bg-[#fff2cc]">
                <td colSpan={4} className={`${cellClass} font-bold`}>{row.description || "기타 일정"}</td>
              </tr>
            ) : (
              <tr key={`portrait-detail-${index}`}>
                <td className={cellClass}>{row.sceneNumber}</td>
                <td className={cellClass}>{row.description}</td>
                <td className={cellClass}>{row.shootingOrder}</td>
                <td className={cellClass}>{row.notes}</td>
              </tr>
            )) : <tr><td colSpan={4} className={cellClass}>등록된 씬 정보가 없습니다.</td></tr>}
          </tbody>
        </table>
      </section>

      <SheetMemoSection title="Notice" value={plan.safetyNotice} />
      <SheetMemoSection title="Memo" value={meta.memoText} />

      <CallSheetTable
        title="Starring"
        headers={["Starring", "Roll", "CALL", "Call Location", "Notes"]}
        rows={starringRows.map((row) => [row.name, row.role, row.callTime, row.callLocation, row.notes])}
      />
      <CallSheetTable
        title="Team"
        headers={["Team", "Total", "CALL", "Call Location", "Notes"]}
        rows={teamRows.map((row) => [row.team, row.total, row.callTime, row.callLocation, row.notes])}
      />
    </article>
  );
}

function StaffRow({ label, name, contact }: { label: string; name: string; contact: string }) {
  return (
    <tr>
      <td className={`${cellClass} font-black`}>{label}</td>
      <td className={cellClass}>{name || "-"}</td>
      <td className={cellClass}>{contact || "-"}</td>
    </tr>
  );
}

function SheetMemoSection({ title, value }: { title: string; value: string }) {
  return (
    <section className="mt-2 border-2 border-black">
      <h3 className="border-b border-black py-1 text-center text-xs font-black">{title}</h3>
      <p className="min-h-14 whitespace-pre-wrap break-words px-2 py-1.5 text-left [overflow-wrap:anywhere]">{value || ""}</p>
    </section>
  );
}

function CallSheetTable({ title, headers, rows }: { title: string; headers: string[]; rows: string[][] }) {
  return (
    <section className="mt-2">
      <h3 className="sr-only">{title}</h3>
      <table className="w-full table-fixed border-collapse border-2 border-black text-center">
        <thead>
          <tr>{headers.map((header) => <th key={header} className={headerCellClass}>{header}</th>)}</tr>
        </thead>
        <tbody>
          {rows.length > 0 ? rows.map((row, rowIndex) => (
            <tr key={`${title}-${rowIndex}`}>
              {row.map((value, cellIndex) => <td key={`${title}-${rowIndex}-${cellIndex}`} className={cellClass}>{value}</td>)}
            </tr>
          )) : <tr><td colSpan={headers.length} className={`${cellClass} h-7`} /></tr>}
        </tbody>
      </table>
    </section>
  );
}

function isPrintableLocation(location: DailyPlanLocation) {
  return Boolean(location.name.trim() || location.detail.trim() || getLocationAddress(location).trim());
}

function getLocationAddress(location: DailyPlanLocation) {
  return [location.roadAddress, location.address].find((value) => value?.trim()) ?? "";
}

function isVisibleTimetableRow(row: MobileDailyPlanTimetableRow) {
  if (row.type === "break") return Boolean(row.start || row.end || row.runtime || row.location || row.description);
  return Boolean(row.start || row.end || row.runtime || row.location || row.dayNight || row.sceneNumber || row.totalCut || row.description || row.shootingOrder || row.notes);
}

function formatDate(value: string) {
  return value ? value.replace(/-/g, ".") : "";
}
