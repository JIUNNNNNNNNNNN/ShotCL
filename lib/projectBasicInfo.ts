import type { ProjectActor, ProjectBasicInfo, ProjectMainStaffMember } from "@/lib/types";
import { isValidKoreanPhoneNumber, sanitizeKoreanPhoneDigits } from "@/lib/formatKoreanPhoneNumber";

const ISO_DATE_PATTERN = /^\d{4}-\d{2}-\d{2}$/;
export const MAX_DAILY_PLAN_MAIN_STAFF = 3;

export const emptyProjectBasicInfo: ProjectBasicInfo = {
  totalEpisodes: 1,
  shootingStartDate: "",
  shootingEndDate: "",
  mainStaff: [],
  actors: []
};

/** DB의 오래된 값이나 일부 필드가 비어 있는 JSON도 안전한 프로젝트 기본정보 형태로 읽습니다. */
export function normalizeProjectBasicInfo(value: unknown): ProjectBasicInfo {
  const source = isRecord(value) ? value : {};
  const parsedTotalEpisodes = Number(source.totalEpisodes);
  const totalEpisodes = Number.isInteger(parsedTotalEpisodes) && parsedTotalEpisodes >= 1
    ? parsedTotalEpisodes
    : 1;

  return {
    totalEpisodes,
    shootingStartDate: normalizeDate(source.shootingStartDate),
    shootingEndDate: normalizeDate(source.shootingEndDate),
    mainStaff: normalizeMainStaff(source.mainStaff, totalEpisodes),
    actors: normalizeActors(source.actors)
  };
}

/** 저장 API에서 프로젝트 기본정보의 필수값과 날짜 범위를 검증합니다. */
export function validateProjectBasicInfo(value: unknown) {
  if (!isRecord(value)) return { ok: false as const, error: "프로젝트 기본정보가 올바르지 않습니다." };

  const totalEpisodes = Number(value.totalEpisodes);
  if (!Number.isInteger(totalEpisodes) || totalEpisodes < 1) {
    return { ok: false as const, error: "총회차는 1 이상의 정수로 입력해주세요." };
  }

  const shootingStartDate = normalizeDate(value.shootingStartDate);
  const shootingEndDate = normalizeDate(value.shootingEndDate);
  if (!shootingStartDate || !shootingEndDate) {
    return { ok: false as const, error: "촬영 시작일과 종료일을 모두 입력해주세요." };
  }
  if (shootingStartDate > shootingEndDate) {
    return { ok: false as const, error: "촬영 시작일은 종료일보다 늦을 수 없습니다." };
  }

  const invalidEpisodeNumber = findInvalidMainStaffEpisodeNumber(value.mainStaff, totalEpisodes);
  if (invalidEpisodeNumber !== null) {
    return {
      ok: false as const,
      error: `참여 회차는 1~${totalEpisodes} 사이의 회차만 선택할 수 있습니다. (${invalidEpisodeNumber}회차)`
    };
  }

  const mainStaff = normalizeMainStaff(value.mainStaff, totalEpisodes);
  const episodeLimitViolation = getDailyPlanMainStaffEpisodeViolations(mainStaff, totalEpisodes)[0];
  if (episodeLimitViolation) {
    return {
      ok: false as const,
      error: `${episodeLimitViolation.episodeNumber}회차 일촬표 표시 인원이 ${episodeLimitViolation.members.length}명입니다. 최대 ${MAX_DAILY_PLAN_MAIN_STAFF}명까지 선택할 수 있습니다.`
    };
  }
  for (const member of mainStaff) {
    if (!isValidKoreanPhoneNumber(member.phone)) {
      return { ok: false as const, error: `${member.role || member.name || "메인 스태프"} 연락처 형식을 확인해주세요.` };
    }
  }

  const normalized = normalizeProjectBasicInfo(value);
  return {
    ok: true as const,
    value: {
      ...normalized,
      totalEpisodes,
      shootingStartDate,
      shootingEndDate
    }
  };
}

