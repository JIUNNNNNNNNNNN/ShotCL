import { NextRequest, NextResponse } from "next/server";
import { normalizeStaffDepartment } from "@/lib/dailyPlan/staffList";
import { formatKoreanPhoneNumber } from "@/lib/formatKoreanPhoneNumber";
import { getAccessGrant, ProjectAccessUnavailableError, requireProjectAccessDb } from "@/lib/projectAccess/server";
import { isValidDatabaseProjectId, normalizeProjectId } from "@/lib/projectId";
import {
  normalizeExcludedEpisodeNumbers,
  normalizeStaffTotalEpisodes
} from "@/lib/staffParticipation";
import {
  decodeProjectStaffNotes,
  encodeProjectStaffNotes
} from "@/lib/staffRoleMetadata";
import type { ProjectStaffDepartment, ProjectStaffMember } from "@/lib/types";

type StaffMemberInput = {
  id?: unknown;
  department?: unknown;
  role?: unknown;
  name?: unknown;
  phone?: unknown;
  location?: unknown;
  notes?: unknown;
  excludedEpisodeNumbers?: unknown;
};

type StaffDepartmentInput = {
  id?: unknown;
  name?: unknown;
};

export async function GET(request: NextRequest, context: { params: Promise<{ projectId: string }> }) {
  try {
    const scope = await requireReadScope(request, context);
    if (scope instanceof NextResponse) return scope;
    const { projectId, supabase } = scope;
    const includeTotalEpisodes = request.nextUrl.searchParams.get("includeTotalEpisodes") === "1";
    const basicInfoRequest = includeTotalEpisodes
      ? supabase
        .from("project_basic_info")
        .select("total_episodes")
        .eq("project_id", projectId)
        .maybeSingle()
      : Promise.resolve({ data: null, error: null });
    const [
      { data: rows, error },
      { data: departmentRows, error: departmentError },
      { data: basicInfoRow, error: basicInfoError }
    ] = await Promise.all([
      supabase
        .from("project_staff_members")
        .select("*")
        .eq("project_id", projectId)
        .order("sort_order")
        .order("created_at"),
      supabase
        .from("project_staff_departments")
        .select("*")
        .eq("project_id", projectId)
        .order("sort_order")
        .order("created_at"),
      basicInfoRequest
    ]);
    if (error) throw error;
    if (departmentError) throw departmentError;
    if (basicInfoError) throw basicInfoError;
    return NextResponse.json({
      members: (rows ?? []).map(staffMemberResponseRow),
      departments: departmentRows ?? [],
      totalEpisodes: normalizeStaffTotalEpisodes(basicInfoRow?.total_episodes),
      warnings: []
    });
  } catch (error) {
    return staffRouteError(error, "스탭 리스트를 불러오지 못했습니다.");
  }
}

