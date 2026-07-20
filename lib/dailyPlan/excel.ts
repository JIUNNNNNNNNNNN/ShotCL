import { createBlankDailyPlanDraft, createBlankDailyPlanShotDraft, isMeaningfulDailyPlanShot, normalizeDailyPlanShotDrafts } from "@/lib/data/dailyPlans";
import { decodeDailyPlanMemo, mergeDailyPlanTimetableRows } from "@/lib/dailyPlan/printMeta";
import type { DailyPlan, DailyPlanDraft, DailyPlanLocation, DailyPlanMealTime, DailyPlanShot, DailyPlanShotDraft, Project } from "@/lib/types";

const META_ROWS: Array<[string, keyof DailyPlanDraft, string, keyof DailyPlanDraft]> = [
  ["작품명 / 프로젝트명", "title", "촬영일", "shootingDate"],
  ["회차", "episode", "감독", "director"],
  ["촬영감독", "dop", "조감독", "assistantDirector"],
  ["제작부", "production", "콜타임", "callTime"],
  ["촬영 시작 시간", "shootStartTime", "촬영 종료 예정 시간", "shootEndTime"],
  ["집합 장소", "meetingLocation", "주의사항", "safetyNotice"],
  ["전체 메모", "memo", "", "memo"]
];

export const DAILY_PLAN_HEADERS = [
  "씬 번호",
  "씬 제목",
  "씬 시작 시간",
  "씬 종료 시간",
  "촬영 장소",
  "주소",
  "D/N",
  "등장인물",
  "소품",
  "의상/분장",
  "컷 번호",
  "촬영 내용",
  "컷 비고"
] as const;

const HEADER_ALIASES: Record<keyof DailyPlanShotDraft | "skip", string[]> = {
  orderIndex: ["순서", "No", "번호"],
  startTime: ["씬 시작 시간", "씬 시작", "촬영 시작 시간", "시작시간", "시작", "Start", "START"],
  endTime: ["씬 종료 시간", "씬 종료", "촬영 종료 시간", "종료시간", "종료", "End", "END"],
  sceneNumber: ["씬", "씬 번호", "Scene", "SC", "S#"],
  sceneTitle: ["씬 제목", "씬 요약", "Scene Title"],
  locationId: [],
  locationName: ["촬영 장소", "장소", "Location", "LOCATION"],
  cutNumber: ["컷", "컷 번호", "Cut", "CUT", "C#"],
  subject: ["대상", "등장인물", "인물", "Cast", "CAST", "대상 / 등장인물"],
  subLocation: ["주소", "상세 주소", "소장소", "Address", "ADDRESS"],
  dayNight: ["D/N", "DN", "낮밤"],
  liveSync: ["L/S", "LS", "동시녹음"],
  cutType: ["CUT", "컷구분"],
  storyDay: ["DAY", "극중일"],
  description: ["촬영 내용", "내용", "설명", "Description", "Action"],
  props: ["소품", "필요 소품", "Props"],
  costumeMakeup: ["의상", "분장", "의상/분장", "Costume", "Makeup"],
  sceneMemo: ["씬 메모", "Scene Memo"],
  memo: ["컷 비고", "비고", "메모", "Note", "Memo"],
  status: ["상태", "Status"],
  skip: []
};

type ParsedSheet = string[][];

type ZipEntry = {
  name: string;
  method: number;
  data: Uint8Array;
};

type WorksheetCell = {
  value: string;
  style?: number;
};

type WorksheetModel = {
  cells: WorksheetCell[][];
  merges: string[];
};

/** 표준 일촬표 xlsx 양식을 다운로드합니다. */
export async function downloadStandardDailyPlanTemplate(project: Project | null) {
  const plan: DailyPlanDraft = {
    ...createBlankDailyPlanDraft(project, "web_editor"),
    shootingLocations: [
      { id: "loc_1", name: "성수동 일대", detail: "성수역 3번 출구 골목", roadAddress: "서울 성동구 성수동 일대" },
      { id: "loc_2", name: "카페 내부", detail: "실내 대화 장면", roadAddress: "서울 성동구 카페 거리" }
    ],
    mealTimes: [
      { id: "meal_1", startTime: "12:30", endTime: "13:30", memo: "현장 도시락" },
      { id: "meal_2", startTime: "18:30", endTime: "19:30", memo: "식당 이동" }
    ]
  };
  const shots = [
    {
      ...createBlankDailyPlanShotDraft(1, "1", "1"),
      sceneTitle: "골목 진입",
      startTime: "13:00",
      endTime: "13:30",
      locationId: "loc_1",
      locationName: "성수동 일대",
      subLocation: "서울 성동구 성수동 일대",
      subject: "주인공",
      dayNight: "D",
      description: "예시: 주인공이 골목으로 들어온다.",
      props: "가방",
      costumeMakeup: "외출복",
      memo: "이 행은 지우고 사용해도 됩니다."
    },
    {
      ...createBlankDailyPlanShotDraft(2, "1", "2"),
      sceneTitle: "골목 진입",
      startTime: "13:00",
      endTime: "13:30",
      locationId: "loc_1",
      locationName: "성수동 일대",
      subLocation: "서울 성동구 성수동 일대",
      subject: "주인공, 친구",
      dayNight: "D",
      description: "예시: 손에 든 휴대폰 클로즈업.",
      memo: "표준 양식 테스트용 예시 행입니다."
    }
  ];
  const blob = await buildDailyPlanExcelBlob(plan, shots);
  downloadBlob(blob, "표준_일촬표_양식.xlsx");
}

/** 현재 웹 편집기 내용을 xlsx 파일로 다운로드합니다. */
export async function downloadDailyPlanExcel(projectName: string, plan: DailyPlanDraft | DailyPlan, shots: Array<DailyPlanShotDraft | DailyPlanShot>) {
  const blob = await buildDailyPlanExcelBlob(plan, shots);
  const safeProjectName = sanitizeFileName(projectName || plan.title || "프로젝트");
  const safeDate = sanitizeFileName(plan.shootingDate || "촬영일미정");
  downloadBlob(blob, `${safeProjectName}_${safeDate}_일촬표.xlsx`);
}

