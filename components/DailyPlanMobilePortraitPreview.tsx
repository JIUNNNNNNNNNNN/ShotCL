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
      cast: string;
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

const cellClass = "border border-black px-0.5 py-1 align-middle break-words [overflow-wrap:anywhere]";
const headerCellClass = "border border-black bg-[#d9d9d9] px-0.5 py-1 align-middle font-bold break-words [overflow-wrap:anywhere]";
const yellowRowClass = "bg-[#fff2cc]";

/** Google Sheet의 `세로` 시트와 같은 10열 구성으로 모바일 일촬표를 표시합니다. */
export function DailyPlanMobilePortraitPreview({ plan, locations, meta, timetableRows }: DailyPlanMobilePortraitPreviewProps) {
  const locationRows = padRows(locations.filter(isPrintableLocation), 4);
  const sheetTimetableRows = padRows(timetableRows, 7);
  const starringRows = padRows(meta.starring, 10);
  const teamRows = padRows(meta.teams, 10);

  return (
    <article
      data-testid="daily-plan-mobile-portrait-preview"
      className="mt-4 w-full overflow-hidden bg-white font-[Arial,sans-serif] text-[10px] leading-[1.2] text-black md:hidden"
    >
      <table className="w-full table-fixed border-collapse border-2 border-black text-center">
        <SheetColumns />
        <tbody>
          <tr className="h-[54px]">
            <td className={`${cellClass} whitespace-nowrap font-bold`}>
              <span className="text-[8px]">DAY</span>
              <span className="ml-0.5 text-[22px] leading-none">{meta.day || ""}</span>
            </td>
            <td colSpan={9} className={`${cellClass} bg-[#ead1d1] px-1`}>
              <span className="text-[16px] font-bold">&lt;{plan.title || "작품명"}&gt;</span>
              <span className="ml-1.5 text-[14px] font-normal">TIME TABLE</span>
            </td>
          </tr>
          <tr className="h-8">
            <td className={`${cellClass} text-[8px] font-bold`}>CALL TIME</td>
            <td colSpan={9} className={`${cellClass} bg-[#ead1d1]`}>
              <div className="flex items-baseline justify-center gap-1.5 whitespace-nowrap">
                <span className="text-[8px] font-bold">Day</span>
                <span className="text-[15px] font-bold">{formatDate(plan.shootingDate)}</span>
                <span className="text-[8px] font-bold">Time</span>
                <span className="text-[15px] font-bold">{plan.callTime || ""}</span>
              </div>
            </td>
          </tr>
          <tr>
            <StaffCells label="Director" name={plan.director} contact={meta.directorContact} />
            <StaffCells label="A.D" name={plan.assistantDirector} contact={meta.assistantDirectorContact} />
          </tr>
          <tr>
            <StaffCells label="Producer" name={plan.production} contact={meta.producerContact} />
            <td colSpan={2} className={cellClass}>Total Crew</td>
            <td colSpan={3} className={`${cellClass} bg-[#d9ead3] font-bold`}>{formatCrewTotal(meta.totalCrew)}</td>
          </tr>
        </tbody>
      </table>

      <table className="mt-1 w-full table-fixed border-collapse border-y-2 border-black text-center">
        <SheetColumns />
        <tbody>
          <tr>
            <td colSpan={2} className={cellClass}>Sunrise</td>
            <td colSpan={2} className={cellClass}>{meta.sunrise || ""}</td>
            <td colSpan={2} className={cellClass}>Weather</td>
            <td colSpan={2} className={cellClass}>{meta.weather || ""}</td>
            <td className={cellClass}>최고 기온</td>
            <td className={cellClass}>{formatTemperature(meta.maxTemperature)}</td>
          </tr>
          <tr>
            <td colSpan={2} className={cellClass}>Sunset</td>
            <td colSpan={2} className={cellClass}>{meta.sunset || ""}</td>
            <td colSpan={2} className={cellClass}>강수 확률</td>
            <td colSpan={2} className={cellClass}>{formatPercent(meta.rainProbability)}</td>
            <td className={cellClass}>최저 기온</td>
            <td className={cellClass}>{formatTemperature(meta.minTemperature)}</td>
          </tr>
        </tbody>
      </table>

      <table className="mt-1 w-full table-fixed border-collapse border-y-2 border-black text-center">
        <SheetColumns />
        <tbody>
          {locationRows.map((location, index) => (
            <tr key={location?.id || `portrait-location-${index}`} className="h-[21px]">
              <td colSpan={2} className={cellClass}>LOCATION {index + 1}</td>
              <td colSpan={2} className={cellClass}>{location?.name || ""}</td>
              <td colSpan={6} className={cellClass}>{location ? getLocationAddress(location) || location.detail : ""}</td>
            </tr>
          ))}
        </tbody>
      </table>

      <table className="mt-1 w-full table-fixed border-collapse border-y-2 border-black text-center">
        <SheetColumns />
        <thead>
          <tr>
            <th className={headerCellClass}>START</th>
            <th className={headerCellClass}>END</th>
            <th className={headerCellClass}>RT</th>
            <th colSpan={2} className={headerCellClass}>LOCATION</th>
            <th className={headerCellClass}>D/N/S</th>
            <th className={headerCellClass}>SCENE</th>
            <th className={headerCellClass}>Total CUT</th>
            <th colSpan={2} className={headerCellClass}>Shooting order</th>
          </tr>
        </thead>
        <tbody>
          {sheetTimetableRows.map((row, index) => row ? (
            row.type === "break" ? (
              <tr key={`portrait-time-${index}`} className={`${yellowRowClass} h-[21px]`}>
                <td className={cellClass}>{row.start}</td>
                <td className={cellClass}>{row.end}</td>
                <td className={cellClass}>{row.runtime}</td>
                <td colSpan={7} className={cellClass}>{formatBreakDescription(row)}</td>
              </tr>
            ) : (
              <tr key={`portrait-time-${index}`} className="h-[21px]">
                <td className={cellClass}>{row.start}</td>
                <td className={cellClass}>{row.end}</td>
                <td className={cellClass}>{row.runtime}</td>
                <td colSpan={2} className={cellClass}>{row.location}</td>
                <td className={cellClass}>{row.dayNight}</td>
                <td className={cellClass}>{row.sceneNumber}</td>
                <td className={cellClass}>{row.totalCut}</td>
                <td colSpan={2} className={cellClass}>{row.shootingOrder}</td>
              </tr>
            )
          ) : (
            <tr key={`portrait-time-empty-${index}`} className="h-[21px]">
              <td className={cellClass} /><td className={cellClass} /><td className={cellClass} />
              <td colSpan={2} className={cellClass} /><td className={cellClass} /><td className={cellClass} />
              <td className={cellClass} /><td colSpan={2} className={cellClass} />
            </tr>
          ))}
        </tbody>
      </table>

      <table className="mt-1 w-full table-fixed border-collapse border-y-2 border-black text-center">
        <SheetColumns />
        <thead>
          <tr>
            <th className={headerCellClass}>SCENE</th>
            <th colSpan={3} className={headerCellClass}>Description</th>
            <th colSpan={2} className={headerCellClass}>Shooting order</th>
            <th className={headerCellClass}>배우</th>
            <th colSpan={3} className={headerCellClass}>Notes</th>
          </tr>
        </thead>
        <tbody>
          {sheetTimetableRows.map((row, index) => row ? (
            row.type === "break" ? (
              <tr key={`portrait-detail-${index}`} className={`${yellowRowClass} h-[21px]`}>
                <td colSpan={10} className={cellClass}>{formatBreakDescription(row)}</td>
              </tr>
            ) : (
              <tr key={`portrait-detail-${index}`} className="h-[21px]">
                <td className={cellClass}>{row.sceneNumber}</td>
                <td colSpan={3} className={cellClass}>{row.description}</td>
                <td colSpan={2} className={cellClass}>{row.shootingOrder}</td>
                <td className={cellClass}>{row.cast}</td>
                <td colSpan={3} className={cellClass}>{row.notes}</td>
              </tr>
            )
          ) : (
            <tr key={`portrait-detail-empty-${index}`} className="h-[21px]">
              <td className={cellClass} /><td colSpan={3} className={cellClass} />
              <td colSpan={2} className={cellClass} /><td className={cellClass} />
              <td colSpan={3} className={cellClass} />
            </tr>
          ))}
        </tbody>
      </table>

      <SheetMemoSection title="Notice" value={plan.safetyNotice} />
      <SheetMemoSection title="Memo" value={meta.memoText} />

      <CallSheetTable
        title="Starring"
        headers={["Starring", "Roll", "CALL", "Call Location", "Notes"]}
        spans={[1, 1, 1, 2, 5]}
        rows={starringRows.map((row) => row ? [row.name, row.role, row.callTime, row.callLocation, row.notes] : ["", "", "", "", ""])}
      />
      <CallSheetTable
        title="Team"
        headers={["Team", "Total", "CALL", "Call Location", "Notes"]}
        spans={[1, 1, 1, 2, 5]}
        rows={teamRows.map((row) => row ? [row.team, row.total, row.callTime, row.callLocation, row.notes] : ["", "", "", "", ""])}
      />
    </article>
  );
}

