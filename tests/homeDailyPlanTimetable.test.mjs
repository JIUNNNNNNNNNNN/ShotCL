import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";
import { buildDailyPlanDateIndex } from "../lib/projectCalendar.ts";

const readSource = async (path) => readFile(new URL(`../${path}`, import.meta.url), "utf8");

test("same-date Daily Plans retain canonical round and stable-id order", () => {
  const index = buildDailyPlanDateIndex([
    { id: "plan-z", shootingDate: "2026-08-15", episode: "10" },
    { id: "plan-b", shootingDate: "2026-08-15", episode: "2" },
    { id: "plan-a", shootingDate: "2026-08-15", episode: "2" },
    { id: "other", shootingDate: "2026-08-17", episode: "1" }
  ]);

  assert.deepEqual(
    index.get("2026-08-15")?.map(({ plan }) => plan.id),
    ["plan-a", "plan-b", "plan-z"]
  );
  assert.equal(index.get("2026-08-16"), undefined);
});

test("Home and the visible portrait Daily Plan use one shared timetable renderer", async () => {
  const [detail, document, timetable] = await Promise.all([
    readSource("components/DailyPlanCalendarDetail.tsx"),
    readSource("components/DailyPlanDocument.tsx"),
    readSource("components/DailyPlanTimetable.tsx")
  ]);

  assert.match(detail, /import \{ DailyPlanTimetable \}/u);
  assert.match(document, /import \{ DailyPlanTimetable \}/u);
  assert.match(detail, /<DailyPlanTimetable[\s\S]*rows=\{rows\}/u);
  assert.match(document, /<DailyPlanTimetable[\s\S]*rows=\{timetableRows\}/u);
  assert.doesNotMatch(detail, /<table\b|<thead\b|<tbody\b|<tr\b|<td\b|<th\b/u);
  assert.doesNotMatch(detail, /label:\s*"(?:START|END|RT|LOCATION|D\/N\/S|SCENE|Total CUT|Shooting order)"/u);
  assert.match(
    timetable,
    /label: "START"[\s\S]*label: "END"[\s\S]*label: "RT"[\s\S]*label: "LOCATION"[\s\S]*label: "D\/N\/S"[\s\S]*label: "SCENE"[\s\S]*label: "Total CUT"[\s\S]*label: "Shooting order"/u
  );
});

test("selected-date detail reuses workspace plans and fetches only legacy selected rows", async () => {
  const [guide, calendar, detail, monthly, data] = await Promise.all([
    readSource("components/ProjectGuideMenu.tsx"),
    readSource("components/ProjectShootingCalendar.tsx"),
    readSource("components/DailyPlanCalendarDetail.tsx"),
    readSource("components/project-calendar/ProjectMonthlyCalendar.tsx"),
    readSource("lib/data/dailyPlans.ts")
  ]);

  assert.match(guide, /dailyPlans:\s*readonly DailyPlanListItem\[\]/u);
  assert.match(calendar, /new Map\(dailyPlans\.map\(\(plan\) => \[plan\.id, plan\]\)\)/u);
  assert.match(calendar, /selectedPlans\.flatMap/u);
  assert.match(monthly, /selectedPlans\.length > 0[\s\S]*renderDailyPlanDetail \? renderDailyPlanDetail\(selectedPlans\) : null/u);
  assert.match(detail, /selectedMeta\.timetableScenes\.length === 0[\s\S]*selectedPlan\.shotCount > 0/u);
  assert.match(detail, /getDailyPlanWithShots\(projectId, selectedPlan\.id\)/u);
  assert.match(detail, /`\$\{projectId\}:\$\{selectedPlan\.id\}:\$\{selectedPlan\.updatedAt\}`/u);
  assert.match(data, /\.eq\("project_id", projectId\)[\s\S]*\.eq\("daily_plan_id", dailyPlanId\)/u);
  assert.doesNotMatch(`${calendar}\n${detail}`, /router\.refresh|createClient|channel\(|subscribe\(|getProjectSceneList/u);
});

test("same-date rounds are explicitly selectable and empty/error states stay section-local", async () => {
  const detail = await readSource("components/DailyPlanCalendarDetail.tsx");

  assert.match(detail, /plans\.find\(\(plan\) => plan\.id === requestedPlanId\) \?\? plans\[0\]/u);
  assert.match(detail, /plans\.map\(\(plan\) =>/u);
  assert.match(detail, /aria-label="같은 날짜 일촬표 회차 선택"/u);
  assert.match(detail, /aria-pressed=\{selected\}/u);
  assert.match(detail, /setRequestedPlanId\(plan\.id\)/u);
  assert.match(detail, /등록된 타임테이블이 없습니다\./u);
  assert.match(detail, /타임테이블을 불러오는 중입니다\./u);
  assert.match(detail, /다시 시도/u);
});

test("timetable detail expands the in-flow calendar layout without Home table CSS or PDF code", async () => {
  const [detail, monthly, styles] = await Promise.all([
    readSource("components/DailyPlanCalendarDetail.tsx"),
    readSource("components/project-calendar/ProjectMonthlyCalendar.tsx"),
    readSource("components/project-calendar/ProjectMonthlyCalendar.module.css")
  ]);

  assert.match(monthly, /data-has-daily-plan=\{selectedPlans\.length > 0/u);
  assert.match(styles, /\.calendarLayout\[data-has-daily-plan="true"\][\s\S]*grid-template-columns:\s*minmax\(0, 1fr\)/u);
  assert.match(detail, /w-full min-w-0 max-w-full overflow-hidden/u);
  assert.doesNotMatch(styles, /home[-_]timetable|daily-plan-(?:cell|preview-header|additional-cell)/u);
  assert.doesNotMatch(detail, /DailyPlanDocument|DailyPlanEditor|PrintDailyPlan|jsPDF|jspdf|html2canvas|pdfjs/u);
});