/** 업로드한 xlsx 파일에서 기본 정보와 컷 표를 읽어 웹 편집기 draft로 바꿉니다. */
export async function parseDailyPlanExcel(file: File, project: Project | null): Promise<{ plan: DailyPlanDraft; shots: DailyPlanShotDraft[] }> {
  const entries = await readZipEntries(await file.arrayBuffer());
  const sheet = await readWorkbookSheet(entries);
  const plan = extractPlanMeta(sheet, project, file.name);
  const locations = mergeLocations(extractLocations(sheet), []);
  const meals = extractMealTimes(sheet);
  const shots = extractPlanShots(sheet);
  const allLocations = attachShotAddressesToLocations(mergeLocations(locations, shots.map((shot) => shot.locationName).filter(Boolean)), shots);
  const shotsWithLocationIds = shots.map((shot) => ({
    ...shot,
    locationId: allLocations.find((location) => location.name === shot.locationName)?.id ?? shot.locationId
  }));
  plan.shootingLocations = allLocations;
  plan.mealTimes = meals;
  plan.shootingLocation = allLocations.map((location) => location.name).filter(Boolean).join(", ");
  plan.mealTime = meals
    .map((meal) => [formatExcelTimeRange(meal.startTime, meal.endTime), meal.memo].filter(Boolean).join(" / "))
    .filter(Boolean)
    .join(", ");

  return {
    plan,
    shots: shotsWithLocationIds.length > 0 ? shotsWithLocationIds : [createBlankDailyPlanShotDraft(1)]
  };
}

function attachShotAddressesToLocations(locations: DailyPlanLocation[], shots: DailyPlanShotDraft[]) {
  return locations.map((location) => {
    if (getLocationAddress(location)) return location;
    const shotAddress = shots.find((shot) => shot.locationName === location.name && shot.subLocation.trim())?.subLocation ?? "";
    return shotAddress ? { ...location, roadAddress: shotAddress } : location;
  });
}

async function buildDailyPlanExcelBlob(plan: DailyPlanDraft | DailyPlan, shots: Array<DailyPlanShotDraft | DailyPlanShot>) {
  const worksheet = buildWorksheetRows(plan, normalizeDailyPlanShotDrafts(shots.map(normalizeShotLike)));
  const files: Record<string, string> = {
    "[Content_Types].xml": buildContentTypesXml(),
    "_rels/.rels": buildRootRelsXml(),
    "docProps/app.xml": buildAppXml(),
    "docProps/core.xml": buildCoreXml(),
    "xl/workbook.xml": buildWorkbookXml(),
    "xl/_rels/workbook.xml.rels": buildWorkbookRelsXml(),
    "xl/styles.xml": buildStylesXml(),
    "xl/worksheets/sheet1.xml": buildWorksheetXml(worksheet)
  };

  return new Blob([createZip(files)], {
    type: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet"
  });
}

