import type { ProjectActor, ProjectBasicInfo, ProjectMainStaffMember } from "@/lib/types";

const ISO_DATE_PATTERN = /^\d{4}-\d{2}-\d{2}$/;

export const emptyProjectBasicInfo: ProjectBasicInfo = {
  totalEpisodes: 1,
  shootingStartDate: "",
  shootingEndDate: "",
  mainStaff: {
    director: { name: "", phone: "" },
    assistantDirector: { name: "", phone: "" },
    producer: { name: "", phone: "" }
  },
  actors: []
};

/** DB의 오래된 값이나 일부 필드가 비어 있는 JSON도 안전한 프로젝트 기본정보 형태로 읽습니다. */
export function normalizeProjectBasicInfo(value: unknown): ProjectBasicInfo {
  const source = isRecord(value) ? value : {};
  const mainStaff = isRecord(source.mainStaff) ? source.mainStaff : {};
  const totalEpisodes = Number(source.totalEpisodes);

  return {
    totalEpisodes: Number.isInteger(totalEpisodes) && totalEpisodes >= 1 ? totalEpisodes : 1,
    shootingStartDate: normalizeDate(source.shootingStartDate),
    shootingEndDate: normalizeDate(source.shootingEndDate),
    mainStaff: {
      director: normalizeStaffMember(mainStaff.director),
      assistantDirector: normalizeStaffMember(mainStaff.assistantDirector),
      producer: normalizeStaffMember(mainStaff.producer)
    },
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

function normalizeStaffMember(value: unknown): ProjectMainStaffMember {
  const source = isRecord(value) ? value : {};
  return {
    name: normalizeText(source.name, 100),
    phone: String(source.phone ?? "").replace(/\D/g, "").slice(0, 11)
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

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value && typeof value === "object" && !Array.isArray(value));
}
