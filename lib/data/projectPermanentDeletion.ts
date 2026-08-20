import { isValidDatabaseProjectId, normalizeProjectId } from "@/lib/projectId";
import { PROJECT_PERMANENT_DELETE_CONFIRMATION_PHRASE } from "@/lib/projectDeletion/core";

export const PROJECT_PERMANENT_DELETE_PHRASE = PROJECT_PERMANENT_DELETE_CONFIRMATION_PHRASE;

type ProjectPermanentDeletionPayload = {
  ok?: boolean;
  deletedProjectId?: string;
  deletedStorageObjectCount?: number;
  message?: string;
  error?: string;
  code?: string;
};

export class ProjectPermanentDeletionError extends Error {
  readonly status: number;
  readonly code: string;

  constructor(message: string, status: number, code = "") {
    super(message);
    this.name = "ProjectPermanentDeletionError";
    this.status = status;
    this.code = code;
  }
}

/** Client fallback 없이 owner-authorized canonical destruction endpoint만 호출합니다. */
export async function permanentlyDeleteProject(input: {
  projectId: string;
  projectName: string;
  confirmationPhrase: string;
}) {
  const projectId = normalizeProjectId(input.projectId);
  if (!isValidDatabaseProjectId(projectId)) {
    throw new ProjectPermanentDeletionError("프로젝트 ID가 올바르지 않습니다.", 400, "INVALID_PROJECT_ID");
  }
  // Destructive submit 시점에만 현재 Google session을 읽습니다. 일반 project
  // bootstrap에는 auth query나 delete code를 추가하지 않습니다.
  const { getSupabaseBrowserClient } = await import("@/lib/supabase/client");
  const supabase = getSupabaseBrowserClient();
  const { data: sessionData, error: sessionError } = supabase
    ? await supabase.auth.getSession()
    : { data: { session: null }, error: null };
  const accessToken = sessionData.session?.access_token?.trim() ?? "";
  if (sessionError || !accessToken) {
    throw new ProjectPermanentDeletionError(
      "Google 계정을 다시 확인한 뒤 영구 삭제를 시도해주세요.",
      401,
      "GOOGLE_REAUTH_REQUIRED"
    );
  }
  const response = await fetch(`/api/projects/${encodeURIComponent(projectId)}`, {
    method: "DELETE",
    cache: "no-store",
    credentials: "same-origin",
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${accessToken}`
    },
    body: JSON.stringify({
      projectName: input.projectName.trim(),
      confirmationPhrase: input.confirmationPhrase
    })
  });
  const payload = await readPayload(response);
  if (response.status === 404 && payload.code === "PROJECT_NOT_FOUND") {
    // A completed request whose response was lost may be retried. Treat only
    // the exact old route UUID's terminal absence as success; never find by name.
    return;
  }
  if (!response.ok) {
    throw new ProjectPermanentDeletionError(
      payload.error || "프로젝트를 영구 삭제하지 못했습니다.",
      response.status,
      payload.code ?? ""
    );
  }
  if (
    payload.ok !== true
    || normalizeProjectId(payload.deletedProjectId ?? "") !== projectId
  ) {
    throw new ProjectPermanentDeletionError(
      "프로젝트 삭제 완료 응답을 확인하지 못했습니다.",
      502,
      "INVALID_DELETE_RESPONSE"
    );
  }
  return payload;
}

async function readPayload(response: Response): Promise<ProjectPermanentDeletionPayload> {
  try {
    return await response.json() as ProjectPermanentDeletionPayload;
  } catch {
    return {};
  }
}
