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
type AssetType = "scenario" | "storyboard" | "overhead";

const STORAGE_BUCKET = "storyboards";
const SELECT_COLUMNS = "id,project_id,asset_type,filename,storage_path,public_url,mime_type,size_bytes,daily_plan_id,scene_no,cut_no,shot_ref,group_id,crop_data,sort_order,created_at,updated_at";

export async function GET(request: NextRequest, context: RouteContext) {
  try {
    const projectId = await getProjectId(context);
    if (!projectId) return NextResponse.json({ error: "프로젝트 ID가 올바르지 않습니다." }, { status: 400 });
    if (!(await getMaterialRole(request, projectId))) {
      return NextResponse.json({ error: "프로젝트 자료를 볼 권한이 없습니다." }, { status: 403 });
    }

    const assetType = normalizeAssetType(request.nextUrl.searchParams.get("type"));
    if (!assetType) return NextResponse.json({ error: "자료 종류가 올바르지 않습니다." }, { status: 400 });

    const supabase = requireProjectAccessDb();
    let query = supabase
      .from("project_reference_assets")
      .select(SELECT_COLUMNS)
      .eq("project_id", projectId)
      .eq("asset_type", assetType)
      .order("sort_order", { ascending: true })
      .order("created_at", { ascending: false });
    const dailyPlanId = cleanText(request.nextUrl.searchParams.get("dailyPlanId"), 500);
    if (dailyPlanId) query = query.eq("daily_plan_id", dailyPlanId);
    const { data, error } = await query;
    if (error) throw error;
    return NextResponse.json({ ok: true, assets: (data ?? []).map(mapAssetRow) });
  } catch (error) {
    return materialError(error, "프로젝트 자료를 불러오지 못했습니다.");
  }
}

export async function POST(request: NextRequest, context: RouteContext) {
  let uploadedPath = "";
  try {
    const projectId = await getProjectId(context);
    if (!projectId) return NextResponse.json({ error: "프로젝트 ID가 올바르지 않습니다." }, { status: 400 });
    if ((await getMaterialRole(request, projectId)) !== "admin") {
      return NextResponse.json({ error: "자료 업로드는 Key staff만 할 수 있습니다." }, { status: 403 });
    }

    const formData = await request.formData();
    const assetType = normalizeAssetType(formData.get("assetType"));
    const file = formData.get("file");
    if (!assetType || !(file instanceof File)) {
      return NextResponse.json({ error: "업로드할 자료가 없습니다." }, { status: 400 });
    }
    const validationError = validateFile(assetType, file);
    if (validationError) return NextResponse.json({ error: validationError }, { status: 415 });

    const dailyPlanId = cleanText(formData.get("dailyPlanId"), 500);
    const sceneNo = cleanText(formData.get("sceneNo"), 100);
    const cutNo = cleanText(formData.get("cutNo"), 100);
    const shotRef = cleanText(formData.get("shotRef"), 500);
    if (assetType === "overhead" && (!dailyPlanId || !shotRef)) {
      return NextResponse.json({ error: "부감도에는 회차와 컷 식별값이 필요합니다." }, { status: 400 });
    }

    const supabase = requireProjectAccessDb();
    const safeFilename = safeName(file.name);
    uploadedPath = `project-assets/${projectId}/${assetType}/${Date.now()}-${randomUUID()}-${safeFilename}`;
    const { error: uploadError } = await supabase.storage
      .from(STORAGE_BUCKET)
      .upload(uploadedPath, Buffer.from(await file.arrayBuffer()), {
        contentType: file.type || "application/octet-stream",
        upsert: false
      });
    if (uploadError) throw uploadError;
    const { data: publicData } = supabase.storage.from(STORAGE_BUCKET).getPublicUrl(uploadedPath);
    const payload = {
      project_id: projectId,
      asset_type: assetType,
      filename: file.name.slice(0, 500),
      storage_path: uploadedPath,
      public_url: publicData.publicUrl,
      mime_type: file.type || "application/octet-stream",
      size_bytes: file.size,
      daily_plan_id: dailyPlanId || null,
      scene_no: sceneNo || null,
      cut_no: cutNo || null,
      shot_ref: shotRef || null,
      group_id: cleanText(formData.get("groupId"), 200) || null,
      crop_data: normalizeCrop({
        ratio: formData.get("cropRatio")
      }),
      sort_order: toInteger(formData.get("sortOrder"))
    };

    let savedRow: Record<string, unknown> | null = null;
    if (assetType === "overhead") {
      const { data: existing, error: existingError } = await supabase
        .from("project_reference_assets")
        .select(SELECT_COLUMNS)
        .eq("project_id", projectId)
        .eq("asset_type", "overhead")
        .eq("daily_plan_id", dailyPlanId)
        .eq("shot_ref", shotRef)
        .maybeSingle();
      if (existingError) throw existingError;

      if (existing) {
        const { data, error } = await supabase
          .from("project_reference_assets")
          .update(payload)
          .eq("id", existing.id)
          .eq("project_id", projectId)
          .select(SELECT_COLUMNS)
          .single();
        if (error) throw error;
        savedRow = data;
        const previousPath = String(existing.storage_path ?? "");
        if (previousPath && previousPath !== uploadedPath) {
          await supabase.storage.from(STORAGE_BUCKET).remove([previousPath]);
        }
      }
    }

    if (!savedRow) {
      const { data, error } = await supabase
        .from("project_reference_assets")
        .insert(payload)
        .select(SELECT_COLUMNS)
        .single();
      if (error) throw error;
      savedRow = data;
    }
    return NextResponse.json({ ok: true, asset: mapAssetRow(savedRow) }, { status: 201 });
  } catch (error) {
    if (uploadedPath) {
      try {
        await requireProjectAccessDb().storage.from(STORAGE_BUCKET).remove([uploadedPath]);
      } catch {
        // 메타데이터 저장 실패 응답을 우선합니다.
      }
    }
    return materialError(error, "자료를 업로드하지 못했습니다.");
  }
}

