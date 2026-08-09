import { readLocalBuckets, writeLocalBuckets } from "@/lib/data/localStore";
import { AutosaveConflictError } from "@/lib/data/autosaveConflict";
import { normalizeStaffDepartment, sortStaffMembers } from "@/lib/dailyPlan/staffList";
import { formatKoreanPhoneNumber } from "@/lib/formatKoreanPhoneNumber";
import { isValidDatabaseProjectId } from "@/lib/projectId";
import {
  normalizeExcludedEpisodeNumbers,
  normalizeStaffTotalEpisodes
} from "@/lib/staffParticipation";
import { decodeProjectStaffNotes, encodeProjectStaffNotes } from "@/lib/staffRoleMetadata";
import type { ProjectStaffDepartment, ProjectStaffMember } from "@/lib/types";

type StaffListPayload = {
  members?: Record<string, unknown>[];
  member?: Record<string, unknown>;
  departments?: Record<string, unknown>[];
  department?: Record<string, unknown>;
  orders?: Record<string, unknown>[];
  memberId?: unknown;
  deleted?: unknown;
  warnings?: string[];
  totalEpisodes?: unknown;
  error?: string;
};

export type ProjectStaffListResult = {
  members: ProjectStaffMember[];
  departments: ProjectStaffDepartment[];
  warnings: string[];
  totalEpisodes: number;
};

export type ProjectStaffOrderUpdate = Pick<ProjectStaffMember, "id" | "sortOrder" | "updatedAt">;

export type ProjectStaffDeleteResult = {
  memberId: string;
  deleted: boolean;
};

export type ProjectStaffMemberDraftPatch = Partial<Pick<
  ProjectStaffMember,
  "department" | "name" | "phone" | "location"