function buildWorksheetRows(plan: DailyPlanDraft | DailyPlan, shots: DailyPlanShotDraft[]): WorksheetModel {
  const meta = decodeDailyPlanMemo(String(plan.memo ?? ""));
  const colCount = 16;
  const locations = getPlanLocations(plan).filter(isExcelPrintableLocation);
  const timeRows = buildExcelTimetableRows(plan, shots);
  const visibleTimeRows = [...timeRows, ...createBlankExcelRows(Math.max(0, 7 - timeRows.length))];
  const locationStartRow = 8;
  const timeHeaderRow = locationStartRow + locations.length + 2;
  const timeStartRow = timeHeaderRow + 1;
  const noticeHeaderRow = timeStartRow + visibleTimeRows.length + 2;
  const noticeBodyStartRow = noticeHeaderRow + 1;
  const noticeBodyEndRow = noticeHeaderRow + 5;
  const callHeaderRow = noticeBodyEndRow + 2;
  const callStartRow = callHeaderRow + 1;
  const callRowCount = Math.max(10, meta.starring.length, meta.teams.length);
  const rowCount = Math.max(39, callStartRow + callRowCount - 1);
  const cells: WorksheetCell[][] = Array.from({ length: rowCount }, () =>
    Array.from({ length: colCount }, () => ({ value: "", style: 1 }))
  );
  const merges: string[] = [
    "A1:A4",
    "B1:L4",
    "O1:P1",
    "O2:P2",
    "O3:P3",
    "M4:N4",
    "O4:P4",
    "A5:A6",
    "B5:I6",
    "O5:P5",
    "O6:P6"
  ];

  setCell(cells, 1, 1, `DAY${meta.day || ""}`, 4);
  setCell(cells, 1, 2, `${plan.title || "작품명"} TIME TABLE`, 3);
  setCell(cells, 1, 13, "Director", 1);
  setCell(cells, 1, 14, plan.director, 1);
  setCell(cells, 1, 15, meta.directorContact, 1);
  setCell(cells, 2, 13, "A.D", 1);
  setCell(cells, 2, 14, plan.assistantDirector, 1);
  setCell(cells, 2, 15, meta.assistantDirectorContact, 1);
  setCell(cells, 3, 13, "Producer", 1);
  setCell(cells, 3, 14, plan.production, 1);
  setCell(cells, 3, 15, meta.producerContact, 1);
  setCell(cells, 4, 13, "Total Crew", 1);
  setCell(cells, 4, 15, meta.totalCrew, 1);
  setCell(cells, 5, 1, "CALL TIME", 4);
  setCell(
    cells,
    5,
    2,
    `Day ${formatDateForPreview(plan.shootingDate || "")}${plan.callTime ? ` Time ${plan.callTime}` : ""}`,
    4
  );
  setCell(cells, 5, 10, "Sunset", 1);
  setCell(cells, 5, 11, meta.sunset, 1);
  setCell(cells, 5, 12, "최고 기온", 1);
  setCell(cells, 5, 13, meta.maxTemperature, 1);
  setCell(cells, 5, 14, "Weather", 1);
  setCell(cells, 5, 15, meta.weather, 1);
  setCell(cells, 6, 10, "최저 기온", 1);
  setCell(cells, 6, 11, meta.minTemperature, 1);
  setCell(cells, 6, 12, "", 1);
  setCell(cells, 6, 13, "", 1);
  setCell(cells, 6, 14, "강수 확률", 1);
  setCell(cells, 6, 15, meta.rainProbability, 1);

  locations.forEach((location, index) => {
    const row = locationStartRow + index;
    merges.push(`B${row}:H${row}`, `I${row}:P${row}`);
    setCell(cells, row, 1, `LOCATION ${index + 1}`, 4);
    setCell(cells, row, 2, location.name, 1);
    setCell(cells, row, 9, getLocationAddress(location) || location.detail || "", 1);
  });

  [
    ["START", 1, 1],
    ["END", 2, 2],
    ["RT", 3, 3],
    ["LOCATION", 4, 5],
    ["D/N/S", 6, 6],
    ["SCENE", 7, 7],
    ["Total CUT", 8, 8],
    ["Description", 9, 12],
    ["Shooting order", 13, 14],
    ["Notes", 15, 16]
  ].forEach(([label, start, end]) => {
    if (start !== end) merges.push(`${indexToColumnLetters(Number(start) - 1)}${timeHeaderRow}:${indexToColumnLetters(Number(end) - 1)}${timeHeaderRow}`);
    setCell(cells, timeHeaderRow, Number(start), String(label), 2);
  });

  visibleTimeRows.forEach((row, index) => {
    const excelRow = timeStartRow + index;
    if (row.type === "break") {
      setCell(cells, excelRow, 1, row.start, 1);
      setCell(cells, excelRow, 2, row.end, 1);
      setCell(cells, excelRow, 3, row.runtime, 1);
      if (row.location) {
        merges.push(`D${excelRow}:E${excelRow}`, `F${excelRow}:P${excelRow}`);
        setCell(cells, excelRow, 4, row.location, 5);
        setCell(cells, excelRow, 6, row.description, 5);
      } else {
        merges.push(`D${excelRow}:P${excelRow}`);
        setCell(cells, excelRow, 4, row.description, 5);
      }
      return;
    }

    merges.push(`D${excelRow}:E${excelRow}`, `I${excelRow}:L${excelRow}`, `M${excelRow}:N${excelRow}`, `O${excelRow}:P${excelRow}`);
    setCell(cells, excelRow, 1, row.start, 1);
    setCell(cells, excelRow, 2, row.end, 1);
    setCell(cells, excelRow, 3, row.runtime, 1);
    setCell(cells, excelRow, 4, row.location, 1);
    setCell(cells, excelRow, 6, row.dayNight, 1);
    setCell(cells, excelRow, 7, row.sceneNumber, 1);
    setCell(cells, excelRow, 8, row.totalCut, 1);
    setCell(cells, excelRow, 9, row.description, 1);
    setCell(cells, excelRow, 13, row.shootingOrder, 1);
    setCell(cells, excelRow, 15, row.notes, 1);
  });

  merges.push(`A${noticeHeaderRow}:H${noticeHeaderRow}`, `I${noticeHeaderRow}:P${noticeHeaderRow}`, `A${noticeBodyStartRow}:H${noticeBodyEndRow}`, `I${noticeBodyStartRow}:P${noticeBodyEndRow}`);
  setCell(cells, noticeHeaderRow, 1, "Notice", 4);
  setCell(cells, noticeHeaderRow, 9, "Memo", 4);
  setCell(cells, noticeBodyStartRow, 1, plan.safetyNotice, 1);
  setCell(cells, noticeBodyStartRow, 9, meta.memoText, 1);

  [
    ["Starring", 1, 2],
    ["Roll", 3, 4],
    ["CALL", 5, 5],
    ["Call Location", 6, 7],
    ["Notes", 8, 8],
    ["Team", 9, 10],
    ["Total", 11, 11],
    ["CALL", 12, 12],
    ["Call Location", 13, 14],
    ["Notes", 15, 16]
  ].forEach(([label, start, end]) => {
    if (start !== end) merges.push(`${indexToColumnLetters(Number(start) - 1)}${callHeaderRow}:${indexToColumnLetters(Number(end) - 1)}${callHeaderRow}`);
    setCell(cells, callHeaderRow, Number(start), String(label), 2);
  });

  const starring = padGenericRows(meta.starring, callRowCount);
  const teams = padGenericRows(meta.teams, callRowCount);
  Array.from({ length: callRowCount }, (_, index) => {
    const row = callStartRow + index;
    const person = starring[index];
    const team = teams[index];
    merges.push(`A${row}:B${row}`, `C${row}:D${row}`, `F${row}:G${row}`, `I${row}:J${row}`, `M${row}:N${row}`, `O${row}:P${row}`);
    setCell(cells, row, 1, person?.name ?? "", 1);
    setCell(cells, row, 3, person?.role ?? "", 1);
    setCell(cells, row, 5, person?.callTime ?? "", 1);
    setCell(cells, row, 6, person?.callLocation ?? "", 1);
    setCell(cells, row, 8, [person?.contact, person?.notes].filter(Boolean).join(" / "), 1);
    setCell(cells, row, 9, team?.team ?? "", 1);
    setCell(cells, row, 11, team?.total ?? "", 1);
    setCell(cells, row, 12, team?.callTime ?? "", 1);
    setCell(cells, row, 13, team?.callLocation ?? "", 1);
    setCell(cells, row, 15, [team?.contact, team?.notes].filter(Boolean).join(" / "), 1);
  });

  return { cells, merges };
}