export async function PATCH(request: NextRequest, context: RouteContext) {
  try {
    const projectId = await getProjectId(context);
    if (!projectId) return NextResponse.json({ error: "프로젝트 ID가 올바르지 않습니다." }, { status: 400 });
    if ((await getMaterialRole(request, projectId)) !== "admin") {
      return NextResponse.json({ error: "자료 수정은 Key staff만 할 수 있습니다." }, { status: 403 });
    }
    const body = (await request.json()) as {
      id?: unknown;
      groupId?: unknown;
      crop?: unknown;
      sortOrder?: unknown;
    };
    const id = cleanText(body.id, 100);
    if (!id) return NextResponse.json({ error: "자료 ID가 필요합니다." }, { status: 400 });
    const supabase = requireProjectAccessDb();
    const { data, error } = await supabase
      .from("project_reference_assets")
      .update({
        group_id: cleanText(body.groupId, 200) || null,
        crop_data: normalizeCrop(body.crop),
        sort_order: toInteger(body.sortOrder)
      })
      .eq("id", id)
      .eq("project_id", projectId)
      .select(SELECT_COLUMNS)
      .single();
    if (error) throw error;
    return NextResponse.json({ ok: true, asset: mapAssetRow(data) });
  } catch (error) {
    return materialError(error, "자료 설정을 저장하지 못했습니다.");
  }
}

