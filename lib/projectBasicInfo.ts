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
  const totalEpisodes = Number(source.totalEpisodes);

  return {
    totalEpisodes: Number.isInteger(totalEpisodes) && totalEpisodes >= 1 ? totalEpisodes : 1,
    shootingStartDate: normalizeDate(source.shootingStartDate),
    shootingEndDate: normalizeDate(source.shootingEndDate),
    mainStaff: normalizeMainStaff(source.mainStaff),
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

  const mainStaff = normalizeMainStaff(value.mainStaff);
  if (mainStaff.filter((member) => member.includeInDailyPlan).length > MAX_DAILY_PLAN_MAIN_STAFF) {
    return { ok: false as const, error: "일촬표 반영은 최대 3명까지만 가능합니다." };
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
    sortOrder: index
  };
}

function normalizeMainStaff(value: unknown): ProjectMainStaffMember[] {
  if (Array.isArray(value)) {
    return value.map((member, index) => normalizeStaffMember(member, index))
      .filter((member) => member.role || member.name || member.phone)
      .map((member, index) => ({ ...member, sortOrder: index }));
  }

  const source = isRecord(value) ? value : {};
  const legacyRows = [
    legacyStaffMember(source, "director", "감독", ["directorName"], ["directorPhone"]),
    legacyStaffMember(source, "assistantDirector", "조감독", ["assistantDirectorName", "adName"], ["assistantDirectorPhone", "adPhone"]),
    legacyStaffMember(source, "producer", "제작", ["producerName", "productionName"], ["producerPhone", "productionPhone"])
  ].filter((member): member is ProjectMainStaffMember => member !== null);

  return legacyRows.map((member, index) => ({ ...member, sortOrder: index }));
}

function legacyStaffMember(
  source: Record<string, unknown>,
  key: string,
  fallbackRole: string,
  nameKeys: string[],
  phoneKeys: string[]
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
    sortOrder: 0
  } satisfies ProjectMainStaffMember;
}

function firstDefined(source: Record<string, unknown>, keys: string[]) {
  for (const key of keys) {
    if (source[key] !== undefined && source[key] !== null) return source[key];
  }
  return "";
}

function normalizeStaffMember(value: unknown, index: number): ProjectMainStaffMember {
  const source = isRecord(value) ? value : {};
  return {
    id: normalizeText(source.id, 120) || createStaffId(`${index}-${source.role ?? ""}-${source.name ?? ""}`),
    role: normalizeText(source.role ?? source.title, 100),
    name: normalizeText(source.name, 100),
    phone: sanitizeKoreanPhoneDigits(String(source.phone ?? "")),
    includeInDailyPlan: source.includeInDailyPlan !== false,
    sortOrder: Number.isInteger(Number(source.sortOrder)) ? Math.max(0, Number(source.sortOrder)) : index
  };
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
