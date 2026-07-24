import type { ProjectStaffMember } from "@/lib/types";

export function normalizeStaffDepartment(value: unknown) {
  return String(value ?? "").trim().slice(0, 50);
}

export function isStaffMemberEmpty(member: Pick<ProjectStaffMember, "name" | "phone" | "location" | "notes">) {
  return !member.name.trim()
    && !member.phone.trim()
    && !member.location.trim()
    && !member.notes.trim();
}

export function sortStaffMembers(members: ProjectStaffMember[]) {
  return [...members].sort((left, right) => {
    return left.sortOrder - right.sortOrder || left.createdAt.localeCompare(right.createdAt);
  });
}
