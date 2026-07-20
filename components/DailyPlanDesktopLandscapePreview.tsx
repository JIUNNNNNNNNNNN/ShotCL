import type { MobileDailyPlanTimetableRow } from "@/components/DailyPlanMobilePortraitPreview";
import type { DailyPlanPrintMeta } from "@/lib/dailyPlan/printMeta";
import type { DailyPlanDraft, DailyPlanLocation } from "@/lib/types";

type DailyPlanDesktopLandscapePreviewProps = {
  plan: DailyPlanDraft;
  locations: DailyPlanLocation[];
  meta: DailyPlanPrintMeta;
  timetableRows: MobileDailyPlanTimetableRow[];
};

const sectionTableClass = "mt-1 w-full table-fixed border-collapse border-2 border-black text-center";
const cellClass = "border border-black px-1.5 py-1 align-middle";
const headerCellClass = `${cellClass} bg-[#d9d9d9] font-black`;

/** 앱 화면에서만 사용하는 Google Sheet 기반 가로형 미리보기입니다. */
export function DailyPlanDesktopLandscapePreview({ plan, locations, meta, timetableRows }: DailyPlanDesktopLandscapePreviewProps) {
  const printableLocations = locations.filter(isPrintableLocation);
  const starringRows = padRows(meta.starring, 9);
  const teamRows = padRows(meta.teams, 10);

  return (
    <article data-testid="daily-plan-desktop-landscape-preview" className="daily-plan-template text-[11px] leading-tight text-black">
      <table className="w-full table-fixed border-collapse border-2 border-black text-center">
        <tbody>
          <tr>
            <td rowSpan={4} className={`${cellClass} font-black`}>
              <span className="text-[9px]">DAY</span>
              <span className="ml-1 text-2xl leading-none">{meta.day || "-"}</span>
            </td>
            <td rowSpan={4} colSpan={11} className={`${cellClass} text-2xl font-black`}>
              {plan.title || "작품명"} TIME TABLE
            </td>
            <td className={cellClass}>Director</td>
            <td className={cellClass}>{plan.director || "-"}</td>
            <td colSpan={2} className={cellClass}>{meta.directorContact || "-"}</td>
          </tr>
          <tr>
            <td className={cellClass}>A.D</td>
            <td className={cellClass}>{plan.assistantDirector || "-"}</td>
            <td colSpan={2} className={cellClass}>{meta.assistantDirectorContact || "-"}</td>
          </tr>
          <tr>
            <td className={cellClass}>Producer</td>
            <td className={cellClass}>{plan.production || "-"}</td>
            <td colSpan={2} className={cellClass}>{meta.producerContact || "-"}</td>
          </tr>
          <tr>
            <td colSpan={2} className={cellClass}>Total Crew</td>
            <td colSpan={2} className={cellClass}>{meta.totalCrew || "-"}</td>
          </tr>
        </tbody>
      </table>

      <table className={sectionTableClass}>
        <tbody>
          <tr>
            <td rowSpan={2} className={`${cellClass} font-black`}>CALL TIME</td>
            <td rowSpan={2} colSpan={7} className={`${cellClass} bg-[#ead1d1]`}>
              <span className="mr-1 text-[9px] font-bold">Day</span>
              <span className="text-lg font-black">{formatDate(plan.shootingDate) || "-"}</span>
              <span className="ml-3 mr-1 text-[9px] font-bold">Time</span>
              <span className="text-lg font-black">{plan.callTime || "-"}</span>
            </td>
            <td className={cellClass}>Sunrise</td>
            <td className={cellClass}>{meta.sunrise || "-"}</td>
            <td className={cellClass}>Sunset</td>
            <td className={cellClass}>{meta.sunset || "-"}</td>
            <td className={cellClass}>Weather</td>
            <td colSpan={3} className={cellClass}>{meta.weather || "-"}</td>
          </tr>
          <tr>
            <td className={cellClass}>최저 기온</td>
            <td className={cellClass}>{meta.minTemperature || "-"}</td>
            <td className={cellClass}>최고 기온</td>
            <td className={cellClass}>{meta.maxTemperature || "-"}</td>
            <td className={cellClass}>강수 확률</td>
            <td colSpan={3} className={cellClass}>{meta.rainProbability || "-"}</td>
          </tr>
        </tbody>
      </table>

      <table className={sectionTableClass}>
        <tbody>
          {printableLocations.length > 0 ? printableLocations.map((location, index) => (
            <tr key={location.id || `landscape-location-${index}`}>
              <td className={`${cellClass} whitespace-nowrap text-left font-black`}>LOCATION {index + 1}</td>
              <td colSpan={7} className={`${cellClass} break-words font-bold`}>{location.name || "-"}</td>
              <td colSpan={8} className={`${cellClass} break-words text-left leading-tight [overflow-wrap:anywhere]`}>
                {getLocationAddress(location) || location.detail || "-"}
              </td>
            </tr>
          )) : (
            <tr><td colSpan={16} className={cellClass}>등록된 장소가 없습니다.</td></tr>
          )}
        </tbody>
      </table>

      <table className={sectionTableClass}>
        <thead>
          <tr>
            <th className={headerCellClass}>START</th>
            <th className={headerCellClass}>END</th>
            <th className={headerCellClass}>RT</th>
            <th colSpan={2} className={headerCellClass}>LOCATION</th>
            <th className={headerCellClass}>D/N</th>
            <th className={headerCellClass}>SCENE</th>
            <th className={headerCellClass}>Total CUT</th>
            <th colSpan={3} className={headerCellClass}>Description</th>
            <th colSpan={2} className={headerCellClass}>배우</th>
            <th className={headerCellClass}>Shooting order</th>
            <th colSpan={2} className={headerCellClass}>Notes</th>
          </tr>
        </thead>
        <tbody>
          {timetableRows.map((row, index) => row.type === "break" ? (
            <tr key={`landscape-row-${index}`} className="bg-[#fff2cc]">
              <td className={cellClass}>{row.start}</td>
              <td className={cellClass}>{row.end}</td>
              <td className={cellClass}>{row.runtime}</td>
              {row.location ? (
                <>
                  <td colSpan={2} className={`${cellClass} break-words`}>{row.location}</td>
                  <td colSpan={11} className={`${cellClass} text-left font-black`}>{row.description || "-"}</td>
                </>
              ) : (
                <td colSpan={13} className={`${cellClass} text-left font-black`}>{row.description || "-"}</td>
              )}
            </tr>
          ) : (
            <tr key={`landscape-row-${index}`}>
              <td className={cellClass}>{row.start}</td>
              <td className={cellClass}>{row.end}</td>
              <td className={cellClass}>{row.runtime}</td>
              <td colSpan={2} className={`${cellClass} break-words`}>{row.location}</td>
              <td className={cellClass}>{row.dayNight}</td>
              <td className={cellClass}>{row.sceneNumber}</td>
              <td className={cellClass}>{row.totalCut}</td>
              <td colSpan={3} className={`${cellClass} text-left`}>{row.description}</td>
              <td colSpan={2} className={`${cellClass} break-words`}>{formatCast(row.cast)}</td>
              <td className={cellClass}>{row.shootingOrder}</td>
              <td colSpan={2} className={`${cellClass} text-left`}>{row.notes}</td>
            </tr>
          ))}
        </tbody>
      </table>

      <table className={sectionTableClass}>
        <tbody>
          <tr className="font-black">
            <td colSpan={8} className={cellClass}>Notice</td>
            <td colSpan={8} className={cellClass}>Memo</td>
          </tr>
          <tr>
            <td colSpan={8} className={`${cellClass} h-20 whitespace-pre-wrap text-left align-top`}>{plan.safetyNotice || ""}</td>
            <td colSpan={8} className={`${cellClass} h-20 whitespace-pre-wrap text-left align-top`}>{meta.memoText || ""}</td>
          </tr>
        </tbody>
      </table>

      <table className={sectionTableClass}>
        <thead>
          <tr>
            <th colSpan={2} className={headerCellClass}>Starring</th>
            <th colSpan={2} className={headerCellClass}>Roll</th>
            <th className={headerCellClass}>CALL</th>
            <th colSpan={2} className={headerCellClass}>Call Location</th>
            <th className={headerCellClass}>Notes</th>
            <th colSpan={2} className={headerCellClass}>Team</th>
            <th className={headerCellClass}>Total</th>
            <th className={headerCellClass}>CALL</th>
            <th colSpan={2} className={headerCellClass}>Call Location</th>
            <th colSpan={2} className={headerCellClass}>Notes</th>
          </tr>
        </thead>
        <tbody>
          {Array.from({ length: Math.max(starringRows.length, teamRows.length) }, (_, index) => {
            const person = starringRows[index];
            const team = teamRows[index];
            return (
              <tr key={`landscape-call-${index}`}>
                <td colSpan={2} className={cellClass}>{person?.name || ""}</td>
                <td colSpan={2} className={cellClass}>{person?.role || ""}</td>
                <td className={cellClass}>{person?.callTime || ""}</td>
                <td colSpan={2} className={cellClass}>{person?.callLocation || ""}</td>
                <td className={`${cellClass} text-left`}>{person?.notes || ""}</td>
                <td colSpan={2} className={cellClass}>{team?.team || ""}</td>
                <td className={cellClass}>{team?.total || ""}</td>
                <td className={cellClass}>{team?.callTime || ""}</td>
                <td colSpan={2} className={cellClass}>{team?.callLocation || ""}</td>
                <td colSpan={2} className={`${cellClass} text-left`}>{team?.notes || ""}</td>
              </tr>
            );
          })}
        </tbody>
      </table>
    </article>
  );
}

function isPrintableLocation(location: DailyPlanLocation) {
  return Boolean(location.name.trim() || location.detail.trim() || getLocationAddress(location).trim());
}

function getLocationAddress(location: DailyPlanLocation) {
  return (location.roadAddress || location.address || "").trim();
}

function formatDate(value: string) {
  return value ? value.replace(/-/g, ".") : "";
}

function formatCast(value: string) {
  return String(value ?? "")
    .split(",")
    .map((item) => item.trim().replace(/\s*\([^)]*\)\s*$/, ""))
    .filter(Boolean)
    .join(" / ");
}

function padRows<T>(rows: T[], minimum: number): Array<T | null> {
  return [...rows, ...Array.from({ length: Math.max(0, minimum - rows.length) }, () => null)];
}
