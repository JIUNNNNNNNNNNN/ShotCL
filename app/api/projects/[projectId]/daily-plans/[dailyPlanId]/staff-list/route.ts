import { NextRequest, NextResponse } from "next/server";
import {
  applyStaffCountsToPrintMeta,
  getStaffCountsFromMembers,
  normalizeStaffDepartment
} from "@/lib/dailyPlan/staffList";
import { decodeDailyPlanMemo, encodeDailyPlanMemo } from "@/lib/dailyPlan/printMeta";
import { syncDailyPlanStaffRows } from "@/lib/dailyPlan/staffSync.server";
import { formatKoreanPhoneNumber } from "@/lib/formatKoreanPhoneNumber";
import { getAccessGrant, ProjectAccessUnavailableError, requireProjectAccessDb } from "@/lib/projectAccess/server";
import { isValidDatabaseProjectId, normalizeProjectId } from "@/lib/projectId";
import type { DailyPlanStaffMember } from "@/lib/types";

type StaffMemberInput = {
  id?: unknown;
  department?: unknown;
  name?: unknown;
  phone?: unknown;
  province?: unknown;
  cityDistrict?: unknown;
  notes?: unknown;
};

export async function GET(request: NextRequest, context: { params: Promise<{ projectId: string; dailyPlanId: string }> }) {
  try {
    const scope = await requireAdminScope(request, context);
    if (scope instanceof NextResponse) return scope;
    const { projectId, dailyPlanId, supabase, plan } = scope;
    const synced = await syncDailyPlanStaffRows(supabase, projectId, dailyPlanId, String(plan.memo ?? ""));
    return NextResponse.json({ members: synced.rows, warnings: synced.warnings });
  } catch (error) {
    return staffRouteError(error, "스텝 리스트를 불러오지 못했습니다.");
  }
}

export async function PUT(request: NextRequest, context: { params: Promise<{ projectId: string; dailyPlanId: string }> }) {
  try {
    const scope = await requireAdminScope(request, context);
    if (scope instanceof NextResponse) return scope;
    const { projectId, dailyPlanId, supabase, plan } = scope;
    const body = (await request.json()) as { members?: StaffMemberInput[] };
    if (!Array.isArray(body.members) || body.members.length > 500) {
      return NextResponse.json({ error: "스텝 목록 데이터가 올바르지 않습니다." }, { status: 400 });
    }

    const members = body.members.map((member, index) => normalizeMemberInput(member, projectId, dailyPlanId, index));
    if (members.some((member) => !member)) {
      return NextResponse.json({ error: "스텝 행 ID 또는 입력값이 올바르지 않습니다." }, { status: 400 });
    }
    const normalizedMembers = members as DailyPlanStaffMember[];
    if (new Set(normalizedMembers.map((member) => member.id)).size !== normalizedMembers.length) {
      return NextResponse.json({ error: "중복된 스텝 행이 있습니다." }, { status: 400 });
    }

    const ids = normalizedMembers.map((member) => member.id);
    if (ids.length > 0) {
      const { data: idRows, error: idError } = await supabase
        .from("daily_plan_staff_members")
        .select("id,project_id,daily_plan_id")
        .in("id", ids);
      if (idError) throw idError;
      if ((idRows ?? []).some((row) => row.project_id !== projectId || row.daily_plan_id !== dailyPlanId)) {
        return NextResponse.json({ error: "다른 프로젝트 또는 회차의 스텝 행은 수정할 수 없습니다." }, { status: 409 });
      }
    }

    const { data: existingRows, error: existingError } = await supabase
      .from("daily_plan_staff_members")
      .select("id,department")
      .eq("project_id", projectId)
      .eq("daily_plan_id", dailyPlanId);
    if (existingError) throw existingError;

    const rows = normalizedMembers.map((member, index) => ({
      id: member.id,
      project_id: projectId,
      daily_plan_id: dailyPlanId,
      department: member.department,
      name: member.name,
      phone: member.phone,
      province: member.province,
      city_district: member.cityDistrict,
      notes: member.notes,
      sort_order: index + 1
    }));
    if (rows.length > 0) {
      const { error } = await supabase.from("daily_plan_staff_members").upsert(rows, { onConflict: "id" });
      if (error) throw error;
    }

    const submittedIds = new Set(ids);
    const deletedRows = (existingRows ?? []).filter((row) => !submittedIds.has(row.id));
    if (deletedRows.length > 0) {
      const { error } = await supabase
        .from("daily_plan_staff_members")
        .delete()
        .eq("project_id", projectId)
        .eq("daily_plan_id", dailyPlanId)
        .in("id", deletedRows.map((row) => row.id));
      if (error) throw error;
    }

    const counts = getStaffCountsFromMembers(normalizedMembers);
    const affectedDepartments = new Set<string>([
      ...normalizedMembers.map((member) => member.department),
      ...(existingRows ?? []).map((row) => normalizeStaffDepartment(row.department)),
      ...deletedRows.map((row) => normalizeStaffDepartment(row.department))
    ]);
    const nextMemo = encodeDailyPlanMemo(
      applyStaffCountsToPrintMeta(decodeDailyPlanMemo(String(plan.memo ?? "")), counts, affectedDepartments)
    );
    const { error: planError } = await supabase
      .from("daily_plans")
      .update({ memo: nextMemo })
      .eq("project_id", projectId)
      .eq("id", dailyPlanId);
    if (planError) throw planError;

    const { data: savedRows, error: savedError } = await supabase
      .from("daily_plan_staff_members")
      .select("*")
      .eq("project_id", projectId)
      .eq("daily_plan_id", dailyPlanId)
      .order("sort_order")
      .order("created_at");
    if (savedError) throw savedError;

    return NextResponse.json({ members: savedRows ?? [], warnings: [] });
  } catch (error) {
    return staffRouteError(error, "스텝 리스트를 저장하지 못했습니다.");
  }
}

