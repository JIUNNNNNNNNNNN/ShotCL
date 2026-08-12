import { NextRequest, NextResponse } from "next/server";
import {
  canAdministerProject,
  ProjectAccessUnavailableError,
  requireProjectAccessDb
} from "@/lib/projectAccess/server";
import { normalizeProjectBasicInfo, validateProjectBasicInfo } from "@/lib/projectBasicInfo";
import { isValidDatabaseProjectId, normalizeProjectId } from "@/lib/projectId";
import {
  createProjectDeleteReceipt,
  ProjectDeleteReceiptError,
  verifyProjectDeleteReceipt
} from "@/lib/projectDeleteReceipt.server";
import type { ProjectActor, ProjectMainStaffMember } from "@/lib/types";

type RouteContext = { params: Promise<{ projectId: string }> };

const PROJECT_BASIC_INFO_COLUMNS = [
  "project_id",
  "total_episodes",
  "shooting_start_date",
  "shooting_end_date",
  "main_staff",
  "actors",
  "updated_at"
].join(",");
const BASIC_INFO_ENTITY_DELETE_RECEIPT_KIND = "basic-info-entity";
type BasicInfoEntityKind = "staff" | "actor";
type DeletedBasicInfoEntityReceipt = {
  kind: BasicInfoEntityKind;
  entity: ProjectMainStaffMember | ProjectActor;
  beforeId: string;
  afterId: string;
  index: number;
};

export async function GET(request: NextRequest, context: RouteContext) {
  try {
    const projectId = await getValidatedProjectId(context);
    if (!projectId) {
      return NextResponse.json({ error: "프로젝트 ID가 올바르지 않습니다." }, { status: 400 });
    }
    if (!(await canAdministerProject(request, projectId))) {
      return NextResponse.json({ error: "프로젝트 기본정보는 Key staff만 확인할 수 있습니다." }, { status: 403 });
    }

    const supabase = requireProjectAccessDb();
    const { data, error } = await supabase
      .from("project_basic_info")
      .select(PROJECT_BASIC_INFO_COLUMNS)
      .eq("project_id", projectId)
      .maybeSingle();
    if (error) throw error;

    return NextResponse.json({
      ok: true,
      basicInfo: data ? projectBasicInfoFromRow(data) : {}
    });
  } catch (error) {
    return basicInfoErrorResponse(
      error,
      "프로젝트 기본정보를 불러오지 못했습니다.",
      "프로젝트 기본정보를 확인할 권한이 없습니다."
    );
  }
}

export async function PATCH(request: NextRequest, context: RouteContext) {
  try {
    const projectId = await getValidatedProjectId(context);
    if (!projectId) {
      return NextResponse.json({ error: "프로젝트 ID가 올바르지 않습니다." }, { status: 400 });
    }
    if (!(await canAdministerProject(request, projectId))) {
      return NextResponse.json({ error: "프로젝트 기본정보는 Key staff만 수정할 수 있습니다." }, { status: 403 });
    }

    const body = (await request.json()) as {
      basicInfo?: unknown;
      operation?: unknown;
      kind?: unknown;
      id?: unknown;
      receipt?: unknown;
    };
    if (body.operation === "delete_entity") {
      return deleteBasicInfoEntity(projectId, body);
    }
    if (body.operation === "restore_deleted_entity" || body.operation === "finalize_deleted_entity") {
      const snapshot = readDeletedBasicInfoEntityReceipt(projectId, body.receipt);
      if (body.operation === "finalize_deleted_entity") {
        return NextResponse.json({ ok: true, finalized: true });
      }
      return restoreDeletedBasicInfoEntity(projectId, snapshot);
    }
    const validation = validateProjectBasicInfo(body.basicInfo);
    if (!validation.ok) {
      return NextResponse.json({ error: validation.error }, { status: 400 });
    }

    const supabase = requireProjectAccessDb();
    const savePayload = {
      project_id: projectId,
      total_episodes: validation.value.totalEpisodes,
      shooting_start_date: validation.value.shootingStartDate || null,
      shooting_end_date: validation.value.shootingEndDate || null,
      main_staff: validation.value.mainStaff,
      actors: validation.value.actors
    };
    logBasicInfoSavePayload(savePayload);
    const { data, error } = await supabase
      .from("project_basic_info")
      .upsert(savePayload, { onConflict: "project_id" })
      .select(PROJECT_BASIC_INFO_COLUMNS)
      .single();
    if (error) throw error;

    return NextResponse.json({
      ok: true,
      status: "saved",
      basicInfo: projectBasicInfoFromRow(data)
    });
  } catch (error) {
    return basicInfoErrorResponse(
      error,
      "프로젝트 기본정보를 저장하지 못했습니다.",
      "기본정보를 수정할 권한이 없습니다."
    );
  }
}