export async function DELETE(request: NextRequest, context: RouteContext) {
  try {
    const projectId = await getProjectId(context);
    if (!projectId) return NextResponse.json({ error: "프로젝트 ID가 올바르지 않습니다." }, { status: 400 });
    if ((await getMaterialRole(request, projectId)) !== "admin") {
      return NextResponse.json({ error: "자료 삭제는 Key staff만 할 수 있습니다." }, { status: 403 });
    }
    const id = cleanText(request.nextUrl.searchParams.get("id"), 100);
    if (!id) return NextResponse.json({ error: "자료 ID가 필요합니다." }, { status: 400 });
    const supabase = requireProjectAccessDb();
    const { data: existing, error: readError } = await supabase
      .from("project_reference_assets")
      .select("id,storage_path")
      .eq("id", id)
      .eq("project_id", projectId)
      .maybeSingle();
    if (readError) throw readError;
    if (!existing) return NextResponse.json({ error: "자료를 찾을 수 없습니다." }, { status: 404 });
    const { error: deleteError } = await supabase
      .from("project_reference_assets")
      .delete()
      .eq("id", id)
      .eq("project_id", projectId);
    if (deleteError) throw deleteError;
    if (existing.storage_path) {
      const { error: storageError } = await supabase.storage.from(STORAGE_BUCKET).remove([existing.storage_path]);
      if (storageError) console.error("[reference-assets:storage-delete]", safeError(storageError));
    }
    return NextResponse.json({ ok: true });
  } catch (error) {
    return materialError(error, "자료를 삭제하지 못했습니다.");
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

function normalizeAssetType(value: unknown): AssetType | null {
  return value === "scenario" || value === "storyboard" || value === "overhead" ? value : null;
}

function validateFile(assetType: AssetType, file: File) {
  if (assetType === "scenario") {
    if (file.type !== "application/pdf" && !/\.pdf$/i.test(file.name)) return "PDF 파일만 업로드할 수 있습니다.";
    if (file.size > 50 * 1024 * 1024) return "PDF는 50MB 이하만 업로드할 수 있습니다.";
    return "";
  }
  if (!file.type.startsWith("image/") && !/\.(?:jpe?g|png|gif|webp|heic|heif)$/i.test(file.name)) {
    return "이미지 파일만 업로드할 수 있습니다.";
  }
  return file.size > 20 * 1024 * 1024 ? "이미지는 장당 20MB 이하만 업로드할 수 있습니다." : "";
}

function safeName(value: string) {
  return value.normalize("NFKD").replace(/[^\w.\-]+/g, "-").replace(/-+/g, "-").replace(/^-|-$/g, "").slice(0, 120) || "file";
}

function cleanText(value: unknown, max: number) {
  return typeof value === "string" ? value.trim().slice(0, max) : "";
}

function toInteger(value: unknown) {
  const parsed = Number(value);
  return Number.isFinite(parsed) ? Math.max(0, Math.round(parsed)) : 0;
}

function normalizeCrop(value: unknown) {
  const source = value && typeof value === "object"
    ? value as Record<string, unknown>
    : { ratio: value };
  const number = (key: string, fallback: number) => {
    const parsed = Number(source[key]);
    return Number.isFinite(parsed) ? parsed : fallback;
  };
  const ratio = number("ratio", 0);
  return {
    x: Math.min(1, Math.max(0, number("x", 0))),
    y: Math.min(1, Math.max(0, number("y", 0))),
    width: Math.min(1, Math.max(0.01, number("width", 1))),
    height: Math.min(1, Math.max(0.01, number("height", 1))),
    ratio: ratio > 0 ? ratio : null
  };
}

function mapAssetRow(row: Record<string, unknown>) {
  return {
    id: String(row.id ?? ""),
    projectId: String(row.project_id ?? ""),
    assetType: String(row.asset_type ?? ""),
    filename: String(row.filename ?? ""),
    storagePath: String(row.storage_path ?? ""),
    publicUrl: String(row.public_url ?? ""),
    mimeType: String(row.mime_type ?? ""),
    sizeBytes: Number(row.size_bytes ?? 0),
    dailyPlanId: row.daily_plan_id ? String(row.daily_plan_id) : null,
    sceneNo: row.scene_no ? String(row.scene_no) : null,
    cutNo: row.cut_no ? String(row.cut_no) : null,
    shotRef: row.shot_ref ? String(row.shot_ref) : null,
    groupId: row.group_id ? String(row.group_id) : null,
    crop: normalizeCrop(row.crop_data),
    sortOrder: Number(row.sort_order ?? 0),
    createdAt: String(row.created_at ?? ""),
    updatedAt: String(row.updated_at ?? "")
  };
}

function materialError(error: unknown, message: string) {
  if (error instanceof ProjectAccessUnavailableError) {
    return NextResponse.json({ error: message, code: "PROJECT_REFERENCE_STORAGE_UNAVAILABLE" }, { status: 503 });
  }
  console.error("[reference-assets]", safeError(error));
  const source = safeError(error);
  const missingTable = source.code === "42P01" || /project_reference_assets/i.test(source.message) && /does not exist|schema cache/i.test(source.message);
  return NextResponse.json({
    error: missingTable ? "프로젝트 자료 migration을 먼저 적용해주세요." : message,
    code: missingTable ? "PROJECT_REFERENCE_MIGRATION_REQUIRED" : "PROJECT_REFERENCE_ERROR",
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