async function requireAdminScope(
  request: NextRequest,
  context: { params: Promise<{ projectId: string; dailyPlanId: string }> }
) {
  const { projectId: routeProjectId, dailyPlanId } = await context.params;
  const projectId = normalizeProjectId(routeProjectId);
  if (!isValidDatabaseProjectId(projectId)) {
    return NextResponse.json({ error: "프로젝트 ID가 올바르지 않습니다." }, { status: 400 });
  }
  const grant = await getAccessGrant(request, projectId);
  if (!grant || grant.role !== "admin") {
    return NextResponse.json({ error: "관리자 권한이 필요합니다." }, { status: grant ? 403 : 401 });
  }
  const supabase = requireProjectAccessDb();
  const { data: plan, error } = await supabase
    .from("daily_plans")
    .select("id,memo")
    .eq("project_id", projectId)
    .eq("id", dailyPlanId)
    .maybeSingle();
  if (error) throw error;
  if (!plan) return NextResponse.json({ error: "일촬표를 찾을 수 없습니다." }, { status: 404 });
  return { projectId, dailyPlanId, supabase, plan };
}

function normalizeMemberInput(
  member: StaffMemberInput,
  projectId: string,
  dailyPlanId: string,
  index: number
): DailyPlanStaffMember | null {
  const id = String(member.id ?? "").trim();
  if (!isUuid(id)) return null;
  const now = new Date().toISOString();
  return {
    id,
    projectId,
    dailyPlanId,
    department: normalizeStaffDepartment(member.department),
    name: normalizeText(member.name, 100),
    phone: formatKoreanPhoneNumber(normalizeText(member.phone, 30)),
    province: normalizeText(member.province, 50),
    cityDistrict: normalizeText(member.cityDistrict, 50),
    notes: normalizeText(member.notes, 2000),
    sortOrder: index + 1,
    createdAt: now,
    updatedAt: now
  };
}

function normalizeText(value: unknown, maxLength: number) {
  return String(value ?? "").slice(0, maxLength);
}

function isUuid(value: string) {
  return /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(value);
}

function staffRouteError(error: unknown, fallback: string) {
  const code = error && typeof error === "object" && "code" in error ? String(error.code) : "";
  const message = error instanceof Error ? error.message : "";
  const migrationMissing = code === "42P01" || code === "PGRST205" || /daily_plan_staff_members/i.test(message);
  return NextResponse.json(
    { error: migrationMissing ? "스텝 리스트 migration을 먼저 적용해주세요." : fallback },
    { status: error instanceof ProjectAccessUnavailableError || migrationMissing ? 503 : 500 }
  );
}
