import { readLocalBuckets, writeLocalBuckets } from "@/lib/data/localStore";
import { normalizeStaffDepartment, sortStaffMembers } from "@/lib/dailyPlan/staffList";
import { formatKoreanPhoneNumber } from "@/lib/formatKoreanPhoneNumber";
import { isValidDatabaseProjectId } from "@/lib/projectId";
import type { ProjectStaffDepartment, ProjectStaffMember } from "@/lib/types";

type StaffListPayload = {
  members?: Record<string, unknown>[];
  departments?: Record<string, unknown>[];
  warnings?: string[];
  error?: string;
};

export type ProjectStaffListResult = {
  members: ProjectStaffMember[];
  departments: ProjectStaffDepartment[];
  warnings: string[];
};

export function createBlankProjectStaffMember(
  projectId: string,
  department: string,
  sortOrder: number
): ProjectStaffMember {
  const now = new Date().toISOString();
  return {
    id: createUuid(),
    projectId,
    department: normalizeStaffDepartment(department),
    name: "",
    phone: "",
    location: "",
    notes: "",
    sortOrder,
    createdAt: now,
    updatedAt: now
  };
}

export function createBlankProjectStaffDepartment(
  projectId: string,
  name: string,
  sortOrder: number
): ProjectStaffDepartment {
  const now = new Date().toISOString();
  return {
    id: createUuid(),
    projectId,
    name: normalizeDepartmentName(name),
    sortOrder,
    createdAt: now,
    updatedAt: now
  };
}

/** 프로젝트 전체에서 공유하는 스탭 풀을 불러옵니다. */
export async function listProjectStaffMembers(projectId: string): Promise<ProjectStaffListResult> {
  try {
    const response = await fetch(
      `/api/projects/${encodeURIComponent(projectId)}/staff-list`,
      { cache: "no-store" }
    );
    const payload = (await response.json().catch(() => ({}))) as StaffListPayload;
    if (response.ok && payload.members) {
      return {
        members: sortStaffMembers(payload.members.map(staffMemberFromRow)),
        departments: sortDepartments((payload.departments ?? []).map(staffDepartmentFromRow)),
        warnings: payload.warnings ?? []
      };
    }
    if (isValidDatabaseProjectId(projectId) || response.status === 403) {
      throw new Error(payload.error || "스탭 리스트를 불러오지 못했습니다.");
    }
  } catch (error) {
    if (isValidDatabaseProjectId(projectId) || !(error instanceof TypeError)) throw error;
  }

  return listLocalStaffMembers(projectId);
}

/** 사용자가 입력한 프로젝트 스탭 행과 순서를 그대로 저장합니다. */
export async function saveProjectStaffMembers(
  projectId: string,
  members: ProjectStaffMember[],
  departments: ProjectStaffDepartment[]
): Promise<ProjectStaffListResult> {
  const normalizedMembers = members.map((member, index) => normalizeMember(member, projectId, index));
  const normalizedDepartments = normalizeDepartments(departments, projectId);
  try {
    const response = await fetch(
      `/api/projects/${encodeURIComponent(projectId)}/staff-list`,
      {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          members: normalizedMembers,
          departments: normalizedDepartments
        })
      }
    );
    const payload = (await response.json().catch(() => ({}))) as StaffListPayload;
    if (response.ok && payload.members) {
      return {
        members: sortStaffMembers(payload.members.map(staffMemberFromRow)),
        departments: sortDepartments((payload.departments ?? []).map(staffDepartmentFromRow)),
        warnings: payload.warnings ?? []
      };
    }
    if (isValidDatabaseProjectId(projectId) || response.status === 403) {
      throw new Error(payload.error || "스탭 리스트를 저장하지 못했습니다.");
    }
  } catch (error) {
    if (isValidDatabaseProjectId(projectId) || !(error instanceof TypeError)) throw error;
  }

  return saveLocalStaffMembers(projectId, normalizedMembers, normalizedDepartments);
}

