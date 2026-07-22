import { NextRequest, NextResponse } from "next/server";
import { getAccessGrant, ProjectAccessUnavailableError, requireProjectAccessDb } from "@/lib/projectAccess/server";

const STORAGE_BUCKET = "storyboards";

function safeName(value: string) {
  return value.normalize("NFKD").replace(/[^\w.\-]+/g, "-").replace(/-+/g, "-").replace(/^-|-$/g, "").slice(0, 120) || "storyboard-file";
}

async function requireAdmin(request: NextRequest, projectId: string) {
  const grant = await getAccessGrant(request, projectId);
  return grant?.role === "admin";
}

export async function GET(request: NextRequest, context: { params: Promise<{ projectId: string }> }) {
  try {
    const { projectId } = await context.params;
    if (!(await requireAdmin(request, projectId))) return NextResponse.json({ error: "관리자 권한이 필요합니다." }, { status: 403 });
    const supabase = requireProjectAccessDb();
    const { data, error } = await supabase.from("storyboard_files").select("*").eq("project_id", projectId).order("created_at", { ascending: false });
    if (error) throw error;
    return NextResponse.json({ files: data });
  } catch (error) {
    return NextResponse.json({ error: "업로드 파일을 불러오지 못했습니다." }, { status: error instanceof ProjectAccessUnavailableError ? 503 : 500 });
  }
}

export async function POST(request: NextRequest, context: { params: Promise<{ projectId: string }> }) {
  try {
    const { projectId } = await context.params;
    if (!(await requireAdmin(request, projectId))) return NextResponse.json({ error: "관리자 권한이 필요합니다." }, { status: 403 });
    const formData = await request.formData();
    const file = formData.get("file");
    const shotId = String(formData.get("shotId") || "");
    if (!(file instanceof File)) return NextResponse.json({ error: "업로드할 파일이 없습니다." }, { status: 400 });
    const supabase = requireProjectAccessDb();
    const folder = shotId ? `shots/${shotId}` : "original";
    const storagePath = `storyboard-files/${projectId}/${folder}/${Date.now()}-${safeName(file.name)}`;
    const { error: uploadError } = await supabase.storage.from(STORAGE_BUCKET).upload(storagePath, Buffer.from(await file.arrayBuffer()), {
      contentType: file.type || "application/octet-stream",
      upsert: Boolean(shotId)
    });
    if (uploadError) throw uploadError;
    const { data: publicData } = supabase.storage.from(STORAGE_BUCKET).getPublicUrl(storagePath);
    if (shotId) return NextResponse.json({ imageUrl: publicData.publicUrl });
    const { data, error } = await supabase.from("storyboard_files").insert({
      project_id: projectId,
      file_name: file.name,
      file_type: file.type || "unknown",
      file_size: file.size,
      storage_path: storagePath
    }).select("*").single();
    if (error) throw error;
    return NextResponse.json({ file: data });
  } catch (error) {
    return NextResponse.json({ error: "파일을 업로드하지 못했습니다." }, { status: error instanceof ProjectAccessUnavailableError ? 503 : 500 });
  }
}

export async function DELETE(request: NextRequest, context: { params: Promise<{ projectId: string }> }) {
  try {
    const { projectId } = await context.params;
    if (!(await requireAdmin(request, projectId))) return NextResponse.json({ error: "관리자 권한이 필요합니다." }, { status: 403 });
    const { fileId, storagePath } = (await request.json()) as { fileId?: string; storagePath?: string };
    if (!fileId || !storagePath) return NextResponse.json({ error: "삭제할 파일 정보가 없습니다." }, { status: 400 });
    const supabase = requireProjectAccessDb();
    const storageResult = await supabase.storage.from(STORAGE_BUCKET).remove([storagePath]);
    if (storageResult.error) throw storageResult.error;
    const { error } = await supabase.from("storyboard_files").delete().eq("project_id", projectId).eq("id", fileId);
    if (error) throw error;
    return NextResponse.json({ success: true });
  } catch (error) {
    return NextResponse.json({ error: "파일을 삭제하지 못했습니다." }, { status: error instanceof ProjectAccessUnavailableError ? 503 : 500 });
  }
}