function setCell(cells: WorksheetCell[][], row: number, column: number, value: unknown, style = 1) {
  cells[row - 1][column - 1] = {
    value: String(value ?? ""),
    style
  };
}

function padGenericRows<T>(rows: T[], minLength: number) {
  return [...rows, ...Array.from({ length: Math.max(0, minLength - rows.length) }, () => null as T | null)];
}

type ExcelTimetableRow =
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

function buildExcelTimetableRows(plan: DailyPlanDraft | DailyPlan, shots: DailyPlanShotDraft[]): ExcelTimetableRow[] {
  const locations = getPlanLocations(plan);
  const sceneRows: ExcelTimetableRow[] = shots
    .filter((shot) => shot.sceneNumber.trim() || shot.description.trim())
    .map((shot) => {
      const shootingOrder = normalizeExcelShootingOrder(shot.cutNumber);
      return {
        type: "scene",
        start: shot.startTime,
        end: shot.endTime,
        runtime: calculateExcelRuntime(shot.startTime, shot.endTime),
        location: shot.locationName || shot.subLocation,
        dayNight: shot.dayNight,
        sceneNumber: formatExcelSceneNumber(shot.sceneNumber),
        totalCut: String(shootingOrder.length || 1),
        description: shot.description || shot.sceneTitle,
        shootingOrder: shootingOrder.join("-"),
        notes: shot.memo
      };
    });

  const breakRows: ExcelTimetableRow[] = getPlanMealTimes(plan).map((meal) => ({
    type: "break",
    start: meal.startTime,
    end: meal.endTime,
    runtime: formatExcelRuntimeMinutes(meal.runtimeMinutes) || meal.runtime || calculateExcelRuntime(meal.startTime, meal.endTime),
    location: locations.find((location) => location.id === meal.locationId)?.name ?? "",
    description: meal.memo || "기타 일정"
  }));

  const meta = decodeDailyPlanMemo(String(plan.memo ?? ""));
  return mergeDailyPlanTimetableRows(sceneRows, breakRows, meta.timetableRowOrder);
}

function createBlankExcelRows(count: number): ExcelTimetableRow[] {
  return Array.from({ length: count }, () => ({
    type: "scene",
    start: "",
    end: "",
    runtime: "",
    location: "",
    dayNight: "",
    sceneNumber: "",
    totalCut: "",
    description: "",
    shootingOrder: "",
    notes: ""
  }));
}

function normalizeExcelShootingOrder(value: string) {
  return String(value ?? "")
    .split(/[-,/\s]+/)
    .map((item) => item.trim())
    .filter(Boolean);
}

function formatExcelSceneNumber(value: string) {
  const trimmed = String(value ?? "").trim();
  if (!trimmed) return "";
  return /^s#/i.test(trimmed) ? trimmed : `S#${trimmed}`;
}

function formatExcelTimeRange(startTime: string, endTime: string) {
  if (startTime && endTime) return `${startTime}~${endTime}`;
  return startTime || endTime || "";
}

function calculateExcelRuntime(startTime: string, endTime: string) {
  const start = parseExcelTimeMinutes(startTime);
  const end = parseExcelTimeMinutes(endTime);
  if (start == null || end == null) return "";
  const diff = end >= start ? end - start : end + 24 * 60 - start;
  if (diff <= 0) return "";
  const hours = Math.floor(diff / 60);
  const minutes = diff % 60;
  if (minutes === 0) return `${hours}H`;
  if (hours === 0) return `${minutes}M`;
  return `${hours}H${minutes}M`;
}

function formatExcelRuntimeMinutes(value: number | null | undefined) {
  if (value == null || !Number.isFinite(value) || value <= 0) return "";
  const hours = Math.floor(value / 60);
  const minutes = value % 60;
  if (minutes === 0) return `${hours}H`;
  if (hours === 0) return `${minutes}M`;
  return `${hours}H${minutes}M`;
}

function parseExcelTimeMinutes(value: string) {
  const match = String(value ?? "").match(/^(\d{2}):(\d{2})$/);
  if (!match) return null;
  const hour = Number(match[1]);
  const minute = Number(match[2]);
  if (!Number.isFinite(hour) || !Number.isFinite(minute)) return null;
  return hour * 60 + minute;
}

function extractPlanMeta(sheet: ParsedSheet, project: Project | null, fileName: string): DailyPlanDraft {
  const plan = createBlankDailyPlanDraft(project, "excel_import", fileName);
  const labelMap: Record<string, keyof DailyPlanDraft> = {
    "작품명/프로젝트명": "title",
    작품명: "title",
    프로젝트명: "title",
    제목: "title",
    촬영일: "shootingDate",
    회차: "episode",
    감독: "director",
    촬영감독: "dop",
    조감독: "assistantDirector",
    제작부: "production",
    콜타임: "callTime",
    촬영시작시간: "shootStartTime",
    촬영시작: "shootStartTime",
    촬영종료예정시간: "shootEndTime",
    촬영종료: "shootEndTime",
    집합장소: "meetingLocation",
    촬영장소: "shootingLocation",
    식사시간: "mealTime",
    주의사항: "safetyNotice",
    전체메모: "memo",
    메모: "memo"
  };

  sheet.slice(0, 30).forEach((row) => {
    row.forEach((cell, index) => {
      const key = labelMap[normalizeLabel(cell)];
      if (!key) return;
      const value = row[index + 1]?.trim();
      if (value) {
        (plan[key] as string) = value;
      }
    });
  });

  if (!plan.title.trim()) {
    plan.title = project?.name ? `${project.name} 일촬표` : fileName.replace(/\.xlsx$/i, "");
  }

  return plan;
}

