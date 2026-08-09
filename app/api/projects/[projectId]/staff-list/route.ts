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

type StaffReorderInput = {
  action?: unknown;
  department?: unknown;
  memberIds?: unknown;
  member?: unknown;
  expectedUpdatedAt?: unknown;
};

type StaffDeleteInput = {
  memberId?: unknown;
};

const STAFF_MEMBER_COLUMNS = "id,project_id,department,name,phone,location,notes,sort_order,created_at,updated_at" as const;
const STAFF_DEPARTMENT_COLUMNS = "id,project_id,name,sort_order,created_at,updated_at" as const;

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

/** 같은 부서에 속한 스탭 ID 전체를 한 번에 받아 기존 sort_order 슬롯 안에서 재배치합니다. */
export async function PATCH(request: NextRequest, context: { params: Promise<{ projectId: string }> }) {
  try {
    const scope = await requireAdminScope(request, context);
    if (scope instanceof NextResponse) return scope;
    const { projectId, supabase } = scope;
    const body = (await request.json()) as StaffReorderInput | null;
    if (body?.action === "update-member") {
      return await updateStaffMemberDraft(supabase, projectId, body);
    }
    if (body?.action === "update-department") {
      return await updateStaffDepartmentDraft(supabase, projectId, body);
    }
    if (!body || typeof body.department !== "string" || !Array.isArray(body.memberIds) || body.memberIds.length === 0 || body.memberIds.length > 500) {
      return NextResponse.json({ error: "스탭 순서 데이터가 올바르지 않습니다." }, { status: 400 });
    }
    const departmentKey = staffDepartmentScopeKey(body.department);

    const memberIds = body.memberIds.map((value) => String(value ?? "").trim());
    if (memberIds.some((id) => !isUuid(id)) || new Set(memberIds).size !== memberIds.length) {
      return NextResponse.json({ error: "중복되거나 올바르지 않은 스탭 행 ID가 있습니다." }, { status: 400 });
    }

    const [ownerRowsResult, projectRowsResult] = await Promise.all([
      supabase
        .from("project_staff_members")
        .select("id,project_id")
        .in("id", memberIds),
      supabase
        .from("project_staff_members")
        .select("id,project_id,department,sort_order,created_at,updated_at")
        .eq("project_id", projectId)
        .order("sort_order")
        .order("created_at")
        .order("id")
    ]);
    if (ownerRowsResult.error) throw ownerRowsResult.error;
    if (projectRowsResult.error) throw projectRowsResult.error;

    const ownerRows = ownerRowsResult.data ?? [];
    if (ownerRows.some((row) => row.project_id !== projectId)) {
      return NextResponse.json({ error: "다른 프로젝트의 스탭 행은 이동할 수 없습니다." }, { status: 409 });
    }
    if (ownerRows.length !== memberIds.length) {
      return NextResponse.json({ error: "스탭 목록이 변경되었습니다. 다시 확인해주세요." }, { status: 409 });
    }

    const sectionRows = (projectRowsResult.data ?? []).filter((row) => (
      staffDepartmentScopeKey(row.department) === departmentKey
    ));
    const sectionIdSet = new Set(sectionRows.map((row) => String(row.id)));
    if (
      sectionRows.length !== memberIds.length
      || memberIds.some((id) => !sectionIdSet.has(id))
    ) {
      return NextResponse.json({ error: "해당 부서의 스탭 목록이 변경되었습니다. 다시 확인해주세요." }, { status: 409 });
    }

    const currentIds = sectionRows.map((row) => String(row.id));
    const rowById = new Map(sectionRows.map((row) => [String(row.id), row]));
    const currentSortOrderSlots = sectionRows.map((row, index) => {
      const sortOrder = Number(row.sort_order);
      return Number.isInteger(sortOrder) && sortOrder > 0 ? sortOrder : index + 1;
    });
    const hasStableSlots = currentSortOrderSlots.every((sortOrder, index) => (
      index === 0 || sortOrder > currentSortOrderSlots[index - 1]
    ));
    const projectPositionById = new Map((projectRowsResult.data ?? []).map((row, index) => (
      [String(row.id), index + 1]
    )));
    const sortOrderSlots = hasStableSlots
      ? currentSortOrderSlots
      : sectionRows.map((row, index) => projectPositionById.get(String(row.id)) ?? index + 1);
    if (
      hasStableSlots
      && currentIds.every((id, index) => id === memberIds[index])
    ) {
      return NextResponse.json({
        orders: sectionRows.map(staffOrderResponseRow)
      });
    }
    const updates = memberIds.map((id, index) => {
      const row = rowById.get(id)!;
      return {
        id,
        previousSortOrder: Number(row.sort_order) || sortOrderSlots[index],
        previousUpdatedAt: String(row.updated_at ?? ""),
        nextSortOrder: sortOrderSlots[index]
      };
    }).filter((update) => update.previousSortOrder !== update.nextSortOrder);

    // 한 HTTP mutation 안에서 순서 필드만 갱신합니다. 다른 탭의 이름·연락처·메모는 덮어쓰지 않습니다.
    const updateResults = await settleWithConcurrency(updates, 8, async (update) => {
      const { data, error } = await supabase
        .from("project_staff_members")
        .update({ sort_order: update.nextSortOrder })
        .eq("project_id", projectId)
        .eq("id", update.id)
        .eq("updated_at", update.previousUpdatedAt)
        .select("id,sort_order,updated_at")
        .maybeSingle();
      if (error) throw error;
      if (!data) throw new StaffReorderConflictError();
      return { update, saved: data };
    });
    const successfulUpdates = updateResults.flatMap((result) => (
      result.status === "fulfilled" ? [result.value] : []
    ));
    const failedUpdates = updateResults.filter((result): result is PromiseRejectedResult => (
      result.status === "rejected"
    ));
    if (failedUpdates.length > 0) {
      // 여러 update 중 일부만 성공했다면 성공 응답의 updated_at까지 일치할 때만 원래 슬롯으로 복원합니다.
      const rollbackResults = await settleWithConcurrency(successfulUpdates, 8, async ({ update, saved }) => {
        const { data, error } = await supabase
          .from("project_staff_members")
          .update({ sort_order: update.previousSortOrder })
          .eq("project_id", projectId)
          .eq("id", update.id)
          .eq("updated_at", String(saved.updated_at ?? ""))
          .select("id")
          .maybeSingle();
        if (error) throw error;
        if (!data) throw new StaffReorderRollbackError();
        return data;
      });
      if (rollbackResults.some((result) => result.status === "rejected")) {
        return NextResponse.json(
          { error: "스탭 순서를 완전히 복구하지 못했습니다. 목록을 다시 확인해주세요." },
          { status: 500 }
        );
      }
      const databaseFailure = failedUpdates.find((result) => (
        !(result.reason instanceof StaffReorderConflictError)
      ));
      if (databaseFailure) throw databaseFailure.reason;
      return NextResponse.json(
        { error: "스탭 목록이 다른 곳에서 변경되었습니다. 다시 확인해주세요." },
        { status: 409 }
      );
    }

    const savedById = new Map(successfulUpdates.map(({ saved }) => [String(saved.id), saved]));
    return NextResponse.json({
      orders: memberIds.map((id) => staffOrderResponseRow(savedById.get(id) ?? rowById.get(id) ?? {}))
    });
  } catch (error) {
    return staffRouteError(error, "스탭 순서를 저장하지 못했습니다.");
  }
}