>> & {
  /** role/notes/participation share the physical notes column and are encoded together. */
  notes?: string;
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
    role: "",
    name: "",
    phone: "",
    location: "",
    notes: "",
    excludedEpisodeNumbers: [],
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
export async function listProjectStaffMembers(
  projectId: string,
  options: { includeTotalEpisodes?: boolean } = {}
): Promise<ProjectStaffListResult> {
  const totalEpisodesQuery = options.includeTotalEpisodes ? "?includeTotalEpisodes=1" : "";
  try {
    const response = await fetch(
      `/api/projects/${encodeURIComponent(projectId)}/staff-list${totalEpisodesQuery}`,
      { cache: "no-store" }
    );
    const payload = (await response.json().catch(() => ({}))) as StaffListPayload;
    if (response.ok && payload.members) {
      return {
        members: sortStaffMembers(payload.members.map(staffMemberFromRow)),
        departments: sortDepartments((payload.departments ?? []).map(staffDepartmentFromRow)),
        warnings: payload.warnings ?? [],
        totalEpisodes: normalizeStaffTotalEpisodes(payload.totalEpisodes)
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
  departments: ProjectStaffDepartment[],
  totalEpisodes: number
): Promise<ProjectStaffListResult> {
  const normalizedMembers = members.map((member, index) => (
    normalizeMember(member, projectId, index, totalEpisodes)
  ));
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
        warnings: payload.warnings ?? [],
        totalEpisodes: normalizeStaffTotalEpisodes(payload.totalEpisodes)
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

/** 이미 저장된 한 스탭 행의 입력 필드만 갱신합니다. 생성·삭제·순서는 건드리지 않습니다. */
export async function saveProjectStaffMemberDraft(
  projectId: string,
  memberId: string,
  patch: ProjectStaffMemberDraftPatch,
  expectedUpdatedAt: string
): Promise<ProjectStaffMember> {
  const normalizedPatch = normalizeStaffMemberDraftPatch(patch);
  if (Object.keys(normalizedPatch).length === 0) {
    throw new Error("자동 저장할 스탭 변경사항이 없습니다.");
  }
  try {
    const response = await fetch(
      `/api/projects/${encodeURIComponent(projectId)}/staff-list`,
      {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          action: "update-member",
          member: { id: memberId, ...normalizedPatch },
          expectedUpdatedAt
        })
      }
    );
    const payload = (await response.json().catch(() => ({}))) as StaffListPayload;
    if (response.ok && payload.member) return staffMemberFromRow(payload.member);
    if (response.status === 409 && isValidDatabaseProjectId(projectId)) {
      throw new AutosaveConflictError<ProjectStaffMember>(
        "staff-member",
        payload.error || "스탭 정보가 다른 곳에서 변경되었습니다.",
        payload.member ? staffMemberFromRow(payload.member) : null
      );
    }
    if (isValidDatabaseProjectId(projectId) || response.status === 403) {
      throw new Error(payload.error || "스탭 정보를 자동 저장하지 못했습니다.");
    }
  } catch (error) {
    if (isValidDatabaseProjectId(projectId) || !(error instanceof TypeError)) throw error;
  }

  const buckets = readLocalBuckets();
  const existingIndex = buckets.projectStaffMembers.findIndex((candidate) => (
    candidate.projectId === projectId && candidate.id === memberId
  ));
  if (existingIndex < 0) throw new Error("자동 저장할 스탭을 찾을 수 없습니다.");
  const decodedNotes = normalizedPatch.notes === undefined
    ? null
    : decodeProjectStaffNotes(normalizedPatch.notes);
  const savedMember = {
    ...buckets.projectStaffMembers[existingIndex],
    ...(normalizedPatch.department !== undefined ? { department: normalizedPatch.department } : {}),
    ...(normalizedPatch.name !== undefined ? { name: normalizedPatch.name } : {}),
    ...(normalizedPatch.phone !== undefined ? { phone: normalizedPatch.phone } : {}),
    ...(normalizedPatch.location !== undefined ? { location: normalizedPatch.location } : {}),
    ...(decodedNotes ? decodedNotes : {}),
    updatedAt: new Date().toISOString()
  };
  writeLocalBuckets({
    projectStaffMembers: buckets.projectStaffMembers.map((candidate) => (
      candidate.projectId === projectId && candidate.id === memberId ? savedMember : candidate
    ))
  }, projectId);
  return savedMember;
}

/** 저장된 행과 현재 행을 비교해 실제 DB column에 해당하는 변경만 만듭니다. */
export function createProjectStaffMemberDraftPatch(
  saved: ProjectStaffMember,
  current: ProjectStaffMember,
  totalEpisodes: number
): ProjectStaffMemberDraftPatch {
  const normalized = normalizeMember(current, current.projectId, Math.max(0, current.sortOrder - 1), totalEpisodes);
  const patch: ProjectStaffMemberDraftPatch = {};
  if (normalizeStaffDepartment(saved.department) !== normalized.department) patch.department = normalized.department;
  if (saved.name !== normalized.name) patch.name = normalized.name;
  if (formatKoreanPhoneNumber(saved.phone) !== normalized.phone) patch.phone = normalized.phone;
  if (saved.location !== normalized.location) patch.location = normalized.location;
  if (
    String(saved.role ?? "").trim().slice(0, 100) !== normalized.role
    || saved.notes !== normalized.notes
    || JSON.stringify(normalizeExcludedEpisodeNumbers(saved.excludedEpisodeNumbers, totalEpisodes))
      !== JSON.stringify(normalized.excludedEpisodeNumbers)
  ) {
    patch.notes = encodeProjectStaffNotes(
      normalized.role,
      normalized.notes,
      normalized.excludedEpisodeNumbers
    );
  }
  return patch;
}

/** 이미 저장된 부서 이름만 갱신합니다. 부서 생성·삭제·순서는 건드리지 않습니다. */
export async function saveProjectStaffDepartmentDraft(
  projectId: string,
  departmentId: string,
  nameValue: string,
  expectedUpdatedAt: string
): Promise<ProjectStaffDepartment> {
  const name = normalizeDepartmentName(nameValue);
  if (!name) throw new Error("부서 이름을 입력해주세요.");
  try {
    const response = await fetch(
      `/api/projects/${encodeURIComponent(projectId)}/staff-list`,
      {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          action: "update-department",
          department: { id: departmentId, name },
          expectedUpdatedAt
        })
      }
    );
    const payload = (await response.json().catch(() => ({}))) as StaffListPayload;
    if (response.ok && payload.department) return staffDepartmentFromRow(payload.department);
    if (response.status === 409 && isValidDatabaseProjectId(projectId)) {
      throw new AutosaveConflictError<ProjectStaffDepartment>(
        "staff-department",
        payload.error || "부서 정보가 다른 곳에서 변경되었습니다.",
        payload.department ? staffDepartmentFromRow(payload.department) : null
      );
    }
    if (isValidDatabaseProjectId(projectId) || response.status === 403) {
      throw new Error(payload.error || "부서 정보를 자동 저장하지 못했습니다.");
    }
  } catch (error) {
    if (isValidDatabaseProjectId(projectId) || !(error instanceof TypeError)) throw error;
  }

  const buckets = readLocalBuckets();
  const existingIndex = buckets.projectStaffDepartments.findIndex((candidate) => (
    candidate.projectId === projectId && candidate.id === departmentId
  ));
  if (existingIndex < 0) throw new Error("자동 저장할 부서를 찾을 수 없습니다.");
  const savedDepartment = {
    ...buckets.projectStaffDepartments[existingIndex],
    name,
    updatedAt: new Date().toISOString()
  };
  writeLocalBuckets({
    projectStaffDepartments: buckets.projectStaffDepartments.map((candidate) => (
      candidate.projectId === projectId && candidate.id === departmentId
        ? savedDepartment
        : candidate
    ))
  }, projectId);
  return savedDepartment;
}

function normalizeStaffMemberDraftPatch(
  patch: ProjectStaffMemberDraftPatch
): ProjectStaffMemberDraftPatch {
  const normalized: ProjectStaffMemberDraftPatch = {};
  if (Object.prototype.hasOwnProperty.call(patch, "department")) {
    normalized.department = normalizeStaffDepartment(patch.department);
  }
  if (Object.prototype.hasOwnProperty.call(patch, "name")) {
    normalized.name = String(patch.name ?? "").slice(0, 100);
  }
  if (Object.prototype.hasOwnProperty.call(patch, "phone")) {
    normalized.phone = formatKoreanPhoneNumber(String(patch.phone ?? "").slice(0, 30));
  }
  if (Object.prototype.hasOwnProperty.call(patch, "location")) {
    normalized.location = String(patch.location ?? "").slice(0, 120);
  }
  if (Object.prototype.hasOwnProperty.call(patch, "notes")) {
    const decoded = decodeProjectStaffNotes(patch.notes);
    normalized.notes = encodeProjectStaffNotes(
      decoded.role,
      decoded.notes,
      decoded.excludedEpisodeNumbers
    );
  }
  return normalized;
}

/** 같은 부서의 stable ID 전체를 한 요청으로 재배치하고 canonical sortOrder만 반환합니다. */
export async function reorderProjectStaffMembers(
  projectId: string,
  department: string,
  orderedMemberIds: string[]
): Promise<ProjectStaffOrderUpdate[]> {
  const normalizedDepartment = normalizeStaffDepartment(department);
  const memberIds = orderedMemberIds.map((id) => String(id ?? "").trim());
  if (
    memberIds.length === 0
    || new Set(memberIds).size !== memberIds.length
  ) {
    throw new Error("스탭 순서 데이터가 올바르지 않습니다.");
  }

  try {
    const response = await fetch(
      `/api/projects/${encodeURIComponent(projectId)}/staff-list`,
      {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          department: normalizedDepartment,
          memberIds
        })
      }
    );
    const payload = (await response.json().catch(() => ({}))) as StaffListPayload;
    if (response.ok && Array.isArray(payload.orders)) {
      const orders = payload.orders.map(staffOrderFromRow);
      if (
        orders.length === memberIds.length
        && orders.every((order, index) => order.id === memberIds[index])
      ) {
        return orders;
      }
      throw new Error("저장된 스탭 순서를 확인하지 못했습니다.");
    }
    if (isValidDatabaseProjectId(projectId) || response.status === 403) {
      throw new Error(payload.error || "스탭 순서를 저장하지 못했습니다.");
    }
  } catch (error) {
    if (isValidDatabaseProjectId(projectId) || !(error instanceof TypeError)) throw error;
  }

  return reorderLocalStaffMembers(projectId, normalizedDepartment, memberIds);
}

