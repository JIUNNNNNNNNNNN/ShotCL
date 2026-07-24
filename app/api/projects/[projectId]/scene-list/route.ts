import { NextRequest, NextResponse } from "next/server";
import {
  canAdministerProject,
  getAccessGrant,
  ProjectAccessUnavailableError,
  requireProjectAccessDb
} from "@/lib/projectAccess/server";
import { isValidDatabaseProjectId, normalizeProjectId } from "@/lib/projectId";

type RouteContext = { params: Promise<{ projectId: string }> };

type SceneItemInput = {
  id?: unknown;
  sceneNo?: unknown;
  mainLocation?: unknown;
  subLocation?: unknown;
  dayLabel?: unknown;
  dayNight?: unknown;
  interiorExterior?: unknown;
  sceneContent?: unknown;
  characters?: unknown;
};

const SCENE_COLUMNS = [
  "id",
  "project_id",
  "scene_no",
  "main_location",
  "sub_location",
  "day_label",
  "day_night",
  "interior_exterior",
  "scene_content",
  "characters",
  "sort_order",
  "created_at",
  "updated_at"
].join(",");

export async function GET(request: NextRequest, context: RouteContext) {
  try {
    const scope = await requireReadScope(request, context);
    if (scope instanceof NextResponse) return scope;
    const { projectId, supabase } = scope;

    const [{ data: rows, error }, { data: note, error: noteError }] = await Promise.all([
      supabase
        .from("project_scene_items")
        .select(SCENE_COLUMNS)
        .eq("project_id", projectId)
        .order("sort_order")
        .order("created_at"),
      supabase
        .from("project_scene_notes")
        .select("scenario_reference")
        .eq("project_id", projectId)
        .maybeSingle()
    ]);
    if (error) throw error;
    if (noteError) throw noteError;

    return NextResponse.json({
      items: rows ?? [],
      scenarioReference: note?.scenario_reference ?? ""
    });
  } catch (error) {
    return sceneListError(error, "씬리스트를 불러오지 못했습니다.");
  }
}

export async function PUT(request: NextRequest, context: RouteContext) {
  try {
    const scope = await requireWriteScope(request, context);
    if (scope instanceof NextResponse) return scope;
    const { projectId, supabase } = scope;
    const body = (await request.json()) as {
      items?: SceneItemInput[];
      scenarioReference?: unknown;
    };

    if (!Array.isArray(body.items) || body.items.length > 1000) {
      return NextResponse.json({ error: "씬리스트 데이터가 올바르지 않습니다." }, { status: 400 });
    }

    const rows = body.items.map((item, index) => normalizeItem(item, projectId, index));
    if (rows.some((item) => !item)) {
      return NextResponse.json({ error: "씬 행 ID 또는 입력값이 올바르지 않습니다." }, { status: 400 });
    }
    const normalizedRows = rows as NonNullable<(typeof rows)[number]>[];
    const ids = normalizedRows.map((row) => row.id);
    if (new Set(ids).size !== ids.length) {
      return NextResponse.json({ error: "중복된 씬 행이 있습니다." }, { status: 400 });
    }

    if (ids.length > 0) {
      const { data: idRows, error: idError } = await supabase
        .from("project_scene_items")
        .select("id,project_id")
        .in("id", ids);
      if (idError) throw idError;
      if ((idRows ?? []).some((row) => row.project_id !== projectId)) {
        return NextResponse.json(
          { error: "다른 프로젝트의 씬 행은 수정할 수 없습니다." },
          { status: 409 }
        );
      }
    }

    const { data: existingRows, error: existingError } = await supabase
      .from("project_scene_items")
      .select("id")
      .eq("project_id", projectId);
    if (existingError) throw existingError;

    if (normalizedRows.length > 0) {
      const { error } = await supabase
        .from("project_scene_items")
        .upsert(normalizedRows, { onConflict: "id" });
      if (error) throw error;
    }

    const submittedIds = new Set(ids);
    const deletedIds = (existingRows ?? [])
      .filter((row) => !submittedIds.has(row.id))
      .map((row) => row.id);
    if (deletedIds.length > 0) {
      const { error } = await supabase
        .from("project_scene_items")
        .delete()
        .eq("project_id", projectId)
        .in("id", deletedIds);
      if (error) throw error;
    }

    const scenarioReference = normalizeText(body.scenarioReference, 50000);
    const { error: noteError } = await supabase
      .from("project_scene_notes")
      .upsert(
        { project_id: projectId, scenario_reference: scenarioReference },
        { onConflict: "project_id" }
      );
    if (noteError) throw noteError;

    const { data: savedRows, error: savedError } = await supabase
      .from("project_scene_items")
      .select(SCENE_COLUMNS)
      .eq("project_id", projectId)
      .order("sort_order")
      .order("created_at");
    if (savedError) throw savedError;

    return NextResponse.json({
      items: savedRows ?? [],
      scenarioReference
    });
  } catch (error) {
    return sceneListError(error, "씬리스트를 저장하지 못했습니다.");
  }
}

