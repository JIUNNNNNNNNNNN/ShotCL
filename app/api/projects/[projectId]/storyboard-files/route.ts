import { NextRequest, NextResponse } from "next/server";
import { getAccessGrant, ProjectAccessUnavailableError, requireProjectAccessDb } from "@/lib/projectAccess/server";

const STORAGE_BUCKET = "storyboards";

function safeName(value: string) {
  return value.normalize("NFKD").replace(/[^\w.\-]+/g, "-").replace(/-+/g, "-").replace(/^-|-$/g, "").slice(0, 120) || "storyboard-file";
}

function isStoryboardImage(file: File) {
  return file.type.startsWith("image/") || /\.(?:jpe?g|png|gif|webp|heic|heif)$/i.test(file.name);
}

async function requireAdmin(request: NextRequest, projectId: string) {
  const grant = await getAccessGrant(request, projectId);
  return grant?.role === "admin";
}

export async function POST(request: NextRequest, context: { params: Promise<{ projectId: string }> }) {
  try {
    const { projectId } = await context.params;
    if (!(await requireAdmin(request, projectId))) return NextResponse.json({ error: "Key staff 권한이 필요합니다." }, { status: 403 });
    const formData = await request.formData();
    const file = formData.get("file");
    const legacyShotId = String(formData.get("shotId") || "").trim();
    const assetType = formData.get("assetType") === "schedule" ? "schedule" : "shot";
    const assetRef = String(formData.get("assetRef") || legacyShotId).trim();
    if (!(file instanceof File) || !assetRef) return NextResponse.json({ error: "이미지 정보가 없습니다." }, { status: 400 });
    if (!isStoryboardImage(file)) return NextResponse.json({ error: "이미지 파일만 업로드할 수 있습니다." }, { status: 415 });
    const supabase = requireProjectAccessDb();
    const folder = assetType === "schedule" ? "schedule-items" : "shots";
    const storagePath = `storyboard-files/${projectId}/${folder}/${safeName(assetRef)}/${Date.now()}-${safeName(file.name)}`;
    const { error: uploadError } = await supabase.storage.from(STORAGE_BUCKET).upload(storagePath, Buffer.from(await file.arrayBuffer()), {
      contentType: file.type || "application/octet-stream",
      upsert: true
    });
    if (uploadError) throw uploadError;
    const { data: publicData } = supabase.storage.from(STORAGE_BUCKET).getPublicUrl(storagePath);
    return NextResponse.json({ imageUrl: publicData.publicUrl });
  } catch (error) {
    return NextResponse.json({ error: "이미지를 업로드하지 못했습니다." }, { status: error instanceof ProjectAccessUnavailableError ? 503 : 500 });
  }
}