async function deleteBasicInfoEntity(
  projectId: string,
  body: { kind?: unknown; id?: unknown }
) {
  const kind = normalizeBasicInfoEntityKind(body.kind);
  const id = normalizeEntityId(body.id);
  if (!kind || !id) {
    return NextResponse.json({ error: "삭제할 기본정보 항목이 올바르지 않습니다." }, { status: 400 });
  }
  const supabase = requireProjectAccessDb();
  const { data: row, error: readError } = await supabase
    .from("project_basic_info")
    .select(PROJECT_BASIC_INFO_COLUMNS)
    .eq("project_id", projectId)
    .maybeSingle();
  if (readError) throw readError;
  if (!row) return NextResponse.json({ error: "프로젝트 기본정보를 찾을 수 없습니다." }, { status: 404 });
  const sourceRow = row as unknown as Record<string, unknown>;
  const basicInfo = projectBasicInfoFromRow(sourceRow);
  const collection = kind === "staff" ? basicInfo.mainStaff : basicInfo.actors;
  const index = collection.findIndex((entity) => entity.id === id);
  if (index < 0) return NextResponse.json({ error: "삭제할 기본정보 항목을 찾을 수 없습니다." }, { status: 404 });
  const snapshot: DeletedBasicInfoEntityReceipt = {
    kind,
    entity: collection[index],
    beforeId: index > 0 ? collection[index - 1].id : "",
    afterId: index + 1 < collection.length ? collection[index + 1].id : "",
    index
  };
  const receipt = createProjectDeleteReceipt({
    projectId,
    kind: BASIC_INFO_ENTITY_DELETE_RECEIPT_KIND,
    payload: snapshot
  });
  const nextCollection = collection.filter((entity) => entity.id !== id);
  const update = kind === "staff"
    ? { main_staff: nextCollection.map((member, sortOrder) => ({ ...member, sortOrder })) }
    : { actors: nextCollection };
  const { data: updated, error: updateError } = await supabase
    .from("project_basic_info")
    .update(update)
    .eq("project_id", projectId)
    .eq("updated_at", sourceRow.updated_at)
    .select(PROJECT_BASIC_INFO_COLUMNS)
    .maybeSingle();
  if (updateError) throw updateError;
  if (!updated) return basicInfoEntityConflictResponse();
  return NextResponse.json({ ok: true, receipt, basicInfo: projectBasicInfoFromRow(updated) });
}

async function restoreDeletedBasicInfoEntity(
  projectId: string,
  snapshot: DeletedBasicInfoEntityReceipt
) {
  const supabase = requireProjectAccessDb();
  const { data: row, error: readError } = await supabase
    .from("project_basic_info")
    .select(PROJECT_BASIC_INFO_COLUMNS)
    .eq("project_id", projectId)
    .maybeSingle();
  if (readError) throw readError;
  if (!row) return NextResponse.json({ error: "프로젝트 기본정보를 찾을 수 없습니다." }, { status: 404 });
  const sourceRow = row as unknown as Record<string, unknown>;
  const basicInfo = projectBasicInfoFromRow(sourceRow);
  if (snapshot.kind === "staff") {
    if (basicInfo.mainStaff.some((member) => member.id === snapshot.entity.id)) {
      return NextResponse.json({ ok: true, restored: true, basicInfo });
    }
    const mainStaff = insertBasicInfoEntityByAnchors(
      basicInfo.mainStaff,
      snapshot.entity as ProjectMainStaffMember,
      snapshot
    ).map((member, sortOrder) => ({ ...member, sortOrder }));
    return updateRestoredBasicInfoCollection(projectId, sourceRow.updated_at, { main_staff: mainStaff });
  }
  if (basicInfo.actors.some((actor) => actor.id === snapshot.entity.id)) {
    return NextResponse.json({ ok: true, restored: true, basicInfo });
  }
  const actors = insertBasicInfoEntityByAnchors(
    basicInfo.actors,
    snapshot.entity as ProjectActor,
    snapshot
  );
  return updateRestoredBasicInfoCollection(projectId, sourceRow.updated_at, { actors });
}

