import "server-only";

import { createHash } from "node:crypto";
import type { SupabaseClient } from "@supabase/supabase-js";
import { getProjectStoragePrefixes } from "@/lib/projectDeletion/core";
import {
  inventoryStorageObjects,
  removeStorageObjects,
  type ProjectStorageBucket
} from "@/lib/projectDeletion/storage";
import { requireProjectAccessDb } from "@/lib/projectAccess/server";

const STORAGE_BUCKET = "storyboards";
const STORAGE_EMPTY_SWEEP_LIMIT = 4;
const REALTIME_BROADCAST_TIMEOUT_MS = 2_000;
const CONFIRMATION_NAME_HASH_DOMAIN = "shotcl-project-permanent-deletion:v1";

export type ProjectPermanentDeletionErrorCode =
  | "PROJECT_NOT_FOUND"
  | "PROJECT_OWNER_REQUIRED"
  | "PROJECT_NAME_MISMATCH"
  | "PROJECT_DELETE_MIGRATION_REQUIRED"
  | "PROJECT_DELETE_SIGNAL_FAILED"
  | "STORAGE_INVENTORY_FAILED"
  | "STORAGE_DELETE_FAILED"
  | "PROJECT_DELETE_DB_FAILED";

export class ProjectPermanentDeletionError extends Error {
  readonly code: ProjectPermanentDeletionErrorCode;
  readonly status: number;

  constructor(
    code: ProjectPermanentDeletionErrorCode,
    message: string,
    status: number
  ) {
    super(message);
    this.name = "ProjectPermanentDeletionError";
    this.code = code;
    this.status = status;
  }
}

type ProjectRow = {
  id: string;
  name: string;
  created_by: string | null;
  deletion_started_at?: string | null;
};

type DeletionJobRow = {
  project_id: string;
  owner_user_id: string;
  confirmation_name_hash: string;
  storage_paths: unknown;
};

export type ProjectPermanentDeletionResult = {
  deletedProjectId: string;
  deletedStorageObjectCount: number;
};

/**
 * Server-only irreversible workflow. Storage is inventoried and verified empty
 * before the database transaction removes project rows and the retry job.
 */
