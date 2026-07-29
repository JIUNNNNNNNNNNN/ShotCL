import { formatKoreanPhoneNumber } from "@/lib/formatKoreanPhoneNumber";
import { resolveKoreanWeatherRegion } from "@/lib/koreanWeatherRegions";

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
  name: string;
  total: string;
  /** 현재 스탭리스트에서 집계한 자동 인원입니다. */
  autoTotal?: string;
  /** null이면 자동값을 사용하고, "0"을 포함한 문자열 값이면 일촬표 수동값입니다. */
  totalOverride?: string | null;
  contact?: string;
  callTime: string;
  callLocation: string;
  notes: string;
};

export type DailyPlanMainStaffRow = {
  id: string;
  role: string;
  name: string;
  contact: string;
};

export type DailyPlanPrintMeta = {
  day: string;
  directorContact: string;
  assistantDirectorContact: string;
  producerContact: string;
  /** 화면·미리보기·PDF에 사용하는 최종 총인원입니다. */
  totalCrew: string;
  /** 부서별 유효 인원과 현재 일촬표 배우로 계산한 자동 총인원입니다. */
  autoTotalCrew?: string;
  /** null이면 자동값, "0"을 포함한 문자열 값이면 해당 일촬표의 수동 총인원입니다. */
  totalCrewOverride?: string | null;
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
  mainStaff: DailyPlanMainStaffRow[];
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
    autoTotalCrew: "",
    totalCrewOverride: null,
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
    mainStaff: [],
    starring: [createBlankCallSheetPerson()],
    teams: []
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
    const source = {
      ...fallback,
      ...parsed,
      memoText
    };
    // 과거 metadata에는 override 필드가 없으므로, fallback의 null이
    // "명시적인 자동 모드"로 오인되지 않게 원래 필드 존재 여부를 보존합니다.
    if (!Object.prototype.hasOwnProperty.call(parsed, "totalCrewOverride")) {
      delete source.totalCrewOverride;
    }
    if (!Object.prototype.hasOwnProperty.call(parsed, "autoTotalCrew")) {
      delete source.autoTotalCrew;
    }
    return normalizeDailyPlanPrintMeta(source);
  } catch {
    return { ...fallback, memoText: raw };
  }
}

export function encodeDailyPlanMemo(meta: DailyPlanPrintMeta) {
  const { memoText, ...persisted } = normalizeDailyPlanPrintMeta(meta);
  return `${META_START}\n${JSON.stringify(persisted)}\n${META_END}\n${memoText ?? ""}`;
}

export function normalizeDailyPlanPrintMeta(meta: DailyPlanPrintMeta): DailyPlanPrintMeta {
  const weatherRegion = normalizeWeatherRegion(meta);
  const totalCrew = normalizeTotalCrew(meta);
  return {
    day: meta.day ?? "",
    directorContact: formatKoreanPhoneNumber(meta.directorContact ?? ""),
    assistantDirectorContact: formatKoreanPhoneNumber(meta.assistantDirectorContact ?? ""),
    producerContact: formatKoreanPhoneNumber(meta.producerContact ?? ""),
    totalCrew: totalCrew.effective,
    autoTotalCrew: totalCrew.automatic,
    totalCrewOverride: totalCrew.override,
    weatherRegion: weatherRegion.label,
    weatherProvince: weatherRegion.canonicalRegion,
    weatherDistrict: weatherRegion.district,
    sunrise: meta.sunrise ?? "",
    sunset: meta.sunset ?? "",
    weather: meta.weather ?? "",
    minTemperature: meta.minTemperature ?? "",
    maxTemperature: meta.maxTemperature ?? "",
    rainProbability: meta.rainProbability ?? "",
    timetableRowOrder: normalizeTimetableRowOrder(meta.timetableRowOrder),
    memoText: meta.memoText ?? "",
    mainStaff: normalizeMainStaff(meta.mainStaff),
    starring: normalizePeople(meta.starring),
    teams: normalizeTeams(meta.teams)
  };
}