async function updateRestoredBasicInfoCollection(
  projectId: string,
  updatedAt: unknown,
  patch: { main_staff: ProjectMainStaffMember[] } | { actors: ProjectActor[] }
) {
  const supabase = requireProjectAccessDb();
  const { data, error } = await supabase
    .from("project_basic_info")
    .update(patch)
    .eq("project_id", projectId)
    .eq("updated_at", updatedAt)
    .select(PROJECT_BASIC_INFO_COLUMNS)
    .maybeSingle();
  if (error) throw error;
  if (!data) return basicInfoEntityConflictResponse();
  return NextResponse.json({ ok: true, restored: true, basicInfo: projectBasicInfoFromRow(data) });
}

function readDeletedBasicInfoEntityReceipt(
  projectId: string,
  receipt: unknown
): DeletedBasicInfoEntityReceipt {
  const value = verifyProjectDeleteReceipt<unknown>(receipt, {
    projectId,
    kind: BASIC_INFO_ENTITY_DELETE_RECEIPT_KIND
  });
  if (!isRecord(value)) throw new ProjectDeleteReceiptError();
  const kind = normalizeBasicInfoEntityKind(value.kind);
  const entity = isRecord(value.entity) ? value.entity : null;
  const id = normalizeEntityId(entity?.id);
  const index = Number(value.index);
  if (
    !kind
    || !entity
    || !id
    || !Number.isInteger(index)
    || index < 0
    || index > 10_000
    || (kind === "staff" && !isValidStaffSnapshot(entity))
    || (kind === "actor" && !isValidActorSnapshot(entity))
  ) {
    throw new ProjectDeleteReceiptError();
  }
  return {
    kind,
    entity: entity as ProjectMainStaffMember | ProjectActor,
    beforeId: normalizeEntityId(value.beforeId),
    afterId: normalizeEntityId(value.afterId),
    index
  };
}

function insertBasicInfoEntityByAnchors<T extends { id: string }>(
  collection: T[],
  entity: T,
  snapshot: Pick<DeletedBasicInfoEntityReceipt, "beforeId" | "afterId" | "index">
) {
  const beforeIndex = snapshot.beforeId
    ? collection.findIndex((candidate) => candidate.id === snapshot.beforeId)
    : -1;
  const afterIndex = snapshot.afterId
    ? collection.findIndex((candidate) => candidate.id === snapshot.afterId)
    : -1;
  const insertIndex = beforeIndex >= 0
    ? beforeIndex + 1
    : afterIndex >= 0
      ? afterIndex
      : Math.min(snapshot.index, collection.length);
  const result = [...collection];
  result.splice(insertIndex, 0, entity);
  return result;
}

function normalizeBasicInfoEntityKind(value: unknown): BasicInfoEntityKind | "" {
  return value === "staff" || value === "actor" ? value : "";
}

function normalizeEntityId(value: unknown) {
  return typeof value === "string" ? value.trim().slice(0, 160) : "";
}

function isValidStaffSnapshot(value: Record<string, unknown>) {
  return typeof value.role === "string"
    && typeof value.name === "string"
    && typeof value.phone === "string"
    && typeof value.includeInDailyPlan === "boolean"
    && (value.episodeNumbers === null || Array.isArray(value.episodeNumbers))
    && Number.isInteger(Number(value.sortOrder));
}

function isValidActorSnapshot(value: Record<string, unknown>) {
  return typeof value.role === "string" && typeof value.name === "string";
}

function basicInfoEntityConflictResponse() {
  return NextResponse.json(
    { error: "프로젝트 기본정보가 다른 화면에서 변경되었습니다. 최신 내용을 확인해주세요." },
    { status: 409 }
  );
}

async function getValidatedProjectId(context: RouteContext) {
  const { projectId: routeProjectId } = await context.params;
  const projectId = normalizeProjectId(routeProjectId);
  return isValidDatabaseProjectId(projectId) ? projectId : null;
}

function projectBasicInfoFromRow(value: unknown) {
  const row = isRecord(value) ? value : {};
  return normalizeProjectBasicInfo({
    totalEpisodes: row.total_episodes,
    shootingStartDate: row.shooting_start_date,
    shootingEndDate: row.shooting_end_date,
    mainStaff: row.main_staff,
    actors: row.actors
  });
}