async function requireReadScope(request: NextRequest, context: RouteContext) {
  const projectId = await getProjectId(context);
  if (!projectId) {
    return NextResponse.json({ error: "프로젝트 ID가 올바르지 않습니다." }, { status: 400 });
  }
  const grant = await getAccessGrant(request, projectId);
  if (!grant && !(await canAdministerProject(request, projectId))) {
    return NextResponse.json({ error: "프로젝트 접근 권한이 없습니다." }, { status: 401 });
  }
  return { projectId, supabase: requireProjectAccessDb() };
}

async function requireWriteScope(request: NextRequest, context: RouteContext) {
  const projectId = await getProjectId(context);
  if (!projectId) {
    return NextResponse.json({ error: "프로젝트 ID가 올바르지 않습니다." }, { status: 400 });
  }
  const grant = await getAccessGrant(request, projectId);
  const canWrite = grant?.role === "admin" || (!grant && await canAdministerProject(request, projectId));
  if (!canWrite) {
    return NextResponse.json(
      { error: "씬리스트를 수정하려면 Key staff 권한이 필요합니다." },
      { status: grant ? 403 : 401 }
    );
  }
  return { projectId, supabase: requireProjectAccessDb() };
}

async function getProjectId(context: RouteContext) {
  const { projectId: routeProjectId } = await context.params;
  const projectId = normalizeProjectId(routeProjectId);
  return isValidDatabaseProjectId(projectId) ? projectId : null;
}

function normalizeItem(item: SceneItemInput, projectId: string, index: number) {
  const id = normalizeText(item.id, 36);
  if (!isUuid(id)) return null;
  return {
    id,
    project_id: projectId,
    scene_no: normalizeText(item.sceneNo, 30),
    main_location: normalizeText(item.mainLocation, 120),
    sub_location: normalizeText(item.subLocation, 160),
    day_label: normalizeText(item.dayLabel, 30),
    day_night: normalizeText(item.dayNight, 10),
    interior_exterior: normalizeText(item.interiorExterior, 10),
    scene_content: normalizeText(item.sceneContent, 4000),
    characters: normalizeText(item.characters, 1000),
    sort_order: index + 1
  };
}

function normalizeText(value: unknown, maxLength: number) {
  return String(value ?? "").trim().slice(0, maxLength);
}

function isUuid(value: string) {
  return /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(value);
}

function sceneListError(error: unknown, fallback: string) {
  if (error instanceof ProjectAccessUnavailableError) {
    return NextResponse.json({ error: fallback }, { status: 503 });
  }
  const code = error && typeof error === "object" && "code" in error
    ? String(error.code)
    : "";
  const message = error && typeof error === "object" && "message" in error
    ? String(error.message)
    : "";
  const migrationMissing = (
    code === "42P01" ||
    code === "PGRST205"
  ) && /project_scene_(items|notes)/i.test(message);
  if (migrationMissing) {
    return NextResponse.json(
      { error: "프로젝트 씬리스트 migration을 먼저 적용해주세요." },
      { status: 503 }
    );
  }
  console.error("[project-scene-list]", { code, message });
  return NextResponse.json({ error: fallback }, { status: 500 });
}
