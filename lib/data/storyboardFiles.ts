import { getSupabaseBrowserClient } from "@/lib/supabase/client";

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

function isStoryboardImage(file: File) {
  return file.type.startsWith("image/") || /\.(?:jpe?g|png|gif|webp|heic|heif)$/i.test(file.name);
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

type StoryboardAsset = {
  folder: "shots" | "schedule-items";
  ref: string;
};

async function saveStoryboardImage(projectId: string, asset: StoryboardAsset, file: File): Promise<string> {
  if (!isStoryboardImage(file)) {
    throw new Error("이미지 파일만 업로드할 수 있습니다.");
  }

  if (await hasSharedAccess(projectId)) {
    const formData = new FormData();
    formData.set("file", file);
    formData.set("assetType", asset.folder === "schedule-items" ? "schedule" : "shot");
    formData.set("assetRef", asset.ref);
    const response = await fetch(`/api/projects/${encodeURIComponent(projectId)}/storyboard-files`, { method: "POST", body: formData });
    const payload = (await response.json()) as { imageUrl?: string; error?: string };
    if (!response.ok || !payload.imageUrl) throw new Error(payload.error || "이미지를 업로드하지 못했습니다.");
    return payload.imageUrl;
  }

  const supabase = getSupabaseBrowserClient();
  if (supabase) {
    const storagePath = `storyboard-files/${projectId}/${asset.folder}/${sanitizeFileName(asset.ref)}/${Date.now()}-${sanitizeFileName(file.name) || "image"}`;
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

/** 컷 수정 모달에서 선택한 콘티 이미지를 저장하고 카드에서 표시할 URL을 반환합니다. */
export async function saveShotStoryboardImage(projectId: string, shotId: string, file: File): Promise<string> {
  return saveStoryboardImage(projectId, { folder: "shots", ref: shotId }, file);
}

/** 기타일정 팝업에서 선택한 이미지를 컷과 분리된 Storage 경로에 저장합니다. */
export async function saveScheduleImage(projectId: string, dailyPlanId: string, itemId: string, file: File): Promise<string> {
  return saveStoryboardImage(projectId, {
    folder: "schedule-items",
    ref: `${dailyPlanId}-${itemId}`
  }, file);
}