function basicInfoErrorResponse(error: unknown, fallbackMessage: string, permissionMessage: string) {
  if (error instanceof ProjectDeleteReceiptError) {
    return NextResponse.json(
      { error: error.message, code: "PROJECT_DELETE_RECEIPT_INVALID" },
      { status: 400 }
    );
  }
  if (error instanceof ProjectAccessUnavailableError) {
    return NextResponse.json(
      { error: fallbackMessage, code: "PROJECT_BASIC_INFO_UNAVAILABLE" },
      { status: 503 }
    );
  }
  if (isMissingProjectBasicInfoTable(error)) {
    return NextResponse.json(
      errorBody(error, "프로젝트 기본정보 migration을 먼저 적용해주세요.", "PROJECT_BASIC_INFO_MIGRATION_REQUIRED"),
      { status: 503 }
    );
  }
  if (isLegacyMainStaffObjectConstraintError(error)) {
    logBasicInfoError(error);
    return NextResponse.json(
      errorBody(
        error,
        "메인 스태프 배열 저장을 위한 DB 설정을 적용해주세요.",
        "PROJECT_BASIC_INFO_MAIN_STAFF_ARRAY_REQUIRED"
      ),
      { status: 503 }
    );
  }
  if (isProjectBasicInfoSchemaMismatch(error)) {
    logBasicInfoError(error);
    return NextResponse.json(
      errorBody(
        error,
        "프로젝트 기본정보 테이블의 컬럼 구성을 확인해주세요.",
        "PROJECT_BASIC_INFO_SCHEMA_MISMATCH"
      ),
      { status: 503 }
    );
  }
  if (isPermissionError(error)) {
    logBasicInfoError(error);
    return NextResponse.json(
      errorBody(error, permissionMessage, "PROJECT_BASIC_INFO_FORBIDDEN"),
      { status: 403 }
    );
  }

  logBasicInfoError(error);
  return NextResponse.json(
    errorBody(error, fallbackMessage, "PROJECT_BASIC_INFO_REQUEST_FAILED"),
    { status: 500 }
  );
}

function isMissingProjectBasicInfoTable(error: unknown) {
  const source = getDatabaseError(error);
  if (!source) return false;
  const isMissingRelationCode = source.code === "42P01" || source.code === "PGRST205";
  if (!isMissingRelationCode) return false;

  return (
    /relation\s+["']?public\.project_basic_info["']?\s+does not exist/i.test(source.message) ||
    /could not find the table\s+["']?public\.project_basic_info["']?\s+in the schema cache/i.test(source.message) ||
    source.message.includes("project_basic_info")
  );
}

function isProjectBasicInfoSchemaMismatch(error: unknown) {
  const source = getDatabaseError(error);
  return source?.code === "42703" || source?.code === "PGRST204";
}

function isLegacyMainStaffObjectConstraintError(error: unknown) {
  const source = getDatabaseError(error);
  if (source?.code !== "23514") return false;
  return `${source.message} ${source.details}`.includes("project_basic_info_main_staff_object_check");
}

function isPermissionError(error: unknown) {
  const source = getDatabaseError(error);
  return source?.code === "42501" || source?.code === "PGRST301";
}

function getDatabaseError(error: unknown) {
  if (!isRecord(error)) return null;
  return {
    code: String(error.code ?? ""),
    message: String(error.message ?? ""),
    details: String(error.details ?? ""),
    hint: String(error.hint ?? "")
  };
}

function logBasicInfoError(error: unknown) {
  const source = getDatabaseError(error);
  console.error("[project-basic-info]", source ?? { message: "Unknown project basic info error" });
}

function logBasicInfoSavePayload(payload: {
  project_id: string;
  total_episodes: number;
  shooting_start_date: string | null;
  shooting_end_date: string | null;
  main_staff: Array<{
    id: string;
    role: string;
    name: string;
    phone: string;
    includeInDailyPlan: boolean;
    episodeNumbers: number[] | null;
    sortOrder: number;
  }>;
  actors: Array<{ id: string; role: string; name: string }>;
}) {
  if (process.env.NODE_ENV === "production") return;
  console.debug("[project-basic-info] save payload", {
    ...payload,
    main_staff: payload.main_staff.map((member) => ({
      ...member,
      phone: member.phone ? "[provided]" : ""
    }))
  });
}

function errorBody(error: unknown, message: string, code: string) {
  return {
    error: message,
    code,
    ...(process.env.NODE_ENV !== "production" ? { debug: getDatabaseError(error) } : {})
  };
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value && typeof value === "object" && !Array.isArray(value));
}
