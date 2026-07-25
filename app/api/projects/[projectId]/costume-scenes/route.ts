import { NextRequest, NextResponse } from "next/server";
import {
  canAdministerProject,
  getAccessGrant,
  ProjectAccessUnavailableError,
  requireProjectAccessDb
} from "@/lib/projectAccess/server";
import { isValidDatabaseProjectId, normalizeProjectId } from "@/lib/projectId";

type RouteContext = { params: Promise<{ projectId: string }> };
type ActorSeed = { role: string; name: string };

const SCENE_COLUMNS = "id,project_id,scene_no,scene_title,sort_order,created_at,updated_at";
const ITEM_COLUMNS = "id,project_id,costume_scene_id,scene_no,actor_role,actor_name,costume_content,provider,hair,image_paths,sort_order,created_at,updated_at";

export async function GET(request: NextRequest, context: RouteContext) {
  try {
    const projectId = await getProjectId(context);
    if (!projectId) return NextResponse.json({ error: "프로젝트 ID가 올바르지 않습니다." }, { status: 400 });
    if (!(await getMaterialRole(request, projectId))) {
      return NextResponse.json({ error: "의상 자료를 볼 권한이 없습니다." }, { status: 403 });
    }

    const scenes = await readScenes(projectId);
    return NextResponse.json({ ok: true, scenes });
  } catch (error) {
    return costumeSceneError(error, "씬별 의상 자료를 불러오지 못했습니다.");
  }
}

export async function POST(request: NextRequest, context: RouteContext) {
  try {
    const projectId = await getProjectId(context);
    if (!projectId) return NextResponse.json({ error: "프로젝트 ID가 올바르지 않습니다." }, { status: 400 });
    if ((await getMaterialRole(request, projectId)) !== "admin") {
      return NextResponse.json({ error: "의상 씬 추가는 Key staff만 할 수 있습니다." }, { status: 403 });
    }

    const body = await request.json().catch(() => ({})) as Record<string, unknown>;
    const sceneNo = cleanText(body.sceneNo, 80);
    const sceneTitle = cleanText(body.sceneTitle, 300);
    const actors = normalizeActors(body.actors);
    if (!sceneNo) {
      return NextResponse.json({ error: "씬 번호 또는 씬 이름을 입력해주세요." }, { status: 400 });
    }

    const supabase = requireProjectAccessDb();
    const { data: existingScenes, error: existingError } = await supabase
      .from("project_costume_scenes")
      .select("id,scene_no")
      .eq("project_id", projectId);
    if (existingError) throw existingError;
    const sceneKey = normalizeSceneKey(sceneNo);
    if ((existingScenes ?? []).some((scene) => normalizeSceneKey(String(scene.scene_no ?? "")) === sceneKey)) {
      return NextResponse.json({ error: "이미 추가된 씬입니다." }, { status: 409 });
    }

    const { count, error: countError } = await supabase
      .from("project_costume_scenes")
      .select("id", { count: "exact", head: true })
      .eq("project_id", projectId);
    if (countError) throw countError;

    const { data: scene, error } = await supabase
      .from("project_costume_scenes")
      .insert({
        project_id: projectId,
        scene_no: sceneNo,
        scene_title: sceneTitle,
        sort_order: count ?? 0
      })
      .select(SCENE_COLUMNS)
      .single();
    if (error) throw error;

    if (actors.length > 0) {
      const { error: itemError } = await supabase.from("project_costumes").insert(
        actors.map((actor, index) => ({
          project_id: projectId,
          costume_scene_id: scene.id,
          scene_no: sceneNo,
          actor_role: actor.role,
          actor_name: actor.name,
          costume_content: "",
          provider: "",
          hair: "",
          character_name: actor.role,
          costume_name: "",
          description: "",
          memo: "",
          image_paths: [],
          sort_order: index
        }))
      );
      if (itemError) {
        await supabase.from("project_costume_scenes").delete().eq("id", scene.id).eq("project_id", projectId);
        throw itemError;
      }
    }

    const scenes = await readScenes(projectId);
    return NextResponse.json(
      { ok: true, scene: scenes.find((item) => item.id === String(scene.id ?? "")) },
      { status: 201 }
    );
  } catch (error) {
    return costumeSceneError(error, "의상 씬을 추가하지 못했습니다.");
  }
}

