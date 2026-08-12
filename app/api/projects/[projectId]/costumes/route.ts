import { randomUUID } from "node:crypto";
import { NextRequest, NextResponse } from "next/server";
import {
  canAdministerProject,
  getAccessGrant,
  ProjectAccessUnavailableError,
  requireProjectAccessDb
} from "@/lib/projectAccess/server";
import { isValidDatabaseProjectId, normalizeProjectId } from "@/lib/projectId";
import {
  createProjectDeleteReceipt,
  ProjectDeleteReceiptError,
  verifyProjectDeleteReceipt
} from "@/lib/projectDeleteReceipt.server";

type RouteContext = { params: Promise<{ projectId: string }> };
type CostumeImageField = "costume" | "hair";
type CostumeImage = { path: string; url: string; filename: string; fieldType: CostumeImageField };

const STORAGE_BUCKET = "storyboards";
const SELECT_COLUMNS = "id,project_id,costume_scene_id,scene_no,actor_role,actor_name,costume_content,provider,hair,image_paths,sort_order,created_at,updated_at";
const COSTUME_ITEM_DELETE_RECEIPT_KIND = "costume-item";
const COSTUME_IMAGE_DELETE_RECEIPT_KIND = "costume-image";
const COSTUME_STORAGE_SCAN_PAGE_SIZE = 1_000;
const MAX_COSTUME_STORAGE_SCAN_ROWS = 50_000;
type DatabaseRow = Record<string, unknown>;
type DeletedCostumeItemReceiptPayload = { item: DatabaseRow };
type DeletedCostumeImageReceiptPayload = {
  itemId: string;
  image: CostumeImage;
  index: number;
};

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

/** Restore/finalize a server-signed costume item delete receipt. */
export async function PATCH(request: NextRequest, context: RouteContext) {
  try {
    const projectId = await getProjectId(context);
    if (!projectId) return NextResponse.json({ error: "프로젝트 ID가 올바르지 않습니다." }, { status: 400 });
    if ((await getMaterialRole(request, projectId)) !== "admin") {
      return NextResponse.json({ error: "의상 수정은 Key staff만 할 수 있습니다." }, { status: 403 });
    }
    const body = await request.json().catch(() => ({})) as Record<string, unknown>;
    if (body.operation === "restore_deleted_image" || body.operation === "finalize_deleted_image") {
      const snapshot = readDeletedCostumeImageReceipt(projectId, body.receipt);
      if (body.operation === "finalize_deleted_image") {
        const storageCleanupWarning = await finalizeDeletedCostumeImages(projectId, [snapshot.image.path]);
        return NextResponse.json({ ok: true, finalized: true, storageCleanupWarning });
      }
      const costume = await restoreDeletedCostumeImage(projectId, snapshot);
      if (costume instanceof NextResponse) return costume;
      return NextResponse.json({ ok: true, restored: true, costume });
    }
    if (body.operation !== "restore_deleted" && body.operation !== "finalize_deleted") {
      return NextResponse.json({ error: "지원하지 않는 의상 복원 작업입니다." }, { status: 400 });
    }
    const snapshot = readDeletedCostumeItemReceipt(projectId, body.receipt);
    if (body.operation === "finalize_deleted") {
      const storageCleanupWarning = await finalizeDeletedCostumeImages(
        projectId,
        readCostumeImagePaths(snapshot.item.image_paths)
      );
      return NextResponse.json({ ok: true, finalized: true, storageCleanupWarning });
    }

    const supabase = requireProjectAccessDb();
    const costumeSceneId = String(snapshot.item.costume_scene_id ?? "");
    const { data: parentScene, error: parentError } = await supabase
      .from("project_costume_scenes")
      .select("id")
      .eq("project_id", projectId)
      .eq("id", costumeSceneId)
      .maybeSingle();
    if (parentError) throw parentError;
    if (!parentScene) {
      return NextResponse.json(
        { error: "의상 항목이 속한 씬을 먼저 복원해주세요." },
        { status: 409 }
      );
    }
    const { error: restoreError } = await supabase
      .from("project_costumes")
      .upsert([snapshot.item], { onConflict: "id", ignoreDuplicates: true });
    if (restoreError) throw restoreError;
    const { data: restored, error: readError } = await supabase
      .from("project_costumes")
      .select(SELECT_COLUMNS)
      .eq("project_id", projectId)
      .eq("id", String(snapshot.item.id))
      .maybeSingle();
    if (readError) throw readError;
    return NextResponse.json({
      ok: true,
      restored: true,
      costume: restored ? mapCostumeRow(restored) : null
    });
  } catch (error) {
    return costumeError(error, "의상 항목을 복원하지 못했습니다.");
  }
}