export async function permanentlyDeleteProject(input: {
  projectId: string;
  ownerUserId: string;
  confirmedProjectName: string;
}): Promise<ProjectPermanentDeletionResult> {
  const supabase = requireProjectAccessDb();
  const confirmationNameHash = hashConfirmationName(input.confirmedProjectName);
  const [projectResult, jobResult] = await Promise.all([
    supabase
      .from("projects")
      .select("id,name,created_by,deletion_started_at")
      .eq("id", input.projectId)
      .maybeSingle(),
    supabase
      .from("project_deletion_jobs")
      .select("project_id,owner_user_id,confirmation_name_hash,storage_paths")
      .eq("project_id", input.projectId)
      .maybeSingle()
  ]);

  if (projectResult.error) {
    throw databaseFailure("프로젝트 삭제 대상을 확인하지 못했습니다.", projectResult.error);
  }
  if (jobResult.error) {
    throw migrationOrDatabaseFailure(jobResult.error);
  }

  const project = projectResult.data as ProjectRow | null;
  const existingJob = jobResult.data as DeletionJobRow | null;
  assertOwnerAndConfirmation({
    project,
    job: existingJob,
    ownerUserId: input.ownerUserId,
    confirmedProjectName: input.confirmedProjectName,
    confirmationNameHash
  });

  const storage = supabase.storage.from(STORAGE_BUCKET) as unknown as ProjectStorageBucket;

  // A failed preflight leaves the live project completely untouched.
  let pendingStoragePaths = await inventoryProjectStorageObjects(storage, input.projectId, {
    freshPreflight: !existingJob && !project?.deletion_started_at
  });

  const { data: beginResult, error: beginError } = await supabase.rpc(
    "begin_project_permanent_deletion",
    {
      p_project_id: input.projectId,
      p_owner_user_id: input.ownerUserId,
      p_confirmed_project_name: input.confirmedProjectName,
      p_confirmation_name_hash: confirmationNameHash
    }
  );
  if (beginError) throw migrationOrDatabaseFailure(beginError);
  if (beginResult !== "started" && beginResult !== "resumed") {
    throw new ProjectPermanentDeletionError(
      "PROJECT_NOT_FOUND",
      "프로젝트를 찾을 수 없습니다.",
      404
    );
  }

  // Existing viewers share this topic. Broadcast is only a low-latency wakeup;
  // clients re-probe the canonical project route, while DB events are fallback.
  try {
    await broadcastProjectDeletionWakeup(supabase, input.projectId);
  } catch {
    throw new ProjectPermanentDeletionError(
      "PROJECT_DELETE_SIGNAL_FAILED",
      "다른 접속자에게 삭제 시작을 알리지 못했습니다. 다시 시도해 주세요.",
      503
    );
  }

  const deletedStoragePaths = new Set<string>();
  for (let sweep = 0; sweep < STORAGE_EMPTY_SWEEP_LIMIT; sweep += 1) {
    const inventorySaved = await saveDeletionInventory(
      supabase,
      input.projectId,
      input.ownerUserId,
      pendingStoragePaths,
      false
    );
    if (!inventorySaved) {
      if (await isProjectPermanentlyAbsent(supabase, input.projectId)) {
        return completedResult(input.projectId, deletedStoragePaths);
      }
      throw databaseFailure("프로젝트 삭제 작업 상태를 저장하지 못했습니다.", null);
    }
    if (pendingStoragePaths.length > 0) {
      await deleteProjectStorageObjects(storage, pendingStoragePaths);
      pendingStoragePaths.forEach((path) => deletedStoragePaths.add(path));
    }
    // Always rescan after the lock, including when preflight was empty, so an
    // upload committed between preflight and begin cannot escape cleanup.
    pendingStoragePaths = await inventoryProjectStorageObjects(storage, input.projectId);
    if (pendingStoragePaths.length === 0) break;
  }

  const finalInventorySaved = await saveDeletionInventory(
    supabase,
    input.projectId,
    input.ownerUserId,
    pendingStoragePaths,
    pendingStoragePaths.length === 0
  );
  if (!finalInventorySaved) {
    if (await isProjectPermanentlyAbsent(supabase, input.projectId)) {
      return completedResult(input.projectId, deletedStoragePaths);
    }
    throw databaseFailure("프로젝트 삭제 작업 상태를 저장하지 못했습니다.", null);
  }
  if (pendingStoragePaths.length > 0) {
    throw new ProjectPermanentDeletionError(
      "STORAGE_DELETE_FAILED",
      "프로젝트 파일을 모두 정리하지 못했습니다. 다시 시도해 주세요.",
      503
    );
  }

  const { data: purged, error: purgeError } = await supabase.rpc(
    "purge_project_permanently",
    {
      p_project_id: input.projectId,
      p_owner_user_id: input.ownerUserId
    }
  );
  if (purgeError) throw migrationOrDatabaseFailure(purgeError, "PROJECT_DELETE_DB_FAILED");
  if (purged !== true) {
    if (await isProjectPermanentlyAbsent(supabase, input.projectId)) {
      return completedResult(input.projectId, deletedStoragePaths);
    }
    throw new ProjectPermanentDeletionError(
      "PROJECT_DELETE_DB_FAILED",
      "프로젝트 데이터 삭제를 완료하지 못했습니다. 다시 시도해 주세요.",
      503
    );
  }

  return completedResult(input.projectId, deletedStoragePaths);
}

