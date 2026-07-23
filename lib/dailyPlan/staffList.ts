import { dailyPlanTeamDepartments } from "@/lib/dailyPlan/printMeta";
import type { DailyPlanStaffMember } from "@/lib/types";

/** 스텝 행에서 직접 선택할 수 있는 기본 부서 목록입니다. */
export const dailyPlanStaffDepartments = dailyPlanTeamDepartments;

export function normalizeStaffDepartment(value: unknown) {
  return String(value ?? "").trim().slice(0, 50) || "기타";
}

export function isStaffMemberEmpty(member: Pick<DailyPlanStaffMember, "name" | "phone" | "province" | "cityDistrict" | "notes">) {
  return !member.name.trim()
    && !member.phone.trim()
    && !member.province.trim()
    && !member.cityDistrict.trim()
    && !member.notes.trim();
}

export function sortStaffMembers(members: DailyPlanStaffMember[]) {
  return [...members].sort((left, right) => {
    return left.sortOrder - right.sortOrder || left.createdAt.localeCompare(right.createdAt);
  });
}
