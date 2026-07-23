import { readLocalBuckets, writeLocalBuckets } from "@/lib/data/localStore";
import {
  normalizeStaffDepartment,
  sortStaffMembers
} from "@/lib/dailyPlan/staffList";
import { formatKoreanPhoneNumber } from "@/lib/formatKoreanPhoneNumber";
import { isValidDatabaseProjectId } from "@/lib/projectId";
import type { DailyPlanStaffMember } from "@/lib/types";

type StaffListPayload = {
  members?: Record<string, unknown>[];
  warnings?: string[];
  error?: string;
};

export type DailyPlanStaffListResult = {
  members: DailyPlanStaffMember[];
  warnings: string[];
};

export function createBlankDailyPlanStaffMember(
  projectId: string,
  dailyPlanId: string,
  department: string,
  sortOrder: number
): DailyPlanStaffMember {
  const now = new Date().toISOString();
  return {
    id: createUuid(),
    projectId,
    dailyPlanId,
    department: normalizeStaffDepartment(department),
    name: "",
    phone: "",
    province: "",
    cityDistrict: "",
    notes: "",
    sortOrder,
    createdAt: now,
    updatedAt: now
  };
}

/** 저장된 스텝 행만 불러오며 일촬표 인원수로 행을 자동 생성하지 않습니다. */
export async function listDailyPlanStaffMembers(projectId: string, dailyPlanId: string): Promise<DailyPlanStaffListResult> {
  try {
    const response = await fetch(
      `/api/projects/${encodeURIComponent(projectId)}/daily-plans/${encodeURIComponent(dailyPlanId)}/staff-list`,
      { cache: "no-store" }
    );
    const payload = (await response.json().catch(() => ({}))) as StaffListPayload;
    if (response.ok && payload.members) {
      return {
        members: sortStaffMembers(payload.members.map(staffMemberFromRow)),
        warnings: payload.warnings ?? []
      };
    }
    if (isValidDatabaseProjectId(projectId) || response.status === 403) {
      throw new Error(payload.error || "스텝 리스트를 불러오지 못했습니다.");
    }
  } catch (error) {
    if (isValidDatabaseProjectId(projectId) || !(error instanceof TypeError)) throw error;
  }

  return listLocalStaffMembers(projectId, dailyPlanId);
}

/** 사용자가 입력한 상세 행과 순서를 그대로 저장합니다. */
export async function saveDailyPlanStaffMembers(
  projectId: string,
  dailyPlanId: string,
  members: DailyPlanStaffMember[]
): Promise<DailyPlanStaffListResult> {
  const normalizedMembers = members.map((member, index) => normalizeMember(member, projectId, dailyPlanId, index));
  try {
    const response = await fetch(
      `/api/projects/${encodeURIComponent(projectId)}/daily-plans/${encodeURIComponent(dailyPlanId)}/staff-list`,
      {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ members: normalizedMembers })
      }
    );
    const payload = (await response.json().catch(() => ({}))) as StaffListPayload;
    if (response.ok && payload.members) {
      return {
        members: sortStaffMembers(payload.members.map(staffMemberFromRow)),
        warnings: payload.warnings ?? []
      };
    }
    if (isValidDatabaseProjectId(projectId) || response.status === 403) {
      throw new Error(payload.error || "스텝 리스트를 저장하지 못했습니다.");
    }
  } catch (error) {
    if (isValidDatabaseProjectId(projectId) || !(error instanceof TypeError)) throw error;
  }

  return saveLocalStaffMembers(projectId, dailyPlanId, normalizedMembers);
}

function listLocalStaffMembers(projectId: string, dailyPlanId: string): DailyPlanStaffListResult {
  const buckets = readLocalBuckets();
  const plan = buckets.dailyPlans.find((item) => item.projectId === projectId && item.id === dailyPlanId);
  if (!plan) throw new Error("일촬표를 찾을 수 없습니다.");

  return {
    members: sortStaffMembers(
      buckets.dailyPlanStaffMembers.filter((member) => member.projectId === projectId && member.dailyPlanId === dailyPlanId)
    ),
    warnings: []
  };
}

function saveLocalStaffMembers(
  projectId: string,
  dailyPlanId: string,
  members: DailyPlanStaffMember[]
): DailyPlanStaffListResult {
  const buckets = readLocalBuckets();
  const plan = buckets.dailyPlans.find((item) => item.projectId === projectId && item.id === dailyPlanId);
  if (!plan) throw new Error("일촬표를 찾을 수 없습니다.");

  const normalizedMembers = sortStaffMembers(
    members.map((member, index) => normalizeMember(member, projectId, dailyPlanId, index))
  );
  writeLocalBuckets({
    dailyPlanStaffMembers: [
      ...buckets.dailyPlanStaffMembers.filter(
        (member) => member.projectId !== projectId || member.dailyPlanId !== dailyPlanId
      ),
      ...normalizedMembers
    ]
  }, projectId);

  return { members: normalizedMembers, warnings: [] };
}

function normalizeMember(
  member: DailyPlanStaffMember,
  projectId: string,
  dailyPlanId: string,
  index: number
): DailyPlanStaffMember {
  return {
    ...member,
    projectId,
    dailyPlanId,
    department: normalizeStaffDepartment(member.department),
    name: member.name.slice(0, 100),
    phone: formatKoreanPhoneNumber(member.phone),
    province: member.province.slice(0, 50),
    cityDistrict: member.cityDistrict.slice(0, 50),
    notes: member.notes.slice(0, 2000),
    sortOrder: index + 1,
    updatedAt: new Date().toISOString()
  };
}

function staffMemberFromRow(row: Record<string, unknown>): DailyPlanStaffMember {
  return {
    id: String(row.id),
    projectId: String(row.project_id),
    dailyPlanId: String(row.daily_plan_id),
    department: normalizeStaffDepartment(row.department),
    name: String(row.name ?? ""),
    phone: formatKoreanPhoneNumber(String(row.phone ?? "")),
    province: String(row.province ?? ""),
    cityDistrict: String(row.city_district ?? ""),
    notes: String(row.notes ?? ""),
    sortOrder: Number(row.sort_order) || 1,
    createdAt: String(row.created_at ?? ""),
    updatedAt: String(row.updated_at ?? "")
  };
}

function createUuid() {
  if (typeof crypto !== "undefined" && "randomUUID" in crypto) return crypto.randomUUID();
  return "xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx".replace(/[xy]/g, (token) => {
    const random = Math.floor(Math.random() * 16);
    const value = token === "x" ? random : (random & 0x3) | 0x8;
    return value.toString(16);
  });
}
