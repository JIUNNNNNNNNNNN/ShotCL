import { getSupabaseBrowserClient } from "@/lib/supabase/client";
import { storyboardFileFromRow } from "@/lib/data/mappers";
import { createLocalId, readLocalBuckets, writeLocalBuckets } from "@/lib/data/localStore";
import type { StoryboardFile } from "@/lib/types";

const STORAGE_BUCKET = "storyboards";

async function hasSharedAccess(projectId: string) {
  try {
    return (await fetch(`/api/projects/${encodeURIComponent(projectId)}/access`, { cache: "no-store" })).ok;
  } catch {
    return false;
  }
}

/** 파일명을 Supabase Storage path에 안전하게 넣을 수 있도록 단순화합니다. */
function sanitizeFileName(fileName: string) {
  return fileName
    .normalize("NFKD")
    .replace(/[^\w.\-]+/g, "-")
    .replace(/-+/g, "-")
    .replace(/^-|-$/g, "")
    .slice(0, 120);
}

/** 프로젝트에 업로드된 스토리보드 파일 목록을 가져옵니다. */
export async function listStoryboardFiles(projectId: string): Promise<StoryboardFile[]> {
  if (await hasSharedAccess(projectId)) {
    const response = await fetch(`/api/projects/${encodeURIComponent(projectId)}/storyboard-files`, { cache: "no-store" });
    const payload = (await response.json()) as { files?: Record<string, unknown>[]; error?: string };
    if (!response.ok || !payload.files) throw new Error(payload.error || "업로드 파일을 불러오지 못했습니다.");
    return payload.files.map(storyboardFileFromRow);
  }
  const supabase = getSupabaseBrowserClient();

  if (supabase) {
    const { data, error } = await supabase
      .from("storyboard_files")
      .select("*")
      .eq("project_id", projectId)
      .order("created_at", { ascending: false });

    if (error) throw error;
    return data.map(storyboardFileFromRow);
  }

  const { files } = readLocalBuckets();
  return files.filter((file) => file.projectId === projectId).sort((a, b) => b.createdAt.localeCompare(a.createdAt));
}

/** 브라우저에서 선택한 파일을 Supabase Storage 또는 로컬 개발 목록에 저장합니다. */
export async function saveStoryboardFile(projectId: string, file: File): Promise<StoryboardFile> {
  if (await hasSharedAccess(projectId)) {
    const formData = new FormData();
    formData.set("file", file);
    const response = await fetch(`/api/projects/${encodeURIComponent(projectId)}/storyboard-files`, { method: "POST", body: formData });
    const payload = (await response.json()) as { file?: Record<string, unknown>; error?: string };
    if (!response.ok || !payload.file) throw new Error(payload.error || "파일을 업로드하지 못했습니다.");
    return storyboardFileFromRow(payload.file);
  }
  const supabase = getSupabaseBrowserClient();
  const now = new Date().toISOString();

  if (supabase) {
    const storagePath = `storyboard-files/${projectId}/original/${Date.now()}-${sanitizeFileName(file.name) || "storyboard-file"}`;
    const { error: uploadError } = await supabase.storage.from(STORAGE_BUCKET).upload(storagePath, file, {
      contentType: file.type || "application/octet-stream",
      upsert: false
    });

    if (uploadError) throw uploadError;

    const { data, error } = await supabase
      .from("storyboard_files")
      .insert({
        project_id: projectId,
        file_name: file.name,
        file_type: file.type || "unknown",
        file_size: file.size,
        storage_path: storagePath
      })
      .select("*")
      .single();

    if (error) throw error;
    return storyboardFileFromRow(data);
  }

  const record: StoryboardFile = {
    id: createLocalId("file"),
    projectId,
    fileName: file.name,
    fileType: file.type || "unknown",
    fileSize: file.size,
    storagePath: `local-dev/${projectId}/${file.name}`,
    createdAt: now
  };

  const { files } = readLocalBuckets();
  writeLocalBuckets({ files: [record, ...files] }, projectId);
  return record;
}

/** 업로드 파일 목록에서 파일 기록을 삭제합니다. Supabase에서는 Storage 원본도 함께 삭제합니다. */
export async function deleteStoryboardFile(file: StoryboardFile): Promise<void> {
  if (await hasSharedAccess(file.projectId)) {
    const response = await fetch(`/api/projects/${encodeURIComponent(file.projectId)}/storyboard-files`, {
      method: "DELETE",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ fileId: file.id, storagePath: file.storagePath })
    });
    if (!response.ok) {
      const payload = (await response.json()) as { error?: string };
      throw new Error(payload.error || "파일을 삭제하지 못했습니다.");
    }
    return;
  }
  const supabase = getSupabaseBrowserClient();

  if (supabase) {
    const storageResult = await supabase.storage.from(STORAGE_BUCKET).remove([file.storagePath]);
    if (storageResult.error) throw storageResult.error;

    const { error } = await supabase.from("storyboard_files").delete().eq("id", file.id);
    if (error) throw error;
    return;
  }

  const buckets = readLocalBuckets();
  writeLocalBuckets({ files: buckets.files.filter((item) => item.id !== file.id) }, file.projectId);
}

/** 로컬 개발 모드에서 선택한 이미지를 data URL로 바꿉니다. */
function readFileAsDataUrl(file: File) {
  return new Promise<string>((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(String(reader.result));
    reader.onerror = () => reject(new Error("이미지를 읽지 못했습니다."));
    reader.readAsDataURL(file);
  });
}

/** 컷 수정 모달에서 선택한 콘티 이미지를 저장하고 카드에서 표시할 URL을 반환합니다. */
export async function saveShotStoryboardImage(projectId: string, shotId: string, file: File): Promise<string> {
  if (await hasSharedAccess(projectId)) {
    const formData = new FormData();
    formData.set("file", file);
    formData.set("shotId", shotId);
    const response = await fetch(`/api/projects/${encodeURIComponent(projectId)}/storyboard-files`, { method: "POST", body: formData });
    const payload = (await response.json()) as { imageUrl?: string; error?: string };
    if (!response.ok || !payload.imageUrl) throw new Error(payload.error || "콘티 이미지를 업로드하지 못했습니다.");
    return payload.imageUrl;
  }
  const supabase = getSupabaseBrowserClient();

  if (supabase) {
    const storagePath = `storyboard-files/${projectId}/shots/${shotId}/${Date.now()}-${sanitizeFileName(file.name) || "shot-image"}`;
    const { error } = await supabase.storage.from(STORAGE_BUCKET).upload(storagePath, file, {
      contentType: file.type || "image/jpeg",
      upsert: true
    });

    if (error) throw error;

    const { data } = supabase.storage.from(STORAGE_BUCKET).getPublicUrl(storagePath);
    return data.publicUrl;
  }

  return readFileAsDataUrl(file);
}