function extractLocations(sheet: ParsedSheet): DailyPlanLocation[] {
  const startIndex = findSectionIndex(sheet, "촬영장소목록");
  if (startIndex < 0) return [];

  const locations: DailyPlanLocation[] = [];
  for (let index = startIndex + 2; index < sheet.length; index += 1) {
    const row = sheet[index];
    if (isSectionBreak(row)) break;

    const name = row[0]?.trim() ?? "";
    const address = row[1]?.trim() ?? "";
    const detail = row[2]?.trim() ?? "";
    if (name || address || detail) {
      locations.push({ id: `loc_${locations.length + 1}`, name, detail, roadAddress: address });
    }
  }

  return locations;
}

function extractMealTimes(sheet: ParsedSheet): DailyPlanMealTime[] {
  const startIndex = findSectionIndex(sheet, "식사시간목록");
  if (startIndex < 0) return [];

  const meals: DailyPlanMealTime[] = [];
  for (let index = startIndex + 2; index < sheet.length; index += 1) {
    const row = sheet[index];
    if (isSectionBreak(row)) break;

    const startTime = row[0]?.trim() ?? "";
    const endTime = row[1]?.trim() ?? "";
    const memo = row[2]?.trim() ?? "";
    if (startTime || endTime || memo) {
      meals.push({ id: `meal_${meals.length + 1}`, startTime, endTime, memo });
    }
  }

  return meals;
}

function mergeLocations(locations: DailyPlanLocation[], names: string[]) {
  const merged = [...locations];

  names.forEach((name) => {
    const trimmedName = name.trim();
    if (!trimmedName || merged.some((location) => location.name === trimmedName)) return;
    merged.push({ id: `loc_${merged.length + 1}`, name: trimmedName, detail: "" });
  });

  return merged;
}

function findSectionIndex(sheet: ParsedSheet, normalizedTitle: string) {
  return sheet.findIndex((row) => normalizeLabel(row[0] ?? "") === normalizedTitle);
}

function isSectionBreak(row: string[]) {
  const first = normalizeLabel(row[0] ?? "");
  return !row.some((cell) => cell.trim()) || first === "식사시간목록" || first === "씬별컷목록";
}

function extractPlanShots(sheet: ParsedSheet): DailyPlanShotDraft[] {
  const headerInfo = findHeaderRow(sheet);
  if (!headerInfo) return [];

  const { rowIndex, columns } = headerInfo;
  const shots: DailyPlanShotDraft[] = [];

  sheet.slice(rowIndex + 1).forEach((row) => {
    const draft = createBlankDailyPlanShotDraft(shots.length + 1);

    Object.entries(columns).forEach(([columnIndexText, rawKey]) => {
      const key = rawKey as keyof DailyPlanShotDraft | "skip";
      const value = row[Number(columnIndexText)]?.trim() ?? "";
      if (!value || key === "skip") return;

      if (key === "orderIndex") {
        const parsed = Number(value);
        draft.orderIndex = Number.isFinite(parsed) && parsed > 0 ? parsed : shots.length + 1;
      } else if (key === "status") {
        draft.status = value === "OK" || value === "Omit" || value === "촬영중" || value === "보류" ? value : "촬영 전";
      } else {
        assignShotDraftText(draft, key, value);
      }
    });

    if (isMeaningfulDailyPlanShot(draft)) {
      shots.push({ ...draft, orderIndex: shots.length + 1 });
    }
  });

  return shots;
}

function findHeaderRow(sheet: ParsedSheet) {
  let best: { rowIndex: number; score: number; columns: Record<number, keyof DailyPlanShotDraft | "skip"> } | null = null;

  sheet.forEach((row, rowIndex) => {
    const columns: Record<number, keyof DailyPlanShotDraft | "skip"> = {};
    let score = 0;

    row.forEach((cell, columnIndex) => {
      const key = findHeaderKey(cell);
      if (key && key !== "skip") {
        columns[columnIndex] = key;
        score += 1;
      }
    });

    if (score >= 4 && (!best || score > best.score)) {
      best = { rowIndex, score, columns };
    }
  });

  return best;
}

function getPlanLocations(plan: DailyPlanDraft | DailyPlan): DailyPlanLocation[] {
  const locations = "shootingLocations" in plan ? plan.shootingLocations ?? [] : [];
  if (locations.length > 0) return locations;
  return plan.shootingLocation ? [{ id: "loc_1", name: plan.shootingLocation, detail: "" }] : [];
}

function isExcelPrintableLocation(location: DailyPlanLocation) {
  return Boolean(location.name.trim() || location.detail.trim() || getLocationAddress(location).trim());
}

function findLocationForShot(locations: DailyPlanLocation[], shot: DailyPlanShotDraft) {
  return locations.find((location) => location.id === shot.locationId) ?? locations.find((location) => location.name === shot.locationName);
}

function getLocationAddress(location: Partial<DailyPlanLocation> | undefined) {
  if (!location) return "";
  return [location.roadAddress, location.address].find((value) => value?.trim()) ?? "";
}

function getPlanMealTimes(plan: DailyPlanDraft | DailyPlan): DailyPlanMealTime[] {
  const meals = "mealTimes" in plan ? plan.mealTimes ?? [] : [];
  if (meals.length > 0) return meals;
  return plan.mealTime ? [{ id: "meal_1", startTime: "", endTime: "", memo: plan.mealTime }] : [];
}

function findHeaderKey(value: string): keyof DailyPlanShotDraft | "skip" | null {
  const normalized = normalizeLabel(value);

  for (const [key, aliases] of Object.entries(HEADER_ALIASES) as Array<[keyof DailyPlanShotDraft | "skip", string[]]>) {
    if (aliases.some((alias) => normalizeLabel(alias) === normalized)) {
      return key;
    }
  }

  return null;
}

