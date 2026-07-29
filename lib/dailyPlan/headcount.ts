import {
  normalizeDailyPlanCount,
  type CallSheetPerson,
  type DailyPlanPrintMeta,
  type TeamCallSheetRow
} from "@/lib/dailyPlan/printMeta";

export type TeamHeadcount = {
  autoCount: number;
  overrideCount: number | null;
  effectiveCount: number;
};

export type DailyPlanTotalHeadcount = {
  calculatedCount: number;
  overrideCount: number | null;
  effectiveCount: number;
};

/**
 * 기존 total-only 데이터는 저장된 일촬표 수동값으로 취급합니다.
 * 신규 데이터는 totalOverride가 null이면 스탭리스트 자동값을 사용합니다.
 */
export function resolveTeamHeadcount(row: TeamCallSheetRow): TeamHeadcount {
  const hasExplicitOverride = Object.prototype.hasOwnProperty.call(row, "totalOverride");
  const legacyTotal = normalizeDailyPlanCount(row.total);
  const normalizedAuto = normalizeDailyPlanCount(row.autoTotal);
  const normalizedOverride = hasExplicitOverride
    ? normalizeDailyPlanCount(row.totalOverride)
    : legacyTotal;
  const autoCount = Number(normalizedAuto ?? (
    hasExplicitOverride && normalizedOverride === null ? legacyTotal : null
  ) ?? "0");
  const overrideCount = normalizedOverride === null ? null : Number(normalizedOverride);

  return {
    autoCount,
    overrideCount,
    effectiveCount: overrideCount ?? autoCount
  };
}

export function getDailyPlanStaffCount(rows: TeamCallSheetRow[]) {
  const departmentCounts = new Map<string, number>();

  rows.forEach((row) => {
    const key = normalizeIdentity(row.team) || "__unassigned__";
    if (departmentCounts.has(key)) return;
    departmentCounts.set(key, resolveTeamHeadcount(row).effectiveCount);
  });

  return Array.from(departmentCounts.values()).reduce((sum, count) => sum + count, 0);
}

export function getDailyPlanActorCount(rows: CallSheetPerson[]) {
  const seenIds = new Set<string>();
  const seenFallbacks = new Set<string>();
  let count = 0;

  rows.forEach((row) => {
    const name = normalizeIdentity(row.name);
    const role = normalizeIdentity(row.role);
    if (!name && !role) return;

    const id = String(row.id ?? "").trim();
    // 배우 이름은 사람, 역할은 배역이므로 같은 사람이 다른 역할로 중복된 경우에도
    // 총인원은 한 명으로 계산합니다. 이름이 없을 때만 역할을 보조 식별자로 씁니다.
    const fallback = name || `role:${role}`;
    if ((id && seenIds.has(id)) || seenFallbacks.has(fallback)) return;

    if (id) seenIds.add(id);
    seenFallbacks.add(fallback);
    count += 1;
  });

  return count;
}

export function resolveDailyPlanTotalHeadcount(
  meta: DailyPlanPrintMeta,
  teams: TeamCallSheetRow[] = meta.teams
): DailyPlanTotalHeadcount {
  const calculatedCount = getDailyPlanStaffCount(teams) + getDailyPlanActorCount(meta.starring);
  const hasExplicitOverride = Object.prototype.hasOwnProperty.call(meta, "totalCrewOverride");
  const normalizedOverride = hasExplicitOverride
    ? normalizeDailyPlanCount(meta.totalCrewOverride)
    : normalizeDailyPlanCount(meta.totalCrew);
  const overrideCount = normalizedOverride === null ? null : Number(normalizedOverride);

  return {
    calculatedCount,
    overrideCount,
    effectiveCount: overrideCount ?? calculatedCount
  };
}

/**
 * 미리보기, PDF, 저장에 같은 값을 전달할 수 있도록 부서별 유효 인원과
 * 현재 일촬표 배우 인원을 한 번에 반영합니다.
 */
export function deriveDailyPlanHeadcount(meta: DailyPlanPrintMeta): DailyPlanPrintMeta {
  const teams = meta.teams.map((row) => {
    const { autoCount, overrideCount, effectiveCount } = resolveTeamHeadcount(row);
    return {
      ...row,
      autoTotal: String(autoCount),
      totalOverride: overrideCount === null ? null : String(overrideCount),
      total: String(effectiveCount)
    };
  });
  const totalHeadcount = resolveDailyPlanTotalHeadcount(meta, teams);

  return {
    ...meta,
    teams,
    autoTotalCrew: String(totalHeadcount.calculatedCount),
    totalCrewOverride: totalHeadcount.overrideCount === null
      ? null
      : String(totalHeadcount.overrideCount),
    totalCrew: String(totalHeadcount.effectiveCount)
  };
}

function normalizeIdentity(value: unknown) {
  return String(value ?? "")
    .trim()
    .toLocaleLowerCase("ko-KR")
    .replace(/[\s_-]+/g, "");
}