export function createBlankProjectMainStaffMember(index = 0): ProjectMainStaffMember {
  return {
    id: createStaffId(`new-${index}`),
    role: "",
    name: "",
    phone: "",
    includeInDailyPlan: true,
    episodeNumbers: null,
    sortOrder: index
  };
}

/**
 * 특정 회차에 참여하는 메인 스태프를 stable id와 저장 순서를 유지한 채 반환합니다.
 * 일촬표용 호출에서는 dailyPlanOnly를 true로 전달해 표시 여부까지 함께 판정합니다.
 */
export function getProjectMainStaffForEpisode(
  mainStaff: ProjectMainStaffMember[],
  episodeNumber: number,
  dailyPlanOnly = false
) {
  if (!Number.isInteger(episodeNumber) || episodeNumber < 1) return [];
  return [...mainStaff]
    .sort((left, right) => left.sortOrder - right.sortOrder)
    .filter((member) => (
      (!dailyPlanOnly || member.includeInDailyPlan)
      && mainStaffAppliesToEpisode(member, episodeNumber)
    ));
}

export function mainStaffAppliesToEpisode(
  member: Pick<ProjectMainStaffMember, "episodeNumbers">,
  episodeNumber: number
) {
  return member.episodeNumbers === null || member.episodeNumbers.includes(episodeNumber);
}

export type DailyPlanMainStaffEpisodeViolation = {
  episodeNumber: number;
  members: ProjectMainStaffMember[];
};

/** 일촬표 표시 최대 인원은 전체 인원이 아니라 각 회차별 적용 대상 수로 검증합니다. */
export function getDailyPlanMainStaffEpisodeViolations(
  mainStaff: ProjectMainStaffMember[],
  totalEpisodes: number
): DailyPlanMainStaffEpisodeViolation[] {
  if (!Number.isInteger(totalEpisodes) || totalEpisodes < 1) return [];
  return Array.from({ length: totalEpisodes }, (_, index) => index + 1)
    .map((episodeNumber) => ({
      episodeNumber,
      members: getProjectMainStaffForEpisode(mainStaff, episodeNumber, true)
    }))
    .filter(({ members }) => members.length > MAX_DAILY_PLAN_MAIN_STAFF);
}

/**
 * undefined를 포함한 구버전 값은 전체 회차(null)로 읽습니다.
 * 명시적인 빈 배열은 선택 없음으로 유지합니다.
 */
export function normalizeMainStaffEpisodeNumbers(
  value: unknown,
  totalEpisodes: number
): number[] | null {
  if (value === undefined || value === null || !Array.isArray(value)) return null;

  const normalized = [...new Set(
    value
      .map((episode) => Number(episode))
      .filter((episode) => (
        Number.isInteger(episode)
        && episode >= 1
        && episode <= totalEpisodes
      ))
  )].sort((left, right) => left - right);

  return totalEpisodes > 0 && normalized.length === totalEpisodes ? null : normalized;
}

export function formatMainStaffEpisodeSummary(
  episodeNumbers: number[] | null
) {
  if (episodeNumbers === null) return "전체 회차";
  if (episodeNumbers.length === 0) return "선택 없음";
  if (episodeNumbers.length <= 4) return `${episodeNumbers.join(", ")}회차`;
  return `${episodeNumbers.slice(0, 3).join(", ")} 외 ${episodeNumbers.length - 3}개 회차`;
}

function normalizeMainStaff(value: unknown, totalEpisodes: number): ProjectMainStaffMember[] {
  if (Array.isArray(value)) {
    return value.map((member, index) => normalizeStaffMember(member, index, totalEpisodes))
      .filter((member) => member.role || member.name || member.phone)
      .sort((left, right) => left.sortOrder - right.sortOrder)
      .map((member, index) => ({ ...member, sortOrder: index }));
  }

  const source = isRecord(value) ? value : {};
  const legacyRows = [
    legacyStaffMember(source, "director", "감독", ["directorName"], ["directorPhone"], totalEpisodes),
    legacyStaffMember(source, "assistantDirector", "조감독", ["assistantDirectorName", "adName"], ["assistantDirectorPhone", "adPhone"], totalEpisodes),
    legacyStaffMember(source, "producer", "제작", ["producerName", "productionName"], ["producerPhone", "productionPhone"], totalEpisodes)
  ].filter((member): member is ProjectMainStaffMember => member !== null);

  return legacyRows.map((member, index) => ({ ...member, sortOrder: index }));
}

