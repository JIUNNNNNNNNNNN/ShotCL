import { randomUUID } from "node:crypto";
import { NextRequest, NextResponse } from "next/server";
import {
  canAdministerProject,
  getAccessGrant,
  ProjectAccessUnavailableError,
  requireProjectAccessDb
} from "@/lib/projectAccess/server";
import { isValidDatabaseProjectId, normalizeProjectId } from "@/lib/projectId";

type RouteContext = { params: Promise<{ projectId: string }> };
type CostumeImageField = "costume" | "hair";
type CostumeImage = { path: string; url: string; filename: string; fieldType: CostumeImageField };

const STORAGE_BUCKET = "storyboards";
const SELECT_COLUMNS = "id,project_id,costume_scene_id,scene_no,actor_role,actor_name,costume_content,provider,hair,image_paths,sort_order,created_at,updated_at";

export async function GET(request: NextRequest, context: RouteContext) {
  try {
    const projectId = await getProjectId(context);
    if (!projectId) return NextResponse.json({ error: "프로젝트 ID가 올바르지 않습니다." }, { status: 400 });
    if (!(await getMaterialRole(request, projectId))) {
      return NextResponse.json({ error: "의상 자료를 볼 권한이 없습니다." }, { status: 403 });
    }
    const supabase = requireProjectAccessDb();
    const { data, error } = await supabase
      .from("project_costumes")
      .select(SELECT_COLUMNS)
      .eq("project_id", projectId)
      .order("sort_order", { ascending: true })
      .order("created_at", { ascending: true });
    if (error) throw error;
    return NextResponse.json({ ok: true, costumes: (data ?? []).map(mapCostumeRow) });
  } catch (error) {
    return costumeError(error, "의상 리스트를 불러오지 못했습니다.");
  }
}

export async function POST(request: NextRequest, context: RouteContext) {
  const uploadedPaths: string[] = [];
  try {
    const projectId = await getProjectId(context);
    if (!projectId) return NextResponse.json({ error: "프로젝트 ID가 올바르지 않습니다." }, { status: 400 });
    if ((await getMaterialRole(request, projectId)) !== "admin") {
      return NextResponse.json({ error: "의상 수정은 Key staff만 할 수 있습니다." }, { status: 403 });
    }
    const formData = await request.formData();
    const id = cleanText(formData.get("id"), 100);
    const clientItemId = safePathSegment(cleanText(formData.get("clientItemId"), 160)) || "new";
    let costumeSceneId = cleanText(formData.get("costumeSceneId"), 100);
    const costumeFiles = readFiles(formData, "costumeFiles");
    const hairFiles = readFiles(formData, "hairFiles");
    const files = [...costumeFiles, ...hairFiles];
    if (files.some((file) => !isImage(file) || file.size > 20 * 1024 * 1024)) {
      return NextResponse.json({ error: "이미지는 장당 20MB 이하의 이미지 파일만 가능합니다." }, { status: 415 });
    }
    const supabase = requireProjectAccessDb();
    let existingImages: CostumeImage[] = [];
    let sceneNo = "";
    if (id) {
      const { data, error } = await supabase
        .from("project_costumes")
        .select("image_paths,costume_scene_id")
        .eq("id", id)
        .eq("project_id", projectId)
        .maybeSingle();
      if (error) throw error;
      if (!data) return NextResponse.json({ error: "의상 항목을 찾을 수 없습니다." }, { status: 404 });
      existingImages = normalizeImages(data.image_paths);
      costumeSceneId = costumeSceneId || String(data.costume_scene_id ?? "");
    }
    if (!costumeSceneId) {
      return NextResponse.json({ error: "의상 항목이 속할 씬이 필요합니다." }, { status: 400 });
    }
    const { data: scene, error: sceneError } = await supabase
      .from("project_costume_scenes")
      .select("id,scene_no")
      .eq("id", costumeSceneId)
      .eq("project_id", projectId)
      .maybeSingle();
    if (sceneError) throw sceneError;
    if (!scene) {
      return NextResponse.json({ error: "의상 씬을 찾을 수 없습니다." }, { status: 404 });
    }
    sceneNo = String(scene.scene_no ?? "");
    const keepCostumePaths = parseStringArray(formData.get("keepCostumeImagePaths"));
    const keepHairPaths = parseStringArray(formData.get("keepHairImagePaths"));
    const keepPaths = new Set([...keepCostumePaths, ...keepHairPaths]);
    const keptImages = id
      ? existingImages.filter((image) => keepPaths.has(image.path))
      : [];
    const newImages: CostumeImage[] = [];
    for (const [fieldType, selectedFiles] of [
      ["costume", costumeFiles],
      ["hair", hairFiles]
    ] as const) {
      for (const file of selectedFiles) {
        const path = `projects/${projectId}/costumes/${costumeSceneId}/${id || clientItemId}/${fieldType}/${randomUUID()}-${safeName(file.name)}`;
        const { error } = await supabase.storage.from(STORAGE_BUCKET).upload(
          path,
          Buffer.from(await file.arrayBuffer()),
          { contentType: file.type || "application/octet-stream", upsert: false }
        );
        if (error) throw error;
        uploadedPaths.push(path);
        const { data } = supabase.storage.from(STORAGE_BUCKET).getPublicUrl(path);
        newImages.push({ path, url: data.publicUrl, filename: file.name.slice(0, 500), fieldType });
      }
    }
    const payload = {
      project_id: projectId,
      costume_scene_id: costumeSceneId,
      scene_no: sceneNo,
      actor_role: cleanText(formData.get("actorRole"), 200),
      actor_name: cleanText(formData.get("actorName"), 200),
      costume_content: cleanText(formData.get("costumeContent"), 2000),
      provider: cleanText(formData.get("provider"), 200),
      hair: cleanText(formData.get("hair"), 1000),
      character_name: cleanText(formData.get("actorRole"), 200),
      costume_name: cleanText(formData.get("costumeContent"), 200),
      description: "",
      memo: "",
      image_paths: [...keptImages, ...newImages],
      sort_order: toInteger(formData.get("sortOrder"))
    };
    const query = id
      ? supabase.from("project_costumes").update(payload).eq("id", id).eq("project_id", projectId)
      : supabase.from("project_costumes").insert(payload);
    const { data, error } = await query.select(SELECT_COLUMNS).single();
    if (error) throw error;
    const removedPaths = existingImages
      .filter((image) => !keptImages.some((kept) => kept.path === image.path))
      .map((image) => image.path);
    if (removedPaths.length > 0) {
      const { error: storageError } = await supabase.storage.from(STORAGE_BUCKET).remove(removedPaths);
      if (storageError) console.error("[costumes:storage-delete]", safeError(storageError));
    }
    return NextResponse.json({ ok: true, costume: mapCostumeRow(data) }, { status: id ? 200 : 201 });
  } catch (error) {
    if (uploadedPaths.length > 0) {
      try {
        await requireProjectAccessDb().storage.from(STORAGE_BUCKET).remove(uploadedPaths);
      } catch {
        // 원래 오류 응답을 유지합니다.
      }
    }
    return costumeError(error, "의상 항목을 저장하지 못했습니다.");
  }
}

