import { NextRequest, NextResponse } from "next/server";
import { normalizeStaffDepartment } from "@/lib/dailyPlan/staffList";
import { formatKoreanPhoneNumber } from "@/lib/formatKoreanPhoneNumber";
import { getAccessGrant, ProjectAccessUnavailableError, requireProjectAccessDb } from "@/lib/projectAccess/server";
import { isValidDatabaseProjectId, normalizeProjectId } from "@/lib/projectId";
import type { ProjectStaffDepartment, ProjectStaffMember } from "@/lib/types";

type StaffMemberInput = {
  id?: unknown;
  department?: unknown;
  name?: unknown;
  phone?: unknown;
  location?: unknown;
  notes?: unknown;
};

type StaffDepartmentInput = {
  id?: unknown;
  name?: unknown;
};

export async function GET(request: NextRequest, context: { params: Promise<{ projectId: string }> }) {
  try {
    const scope = await requireAdminScope(request, context);
    if (scope instanceof NextResponse) return scope;
    const { projectId, supabase } = scope;
    const { data: rows, error } = await supabase
      .from("project_staff_members")
      .select("*")
      .eq("project_id", projectId)
      .order("sort_order")
      .order("created_at");
    if (error) throw error;
    const { data: departmentRows, error: departmentError } = await supabase
      .from("project_staff_departments")
      .select("*")
      .eq("project_id", projectId)
      .order("sort_order")
      .order("created_at");
    if (departmentError) throw departmentError;
    return NextResponse.json({
      members: rows ?? [],
      departments: departmentRows ?? [],
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

    const members = body.members.map((member, index) => normalizeMemberInput(member, projectId, index));
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
    if (ids.length > 0) {
      const { data: idRows, error: idError } = await supabase
        .from("project_staff_members")
        .select("id,project_id")
        .in("id", ids);
      if (idError) throw idError;
      if ((idRows ?? []).some((row) => row.project_id !== projectId)) {
        return NextResponse.json({ error: "다른 프로젝트의 스탭 행은 수정할 수 없습니다." }, { status: 409 });
      }
    }
    const departmentIds = normalizedDepartments.map((department) => department.id);
    if (departmentIds.length > 0) {
      const { data: departmentIdRows, error: departmentIdError } = await supabase
        .from("project_staff_departments")
        .select("id,project_id")
        .in("id", departmentIds);
      if (departmentIdError) throw departmentIdError;
      if ((departmentIdRows ?? []).some((row) => row.project_id !== projectId)) {
        return NextResponse.json({ error: "다른 프로젝트의 부서 옵션은 수정할 수 없습니다." }, { status: 409 });
      }
    }

    const { data: existingRows, error: existingError } = await supabase
      .from("project_staff_members")
      .select("id")
      .eq("project_id", projectId);
    if (existingError) throw existingError;
    const { data: existingDepartmentRows, error: existingDepartmentError } = await supabase
      .from("project_staff_departments")
      .select("id")
      .eq("project_id", projectId);
    if (existingDepartmentError) throw existingDepartmentError;

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
      notes: member.notes,
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

    const { data: savedRows, error: savedError } = await supabase
      .from("project_staff_members")
      .select("*")
      .eq("project_id", projectId)
      .order("sort_order")
      .order("created_at");
    if (savedError) throw savedError;
    const { data: savedDepartmentRows, error: savedDepartmentError } = await supabase
      .from("project_staff_departments")
      .select("*")
      .eq("project_id", projectId)
      .order("sort_order")
      .order("created_at");
    if (savedDepartmentError) throw savedDepartmentError;

    return NextResponse.json({
      members: savedRows ?? [],
      departments: savedDepartmentRows ?? [],
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

function normalizeMemberInput(
  member: StaffMemberInput,
  projectId: string,
  index: number
): ProjectStaffMember | null {
  const id = String(member.id ?? "").trim();
  if (!isUuid(id)) return null;
  const now = new Date().toISOString();
  return {
    id,
    projectId,
    department: normalizeStaffDepartment(member.department),
    name: normalizeText(member.name, 100),
    phone: formatKoreanPhoneNumber(normalizeText(member.phone, 30)),
    location: normalizeText(member.location, 120),
    notes: normalizeText(member.notes, 2000),
    sortOrder: index + 1,
    createdAt: now,
    updatedAt: now
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