/** 프로젝트 범위와 stable staff ID를 함께 사용하며 이미 삭제된 행에도 성공하는 삭제 요청입니다. */
export async function deleteProjectStaffMember(
  projectId: string,
  memberId: string
): Promise<ProjectStaffDeleteResult> {
  const normalizedMemberId = String(memberId ?? "").trim();
  if (!normalizedMemberId) throw new Error("스탭 행 ID가 올바르지 않습니다.");

  try {
    const response = await fetch(
      `/api/projects/${encodeURIComponent(projectId)}/staff-list`,
      {
        method: "DELETE",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ memberId: normalizedMemberId })
      }
    );
    const payload = (await response.json().catch(() => ({}))) as StaffListPayload;
    if (response.ok) {
      return {
        memberId: String(payload.memberId ?? normalizedMemberId),
        deleted: payload.deleted === true
      };
    }
    if (isValidDatabaseProjectId(projectId) || response.status === 403) {
      throw new Error(payload.error || "스탭을 삭제하지 못했습니다.");
    }
  } catch (error) {
    if (isValidDatabaseProjectId(projectId) || !(error instanceof TypeError)) throw error;
  }

  return deleteLocalStaffMember(projectId, normalizedMemberId);
}

function listLocalStaffMembers(projectId: string): ProjectStaffListResult {
  const buckets = readLocalBuckets();
  const project = buckets.projects.find((item) => item.id === projectId);
  if (!project) {
    throw new Error("프로젝트를 찾을 수 없습니다.");
  }
  const totalEpisodes = normalizeStaffTotalEpisodes(project.basicInfo?.totalEpisodes);

  return {
    members: sortStaffMembers(buckets.projectStaffMembers
      .filter((member) => member.projectId === projectId)
      .map((member, index) => normalizeMember(member, projectId, index, totalEpisodes))),
    departments: sortDepartments(
      buckets.projectStaffDepartments.filter((department) => department.projectId === projectId)
    ),
    warnings: [],
    totalEpisodes
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
    warnings: [],
    totalEpisodes: normalizeStaffTotalEpisodes(
      buckets.projects.find((project) => project.id === projectId)?.basicInfo?.totalEpisodes
    )
  };
}