/** Recursively inventories both canonical UUID prefixes in the sole media bucket. */
export async function inventoryProjectStorageObjects(
  storage: ProjectStorageBucket,
  projectId: string,
  options: { freshPreflight?: boolean } = {}
) {
  try {
    return await inventoryStorageObjects(storage, getProjectStoragePrefixes(projectId));
  } catch {
    throw new ProjectPermanentDeletionError(
      "STORAGE_INVENTORY_FAILED",
      options.freshPreflight
        ? "프로젝트 파일 목록을 확인하지 못했습니다. 아무 데이터도 삭제하지 않았습니다."
        : "프로젝트 파일 목록을 확인하지 못해 삭제를 성공으로 처리하지 않았습니다. 저장된 작업에서 다시 시도해 주세요.",
      503
    );
  }
}

async function deleteProjectStorageObjects(
  storage: ProjectStorageBucket,
  paths: string[]
) {
  try {
    await removeStorageObjects(storage, paths);
  } catch {
    throw new ProjectPermanentDeletionError(
      "STORAGE_DELETE_FAILED",
      "프로젝트 파일을 모두 정리하지 못했습니다. 다시 시도해 주세요.",
      503
    );
  }
}

async function saveDeletionInventory(
  supabase: SupabaseClient,
  projectId: string,
  ownerUserId: string,
  storagePaths: string[],
  verifiedEmpty: boolean
) {
  if (verifiedEmpty && storagePaths.length > 0) {
    throw new Error("Only an empty post-lock inventory can be verified.");
  }
  const { data, error } = await supabase
    .from("project_deletion_jobs")
    .update({
      storage_paths: storagePaths,
      storage_verified_at: verifiedEmpty ? new Date().toISOString() : null,
      updated_at: new Date().toISOString()
    })
    .eq("project_id", projectId)
    .eq("owner_user_id", ownerUserId)
    .select("project_id")
    .maybeSingle();
  if (error) throw databaseFailure("프로젝트 삭제 작업 상태를 저장하지 못했습니다.", error);
  return Boolean(data);
}

async function isProjectPermanentlyAbsent(
  supabase: SupabaseClient,
  projectId: string
) {
  const [projectResult, jobResult] = await Promise.all([
    supabase.from("projects").select("id").eq("id", projectId).maybeSingle(),
    supabase
      .from("project_deletion_jobs")
      .select("project_id")
      .eq("project_id", projectId)
      .maybeSingle()
  ]);
  if (projectResult.error) {
    throw databaseFailure("프로젝트 삭제 완료 상태를 확인하지 못했습니다.", projectResult.error);
  }
  if (jobResult.error) throw migrationOrDatabaseFailure(jobResult.error);
  return !projectResult.data && !jobResult.data;
}

function completedResult(projectId: string, deletedStoragePaths: Set<string>) {
  return {
    deletedProjectId: projectId,
    deletedStorageObjectCount: deletedStoragePaths.size
  };
}

async function broadcastProjectDeletionWakeup(
  supabase: SupabaseClient,
  projectId: string
) {
  const channel = supabase.channel(`progress-project:${projectId}`, {
    config: { private: true, broadcast: { ack: true } }
  });
  let timeout: ReturnType<typeof setTimeout> | null = null;
  try {
    await new Promise<void>((resolve, reject) => {
      timeout = setTimeout(
        () => reject(new Error("Realtime broadcast subscription timed out.")),
        REALTIME_BROADCAST_TIMEOUT_MS
      );
      channel.subscribe((status) => {
        if (status === "SUBSCRIBED") resolve();
        else if (status === "CHANNEL_ERROR" || status === "TIMED_OUT" || status === "CLOSED") {
          reject(new Error("Realtime broadcast subscription failed."));
        }
      });
    });
    const status = await channel.send({
      type: "broadcast",
      event: "project-deleted",
      payload: { projectId }
    });
    if (status !== "ok") throw new Error("Realtime broadcast send failed.");
  } finally {
    if (timeout) clearTimeout(timeout);
    await supabase.removeChannel(channel).catch(() => undefined);
  }
}