export async function DELETE(request: NextRequest, context: RouteContext) {
  try {
    const projectId = await getProjectId(context);
    if (!projectId) return NextResponse.json({ error: "프로젝트 ID가 올바르지 않습니다." }, { status: 400 });
    if ((await getMaterialRole(request, projectId)) !== "admin") {
      return NextResponse.json({ error: "의상 삭제는 Key staff만 할 수 있습니다." }, { status: 403 });
    }
    const id = cleanText(request.nextUrl.searchParams.get("id"), 100);
    if (!id) return NextResponse.json({ error: "의상 항목 ID가 필요합니다." }, { status: 400 });
    const supabase = requireProjectAccessDb();
    const { data: existing, error: readError } = await supabase
      .from("project_costumes")
      .select("image_paths")
      .eq("id", id)
      .eq("project_id", projectId)
      .maybeSingle();
    if (readError) throw readError;
    if (!existing) return NextResponse.json({ error: "의상 항목을 찾을 수 없습니다." }, { status: 404 });
    const { error } = await supabase.from("project_costumes").delete().eq("id", id).eq("project_id", projectId);
    if (error) throw error;
    const paths = normalizeImages(existing.image_paths).map((image) => image.path);
    if (paths.length > 0) {
      const { error: storageError } = await supabase.storage.from(STORAGE_BUCKET).remove(paths);
      if (storageError) console.error("[costumes:storage-delete]", safeError(storageError));
    }
    return NextResponse.json({ ok: true });
  } catch (error) {
    return costumeError(error, "의상 항목을 삭제하지 못했습니다.");
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

function isImage(file: File) {
  return file.type.startsWith("image/") || /\.(?:jpe?g|png|gif|webp|heic|heif)$/i.test(file.name);
}

function cleanText(value: unknown, max: number) {
  return typeof value === "string" ? value.trim().slice(0, max) : "";
}

function safeName(value: string) {
  return value.normalize("NFKD").replace(/[^\w.\-]+/g, "-").replace(/-+/g, "-").replace(/^-|-$/g, "").slice(0, 120) || "image";
}

function safePathSegment(value: string) {
  return value.replace(/[^a-zA-Z0-9_-]+/g, "-").replace(/-+/g, "-").replace(/^-|-$/g, "");
}

function readFiles(formData: FormData, key: string) {
  return formData.getAll(key).filter((file): file is File => file instanceof File && file.size > 0);
}

function parseStringArray(value: FormDataEntryValue | null) {
  try {
    const parsed = JSON.parse(typeof value === "string" ? value : "[]");
    return Array.isArray(parsed) ? parsed.map(String) : [];
  } catch {
    return [];
  }
}

function normalizeImages(value: unknown): CostumeImage[] {
  if (!Array.isArray(value)) return [];
  return value.flatMap((item) => {
    if (!item || typeof item !== "object") return [];
    const source = item as Record<string, unknown>;
    const path = String(source.path ?? "");
    const url = String(source.url ?? "");
    if (!path || !url) return [];
    return [{
      path,
      url,
      filename: String(source.filename ?? ""),
      fieldType: source.fieldType === "hair" ? "hair" : "costume"
    }];
  });
}

function toInteger(value: unknown) {
  const parsed = Number(value);
  return Number.isFinite(parsed) ? Math.max(0, Math.round(parsed)) : 0;
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

function costumeError(error: unknown, message: string) {
  if (error instanceof ProjectAccessUnavailableError) {
    return NextResponse.json({ error: message, code: "PROJECT_COSTUME_STORAGE_UNAVAILABLE" }, { status: 503 });
  }
  const source = safeError(error);
  console.error("[costumes]", source);
  const missingTable = source.code === "42P01"
    || /project_costumes|project_costume_scenes|costume_scene_id|actor_role|costume_content/i.test(source.message)
      && /does not exist|schema cache|could not find/i.test(source.message);
  return NextResponse.json({
    error: missingTable ? "프로젝트 자료 migration을 먼저 적용해주세요." : message,
    code: missingTable ? "PROJECT_REFERENCE_MIGRATION_REQUIRED" : "PROJECT_COSTUME_ERROR",
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