function listLocalStaffMembers(projectId: string): ProjectStaffListResult {
  const buckets = readLocalBuckets();
  if (!buckets.projects.some((project) => project.id === projectId)) {
    throw new Error("프로젝트를 찾을 수 없습니다.");
  }

  return {
    members: sortStaffMembers(
      buckets.projectStaffMembers.filter((member) => member.projectId === projectId)
    ),
    departments: sortDepartments(
      buckets.projectStaffDepartments.filter((department) => department.projectId === projectId)
    ),
    warnings: []
  };
}

function saveLocalStaffMembers(
  projectId: string,
  members: ProjectStaffMember[],
  departments: ProjectStaffDepartment[]
): ProjectStaffListResult {
  const buckets = readLocalBuckets();
  if (!buckets.projects.some((project) => project.id === projectId)) {
    throw new Error("프로젝트를 찾을 수 없습니다.");
  }

  const normalizedMembers = sortStaffMembers(
    members.map((member, index) => normalizeMember(member, projectId, index))
  );
  const normalizedDepartments = sortDepartments(normalizeDepartments(departments, projectId));
  writeLocalBuckets({
    projectStaffMembers: [
      ...buckets.projectStaffMembers.filter((member) => member.projectId !== projectId),
      ...normalizedMembers
    ],
    projectStaffDepartments: [
      ...buckets.projectStaffDepartments.filter((department) => department.projectId !== projectId),
      ...normalizedDepartments
    ]
  }, projectId);

  return {
    members: normalizedMembers,
    departments: normalizedDepartments,
    warnings: []
  };
}

function normalizeMember(
  member: ProjectStaffMember,
  projectId: string,
  index: number
): ProjectStaffMember {
  return {
    ...member,
    projectId,
    department: normalizeStaffDepartment(member.department),
    name: member.name.slice(0, 100),
    phone: formatKoreanPhoneNumber(member.phone),
    location: member.location.slice(0, 120),
    notes: member.notes.slice(0, 2000),
    sortOrder: index + 1,
    updatedAt: new Date().toISOString()
  };
}

function staffMemberFromRow(row: Record<string, unknown>): ProjectStaffMember {
  return {
    id: String(row.id),
    projectId: String(row.project_id),
    department: normalizeStaffDepartment(row.department),
    name: String(row.name ?? ""),
    phone: formatKoreanPhoneNumber(String(row.phone ?? "")),
    location: String(row.location ?? ""),
    notes: String(row.notes ?? ""),
    sortOrder: Number(row.sort_order) || 1,
    createdAt: String(row.created_at ?? ""),
    updatedAt: String(row.updated_at ?? "")
  };
}

function normalizeDepartments(
  departments: ProjectStaffDepartment[],
  projectId: string
): ProjectStaffDepartment[] {
  const seen = new Set<string>();
  return departments.flatMap((department) => {
    const name = normalizeDepartmentName(department.name);
    const duplicateKey = name.toLocaleLowerCase("ko-KR");
    if (!name || seen.has(duplicateKey)) return [];
    seen.add(duplicateKey);
    return [{
      ...department,
      projectId,
      name,
      sortOrder: seen.size,
      updatedAt: new Date().toISOString()
    }];
  });
}

function staffDepartmentFromRow(row: Record<string, unknown>): ProjectStaffDepartment {
  return {
    id: String(row.id),
    projectId: String(row.project_id),
    name: normalizeDepartmentName(row.name),
    sortOrder: Number(row.sort_order) || 1,
    createdAt: String(row.created_at ?? ""),
    updatedAt: String(row.updated_at ?? "")
  };
}

function sortDepartments(departments: ProjectStaffDepartment[]) {
  return [...departments].sort((left, right) => (
    left.sortOrder - right.sortOrder || left.createdAt.localeCompare(right.createdAt)
  ));
}

function normalizeDepartmentName(value: unknown) {
  return String(value ?? "").trim().slice(0, 100);
}

function createUuid() {
  if (typeof crypto !== "undefined" && "randomUUID" in crypto) return crypto.randomUUID();
  return "xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx".replace(/[xy]/g, (token) => {
    const random = Math.floor(Math.random() * 16);
    const value = token === "x" ? random : (random & 0x3) | 0x8;
    return value.toString(16);
  });
}