async function readWorkbookSheet(entries: Map<string, ZipEntry>): Promise<ParsedSheet> {
  const workbookXml = await readTextEntry(entries, "xl/workbook.xml");
  const workbookRelsXml = await readTextEntry(entries, "xl/_rels/workbook.xml.rels");
  const workbook = parseXml(workbookXml);
  const rels = parseXml(workbookRelsXml);
  const sheets = byLocalName(workbook, "sheet");
  const targetSheet = sheets.find((sheet) => sheet.getAttribute("name") === "일촬표") ?? sheets[0];

  if (!targetSheet) {
    throw new Error("Excel 파일에서 시트를 찾지 못했습니다.");
  }

  const relId = targetSheet.getAttribute("r:id") ?? targetSheet.getAttributeNS("http://schemas.openxmlformats.org/officeDocument/2006/relationships", "id");
  const relationship = byLocalName(rels, "Relationship").find((rel) => rel.getAttribute("Id") === relId);
  const target = relationship?.getAttribute("Target") ?? "worksheets/sheet1.xml";
  const sheetPath = target.startsWith("xl/") ? target : `xl/${target.replace(/^\//, "")}`;
  const sharedStrings = await readSharedStrings(entries);
  const worksheetXml = await readTextEntry(entries, sheetPath);

  return parseWorksheetXml(worksheetXml, sharedStrings);
}

async function readSharedStrings(entries: Map<string, ZipEntry>) {
  const entry = entries.get("xl/sharedStrings.xml");
  if (!entry) return [];

  const xml = await decodeZipEntry(entry);
  const doc = parseXml(xml);
  return byLocalName(doc, "si").map((si) => byLocalName(si, "t").map((node) => node.textContent ?? "").join(""));
}

function parseWorksheetXml(xml: string, sharedStrings: string[]) {
  const doc = parseXml(xml);
  const rows: ParsedSheet = [];

  byLocalName(doc, "row").forEach((rowNode) => {
    const rowNumber = Number(rowNode.getAttribute("r") ?? rows.length + 1) - 1;
    const row: string[] = rows[rowNumber] ?? [];

    byLocalName(rowNode, "c").forEach((cellNode) => {
      const ref = cellNode.getAttribute("r") ?? "";
      const columnIndex = columnLettersToIndex(ref.replace(/\d+/g, ""));
      row[columnIndex] = readCellValue(cellNode, sharedStrings);
    });

    rows[rowNumber] = row;
  });

  return rows.map((row) => row.map((cell) => cell ?? ""));
}

function readCellValue(cellNode: Element, sharedStrings: string[]) {
  const type = cellNode.getAttribute("t");
  const rawValue = byLocalName(cellNode, "v")[0]?.textContent ?? "";

  if (type === "s") {
    return sharedStrings[Number(rawValue)] ?? "";
  }

  if (type === "inlineStr") {
    return byLocalName(cellNode, "t").map((node) => node.textContent ?? "").join("");
  }

  return rawValue;
}

async function readZipEntries(buffer: ArrayBuffer) {
  const data = new Uint8Array(buffer);
  const view = new DataView(buffer);
  const eocdOffset = findEndOfCentralDirectory(view);
  const centralDirectoryOffset = view.getUint32(eocdOffset + 16, true);
  const entryCount = view.getUint16(eocdOffset + 10, true);
  const entries = new Map<string, ZipEntry>();
  let offset = centralDirectoryOffset;

  for (let index = 0; index < entryCount; index += 1) {
    if (view.getUint32(offset, true) !== 0x02014b50) {
      throw new Error("Excel 압축 구조를 읽지 못했습니다.");
    }

    const method = view.getUint16(offset + 10, true);
    const compressedSize = view.getUint32(offset + 20, true);
    const fileNameLength = view.getUint16(offset + 28, true);
    const extraLength = view.getUint16(offset + 30, true);
    const commentLength = view.getUint16(offset + 32, true);
    const localHeaderOffset = view.getUint32(offset + 42, true);
    const name = decodeBytes(data.slice(offset + 46, offset + 46 + fileNameLength));
    const localNameLength = view.getUint16(localHeaderOffset + 26, true);
    const localExtraLength = view.getUint16(localHeaderOffset + 28, true);
    const dataStart = localHeaderOffset + 30 + localNameLength + localExtraLength;
    const compressedData = data.slice(dataStart, dataStart + compressedSize);

    entries.set(name, { name, method, data: compressedData });
    offset += 46 + fileNameLength + extraLength + commentLength;
  }

  return entries;
}

async function readTextEntry(entries: Map<string, ZipEntry>, path: string) {
  const entry = entries.get(path);
  if (!entry) {
    throw new Error(`${path} 파일을 Excel 안에서 찾지 못했습니다.`);
  }

  return decodeZipEntry(entry);
}

async function decodeZipEntry(entry: ZipEntry) {
  if (entry.method === 0) return decodeBytes(entry.data);

  if (entry.method === 8) {
    if (typeof DecompressionStream === "undefined") {
      throw new Error("이 브라우저는 xlsx 압축 해제를 지원하지 않습니다. 최신 Chrome 또는 Safari에서 다시 시도해주세요.");
    }

    const stream = new Blob([uint8ToArrayBuffer(entry.data)]).stream().pipeThrough(new DecompressionStream("deflate-raw"));
    const buffer = await new Response(stream).arrayBuffer();
    return decodeBytes(new Uint8Array(buffer));
  }

  throw new Error(`지원하지 않는 Excel 압축 방식입니다. method=${entry.method}`);
}

function findEndOfCentralDirectory(view: DataView) {
  for (let offset = view.byteLength - 22; offset >= 0; offset -= 1) {
    if (view.getUint32(offset, true) === 0x06054b50) {
      return offset;
    }
  }

  throw new Error("xlsx 파일 구조를 찾지 못했습니다.");
}