export async function DELETE(request: NextRequest, context: RouteContext) {
  try {
    const projectId = await getProjectId(context);
    if (!projectId) return NextResponse.json({ error: "프로젝트 ID가 올바르지 않습니다." }, { status: 400 });
    if ((await getMaterialRole(request, projectId)) !== "admin") {
      return NextResponse.json({ error: "의상 삭제는 Key staff만 할 수 있습니다." }, { status: 403 });
    }
    const body = request.headers.get("content-type")?.includes("application/json")
      ? await request.json().catch(() => ({})) as Record<string, unknown>
      : {};
    if (body.operation === "delete_image") {
      return deleteCostumeImage(projectId, body);
    }
    const id = cleanText(request.nextUrl.searchParams.get("id"), 100);
    if (!id) return NextResponse.json({ error: "의상 항목 ID가 필요합니다." }, { status: 400 });
    const supabase = requireProjectAccessDb();
    const { data: existing, error: readError } = await supabase
      .from("project_costumes")
      .select("*")
      .eq("id", id)
      .eq("project_id", projectId)
      .maybeSingle();
    if (readError) throw readError;
    if (!existing) return NextResponse.json({ error: "의상 항목을 찾을 수 없습니다." }, { status: 404 });
    const receipt = createProjectDeleteReceipt({
      projectId,
      kind: COSTUME_ITEM_DELETE_RECEIPT_KIND,
      payload: { item: existing } satisfies DeletedCostumeItemReceiptPayload
    });
    const { data: deleted, error } = await supabase
      .from("project_costumes")
      .delete()
      .eq("id", id)
      .eq("project_id", projectId)
      .eq("updated_at", existing.updated_at)
      .select("id")
      .maybeSingle();
    if (error) throw error;
    if (!deleted) {
      return NextResponse.json(
        { error: "의상 항목이 다른 화면에서 변경되었습니다. 최신 내용을 확인해주세요." },
        { status: 409 }
      );
    }
    // Storage is retained throughout the Undo window and removed by finalize.
    return NextResponse.json({ ok: true, receipt });
  } catch (error) {
    return costumeError(error, "의상 항목을 삭제하지 못했습니다.");
  }
}

async function deleteCostumeImage(projectId: string, body: Record<string, unknown>) {
  const itemId = cleanText(body.itemId, 100);
  const path = cleanText(body.path, 1_000);
  if (!isValidDatabaseProjectId(itemId) || !isProjectCostumeStoragePath(projectId, path)) {
    return NextResponse.json({ error: "삭제할 의상 이미지가 올바르지 않습니다." }, { status: 400 });
  }
  const supabase = requireProjectAccessDb();
  const { data: item, error: readError } = await supabase
    .from("project_costumes")
    .select("*")
    .eq("project_id", projectId)
    .eq("id", itemId)
    .maybeSingle();
  if (readError) throw readError;
  if (!item) return NextResponse.json({ error: "의상 항목을 찾을 수 없습니다." }, { status: 404 });

  const imagePaths = Array.isArray(item.image_paths) ? [...item.image_paths] : [];
  const index = imagePaths.findIndex((entry) => (
    entry
    && typeof entry === "object"
    && !Array.isArray(entry)
    && String((entry as Record<string, unknown>).path ?? "") === path
  ));
  if (index < 0) return NextResponse.json({ error: "의상 이미지를 찾을 수 없습니다." }, { status: 404 });
  const image = normalizeImages([imagePaths[index]])[0];
  if (!image || image.path !== path) {
    return NextResponse.json({ error: "의상 이미지 정보가 올바르지 않습니다." }, { status: 400 });
  }
  const receipt = createProjectDeleteReceipt({
    projectId,
    kind: COSTUME_IMAGE_DELETE_RECEIPT_KIND,
    payload: { itemId, image, index } satisfies DeletedCostumeImageReceiptPayload
  });
  imagePaths.splice(index, 1);
  const { data: updated, error: updateError } = await supabase
    .from("project_costumes")
    .update({ image_paths: imagePaths })
    .eq("project_id", projectId)
    .eq("id", itemId)
    .eq("updated_at", item.updated_at)
    .select(SELECT_COLUMNS)
    .maybeSingle();
  if (updateError) throw updateError;
  if (!updated) {
    return NextResponse.json(
      { error: "의상 항목이 다른 화면에서 변경되었습니다. 최신 내용을 확인해주세요." },
      { status: 409 }
    );
  }
  // The object remains in storage until this receipt leaves the three-entry Undo stack.
  return NextResponse.json({ ok: true, receipt, costume: mapCostumeRow(updated) });
}

async function restoreDeletedCostumeImage(
  projectId: string,
  snapshot: DeletedCostumeImageReceiptPayload
) {
  const supabase = requireProjectAccessDb();
  const { data: item, error: readError } = await supabase
    .from("project_costumes")
    .select("*")
    .eq("project_id", projectId)
    .eq("id", snapshot.itemId)
    .maybeSingle();
  if (readError) throw readError;
  if (!item) {
    return NextResponse.json(
      { error: "의상 이미지가 속한 항목을 먼저 복원해주세요." },
      { status: 409 }
    );
  }
  const imagePaths = Array.isArray(item.image_paths) ? [...item.image_paths] : [];
  const existing = imagePaths.some((entry) => (
    entry
    && typeof entry === "object"
    && !Array.isArray(entry)
    && String((entry as Record<string, unknown>).path ?? "") === snapshot.image.path
  ));
  if (!existing) imagePaths.splice(Math.min(snapshot.index, imagePaths.length), 0, snapshot.image);
  if (existing) return mapCostumeRow(item);

  const { data: updated, error: updateError } = await supabase
    .from("project_costumes")
    .update({ image_paths: imagePaths })
    .eq("project_id", projectId)
    .eq("id", snapshot.itemId)
    .eq("updated_at", item.updated_at)
    .select(SELECT_COLUMNS)
    .maybeSingle();
  if (updateError) throw updateError;
  if (!updated) {
    return NextResponse.json(
      { error: "의상 항목이 다른 화면에서 변경되었습니다. 최신 내용을 확인해주세요." },
      { status: 409 }
    );
  }
  return mapCostumeRow(updated);
}