export async function PUT(request: NextRequest, context: { params: Promise<{ projectId: string }> }) {
  try {
    const scope = await requireAdminScope(request, context);
    if (scope instanceof NextResponse) return scope;
    const { projectId, supabase } = scope;
    const body = (await request.json()) as {
      members?: StaffMemberInput[];
      departments?: StaffDepartmentInput[];
    };
    if (!Array.isArray(body.members) || body.members.length > 500) {
      return NextResponse.json({ error: "스탭 목록 데이터가 올바르지 않습니다." }, { status: 400 });
    }
    if (!Array.isArray(body.departments) || body.departments.length > 100) {
      return NextResponse.json({ error: "부서 목록 데이터가 올바르지 않습니다." }, { status: 400 });
    }

    const { data: basicInfoRow, error: basicInfoError } = await supabase
      .from("project_basic_info")
      .select("total_episodes")
      .eq("project_id", projectId)
      .maybeSingle();
    if (basicInfoError) throw basicInfoError;
    const totalEpisodes = normalizeStaffTotalEpisodes(basicInfoRow?.total_episodes);
    const members = body.members.map((member, index) => (
      normalizeMemberInput(member, projectId, index, totalEpisodes)
    ));
    if (members.some((member) => !member)) {
      return NextResponse.json({ error: "스탭 행 ID 또는 입력값이 올바르지 않습니다." }, { status: 400 });
    }
    const normalizedMembers = members as ProjectStaffMember[];
    if (new Set(normalizedMembers.map((member) => member.id)).size !== normalizedMembers.length) {
      return NextResponse.json({ error: "중복된 스탭 행이 있습니다." }, { status: 400 });
    }
    const departments = body.departments.map((department, index) => (
      normalizeDepartmentInput(department, projectId, index)
    ));
    if (departments.some((department) => !department)) {
      return NextResponse.json({ error: "부서 옵션 ID 또는 입력값이 올바르지 않습니다." }, { status: 400 });
    }
    const normalizedDepartments = departments as ProjectStaffDepartment[];
    if (new Set(normalizedDepartments.map((department) => department.id)).size !== normalizedDepartments.length) {
      return NextResponse.json({ error: "중복된 부서 옵션이 있습니다." }, { status: 400 });
    }
    const departmentNames = normalizedDepartments.map((department) => department.name.toLocaleLowerCase("ko-KR"));
    if (new Set(departmentNames).size !== departmentNames.length) {
      return NextResponse.json({ error: "같은 이름의 부서는 한 번만 등록할 수 있습니다." }, { status: 400 });
    }

    const ids = normalizedMembers.map((member) => member.id);
    const departmentIds = normalizedDepartments.map((department) => department.id);
    const [
      idRowsResult,
      departmentIdRowsResult,
      existingRowsResult,
      existingDepartmentRowsResult
    ] = await Promise.all([
      ids.length > 0
        ? supabase
          .from("project_staff_members")
          .select("id,project_id")
          .in("id", ids)
        : Promise.resolve({ data: [], error: null }),
      departmentIds.length > 0
        ? supabase
          .from("project_staff_departments")
          .select("id,project_id")
          .in("id", departmentIds)
        : Promise.resolve({ data: [], error: null }),
      supabase
        .from("project_staff_members")
        .select("id")
        .eq("project_id", projectId),
      supabase
        .from("project_staff_departments")
        .select("id")
        .eq("project_id", projectId)
    ]);
    if (idRowsResult.error) throw idRowsResult.error;
    if ((idRowsResult.data ?? []).some((row) => row.project_id !== projectId)) {
      return NextResponse.json({ error: "다른 프로젝트의 스탭 행은 수정할 수 없습니다." }, { status: 409 });
    }
    if (departmentIdRowsResult.error) throw departmentIdRowsResult.error;
    if ((departmentIdRowsResult.data ?? []).some((row) => row.project_id !== projectId)) {
      return NextResponse.json({ error: "다른 프로젝트의 부서 옵션은 수정할 수 없습니다." }, { status: 409 });
    }
    if (existingRowsResult.error) throw existingRowsResult.error;
    if (existingDepartmentRowsResult.error) throw existingDepartmentRowsResult.error;
    const existingRows = existingRowsResult.data;
    const existingDepartmentRows = existingDepartmentRowsResult.data;

    const departmentRows = normalizedDepartments.map((department, index) => ({
      id: department.id,
      project_id: projectId,
      name: department.name,
      sort_order: index + 1
    }));
    if (departmentRows.length > 0) {
      const { error } = await supabase
        .from("project_staff_departments")
        .upsert(departmentRows, { onConflict: "id" });
      if (error) throw error;
    }

    const rows = normalizedMembers.map((member, index) => ({
      id: member.id,
      project_id: projectId,
      department: member.department,
      name: member.name,
      phone: member.phone,
      location: member.location,
      notes: encodeProjectStaffNotes(
        member.role,
        member.notes,
        member.excludedEpisodeNumbers
      ),
      sort_order: index + 1
    }));
    if (rows.length > 0) {
      const { error } = await supabase.from("project_staff_members").upsert(rows, { onConflict: "id" });
      if (error) throw error;
    }

    const submittedDepartmentIds = new Set(departmentIds);
    const deletedDepartmentRows = (existingDepartmentRows ?? []).filter((
      row
    ) => !submittedDepartmentIds.has(row.id));
    if (deletedDepartmentRows.length > 0) {
      const { error } = await supabase
        .from("project_staff_departments")
        .delete()
        .eq("project_id", projectId)
        .in("id", deletedDepartmentRows.map((row) => row.id));
      if (error) throw error;
    }

    const submittedIds = new Set(ids);
    const deletedRows = (existingRows ?? []).filter((row) => !submittedIds.has(row.id));
    if (deletedRows.length > 0) {
      const { error } = await supabase
        .from("project_staff_members")
        .delete()
        .eq("project_id", projectId)
        .in("id", deletedRows.map((row) => row.id));
      if (error) throw error;
    }

    const [savedRowsResult, savedDepartmentRowsResult] = await Promise.all([
      supabase
        .from("project_staff_members")
        .select("*")
        .eq("project_id", projectId)
        .order("sort_order")
        .order("created_at"),
      supabase
        .from("project_staff_departments")
        .select("*")
        .eq("project_id", projectId)
        .order("sort_order")
        .order("created_at")
    ]);
    if (savedRowsResult.error) throw savedRowsResult.error;
    if (savedDepartmentRowsResult.error) throw savedDepartmentRowsResult.error;
    const savedRows = savedRowsResult.data;
    const savedDepartmentRows = savedDepartmentRowsResult.data;

    return NextResponse.json({
      members: (savedRows ?? []).map(staffMemberResponseRow),
      departments: savedDepartmentRows ?? [],
      totalEpisodes,
      warnings: []
    });
  } catch (error) {
    return staffRouteError(error, "스탭 리스트를 저장하지 못했습니다.");
  }
}

