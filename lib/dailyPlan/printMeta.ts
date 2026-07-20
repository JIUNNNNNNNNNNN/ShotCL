import { formatKoreanPhoneNumber } from "@/lib/formatKoreanPhoneNumber";

export type DailyPlanTimetableRowType = "scene" | "event";

export type CallSheetPerson = {
  id: string;
  name: string;
  role: string;
  contact?: string;
  callTime: string;
  callLocation: string;
  notes: string;
};

export type TeamCallSheetRow = {
  id: string;
  team: string;
  total: string;
  contact?: string;
  callTime: string;
  callLocation: string;
  notes: string;
};

export type DailyPlanPrintMeta = {
  day: string;
  directorContact: string;
  assistantDirectorContact: string;
  producerContact: string;
  totalCrew: string;
  weatherRegion: string;
  weatherProvince: string;
  weatherDistrict: string;
  sunrise: string;
  sunset: string;
  weather: string;
  minTemperature: string;
  maxTemperature: string;
  rainProbability: string;
  timetableRowOrder: DailyPlanTimetableRowType[];
  memoText: string;
  starring: CallSheetPerson[];
  teams: TeamCallSheetRow[];
};

const META_START = "[[TODAY_BOARD_DAILY_PLAN_PRINT_META_V1]]";
const META_END = "[[/TODAY_BOARD_DAILY_PLAN_PRINT_META_V1]]";

export function createDefaultDailyPlanPrintMeta(): DailyPlanPrintMeta {
  return {
    day: "1",
    directorContact: "",
    assistantDirectorContact: "",
    producerContact: "",
    totalCrew: "",
    weatherRegion: "",
    weatherProvince: "",
    weatherDistrict: "",
    sunrise: "",
    sunset: "",
    weather: "",
    minTemperature: "",
    maxTemperature: "",
    rainProbability: "",
    timetableRowOrder: [],
    memoText: "",
    starring: [createBlankCallSheetPerson()],
    teams: createDefaultTeamRows()
  };
}

export function createBlankCallSheetPerson(): CallSheetPerson {
  return {
    id: createMetaId("star"),
    name: "",
    role: "",
    callTime: "",
    callLocation: "",
    notes: ""
  };
}

export function createBlankTeamCallSheetRow(team = ""): TeamCallSheetRow {
  return {
    id: createMetaId("team"),
    team,
    total: "",
    callTime: "",
    callLocation: "",
    notes: ""
  };
}

export function decodeDailyPlanMemo(value: string): DailyPlanPrintMeta {
  const fallback = createDefaultDailyPlanPrintMeta();
  const raw = String(value ?? "");

  if (!raw.startsWith(META_START)) {
    return { ...fallback, memoText: raw };
  }

  const endIndex = raw.indexOf(META_END);
  if (endIndex < 0) {
    return { ...fallback, memoText: raw };
  }

  const jsonText = raw.slice(META_START.length, endIndex).trim();
  const memoText = raw.slice(endIndex + META_END.length).replace(/^\n+/, "");

  try {
    const parsed = JSON.parse(jsonText) as Partial<DailyPlanPrintMeta>;
    return normalizeDailyPlanPrintMeta({
      ...fallback,
      ...parsed,
      memoText
    });
  } catch {
    return { ...fallback, memoText: raw };
  }
}

export function encodeDailyPlanMemo(meta: DailyPlanPrintMeta) {
  const { memoText, ...persisted } = normalizeDailyPlanPrintMeta(meta);
  return `${META_START}\n${JSON.stringify(persisted)}\n${META_END}\n${memoText ?? ""}`;
}

export function normalizeDailyPlanPrintMeta(meta: DailyPlanPrintMeta): DailyPlanPrintMeta {
  return {
    day: meta.day ?? "",
    directorContact: formatKoreanPhoneNumber(meta.directorContact ?? ""),
    assistantDirectorContact: formatKoreanPhoneNumber(meta.assistantDirectorContact ?? ""),
    producerContact: formatKoreanPhoneNumber(meta.producerContact ?? ""),
    totalCrew: meta.totalCrew ?? "",
    weatherRegion: meta.weatherRegion ?? "",
    weatherProvince: meta.weatherProvince ?? "",
    weatherDistrict: meta.weatherDistrict ?? "",
    sunrise: meta.sunrise ?? "",
    sunset: meta.sunset ?? "",
    weather: meta.weather ?? "",
    minTemperature: meta.minTemperature ?? "",
    maxTemperature: meta.maxTemperature ?? "",
    rainProbability: meta.rainProbability ?? "",
    timetableRowOrder: normalizeTimetableRowOrder(meta.timetableRowOrder),
    memoText: meta.memoText ?? "",
    starring: normalizePeople(meta.starring),
    teams: normalizeTeams(meta.teams)
  };
}

/** 저장된 타입 순서에 맞춰 씬과 기타 일정 배열을 하나의 TIME TABLE 순서로 합칩니다. */
export function mergeDailyPlanTimetableRows<TScene, TEvent>(
  sceneRows: TScene[],
  eventRows: TEvent[],
  order: DailyPlanTimetableRowType[] | undefined
): Array<TScene | TEvent> {
  const scenes = [...sceneRows];
  const events = [...eventRows];
  const merged: Array<TScene | TEvent> = [];

  normalizeTimetableRowOrder(order).forEach((type) => {
    const next = type === "scene" ? scenes.shift() : events.shift();
    if (next !== undefined) merged.push(next);
  });

  return [...merged, ...scenes, ...events];
}

function normalizeTimetableRowOrder(value: DailyPlanTimetableRowType[] | undefined) {
  if (!Array.isArray(value)) return [];
  return value.filter((item): item is DailyPlanTimetableRowType => item === "scene" || item === "event");
}

function normalizePeople(rows: CallSheetPerson[] | undefined) {
  const next = (Array.isArray(rows) ? rows : []).map((row) => ({
    id: row.id || createMetaId("star"),
    name: row.name ?? "",
    role: row.role ?? "",
    contact: formatKoreanPhoneNumber(row.contact ?? ""),
    callTime: row.callTime ?? "",
    callLocation: row.callLocation ?? "",
    notes: row.notes ?? ""
  }));

  return next.length > 0 ? next : [createBlankCallSheetPerson()];
}

function normalizeTeams(rows: TeamCallSheetRow[] | undefined) {
  const next = (Array.isArray(rows) ? rows : []).map((row) => ({
    id: row.id || createMetaId("team"),
    team: row.team ?? "",
    total: row.total ?? "",
    contact: formatKoreanPhoneNumber(row.contact ?? ""),
    callTime: row.callTime ?? "",
    callLocation: row.callLocation ?? "",
    notes: row.notes ?? ""
  }));

  return next.length > 0 ? next : createDefaultTeamRows();
}

function createDefaultTeamRows() {
  return ["연출", "제작", "촬영", "조명", "미술", "의상", "녹음", "데이터", "엔터", "보조 출연"].map(createBlankTeamCallSheetRow);
}

function createMetaId(prefix: string) {
  return `${prefix}_${Date.now()}_${Math.random().toString(16).slice(2)}`;
}