function readDeletedCostumeImageReceipt(
  projectId: string,
  receipt: unknown
): DeletedCostumeImageReceiptPayload {
  const value = verifyProjectDeleteReceipt<unknown>(receipt, {
    projectId,
    kind: COSTUME_IMAGE_DELETE_RECEIPT_KIND
  });
  if (!value || typeof value !== "object" || Array.isArray(value)) throw new ProjectDeleteReceiptError();
  const payload = value as Partial<DeletedCostumeImageReceiptPayload>;
  const image = normalizeImages(payload.image ? [payload.image] : [])[0];
  if (
    !isValidDatabaseProjectId(String(payload.itemId ?? ""))
    || !image
    || !isProjectCostumeStoragePath(projectId, image.path)
    || !Number.isInteger(payload.index)
    || Number(payload.index) < 0
    || Number(payload.index) > 10_000
  ) {
    throw new ProjectDeleteReceiptError();
  }
  return { itemId: String(payload.itemId), image, index: Number(payload.index) };
}

function readDeletedCostumeItemReceipt(
  projectId: string,
  receipt: unknown
): DeletedCostumeItemReceiptPayload {
  const value = verifyProjectDeleteReceipt<unknown>(receipt, {
    projectId,
    kind: COSTUME_ITEM_DELETE_RECEIPT_KIND
  });
  if (!value || typeof value !== "object" || Array.isArray(value)) throw new ProjectDeleteReceiptError();
  const payload = value as Partial<DeletedCostumeItemReceiptPayload>;
  if (
    !payload.item
    || typeof payload.item !== "object"
    || Array.isArray(payload.item)
    || payload.item.project_id !== projectId
    || !isValidDatabaseProjectId(String(payload.item.id ?? ""))
    || !isValidDatabaseProjectId(String(payload.item.costume_scene_id ?? ""))
  ) {
    throw new ProjectDeleteReceiptError();
  }
  return { item: payload.item };
}

async function finalizeDeletedCostumeImages(projectId: string, candidatePaths: string[]) {
  const candidates = new Set(candidatePaths.filter((path) => isProjectCostumeStoragePath(projectId, path)));
  if (candidates.size === 0) return "";

  const supabase = requireProjectAccessDb();
  const referencedPaths = new Set<string>();
  let scannedRows = 0;
  while (scannedRows < MAX_COSTUME_STORAGE_SCAN_ROWS) {
    const { data, error } = await supabase
      .from("project_costumes")
      .select("image_paths")
      .eq("project_id", projectId)
      .order("id")
      .range(scannedRows, scannedRows + COSTUME_STORAGE_SCAN_PAGE_SIZE - 1);
    if (error) throw error;
    const rows = data ?? [];
    rows.forEach((row) => {
      readCostumeImagePaths(row.image_paths).forEach((path) => referencedPaths.add(path));
    });
    scannedRows += rows.length;
    if (rows.length < COSTUME_STORAGE_SCAN_PAGE_SIZE) break;
  }
  if (scannedRows >= MAX_COSTUME_STORAGE_SCAN_ROWS) {
    return "의상 이미지 참조가 너무 많아 안전을 위해 저장소 정리를 건너뛰었습니다.";
  }

  const paths = [...candidates].filter((path) => !referencedPaths.has(path));
  const warnings: string[] = [];
  for (let start = 0; start < paths.length; start += 100) {
    const { error } = await supabase.storage
      .from(STORAGE_BUCKET)
      .remove(paths.slice(start, start + 100));
    if (error) warnings.push(safeError(error).message);
  }
  return warnings.length > 0
    ? `일부 의상 이미지를 정리하지 못했습니다: ${warnings.join(" · ")}`
    : "";
}

function readCostumeImagePaths(value: unknown) {
  if (!Array.isArray(value)) return [] as string[];
  return value.flatMap((item) => {
    if (!item || typeof item !== "object" || Array.isArray(item)) return [];
    const path = String((item as Record<string, unknown>).path ?? "").trim();
    return path ? [path] : [];
  });
}

function isProjectCostumeStoragePath(projectId: string, path: string) {
  return path.length <= 1_000
    && path.startsWith(`projects/${projectId}/costumes/`)
    && !path.includes("../")
    && !path.includes("\\");
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
  if (error instanceof ProjectDeleteReceiptError) {
    return NextResponse.json({ error: error.message, code: "PROJECT_DELETE_RECEIPT_INVALID" }, { status: 400 });
  }
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