function SheetColumns() {
  return <colgroup>{Array.from({ length: 10 }, (_, index) => <col key={index} className="w-[10%]" />)}</colgroup>;
}

function StaffCells({ label, name, contact }: { label: string; name: string; contact: string }) {
  return (
    <>
      <td className={cellClass}>{label}</td>
      <td className={cellClass}>{name || ""}</td>
      <td colSpan={3} className={cellClass}>{contact || ""}</td>
    </>
  );
}

function SheetMemoSection({ title, value }: { title: string; value: string }) {
  return (
    <section className="mt-1 border-2 border-black">
      <h3 className="border-b border-black py-1 text-center text-[11px] font-normal">{title}</h3>
      <p className="min-h-[88px] whitespace-pre-wrap break-words px-1 py-1 text-left [overflow-wrap:anywhere]">{value || ""}</p>
    </section>
  );
}

function CallSheetTable({ title, headers, spans, rows }: { title: string; headers: string[]; spans: number[]; rows: string[][] }) {
  return (
    <section className="mt-1">
      <h3 className="sr-only">{title}</h3>
      <table className="w-full table-fixed border-collapse border-y-2 border-black text-center">
        <SheetColumns />
        <thead>
          <tr>{headers.map((header, index) => <th key={header} colSpan={spans[index]} className={headerCellClass}>{header}</th>)}</tr>
        </thead>
        <tbody>
          {rows.map((row, rowIndex) => (
            <tr key={`${title}-${rowIndex}`} className="h-[21px]">
              {row.map((value, cellIndex) => (
                <td key={`${title}-${rowIndex}-${cellIndex}`} colSpan={spans[cellIndex]} className={cellClass}>{value}</td>
              ))}
            </tr>
          ))}
        </tbody>
      </table>
    </section>
  );
}

function padRows<T>(rows: T[], minimumLength: number): Array<T | null> {
  return [...rows, ...Array.from({ length: Math.max(0, minimumLength - rows.length) }, () => null)];
}

function isPrintableLocation(location: DailyPlanLocation) {
  return Boolean(location.name.trim() || location.detail.trim() || getLocationAddress(location).trim());
}

function getLocationAddress(location: DailyPlanLocation) {
  return [location.roadAddress, location.address].find((value) => value?.trim()) ?? "";
}

function formatBreakDescription(row: Extract<MobileDailyPlanTimetableRow, { type: "break" }>) {
  return [row.description, row.location].filter(Boolean).join(" / ");
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