async function updateStaffMemberDraft(
  supabase: ReturnType<typeof requireProjectAccessDb>,
  projectId: string,
  body: StaffReorderInput
) {
  if (!body.member || typeof body.member !== "object" || Array.isArray(body.member)) {
    return NextResponse.json({ error: "자동 저장할 스탭 입력값이 올바르지 않습니다." }, { status: 400 });
  }
  const input = body.member as StaffMemberInput;
  const id = String(input.id ?? "").trim();
  const expectedUpdatedAt = normalizeExpectedUpdatedAt(body.expectedUpdatedAt, "스탭 행");
  if (!isUuid(id)) {
    return NextResponse.json({ error: "스탭 행 ID가 올바르지 않습니다." }, { status: 400 });
  }
  if (!expectedUpdatedAt.ok) {
    return NextResponse.json({ error: expectedUpdatedAt.error }, { status: 400 });
  }
  const normalizedPatch = normalizeStaffMemberPatch(input);
  if (!normalizedPatch.ok) {
    return NextResponse.json({ error: normalizedPatch.error }, { status: 400 });
  }
  const { data: saved, error: saveError } = await supabase
    .from("project_staff_members")
    .update(normalizedPatch.fields)
    .eq("project_id", projectId)
    .eq("id", id)
    .eq("updated_at", expectedUpdatedAt.value)
    .select(STAFF_MEMBER_COLUMNS)
    .maybeSingle();
  if (saveError) throw saveError;
  if (!saved) {
    const { data: latest, error: latestError } = await supabase
      .from("project_staff_members")
      .select(STAFF_MEMBER_COLUMNS)
      .eq("project_id", projectId)
      .eq("id", id)
      .maybeSingle();
    if (latestError) throw latestError;
    if (!latest) {
      return NextResponse.json({ error: "자동 저장할 스탭을 찾을 수 없습니다." }, { status: 404 });
    }
    return NextResponse.json(
      { error: "스탭 정보가 다른 곳에서 변경되었습니다. 최신 내용을 확인해주세요.", member: staffMemberResponseRow(latest) },
      { status: 409 }
    );
  }
  return NextResponse.json({ ok: true, member: staffMemberResponseRow(saved) });
}