function createZip(files: Record<string, string>) {
  const encoder = new TextEncoder();
  const parts: Uint8Array[] = [];
  const centralParts: Uint8Array[] = [];
  let offset = 0;

  Object.entries(files).forEach(([name, content]) => {
    const nameBytes = encoder.encode(name);
    const dataBytes = encoder.encode(content);
    const crc = crc32(dataBytes);
    const local = new Uint8Array(30 + nameBytes.length);
    const localView = new DataView(local.buffer);
    localView.setUint32(0, 0x04034b50, true);
    localView.setUint16(4, 20, true);
    localView.setUint16(6, 0, true);
    localView.setUint16(8, 0, true);
    localView.setUint32(14, crc, true);
    localView.setUint32(18, dataBytes.length, true);
    localView.setUint32(22, dataBytes.length, true);
    localView.setUint16(26, nameBytes.length, true);
    local.set(nameBytes, 30);
    parts.push(local, dataBytes);

    const central = new Uint8Array(46 + nameBytes.length);
    const centralView = new DataView(central.buffer);
    centralView.setUint32(0, 0x02014b50, true);
    centralView.setUint16(4, 20, true);
    centralView.setUint16(6, 20, true);
    centralView.setUint16(8, 0, true);
    centralView.setUint16(10, 0, true);
    centralView.setUint32(16, crc, true);
    centralView.setUint32(20, dataBytes.length, true);
    centralView.setUint32(24, dataBytes.length, true);
    centralView.setUint16(28, nameBytes.length, true);
    centralView.setUint32(42, offset, true);
    central.set(nameBytes, 46);
    centralParts.push(central);
    offset += local.length + dataBytes.length;
  });

  const centralSize = centralParts.reduce((sum, part) => sum + part.length, 0);
  const end = new Uint8Array(22);
  const endView = new DataView(end.buffer);
  endView.setUint32(0, 0x06054b50, true);
  endView.setUint16(8, Object.keys(files).length, true);
  endView.setUint16(10, Object.keys(files).length, true);
  endView.setUint32(12, centralSize, true);
  endView.setUint32(16, offset, true);

  return new Blob([...parts, ...centralParts, end].map(uint8ToArrayBuffer));
}

function assignShotDraftText(draft: DailyPlanShotDraft, key: keyof DailyPlanShotDraft | "skip", value: string) {
  if (key === "skip" || key === "orderIndex" || key === "status") return;
  draft[key] = value;
}

function buildWorksheetXml(model: WorksheetModel) {
  const columnWidths = [11, 11, 9, 12, 12, 9, 11, 11, 16, 16, 10, 10, 14, 14, 14, 14];
  const sheetRows = model.cells
    .map((row, rowIndex) => {
      const cells = row
        .map((cell, columnIndex) => {
          const ref = `${indexToColumnLetters(columnIndex)}${rowIndex + 1}`;
          const style = ` s="${cell.style ?? 1}"`;
          return `<c r="${ref}" t="inlineStr"${style}><is><t>${escapeXml(cell.value)}</t></is></c>`;
        })
        .join("");
      const height = rowIndex === 0 ? " ht=\"28\" customHeight=\"1\"" : rowIndex >= 22 && rowIndex <= 26 ? " ht=\"28\" customHeight=\"1\"" : "";
      return `<row r="${rowIndex + 1}"${height}>${cells}</row>`;
    })
    .join("");
  const mergeXml = model.merges.length > 0 ? `<mergeCells count="${model.merges.length}">${model.merges.map((ref) => `<mergeCell ref="${ref}"/>`).join("")}</mergeCells>` : "";

  return `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<worksheet xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main" xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships">
  <sheetViews><sheetView workbookViewId="0" showGridLines="0"/></sheetViews>
  <cols>${columnWidths.map((width, index) => `<col min="${index + 1}" max="${index + 1}" width="${width}" customWidth="1"/>`).join("")}</cols>
  <sheetData>${sheetRows}</sheetData>
  ${mergeXml}
  <pageMargins left="0.25" right="0.25" top="0.25" bottom="0.25" header="0" footer="0"/>
  <pageSetup paperSize="9" orientation="landscape" fitToWidth="1" fitToHeight="1"/>
</worksheet>`;
}

function buildContentTypesXml() {
  return `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types">
  <Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/>
  <Default Extension="xml" ContentType="application/xml"/>
  <Override PartName="/docProps/app.xml" ContentType="application/vnd.openxmlformats-officedocument.extended-properties+xml"/>
  <Override PartName="/docProps/core.xml" ContentType="application/vnd.openxmlformats-package.core-properties+xml"/>
  <Override PartName="/xl/workbook.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.sheet.main+xml"/>
  <Override PartName="/xl/worksheets/sheet1.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.worksheet+xml"/>
  <Override PartName="/xl/styles.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.styles+xml"/>
</Types>`;
}

function buildRootRelsXml() {
  return `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">
  <Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/officeDocument" Target="xl/workbook.xml"/>
  <Relationship Id="rId2" Type="http://schemas.openxmlformats.org/package/2006/relationships/metadata/core-properties" Target="docProps/core.xml"/>
  <Relationship Id="rId3" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/extended-properties" Target="docProps/app.xml"/>
</Relationships>`;
}

function buildWorkbookXml() {
  return `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<workbook xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main" xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships">
  <sheets><sheet name="일촬표" sheetId="1" r:id="rId1"/></sheets>
</workbook>`;
}

function buildWorkbookRelsXml() {
  return `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">
  <Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/worksheet" Target="worksheets/sheet1.xml"/>
  <Relationship Id="rId2" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/styles" Target="styles.xml"/>
</Relationships>`;
}

