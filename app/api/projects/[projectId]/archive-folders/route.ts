import { NextRequest, NextResponse } from "next/server";
import {
  canAdministerProject,
  getAccessGrant,
  ProjectAccessUnavailableError,
  requireProjectAccessDb
} from "@/lib/projectAccess/server";
import { isValidDatabaseProjectId, normalizeProjectId } from "@/lib/projectId";

type RouteContext = { params: Promise<{ projectId: string }> };

const SELECT_COLUMNS = "id,project_id,name,sort_order,created_at,updated_at";

export async function GET(request: NextRequest, context: RouteContext) {
  try {
    const projectId = await getProjectId(context);
    if (!projectId) return NextResponse.json({ error: "프로젝트 ID가 올바르지 않습니다." }, { status: 400 });
    if (!(await getMaterialRole(request, projectId))) {
      return NextResponse.json({ error: "아카이브 폴더를 볼 권한이 없습니다." }, { status: 403 });
    }
    const { data, error } = await requireProjectAccessDb()
      .from("project_archive_folders")
      .select(SELECT_COLUMNS)
      .eq("project_id", projectId)
      .order("sort_order", { ascending: true })
      .order("created_at", { ascending: true });
    if (error) throw error;
    return NextResponse.json({ ok: true, folders: (data ?? []).map(mapFolder) });
  } catch (error) {
    return folderError(error, "아카이브 폴더를 불러오지 못했습니다.");
  }
}

export async function POST(request: NextRequest, context: RouteContext) {
  try {
    const projectId = await getProjectId(context);
    if (!projectId) return NextResponse.json({ error: "프로젝트 ID가 올바르지 않습니다." }, { status: 400 });
    if ((await getMaterialRole(request, projectId)) !== "admin") {
      return NextResponse.json({ error: "폴더 생성은 Key staff만 할 수 있습니다." }, { status: 403 });
    }
    const body = (await request.json()) as { name?: unknown; sortOrder?: unknown };
    const name = cleanText(body.name, 80);
    if (!name) return NextResponse.json({ error: "폴더 이름을 입력해주세요." }, { status: 400 });
    const { data, error } = await requireProjectAccessDb()
      .from("project_archive_folders")
      .insert({
        project_id: projectId,
        name,
        sort_order: toInteger(body.sortOrder)
      })
      .select(SELECT_COLUMNS)
      .single();
    if (error) throw error;
    return NextResponse.json({ ok: true, folder: mapFolder(data) }, { status: 201 });
  } catch (error) {
    return folderError(error, "폴더를 만들지 못했습니다.");
  }
}

export async function PATCH(request: NextRequest, context: RouteContext) {
  try {
    const projectId = await getProjectId(context);
    if (!projectId) return NextResponse.json({ error: "프로젝트 ID가 올바르지 않습니다." }, { status: 400 });
    if ((await getMaterialRole(request, projectId)) !== "admin") {
      return NextResponse.json({ error: "폴더 수정은 Key staff만 할 수 있습니다." }, { status: 403 });
    }
    const body = (await request.json()) as { id?: unknown; name?: unknown; sortOrder?: unknown };
    const id = cleanText(body.id, 100);
    const name = cleanText(body.name, 80);
    if (!id || !name) return NextResponse.json({ error: "폴더 ID와 이름이 필요합니다." }, { status: 400 });
    const payload: Record<string, unknown> = { name };
    if (body.sortOrder !== undefined) payload.sort_order = toInteger(body.sortOrder);
    const { data, error } = await requireProjectAccessDb()
      .from("project_archive_folders")
      .update(payload)
      .eq("id", id)
      .eq("project_id", projectId)
      .select(SELECT_COLUMNS)
      .single();
    if (error) throw error;
    return NextResponse.json({ ok: true, folder: mapFolder(data) });
  } catch (error) {
    return folderError(error, "폴더 이름을 변경하지 못했습니다.");
  }
}

export async function DELETE(request: NextRequest, context: RouteContext) {
  try {
    const projectId = await getProjectId(context);
    if (!projectId) return NextResponse.json({ error: "프로젝트 ID가 올바르지 않습니다." }, { status: 400 });
    if ((await getMaterialRole(request, projectId)) !== "admin") {
      return NextResponse.json({ error: "폴더 삭제는 Key staff만 할 수 있습니다." }, { status: 403 });
    }
    const id = cleanText(request.nextUrl.searchParams.get("id"), 100);
    if (!id) return NextResponse.json({ error: "폴더 ID가 필요합니다." }, { status: 400 });
    const supabase = requireProjectAccessDb();
    const { count, error: countError } = await supabase
      .from("project_reference_assets")
      .select("id", { count: "exact", head: true })
      .eq("project_id", projectId)
      .contains("crop_data", { folderId: id });
    if (countError) throw countError;
    if ((count ?? 0) > 0) {
      return NextResponse.json(
        { error: "폴더 안의 자료를 먼저 다른 폴더나 홈으로 이동해주세요." },
        { status: 409 }
      );
    }
    const { error } = await supabase
      .from("project_archive_folders")
      .delete()
      .eq("id", id)
      .eq("project_id", projectId);
    if (error) throw error;
    return NextResponse.json({ ok: true });
  } catch (error) {
    return folderError(error, "폴더를 삭제하지 못했습니다.");
  }
}

async function getProjectId(context: RouteContext) {
  const { projectId: routeProjectId } = await context.params;
  const projectId = normalizeProjectId(routeProjectId);
  return isValidDatabaseProjectId(projectId) ? projectId : "";
}

async function getMaterialRole(request: NextRequest, projectId: string) {
  const grant = await getAccessGrant(request, projectId);
  if (grant) return grant.role;
  return (await canAdministerProject(request, projectId)) ? "admin" : null;
}

function cleanText(value: unknown, max: number) {
  return typeof value === "string" ? value.trim().slice(0, max) : "";
}

function toInteger(value: unknown) {
  const parsed = Number(value);
  return Number.isFinite(parsed) ? Math.max(0, Math.round(parsed)) : 0;
}

function mapFolder(row: Record<string, unknown>) {
  return {
    id: String(row.id ?? ""),
    projectId: String(row.project_id ?? ""),
    name: String(row.name ?? ""),
    sortOrder: Number(row.sort_order ?? 0),
    createdAt: String(row.created_at ?? ""),
    updatedAt: String(row.updated_at ?? "")
  };
}

function folderError(error: unknown, message: string) {
  if (error instanceof ProjectAccessUnavailableError) {
    return NextResponse.json({ error: message, code: "PROJECT_ARCHIVE_FOLDER_UNAVAILABLE" }, { status: 503 });
  }
  const source = safeError(error);
  console.error("[archive-folders]", source);
  const missingTable = source.code === "42P01"
    || /project_archive_folders/i.test(source.message) && /does not exist|schema cache/i.test(source.message);
  const duplicate = source.code === "23505";
  return NextResponse.json({
    error: missingTable
      ? "아카이브 폴더 migration을 먼저 적용해주세요."
      : duplicate
        ? "같은 이름의 폴더가 이미 있습니다."
        : message,
    detail: source.message
  }, { status: missingTable ? 503 : duplicate ? 409 : 500 });
}

function safeError(error: unknown) {
  if (!error || typeof error !== "object") return { code: "", message: String(error) };
  const value = error as { code?: unknown; message?: unknown };
  return {
    code: typeof value.code === "string" ? value.code : "",
    message: typeof value.message === "string" ? value.message : "Unknown error"
  };
}