export async function PATCH(request: NextRequest, context: RouteContext) {
  try {
    const projectId = await getProjectId(context);
    if (!projectId) return NextResponse.json({ error: "프로젝트 ID가 올바르지 않습니다." }, { status: 400 });
    if ((await getMaterialRole(request, projectId)) !== "admin") {
      return NextResponse.json({ error: "의상 씬 수정은 Key staff만 할 수 있습니다." }, { status: 403 });
    }

    const body = await request.json().catch(() => ({})) as Record<string, unknown>;
    const id = cleanText(body.id, 100);
    const sceneNo = cleanText(body.sceneNo, 80);
    const sceneTitle = cleanText(body.sceneTitle, 300);
    if (!id || !sceneNo) {
      return NextResponse.json({ error: "씬 ID와 씬 번호가 필요합니다." }, { status: 400 });
    }

    const supabase = requireProjectAccessDb();
    const { data: otherScenes, error: readError } = await supabase
      .from("project_costume_scenes")
      .select("id,scene_no")
      .eq("project_id", projectId)
      .neq("id", id);
    if (readError) throw readError;
    const sceneKey = normalizeSceneKey(sceneNo);
    if ((otherScenes ?? []).some((scene) => normalizeSceneKey(String(scene.scene_no ?? "")) === sceneKey)) {
      return NextResponse.json({ error: "이미 추가된 씬입니다." }, { status: 409 });
    }

    const { data, error } = await supabase
      .from("project_costume_scenes")
      .update({ scene_no: sceneNo, scene_title: sceneTitle })
      .eq("id", id)
      .eq("project_id", projectId)
      .select(SCENE_COLUMNS)
      .maybeSingle();
    if (error) throw error;
    if (!data) return NextResponse.json({ error: "의상 씬을 찾을 수 없습니다." }, { status: 404 });

    const { error: itemError } = await supabase
      .from("project_costumes")
      .update({ scene_no: sceneNo })
      .eq("project_id", projectId)
      .eq("costume_scene_id", id);
    if (itemError) throw itemError;

    return NextResponse.json({ ok: true, scene: { ...mapSceneRow(data), items: [] } });
  } catch (error) {
    return costumeSceneError(error, "의상 씬을 수정하지 못했습니다.");
  }
}

export async function DELETE(request: NextRequest, context: RouteContext) {
  try {
    const projectId = await getProjectId(context);
    if (!projectId) return NextResponse.json({ error: "프로젝트 ID가 올바르지 않습니다." }, { status: 400 });
    if ((await getMaterialRole(request, projectId)) !== "admin") {
      return NextResponse.json({ error: "의상 씬 삭제는 Key staff만 할 수 있습니다." }, { status: 403 });
    }

    const id = cleanText(request.nextUrl.searchParams.get("id"), 100);
    if (!id) return NextResponse.json({ error: "씬 ID가 필요합니다." }, { status: 400 });
    const supabase = requireProjectAccessDb();
    const { data: items, error: readError } = await supabase
      .from("project_costumes")
      .select("image_paths")
      .eq("project_id", projectId)
      .eq("costume_scene_id", id);
    if (readError) throw readError;

    const { data, error } = await supabase
      .from("project_costume_scenes")
      .delete()
      .eq("id", id)
      .eq("project_id", projectId)
      .select("id")
      .maybeSingle();
    if (error) throw error;
    if (!data) return NextResponse.json({ error: "의상 씬을 찾을 수 없습니다." }, { status: 404 });

    const paths = (items ?? []).flatMap((item) => normalizeImages(item.image_paths).map((image) => image.path));
    if (paths.length > 0) {
      const { error: storageError } = await supabase.storage.from("storyboards").remove(paths);
      if (storageError) console.error("[costume-scenes:storage-delete]", safeError(storageError));
    }
    return NextResponse.json({ ok: true });
  } catch (error) {
    return costumeSceneError(error, "의상 씬을 삭제하지 못했습니다.");
  }
}

