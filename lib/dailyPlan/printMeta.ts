import { formatKoreanPhoneNumber } from "@/lib/formatKoreanPhoneNumber";
import { resolveKoreanWeatherRegion } from "@/lib/koreanWeatherRegions";
import { MAX_SCENE_CUT_COUNT, normalizeSceneCutCount } from "@/lib/sceneCutCount";

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

/**
 * 씬리스트에서 가져온 값의 저장 시점 스냅샷입니다.
 *
 * 연결된 씬이 나중에 삭제되거나 조회되지 않아도 일촬표 행 자체는 이 값과
 * rowSnapshot으로 복원할 수 있습니다. current source가 존재할 때는 이
 * 스냅샷보다 최신 씬리스트 값을 우선합니다.
 */
export type DailyPlanTimetableSceneSourceSnapshot = {
  sceneNumber: string;
  sceneContent: string;
  characters: string;
  totalCuts: number | null;
};

export type DailyPlanTimetableSceneCutSnapshot = {
  id: string;
  cutNumber: string;
  description: string;
  memo: string;
};

/**
 * daily_plan_shots가 한 건도 생기지 않는 0컷 행까지 다시 만들기 위한
 * 일촬표 로컬 행의 최종(effective) 스냅샷입니다.
 */
export type DailyPlanTimetableSceneRowSnapshot = {
  sceneNumber: string;
  sceneTitle: string;
  description: string;
  startTime: string;
  endTime: string;
  runtimeMinutes: number | null;
  runtime: string;
  locationId: string;
  locationName: string;
  dayNight: string;
  storyDay: string;
  shootingOrder: string;
  notes: string;
  subject: string;
  props: string;
  costumeMakeup: string;
  sceneMemo: string;
  totalCuts: number | null;
  cuts: DailyPlanTimetableSceneCutSnapshot[];
};

/**
 * 씬별 내용/등장인물/총 컷수 override는 프로퍼티 존재 여부로 판정합니다.
 * 프로퍼티가 없으면 씬리스트 값을 사용하고, 빈 문자열과 숫자 0은 명시적인
 * 일촬표 override로 보존합니다.
 */