async function requireAdminScope(
  request: NextRequest,
  context: { params: Promise<{ projectId: string }> }
) {
  const { projectId: routeProjectId } = await context.params;
  const projectId = normalizeProjectId(routeProjectId);
  if (!isValidDatabaseProjectId(projectId)) {
    return NextResponse.json({ error: "프로젝트 ID가 올바르지 않습니다." }, { status: 400 });
  }
  const grant = await getAccessGrant(request, projectId);
  if (!grant || grant.role !== "admin") {
    return NextResponse.json({ error: "Key staff 권한이 필요합니다." }, { status: grant ? 403 : 401 });
  }
  return { projectId, supabase: requireProjectAccessDb() };
}

async function requireReadScope(
  request: NextRequest,
  context: { params: Promise<{ projectId: string }> }
) {
  const { projectId: routeProjectId } = await context.params;
  const projectId = normalizeProjectId(routeProjectId);
  if (!isValidDatabaseProjectId(projectId)) {
    return NextResponse.json({ error: "프로젝트 ID가 올바르지 않습니다." }, { status: 400 });
  }
  const grant = await getAccessGrant(request, projectId);
  if (!grant || (grant.role !== "admin" && grant.role !== "progress")) {
    return NextResponse.json(
      { error: "프로젝트 스탭 리스트를 확인할 권한이 없습니다." },
      { status: grant ? 403 : 401 }
    );
  }
  return { projectId, supabase: requireProjectAccessDb() };
}

function normalizeMemberInput(
  member: StaffMemberInput,
  projectId: string,
  index: number,
  totalEpisodes: number
): ProjectStaffMember | null {
  const id = String(member.id ?? "").trim();
  if (!isUuid(id)) return null;
  const now = new Date().toISOString();
  return {
    id,
    projectId,
    department: normalizeStaffDepartment(member.department),
    role: normalizeText(member.role, 100).trim(),
    name: normalizeText(member.name, 100),
    phone: formatKoreanPhoneNumber(normalizeText(member.phone, 30)),
    location: normalizeText(member.location, 120),
    notes: normalizeText(member.notes, 2000),
    excludedEpisodeNumbers: normalizeExcludedEpisodeNumbers(
      member.excludedEpisodeNumbers,
      totalEpisodes
    ),
    sortOrder: index + 1,
    createdAt: now,
    updatedAt: now
  };
}

function staffMemberResponseRow(row: Record<string, unknown>) {
  const decodedNotes = decodeProjectStaffNotes(row.notes);
  return {
    ...row,
    role: decodedNotes.role,
    notes: decodedNotes.notes,
    excludedEpisodeNumbers: decodedNotes.excludedEpisodeNumbers
  };
}

function normalizeDepartmentInput(
  department: StaffDepartmentInput,
  projectId: string,
  index: number
): ProjectStaffDepartment | null {
  const id = String(department.id ?? "").trim();
  const name = normalizeText(department.name, 100).trim();
  if (!isUuid(id) || !name) return null;
  const now = new Date().toISOString();
  return {
    id,
    projectId,
    name,
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
  const message = error && typeof error === "object" && "message" in error
    ? String(error.message)
    : error instanceof Error
      ? error.message
      : "";
  const departmentMigrationMissing = (
    code === "42P01" ||
    code === "PGRST205"
  ) && /project_staff_departments/i.test(message);
  const memberMigrationMissing = (
    code === "42P01" ||
    code === "PGRST205"
  ) && /project_staff_members/i.test(message);
  const migrationMissing = departmentMigrationMissing || memberMigrationMissing;
  return NextResponse.json(
    {
      error: departmentMigrationMissing
        ? "프로젝트 부서 목록 migration을 먼저 적용해주세요."
        : memberMigrationMissing
          ? "프로젝트 스탭 리스트 migration을 먼저 적용해주세요."
          : fallback
    },
    { status: error instanceof ProjectAccessUnavailableError || migrationMissing ? 503 : 500 }
  );
}