function reorderLocalStaffMembers(
  projectId: string,
  department: string,
  orderedMemberIds: string[]
): ProjectStaffOrderUpdate[] {
  const buckets = readLocalBuckets();
  if (!buckets.projects.some((project) => project.id === projectId)) {
    throw new Error("프로젝트를 찾을 수 없습니다.");
  }

  const projectMembers = buckets.projectStaffMembers.filter((member) => member.projectId === projectId);
  const departmentKey = staffDepartmentScopeKey(department);
  const sectionMembers = sortStaffMembers(projectMembers.filter((member) => (
    staffDepartmentScopeKey(member.department) === departmentKey
  )));
  const sectionIdSet = new Set(sectionMembers.map((member) => member.id));
  if (
    sectionMembers.length !== orderedMemberIds.length
    || orderedMemberIds.some((id) => !sectionIdSet.has(id))
  ) {
    throw new Error("해당 부서의 스탭 목록이 변경되었습니다. 다시 확인해주세요.");
  }

  const currentSortOrderSlots = sectionMembers.map((member, index) => (
    Number.isInteger(member.sortOrder) && member.sortOrder > 0 ? member.sortOrder : index + 1
  ));
  const hasStableSlots = currentSortOrderSlots.every((sortOrder, index) => (
    index === 0 || sortOrder > currentSortOrderSlots[index - 1]
  ));
  const projectPositionById = new Map(sortStaffMembers(projectMembers).map((member, index) => (
    [member.id, index + 1]
  )));
  const sortOrderSlots = hasStableSlots
    ? currentSortOrderSlots
    : sectionMembers.map((member, index) => projectPositionById.get(member.id) ?? index + 1);
  const updatedAt = new Date().toISOString();
  const orderById = new Map(orderedMemberIds.map((id, index) => [id, {
    sortOrder: sortOrderSlots[index],
    updatedAt
  }]));
  const reorderedProjectMembers = sortStaffMembers(projectMembers.map((member) => {
    const order = orderById.get(member.id);
    return order ? { ...member, ...order } : member;
  }));
  writeLocalBuckets({
    // local 조회는 저장 배열 순서를 기준으로 canonical sortOrder를 다시 계산하므로
    // 해당 프로젝트 배열도 함께 재배치해야 새로고침 뒤 순서가 유지됩니다.
    projectStaffMembers: [
      ...buckets.projectStaffMembers.filter((member) => member.projectId !== projectId),
      ...reorderedProjectMembers
    ]
  }, projectId);

  return orderedMemberIds.map((id) => ({ id, ...orderById.get(id)! }));
}