function buildStylesXml() {
  return `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<styleSheet xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main">
  <fonts count="3">
    <font><sz val="9"/><name val="Arial"/></font>
    <font><b/><sz val="9"/><name val="Arial"/></font>
    <font><b/><sz val="18"/><name val="Arial"/></font>
  </fonts>
  <fills count="4">
    <fill><patternFill patternType="none"/></fill>
    <fill><patternFill patternType="gray125"/></fill>
    <fill><patternFill patternType="solid"><fgColor rgb="FFD9D9D9"/><bgColor indexed="64"/></patternFill></fill>
    <fill><patternFill patternType="solid"><fgColor rgb="FFFFF2CC"/><bgColor indexed="64"/></patternFill></fill>
  </fills>
  <borders count="2">
    <border><left/><right/><top/><bottom/><diagonal/></border>
    <border>
      <left style="thin"><color rgb="FF000000"/></left>
      <right style="thin"><color rgb="FF000000"/></right>
      <top style="thin"><color rgb="FF000000"/></top>
      <bottom style="thin"><color rgb="FF000000"/></bottom>
      <diagonal/>
    </border>
  </borders>
  <cellStyleXfs count="1"><xf numFmtId="0" fontId="0" fillId="0" borderId="0"/></cellStyleXfs>
  <cellXfs count="6">
    <xf numFmtId="0" fontId="0" fillId="0" borderId="0" xfId="0"/>
    <xf numFmtId="0" fontId="0" fillId="0" borderId="1" xfId="0" applyBorder="1" applyAlignment="1"><alignment horizontal="center" vertical="center" wrapText="1"/></xf>
    <xf numFmtId="0" fontId="1" fillId="2" borderId="1" xfId="0" applyFill="1" applyBorder="1" applyAlignment="1"><alignment horizontal="center" vertical="center" wrapText="1"/></xf>
    <xf numFmtId="0" fontId="2" fillId="0" borderId="1" xfId="0" applyBorder="1" applyAlignment="1"><alignment horizontal="center" vertical="center" wrapText="1"/></xf>
    <xf numFmtId="0" fontId="1" fillId="0" borderId="1" xfId="0" applyBorder="1" applyAlignment="1"><alignment horizontal="center" vertical="center" wrapText="1"/></xf>
    <xf numFmtId="0" fontId="1" fillId="3" borderId="1" xfId="0" applyFill="1" applyBorder="1" applyAlignment="1"><alignment horizontal="center" vertical="center" wrapText="1"/></xf>
  </cellXfs>
</styleSheet>`;
}

function buildAppXml() {
  return `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<Properties xmlns="http://schemas.openxmlformats.org/officeDocument/2006/extended-properties"><Application>오늘의 보드</Application></Properties>`;
}

function buildCoreXml() {
  return `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<cp:coreProperties xmlns:cp="http://schemas.openxmlformats.org/package/2006/metadata/core-properties" xmlns:dc="http://purl.org/dc/elements/1.1/" xmlns:dcterms="http://purl.org/dc/terms/">
  <dc:creator>오늘의 보드</dc:creator><dcterms:created xsi:type="dcterms:W3CDTF" xmlns:xsi="http://www.w3.org/2001/XMLSchema-instance">${new Date().toISOString()}</dcterms:created>
</cp:coreProperties>`;
}

function normalizeShotLike(shot: DailyPlanShotDraft | DailyPlanShot): DailyPlanShotDraft {
  return {
    orderIndex: shot.orderIndex,
    startTime: shot.startTime,
    endTime: shot.endTime,
    sceneNumber: shot.sceneNumber,
    sceneTitle: shot.sceneTitle ?? "",
    locationId: shot.locationId ?? "",
    locationName: shot.locationName ?? shot.subLocation ?? "",
    cutNumber: shot.cutNumber,
    subject: shot.subject,
    subLocation: shot.subLocation,
    dayNight: shot.dayNight,
    liveSync: shot.liveSync,
    cutType: shot.cutType,
    storyDay: shot.storyDay,
    description: shot.description,
    props: shot.props,
    costumeMakeup: shot.costumeMakeup,
    sceneMemo: shot.sceneMemo ?? "",
    memo: shot.memo,
    status: shot.status
  };
}

function parseXml(xml: string) {
  return new DOMParser().parseFromString(xml, "application/xml");
}

function byLocalName(root: ParentNode, name: string) {
  return Array.from(root.querySelectorAll("*")).filter((node) => node.localName === name) as Element[];
}

function columnLettersToIndex(value: string) {
  return value.split("").reduce((sum, letter) => sum * 26 + letter.charCodeAt(0) - 64, 0) - 1;
}

function indexToColumnLetters(index: number) {
  let value = "";
  let current = index + 1;

  while (current > 0) {
    const remainder = (current - 1) % 26;
    value = String.fromCharCode(65 + remainder) + value;
    current = Math.floor((current - 1) / 26);
  }

  return value;
}

function normalizeLabel(value: string) {
  return String(value ?? "")
    .replace(/\s+/g, "")
    .replace(/[()]/g, "")
    .trim();
}

function decodeBytes(bytes: Uint8Array) {
  return new TextDecoder("utf-8").decode(bytes);
}

function escapeXml(value: string) {
  return String(value ?? "")
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}

function sanitizeFileName(value: string) {
  return value.replace(/[\\/:*?"<>|]/g, "_").trim() || "일촬표";
}

function formatDateForPreview(value: string) {
  return value ? value.replace(/-/g, ".") : "";
}

function downloadBlob(blob: Blob, fileName: string) {
  const url = URL.createObjectURL(blob);
  const anchor = document.createElement("a");
  anchor.href = url;
  anchor.download = fileName;
  anchor.click();
  URL.revokeObjectURL(url);
}

function uint8ToArrayBuffer(value: Uint8Array) {
  return value.buffer.slice(value.byteOffset, value.byteOffset + value.byteLength) as ArrayBuffer;
}

function crc32(bytes: Uint8Array) {
  let crc = 0xffffffff;

  for (const byte of bytes) {
    crc ^= byte;
    for (let index = 0; index < 8; index += 1) {
      crc = (crc >>> 1) ^ (0xedb88320 & -(crc & 1));
    }
  }

  return (crc ^ 0xffffffff) >>> 0;
}