async function updateStaffDepartmentDraft(
  supabase: ReturnType<typeof requireProjectAccessDb>,
  projectId: string,
  body: StaffReorderInput
) {
  if (!body.department || typeof body.department !== "object" || Array.isArray(body.department)) {
    return NextResponse.json({ error: "자동 저장할 부서 입력값이 올바르지 않습니다." }, { status: 400 });
  }
  const input = body.department as StaffDepartmentInput;
  const id = String(input.id ?? "").trim();
  const name = normalizeText(input.name, 100).trim();
  const expectedUpdatedAt = normalizeExpectedUpdatedAt(body.expectedUpdatedAt, "부서");
  if (!isUuid(id)) {
    return NextResponse.json({ error: "부서 ID가 올바르지 않습니다." }, { status: 400 });
  }
  if (!name) {
    return NextResponse.json({ error: "부서 이름을 입력해주세요." }, { status: 400 });
  }
  if (!expectedUpdatedAt.ok) {
    return NextResponse.json({ error: expectedUpdatedAt.error }, { status: 400 });
  }
  const { data: saved, error: saveError } = await supabase
    .from("project_staff_departments")
    .update({ name })
    .eq("project_id", projectId)
    .eq("id", id)
    .eq("updated_at", expectedUpdatedAt.value)
    .select(STAFF_DEPARTMENT_COLUMNS)
    .maybeSingle();
  if (saveError?.code === "23505") {
    // 중복 이름은 낙관적 잠금 충돌이 아니라 입력값 제약 위반입니다.
    // 409를 쓰면 클라이언트가 최신 버전을 다시 적용하는 CAS 충돌로 오인합니다.
    return NextResponse.json({ error: "같은 이름의 부서는 한 번만 등록할 수 있습니다." }, { status: 422 });
  }
  if (saveError) throw saveError;
  if (!saved) {
    const { data: latest, error: latestError } = await supabase
      .from("project_staff_departments")
      .select(STAFF_DEPARTMENT_COLUMNS)
      .eq("project_id", projectId)
      .eq("id", id)
      .maybeSingle();
    if (latestError) throw latestError;
    if (!latest) {
      return NextResponse.json({ error: "자동 저장할 부서를 찾을 수 없습니다." }, { status: 404 });
    }
    return NextResponse.json(
      { error: "부서 정보가 다른 곳에서 변경되었습니다. 최신 내용을 확인해주세요.", department: latest },
      { status: 409 }
    );
  }
  return NextResponse.json({ ok: true, department: saved });
}

