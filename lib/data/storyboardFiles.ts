import { getSupabaseBrowserClient } from "@/lib/supabase/client";
import { storyboardFileFromRow } from "@/lib/data/mappers";
import { createLocalId, readLocalBuckets, writeLocalBuckets } from "@/lib/data/localStore";
import type { StoryboardFile } from "@/lib/types";

const STORAGE_BUCKET = "storyboards";

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