function legacyStaffMember(
  source: Record<string, unknown>,
  key: string,
  fallbackRole: string,
  nameKeys: string[],
  phoneKeys: string[],
  totalEpisodes: number
) {
  const nestedValue = source[key];
  const nested = isRecord(nestedValue) ? nestedValue : {};
  const name = normalizeText(
    nested.name
      ?? (typeof nestedValue === "string" ? nestedValue : firstDefined(source, nameKeys)),
    100
  );
  const phone = sanitizeKoreanPhoneDigits(String(nested.phone ?? firstDefined(source, phoneKeys) ?? ""));
  const role = normalizeText(nested.role ?? nested.title, 100) || fallbackRole;
  if (!name && !phone) return null;
  return {
    id: normalizeText(nested.id, 120) || createStaffId(key),
    role,
    name,
    phone,
    includeInDailyPlan: nested.includeInDailyPlan !== false,
    episodeNumbers: normalizeMainStaffEpisodeNumbers(nested.episodeNumbers, totalEpisodes),
    sortOrder: 0
  } satisfies ProjectMainStaffMember;
}

function firstDefined(source: Record<string, unknown>, keys: string[]) {
  for (const key of keys) {
    if (source[key] !== undefined && source[key] !== null) return source[key];
  }
  return "";
}

function normalizeStaffMember(
  value: unknown,
  index: number,
  totalEpisodes: number
): ProjectMainStaffMember {
  const source = isRecord(value) ? value : {};
  return {
    id: normalizeText(source.id, 120) || createStaffId(`${index}-${source.role ?? ""}-${source.name ?? ""}`),
    role: normalizeText(source.role ?? source.title, 100),
    name: normalizeText(source.name, 100),
    phone: sanitizeKoreanPhoneDigits(String(source.phone ?? "")),
    includeInDailyPlan: source.includeInDailyPlan !== false,
    episodeNumbers: normalizeMainStaffEpisodeNumbers(source.episodeNumbers, totalEpisodes),
    sortOrder: Number.isInteger(Number(source.sortOrder)) ? Math.max(0, Number(source.sortOrder)) : index
  };
}

function findInvalidMainStaffEpisodeNumber(
  value: unknown,
  totalEpisodes: number
): number | null {
  if (!Array.isArray(value)) return null;
  for (const member of value) {
    if (!isRecord(member) || member.episodeNumbers === undefined || member.episodeNumbers === null) continue;
    if (!Array.isArray(member.episodeNumbers)) return 0;
    for (const rawEpisode of member.episodeNumbers) {
      const episode = Number(rawEpisode);
      if (!Number.isInteger(episode) || episode < 1 || episode > totalEpisodes) {
        return Number.isFinite(episode) ? episode : 0;
      }
    }
  }
  return null;
}

function normalizeActors(value: unknown): ProjectActor[] {
  if (!Array.isArray(value)) return [];
  return value.slice(0, 200).map((actor) => {
    const source = isRecord(actor) ? actor : {};
    return {
      role: normalizeText(source.role, 100),
      name: normalizeText(source.name, 100)
    };
  }).filter((actor) => actor.role || actor.name);
}

function normalizeDate(value: unknown) {
  const date = String(value ?? "").trim();
  if (!ISO_DATE_PATTERN.test(date)) return "";
  const parsed = new Date(`${date}T00:00:00Z`);
  return Number.isNaN(parsed.getTime()) || parsed.toISOString().slice(0, 10) !== date ? "" : date;
}

function normalizeText(value: unknown, maxLength: number) {
  return String(value ?? "").trim().slice(0, maxLength);
}

function createStaffId(seed: string) {
  const normalized = seed.toLocaleLowerCase("ko-KR").replace(/[^0-9a-z가-힣]+/g, "-").replace(/^-|-$/g, "");
  return `main_staff_${normalized || "member"}`;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value && typeof value === "object" && !Array.isArray(value));
}