function assertOwnerAndConfirmation(input: {
  project: ProjectRow | null;
  job: DeletionJobRow | null;
  ownerUserId: string;
  confirmedProjectName: string;
  confirmationNameHash: string;
}) {
  if (input.project) {
    if (!input.project.created_by || input.project.created_by !== input.ownerUserId) {
      throw new ProjectPermanentDeletionError(
        "PROJECT_OWNER_REQUIRED",
        "프로젝트 최초 작성자만 영구 삭제할 수 있습니다.",
        403
      );
    }
    if (input.project.name.trim() !== input.confirmedProjectName) {
      throw new ProjectPermanentDeletionError(
        "PROJECT_NAME_MISMATCH",
        "입력한 프로젝트 이름이 현재 프로젝트 이름과 일치하지 않습니다.",
        409
      );
    }
    return;
  }

  if (!input.job) {
    throw new ProjectPermanentDeletionError(
      "PROJECT_NOT_FOUND",
      "프로젝트를 찾을 수 없습니다.",
      404
    );
  }
  if (input.job.owner_user_id !== input.ownerUserId) {
    throw new ProjectPermanentDeletionError(
      "PROJECT_OWNER_REQUIRED",
      "프로젝트 최초 작성자만 영구 삭제할 수 있습니다.",
      403
    );
  }
  if (input.job.confirmation_name_hash !== input.confirmationNameHash) {
    throw new ProjectPermanentDeletionError(
      "PROJECT_NAME_MISMATCH",
      "입력한 프로젝트 이름이 삭제 작업의 프로젝트와 일치하지 않습니다.",
      409
    );
  }
}

function hashConfirmationName(projectName: string) {
  return createHash("sha256")
    .update(`${CONFIRMATION_NAME_HASH_DOMAIN}\0${projectName}`, "utf8")
    .digest("hex");
}

function migrationOrDatabaseFailure(
  error: unknown,
  fallbackCode: ProjectPermanentDeletionErrorCode = "PROJECT_DELETE_DB_FAILED"
) {
  const source = databaseError(error);
  if (source.code === "42501") {
    return new ProjectPermanentDeletionError(
      "PROJECT_OWNER_REQUIRED",
      "프로젝트 최초 작성자만 영구 삭제할 수 있습니다.",
      403
    );
  }
  if (/project name confirmation mismatch/iu.test(source.message)) {
    return new ProjectPermanentDeletionError(
      "PROJECT_NAME_MISMATCH",
      "입력한 프로젝트 이름이 현재 프로젝트 이름과 일치하지 않습니다.",
      409
    );
  }
  const missingMigration = source.code === "42P01"
    || source.code === "42703"
    || source.code === "PGRST202"
    || source.code === "PGRST204"
    || source.code === "PGRST205"
    || /project_deletion_jobs|begin_project_permanent_deletion|purge_project_permanently/iu.test(source.message);
  return new ProjectPermanentDeletionError(
    missingMigration ? "PROJECT_DELETE_MIGRATION_REQUIRED" : fallbackCode,
    missingMigration
      ? "프로젝트 영구 삭제 migration이 적용되지 않았습니다."
      : "프로젝트 데이터 삭제를 완료하지 못했습니다. 다시 시도해 주세요.",
    503
  );
}

function databaseFailure(message: string, error: unknown) {
  const source = databaseError(error);
  const missingMigration = source.code === "42P01"
    || source.code === "42703"
    || source.code === "PGRST204"
    || source.code === "PGRST205";
  return new ProjectPermanentDeletionError(
    missingMigration ? "PROJECT_DELETE_MIGRATION_REQUIRED" : "PROJECT_DELETE_DB_FAILED",
    missingMigration ? "프로젝트 영구 삭제 migration이 적용되지 않았습니다." : message,
    503
  );
}

function databaseError(error: unknown) {
  if (!error || typeof error !== "object" || Array.isArray(error)) {
    return { code: "", message: "" };
  }
  const source = error as Record<string, unknown>;
  return {
    code: typeof source.code === "string" ? source.code : "",
    message: typeof source.message === "string" ? source.message : ""
  };
}