function normalizeTotalCrew(meta: DailyPlanPrintMeta) {
  const legacyTotal = normalizeDailyPlanCount(meta.totalCrew);
  const storedAutomatic = normalizeDailyPlanCount(meta.autoTotalCrew);
  const hasExplicitOverride = Object.prototype.hasOwnProperty.call(meta, "totalCrewOverride");
  const hasModernDepartmentCounts = Array.isArray(meta.teams) && meta.teams.some(
    (row) => Object.prototype.hasOwnProperty.call(row, "totalOverride")
  );
  const override = hasExplicitOverride
    ? normalizeDailyPlanCount(meta.totalCrewOverride)
    : hasModernDepartmentCounts
      ? null
      : legacyTotal;
  const automatic = storedAutomatic
    ?? (hasModernDepartmentCounts || hasExplicitOverride ? legacyTotal : null)
    ?? "";

  return {
    automatic,
    override,
    effective: override ?? automatic
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

function normalizeMainStaff(rows: DailyPlanMainStaffRow[] | undefined) {
  if (!Array.isArray(rows)) return [];
  return rows.slice(0, 200).map((row, index) => ({
    id: String(row?.id ?? "") || `daily_main_staff_${index}`,
    role: String(row?.role ?? "").trim().slice(0, 100),
    name: String(row?.name ?? "").trim().slice(0, 100),
    contact: formatKoreanPhoneNumber(row?.contact ?? "")
  })).filter((row) => row.role || row.name);
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
  const next = (Array.isArray(rows) ? rows : []).map((row) => {
    const hasExplicitOverride = Object.prototype.hasOwnProperty.call(row, "totalOverride");
    const legacyTotal = normalizeDailyPlanCount(row.total);
    const totalOverride = hasExplicitOverride
      ? normalizeDailyPlanCount(row.totalOverride)
      : legacyTotal;
    const autoTotal = normalizeDailyPlanCount(row.autoTotal)
      ?? (hasExplicitOverride && totalOverride === null ? legacyTotal : null)
      ?? "";
    const total = totalOverride ?? autoTotal;

    return {
      id: row.id || createMetaId("team"),
      team: row.team ?? "",
      name: row.name ?? "",
      total,
      autoTotal,
      totalOverride,
      contact: formatKoreanPhoneNumber(row.contact ?? ""),
      callTime: row.callTime ?? "",
      callLocation: row.callLocation ?? "",
      notes: row.notes ?? ""
    };
  });

  return next;
}

/** 0을 포함한 0 이상의 정수만 인원 값으로 정규화합니다. */
export function normalizeDailyPlanCount(value: unknown): string | null {
  const normalized = String(value ?? "").trim();
  if (!/^\d+$/.test(normalized)) return null;
  const count = Number(normalized);
  if (!Number.isSafeInteger(count) || count < 0) return null;
  return String(count);
}

export function formatDailyPlanWeatherSummary(meta: Pick<DailyPlanPrintMeta, "weatherRegion" | "weather">) {
  const region = resolveKoreanWeatherRegion(meta.weatherRegion)?.label
    ?? String(meta.weatherRegion ?? "").trim();
  const weather = String(meta.weather ?? "").trim();
  if (!region) return weather;
  if (!weather || weather === region) return region;

  const weatherRegion = resolveKoreanWeatherRegion(weather);
  if (weatherRegion?.label === region) {
    const prefix = [
      weatherRegion.canonicalRegion,
      weatherRegion.weatherQuery,
      ...weatherRegion.aliases,
      weatherRegion.label
    ]
      .sort((left, right) => right.length - left.length)
      .find((candidate) => weather.toLocaleLowerCase("ko-KR").startsWith(
        candidate.toLocaleLowerCase("ko-KR")
      ));
    const detail = prefix
      ? weather.slice(prefix.length).replace(/^[\s·,:/-]+/, "").trim()
      : "";
    return [region, detail].filter(Boolean).join(" · ");
  }
  return `${region} · ${weather}`;
}

function normalizeWeatherRegion(meta: DailyPlanPrintMeta) {
  const sourceLabel = String(meta.weatherRegion ?? "").trim();
  const sourceProvince = String(meta.weatherProvince ?? "").trim();
  const sourceDistrict = String(meta.weatherDistrict ?? "").trim();
  const isLegacyProvinceDistrictSelection = Boolean(
    sourceProvince
    && (
      !sourceLabel
      || sourceLabel === sourceDistrict
      || sourceLabel === [sourceProvince, sourceDistrict].filter(Boolean).join(" ")
    )
  );
  const resolved = resolveKoreanWeatherRegion(sourceLabel)
    ?? (isLegacyProvinceDistrictSelection
      ? resolveKoreanWeatherRegion([sourceProvince, sourceDistrict].filter(Boolean).join(" "))
      : null);

  if (!resolved) {
    return {
      label: sourceLabel,
      canonicalRegion: sourceProvince,
      district: sourceDistrict
    };
  }

  return {
    label: resolved.label,
    canonicalRegion: resolved.canonicalRegion,
    district: ""
  };
}

function createMetaId(prefix: string) {
  return `${prefix}_${Date.now()}_${Math.random().toString(16).slice(2)}`;
}