async function readScenes(projectId: string) {
  const supabase = requireProjectAccessDb();
  const [{ data: sceneRows, error: sceneError }, { data: itemRows, error: itemError }] = await Promise.all([
    supabase
      .from("project_costume_scenes")
      .select(SCENE_COLUMNS)
      .eq("project_id", projectId)
      .order("sort_order", { ascending: true })
      .order("created_at", { ascending: true }),
    supabase
      .from("project_costumes")
      .select(ITEM_COLUMNS)
      .eq("project_id", projectId)
      .not("costume_scene_id", "is", null)
      .order("sort_order", { ascending: true })
      .order("created_at", { ascending: true })
  ]);
  if (sceneError) throw sceneError;
  if (itemError) throw itemError;
  const itemsByScene = new Map<string, ReturnType<typeof mapCostumeRow>[]>();
  (itemRows ?? []).forEach((row) => {
    const item = mapCostumeRow(row);
    const items = itemsByScene.get(item.costumeSceneId) ?? [];
    items.push(item);
    itemsByScene.set(item.costumeSceneId, items);
  });
  return (sceneRows ?? []).map((row) => {
    const scene = mapSceneRow(row);
    return { ...scene, items: itemsByScene.get(scene.id) ?? [] };
  });
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

function normalizeActors(value: unknown): ActorSeed[] {
  if (!Array.isArray(value)) return [];
  const seen = new Set<string>();
  return value.flatMap((item) => {
    if (!item || typeof item !== "object") return [];
    const source = item as Record<string, unknown>;
    const role = cleanText(source.role, 200);
    const name = cleanText(source.name, 200);
    if (!role && !name) return [];
    const key = (role || name).normalize("NFKC").replace(/\s+/g, "").toLocaleLowerCase("ko-KR");
    if (seen.has(key)) return [];
    seen.add(key);
    return [{ role, name }];
  });
}

function normalizeSceneKey(value: string) {
  return value
    .normalize("NFKC")
    .trim()
    .toLocaleLowerCase("ko-KR")
    .replace(/\s+/g, "")
    .replace(/^(?:scene|씬|s)#?/i, "")
    .replace(/^#+/, "");
}

function cleanText(value: unknown, max: number) {
  return typeof value === "string" ? value.trim().slice(0, max) : "";
}

function normalizeImages(value: unknown) {
  if (!Array.isArray(value)) return [] as Array<{ path: string; url: string; filename: string }>;
  return value.flatMap((item) => {
    if (!item || typeof item !== "object") return [];
    const source = item as Record<string, unknown>;
    const path = String(source.path ?? "");
    const url = String(source.url ?? "");
    return path && url ? [{ path, url, filename: String(source.filename ?? "") }] : [];
  });
}

function mapSceneRow(row: Record<string, unknown>) {
  return {
    id: String(row.id ?? ""),
    projectId: String(row.project_id ?? ""),
    sceneNo: String(row.scene_no ?? ""),
    sceneTitle: String(row.scene_title ?? ""),
    sortOrder: Number(row.sort_order ?? 0),
    createdAt: String(row.created_at ?? ""),
    updatedAt: String(row.updated_at ?? "")
  };
}

function mapCostumeRow(row: Record<string, unknown>) {
  return {
    id: String(row.id ?? ""),
    projectId: String(row.project_id ?? ""),
    costumeSceneId: String(row.costume_scene_id ?? ""),
    sceneNo: String(row.scene_no ?? ""),
    actorRole: String(row.actor_role ?? ""),
    actorName: String(row.actor_name ?? ""),
    costumeContent: String(row.costume_content ?? ""),
    provider: String(row.provider ?? ""),
    hair: String(row.hair ?? ""),
    images: normalizeImages(row.image_paths),
    sortOrder: Number(row.sort_order ?? 0),
    createdAt: String(row.created_at ?? ""),
    updatedAt: String(row.updated_at ?? "")
  };
}

function costumeSceneError(error: unknown, message: string) {
  if (error instanceof ProjectAccessUnavailableError) {
    return NextResponse.json({ error: message, code: "PROJECT_COSTUME_STORAGE_UNAVAILABLE" }, { status: 503 });
  }
  const source = safeError(error);
  console.error("[costume-scenes]", source);
  const missingTable = source.code === "42P01"
    || /project_costume_scenes|costume_scene_id|actor_role|costume_content/i.test(source.message)
      && /does not exist|schema cache|could not find/i.test(source.message);
  return NextResponse.json({
    error: missingTable ? "프로젝트 자료 migration을 먼저 적용해주세요." : message,
    code: missingTable ? "PROJECT_REFERENCE_MIGRATION_REQUIRED" : "PROJECT_COSTUME_SCENE_ERROR",
    detail: source.message
  }, { status: missingTable ? 503 : 500 });
}

function safeError(error: unknown) {
  if (!error || typeof error !== "object") return { code: "", message: String(error) };
  const value = error as { code?: unknown; message?: unknown };
  return {
    code: typeof value.code === "string" ? value.code : "",
    message: typeof value.message === "string" ? value.message : "Unknown error"
  };
}