export type DailyPlanTimetableSceneMeta = {
  version: 1;
  rowId: string;
  sourceSceneId: string | null;
  sourceSnapshot: DailyPlanTimetableSceneSourceSnapshot | null;
  sceneContentOverride?: string;
  charactersOverride?: string;
  /** 등장인물 selector에서 문자열 대신 사용하는 안정적인 CallSheetPerson id입니다. */
  characterIdsOverride?: string[];
  totalCutsOverride?: number;
  rowSnapshot: DailyPlanTimetableSceneRowSnapshot;
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
  /** 순서를 유지하며 0컷 씬 행까지 저장하는 버전형 TIME TABLE 메타데이터입니다. */
  timetableScenes: DailyPlanTimetableSceneMeta[];
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
    timetableScenes: [],
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
    timetableScenes: normalizeDailyPlanTimetableScenes(meta.timetableScenes),
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

/**
 * 저장 데이터가 훼손되어도 편집 화면 전체가 실패하지 않도록 각 행을
 * 독립적으로 정규화합니다. 배열 순서는 일촬표 행 순서이므로 변경하지 않습니다.
 */
export function normalizeDailyPlanTimetableScenes(
  value: unknown
): DailyPlanTimetableSceneMeta[] {
  if (!Array.isArray(value)) return [];

  const usedRowIds = new Set<string>();
  return value
    .map((candidate, index) => normalizeDailyPlanTimetableScene(candidate, index))
    .filter((candidate): candidate is DailyPlanTimetableSceneMeta => candidate !== null)
    .map((candidate, index) => ({
      ...candidate,
      rowId: createUniqueSnapshotId(
        candidate.rowId || `daily_scene_${index}`,
        usedRowIds
      )
    }));
}

/**
 * 최신 씬리스트 데이터와 저장된 일촬표 override를 합쳐 화면/미리보기/PDF에
 * 사용할 세 필드의 유효값을 계산합니다.
 *
 * currentSource가 null이면 연결된 원본이 삭제된 상태이므로 저장된 최종
 * rowSnapshot을 fallback으로 사용합니다. undefined도 아직 원본을 조회하지
 * 않은 상태로 보고 같은 fallback을 사용합니다.
 */
export function resolveDailyPlanTimetableSceneValues(
  meta: DailyPlanTimetableSceneMeta,
  currentSource?: DailyPlanTimetableSceneSourceSnapshot | null
) {
  const hasCurrentSource = currentSource !== undefined && currentSource !== null;
  const hasContentOverride = Object.prototype.hasOwnProperty.call(meta, "sceneContentOverride");
  const hasCharactersOverride = Object.prototype.hasOwnProperty.call(meta, "charactersOverride");
  const hasTotalCutsOverride = Object.prototype.hasOwnProperty.call(meta, "totalCutsOverride");

  return {
    sceneContent: hasContentOverride
      ? meta.sceneContentOverride ?? ""
      : hasCurrentSource
        ? currentSource.sceneContent
        : meta.rowSnapshot.description,
    characters: hasCharactersOverride
      ? meta.charactersOverride ?? ""
      : hasCurrentSource
        ? currentSource.characters
        : meta.rowSnapshot.subject,
    totalCuts: hasTotalCutsOverride
      ? meta.totalCutsOverride ?? null
      : hasCurrentSource
        ? currentSource.totalCuts
        : meta.rowSnapshot.totalCuts
  };
}

function normalizeDailyPlanTimetableScene(
  value: unknown,
  index: number
): DailyPlanTimetableSceneMeta | null {
  if (!isUnknownRecord(value) || value.version !== 1 || !isUnknownRecord(value.rowSnapshot)) {
    return null;
  }

  const rowSnapshot = normalizeDailyPlanTimetableSceneRowSnapshot(value.rowSnapshot, index);
  if (!rowSnapshot) return null;

  const normalized: DailyPlanTimetableSceneMeta = {
    version: 1,
    rowId: normalizeMetaText(value.rowId) || `daily_scene_${index}`,
    sourceSceneId: normalizeNullableMetaText(value.sourceSceneId),
    sourceSnapshot: normalizeDailyPlanTimetableSceneSourceSnapshot(value.sourceSnapshot),
    rowSnapshot
  };

  // 값의 truthiness가 아니라 프로퍼티 존재 여부를 보존해야 ""와 0이
  // 명시적인 override로 유지됩니다.
  if (
    Object.prototype.hasOwnProperty.call(value, "sceneContentOverride")
    && typeof value.sceneContentOverride === "string"
  ) {
    normalized.sceneContentOverride = value.sceneContentOverride;
  }
  if (
    Object.prototype.hasOwnProperty.call(value, "charactersOverride")
    && typeof value.charactersOverride === "string"
  ) {
    normalized.charactersOverride = value.charactersOverride;
  }
  if (
    Object.prototype.hasOwnProperty.call(value, "characterIdsOverride")
    && Array.isArray(value.characterIdsOverride)
  ) {
    normalized.characterIdsOverride = Array.from(new Set(
      value.characterIdsOverride
        .map((id) => normalizeMetaText(id))
        .filter(Boolean)
    )).slice(0, 200);
  }
  if (Object.prototype.hasOwnProperty.call(value, "totalCutsOverride")) {
    const totalCutsOverride = normalizeSceneCutCount(value.totalCutsOverride);
    if (totalCutsOverride !== null) normalized.totalCutsOverride = totalCutsOverride;
  }

  return normalized;
}

function normalizeDailyPlanTimetableSceneSourceSnapshot(
  value: unknown
): DailyPlanTimetableSceneSourceSnapshot | null {
  if (!isUnknownRecord(value)) return null;
  return {
    sceneNumber: normalizeMetaText(value.sceneNumber),
    sceneContent: normalizeMetaText(value.sceneContent),
    characters: normalizeMetaText(value.characters),
    totalCuts: normalizeSceneCutCount(value.totalCuts)
  };
}

function normalizeDailyPlanTimetableSceneRowSnapshot(
  value: Record<string, unknown>,
  index: number
): DailyPlanTimetableSceneRowSnapshot | null {
  const usedCutIds = new Set<string>();
  const cuts = Array.isArray(value.cuts)
    ? value.cuts
      .slice(0, MAX_SCENE_CUT_COUNT)
      .map((cut, cutIndex) => normalizeDailyPlanTimetableSceneCutSnapshot(cut, index, cutIndex))
      .filter((cut): cut is DailyPlanTimetableSceneCutSnapshot => cut !== null)
      .map((cut, cutIndex) => ({
        ...cut,
        id: createUniqueSnapshotId(
          cut.id || `daily_scene_${index}_cut_${cutIndex}`,
          usedCutIds
        )
      }))
    : [];

  return {
    sceneNumber: normalizeMetaText(value.sceneNumber),
    sceneTitle: normalizeMetaText(value.sceneTitle),
    description: normalizeMetaText(value.description),
    startTime: normalizeMetaText(value.startTime),
    endTime: normalizeMetaText(value.endTime),
    runtimeMinutes: normalizeNonNegativeInteger(value.runtimeMinutes),
    runtime: normalizeMetaText(value.runtime),
    locationId: normalizeMetaText(value.locationId),
    locationName: normalizeMetaText(value.locationName),
    dayNight: normalizeMetaText(value.dayNight),
    storyDay: normalizeMetaText(value.storyDay),
    shootingOrder: normalizeMetaText(value.shootingOrder),
    notes: normalizeMetaText(value.notes),
    subject: normalizeMetaText(value.subject),
    props: normalizeMetaText(value.props),
    costumeMakeup: normalizeMetaText(value.costumeMakeup),
    sceneMemo: normalizeMetaText(value.sceneMemo),
    totalCuts: normalizeSceneCutCount(value.totalCuts),
    cuts
  };
}

function normalizeDailyPlanTimetableSceneCutSnapshot(
  value: unknown,
  sceneIndex: number,
  cutIndex: number
): DailyPlanTimetableSceneCutSnapshot | null {
  if (!isUnknownRecord(value)) return null;
  return {
    id: normalizeMetaText(value.id) || `daily_scene_${sceneIndex}_cut_${cutIndex}`,
    cutNumber: normalizeMetaText(value.cutNumber),
    description: normalizeMetaText(value.description),
    memo: normalizeMetaText(value.memo)
  };
}

function normalizeNonNegativeInteger(value: unknown): number | null {
  if (value === null || value === undefined || value === "") return null;
  const normalized = typeof value === "number" ? value : Number(String(value).trim());
  if (!Number.isSafeInteger(normalized) || normalized < 0) return null;
  return normalized;
}

function createUniqueSnapshotId(value: string, usedIds: Set<string>) {
  let candidate = value;
  let suffix = 2;
  while (usedIds.has(candidate)) {
    candidate = `${value}_${suffix}`;
    suffix += 1;
  }
  usedIds.add(candidate);
  return candidate;
}

function normalizeNullableMetaText(value: unknown): string | null {
  if (value === null || value === undefined) return null;
  return normalizeMetaText(value) || null;
}

function normalizeMetaText(value: unknown) {
  return typeof value === "string" ? value : value == null ? "" : String(value);
}

function isUnknownRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
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