function deleteLocalStaffMember(
  projectId: string,
  memberId: string
): ProjectStaffDeleteResult {
  const buckets = readLocalBuckets();
  if (!buckets.projects.some((project) => project.id === projectId)) {
    throw new Error("프로젝트를 찾을 수 없습니다.");
  }
  const deleted = buckets.projectStaffMembers.some((member) => (
    member.projectId === projectId && member.id === memberId
  ));
  writeLocalBuckets({
    projectStaffMembers: buckets.projectStaffMembers.filter((member) => (
      member.projectId !== projectId || member.id !== memberId
    ))
  }, projectId);
  return { memberId, deleted };
}

function normalizeMember(
  member: ProjectStaffMember,
  projectId: string,
  index: number,
  totalEpisodes?: number
): ProjectStaffMember {
  return {
    ...member,
    projectId,
    department: normalizeStaffDepartment(member.department),
    role: String(member.role ?? "").trim().slice(0, 100),
    name: member.name.slice(0, 100),
    phone: formatKoreanPhoneNumber(member.phone),
    location: member.location.slice(0, 120),
    notes: member.notes.slice(0, 2000),
    excludedEpisodeNumbers: normalizeExcludedEpisodeNumbers(
      member.excludedEpisodeNumbers,
      totalEpisodes
    ),
    sortOrder: index + 1,
    updatedAt: new Date().toISOString()
  };
}

function staffMemberFromRow(row: Record<string, unknown>): ProjectStaffMember {
  const decodedNotes = decodeProjectStaffNotes(row.notes);
  return {
    id: String(row.id),
    projectId: String(row.project_id),
    department: normalizeStaffDepartment(row.department),
    role: String(row.role ?? decodedNotes.role),
    name: String(row.name ?? ""),
    phone: formatKoreanPhoneNumber(String(row.phone ?? "")),
    location: String(row.location ?? ""),
    notes: row.role === undefined ? decodedNotes.notes : String(row.notes ?? ""),
    excludedEpisodeNumbers: normalizeExcludedEpisodeNumbers(
      row.excludedEpisodeNumbers ?? decodedNotes.excludedEpisodeNumbers
    ),
    sortOrder: Number(row.sort_order) || 1,
    createdAt: String(row.created_at ?? ""),
    updatedAt: String(row.updated_at ?? "")
  };
}

function staffOrderFromRow(row: Record<string, unknown>): ProjectStaffOrderUpdate {
  return {
    id: String(row.id ?? ""),
    sortOrder: Number(row.sortOrder ?? row.sort_order) || 1,
    updatedAt: String(row.updatedAt ?? row.updated_at ?? "")
  };
}

function staffDepartmentScopeKey(value: unknown) {
  return normalizeStaffDepartment(value).toLocaleLowerCase("ko-KR");
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