/** 프로젝트와 stable staff ID를 함께 제한해 여러 번 호출해도 안전하게 같은 결과를 냅니다. */
export async function DELETE(request: NextRequest, context: { params: Promise<{ projectId: string }> }) {
  try {
    const scope = await requireAdminScope(request, context);
    if (scope instanceof NextResponse) return scope;
    const { projectId, supabase } = scope;
    const body = (await request.json()) as StaffDeleteInput | null;
    if (!body) {
      return NextResponse.json({ error: "스탭 행 ID가 올바르지 않습니다." }, { status: 400 });
    }
    const memberId = String(body.memberId ?? "").trim();
    if (!isUuid(memberId)) {
      return NextResponse.json({ error: "스탭 행 ID가 올바르지 않습니다." }, { status: 400 });
    }

    const { data: deletedRows, error } = await supabase
      .from("project_staff_members")
      .delete()
      .eq("project_id", projectId)
      .eq("id", memberId)
      .select("id");
    if (error) throw error;

    return NextResponse.json({
      memberId,
      deleted: (deletedRows ?? []).length > 0
    });
  } catch (error) {
    return staffRouteError(error, "스탭을 삭제하지 못했습니다.");
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

function normalizeStaffMemberPatch(input: StaffMemberInput):
  | { ok: true; fields: Record<string, unknown> }
  | { ok: false; error: string } {
  const fields: Record<string, unknown> = {};
  const has = (key: keyof StaffMemberInput) => Object.prototype.hasOwnProperty.call(input, key);
  if (has("department")) fields.department = normalizeStaffDepartment(input.department);
  if (has("name")) fields.name = normalizeText(input.name, 100);
  if (has("phone")) fields.phone = formatKoreanPhoneNumber(normalizeText(input.phone, 30));
  if (has("location")) fields.location = normalizeText(input.location, 120);
  if (has("notes")) {
    const decoded = decodeProjectStaffNotes(input.notes);
    fields.notes = encodeProjectStaffNotes(
      decoded.role,
      decoded.notes,
      decoded.excludedEpisodeNumbers
    );
  }
  if (Object.keys(fields).length === 0) {
    return { ok: false, error: "자동 저장할 스탭 변경사항이 없습니다." };
  }
  return { ok: true, fields };
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

function staffOrderResponseRow(row: Record<string, unknown>) {
  return {
    id: String(row.id ?? ""),
    sortOrder: Number(row.sort_order) || 1,
    updatedAt: String(row.updated_at ?? "")
  };
}

function staffDepartmentScopeKey(value: unknown) {
  return normalizeStaffDepartment(value).toLocaleLowerCase("ko-KR");
}

class StaffReorderConflictError extends Error {
  constructor() {
    super("STAFF_REORDER_CONFLICT");
    this.name = "StaffReorderConflictError";
  }
}

class StaffReorderRollbackError extends Error {
  constructor() {
    super("STAFF_REORDER_ROLLBACK_FAILED");
    this.name = "StaffReorderRollbackError";
  }
}

async function settleWithConcurrency<T, R>(
  items: T[],
  limit: number,
  worker: (item: T, index: number) => Promise<R>
): Promise<PromiseSettledResult<R>[]> {
  if (items.length === 0) return [];
  const results = new Array<PromiseSettledResult<R>>(items.length);
  let nextIndex = 0;
  async function runWorker() {
    while (nextIndex < items.length) {
      const index = nextIndex;
      nextIndex += 1;
      try {
        results[index] = { status: "fulfilled", value: await worker(items[index], index) };
      } catch (reason) {
        results[index] = { status: "rejected", reason };
      }
    }
  }
  await Promise.all(Array.from(
    { length: Math.min(Math.max(1, limit), items.length) },
    () => runWorker()
  ));
  return results;
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

function normalizeExpectedUpdatedAt(value: unknown, label: string):
  | { ok: true; value: string }
  | { ok: false; error: string } {
  if (typeof value !== "string") {
    return { ok: false, error: `${label} 버전 정보가 올바르지 않습니다.` };
  }
  const normalized = value.trim();
  if (!normalized || normalized.length > 80 || Number.isNaN(Date.parse(normalized))) {
    return { ok: false, error: `${label} 버전 정보가 올바르지 않습니다.` };
  }
  return { ok: true, value: normalized };
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
