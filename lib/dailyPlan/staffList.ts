import {
  createBlankTeamCallSheetRow,
  dailyPlanTeamDepartments,
  type DailyPlanPrintMeta
} from "@/lib/dailyPlan/printMeta";
import type { DailyPlanStaffMember } from "@/lib/types";

/** 일촬표 스태프 섹션의 기존 부서를 우선하고 확장용 부서를 뒤에 둡니다. */
export const dailyPlanStaffDepartments = dailyPlanTeamDepartments;

export const MAX_DAILY_PLAN_STAFF_COUNT = 500;

export type StaffCountMap = Map<string, number>;

export function normalizeStaffDepartment(value: unknown) {
  return String(value ?? "").trim().slice(0, 50) || "기타";
}

export function parseStaffCount(value: unknown) {
  const count = Number.parseInt(String(value ?? "").replace(/\D/g, ""), 10);
  if (!Number.isFinite(count)) return 0;
  return Math.min(Math.max(count, 0), MAX_DAILY_PLAN_STAFF_COUNT);
}

export function getStaffCountsFromPrintMeta(meta: DailyPlanPrintMeta): StaffCountMap {
  const counts: StaffCountMap = new Map();
  meta.teams.forEach((team) => {
    const department = normalizeStaffDepartment(team.team);
    const count = parseStaffCount(team.total);
    counts.set(department, (counts.get(department) ?? 0) + count);
  });
  return counts;
}

export function getStaffCountsFromMembers(members: DailyPlanStaffMember[]): StaffCountMap {
  const counts: StaffCountMap = new Map();
  members.forEach((member) => {
    const department = normalizeStaffDepartment(member.department);
    counts.set(department, (counts.get(department) ?? 0) + 1);
  });
  return counts;
}

export function isStaffMemberEmpty(member: Pick<DailyPlanStaffMember, "name" | "phone" | "province" | "cityDistrict" | "notes">) {
  return !member.name.trim()
    && !member.phone.trim()
    && !member.province.trim()
    && !member.cityDistrict.trim()
    && !member.notes.trim();
}

export function applyStaffCountsToPrintMeta(
  meta: DailyPlanPrintMeta,
  counts: StaffCountMap,
  affectedDepartments: Iterable<string> = counts.keys()
): DailyPlanPrintMeta {
  const affected = new Set(Array.from(affectedDepartments, normalizeStaffDepartment));
  const represented = new Set<string>();
  const teams = meta.teams.map((team) => {
    const department = normalizeStaffDepartment(team.team);
    if (!affected.has(department) || represented.has(department)) return team;
    represented.add(department);
    const count = counts.get(department) ?? 0;
    return { ...team, team: department, total: count > 0 ? String(count) : "" };
  });

  counts.forEach((count, departmentValue) => {
    const department = normalizeStaffDepartment(departmentValue);
    if (count <= 0 || represented.has(department)) return;
    represented.add(department);
    teams.push({ ...createBlankTeamCallSheetRow(department), total: String(count) });
  });

  return { ...meta, teams };
}

export function sortStaffMembers(members: DailyPlanStaffMember[]) {
  const departmentOrder = new Map<string, number>(
    dailyPlanStaffDepartments.map((department, index) => [department, index])
  );
  return [...members].sort((left, right) => {
    const leftDepartment = normalizeStaffDepartment(left.department);
    const rightDepartment = normalizeStaffDepartment(right.department);
    const departmentDifference = (departmentOrder.get(leftDepartment) ?? 999)
      - (departmentOrder.get(rightDepartment) ?? 999);
    if (departmentDifference !== 0) return departmentDifference;
    if (leftDepartment !== rightDepartment) return leftDepartment.localeCompare(rightDepartment, "ko");
    return left.sortOrder - right.sortOrder || left.createdAt.localeCompare(right.createdAt);
  });
}
