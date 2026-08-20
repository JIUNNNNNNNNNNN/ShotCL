"use client";

import { getSupabaseBrowserClient } from "@/lib/supabase/client";

export type ProjectDeletionBoundaryHandlers = {
  onProjectDeleted: (projectId: string) => void;
  onConnectionError: () => void;
};

/** One private project channel protects non-Progress authenticated member pages. */
export function subscribeToMemberProjectDeletionBoundary(
  projectId: string,
  handlers: ProjectDeletionBoundaryHandlers
) {
  const supabase = getSupabaseBrowserClient();
  if (!supabase) return () => undefined;
  let active = true;
  let hasSubscribed = false;
  const handleDeletionRow = (row: Record<string, unknown>) => {
    const deletedProjectId = String(row.project_id ?? "");
    if (
      !active
      || deletedProjectId !== projectId
      || !String(row.deletion_started_at ?? "").trim()
    ) return;
    active = false;
    void supabase.removeChannel(channel);
    handlers.onProjectDeleted(deletedProjectId);
  };
  const channel = supabase
    .channel(`progress-project:${projectId}`, {
      config: { private: true, broadcast: { ack: true } }
    })
    .on("broadcast", { event: "project-deleted" }, ({ payload }) => {
      if (!active || String(payload?.projectId ?? "") !== projectId) return;
      handlers.onConnectionError();
    })
    .on(
      "postgres_changes",
      {
        event: "INSERT",
        schema: "public",
        table: "project_deletion_events",
        filter: `project_id=eq.${projectId}`
      },
      (payload) => handleDeletionRow((payload.new ?? {}) as Record<string, unknown>)
    )
    .on(
      "postgres_changes",
      {
        event: "UPDATE",
        schema: "public",
        table: "project_deletion_events",
        filter: `project_id=eq.${projectId}`
      },
      (payload) => handleDeletionRow((payload.new ?? {}) as Record<string, unknown>)
    )
    .subscribe((status) => {
      if (!active) return;
      if (status === "SUBSCRIBED" && !hasSubscribed) {
        hasSubscribed = true;
        return;
      }
      handlers.onConnectionError();
    });

  return () => {
    active = false;
    void supabase.removeChannel(channel);
  };
}

/** Guest/legacy non-Progress pages reuse one bounded server-authorized stream. */
export function subscribeToServerProjectDeletionBoundary(
  projectId: string,
  handlers: ProjectDeletionBoundaryHandlers
) {
  const source = new EventSource(
    `/api/projects/${encodeURIComponent(projectId)}/deletion-events`
  );
  let expectedRotationClose = false;
  const handleProjectDeleted = (message: MessageEvent<string>) => {
    let payload: unknown;
    try {
      payload = JSON.parse(message.data);
    } catch {
      return;
    }
    if (
      !payload
      || typeof payload !== "object"
      || String((payload as Record<string, unknown>).projectId ?? "") !== projectId
    ) return;
    source.close();
    handlers.onProjectDeleted(projectId);
  };
  const handleExpectedRotation = () => {
    expectedRotationClose = true;
  };
  const handleConnectionError = () => {
    expectedRotationClose = false;
    handlers.onConnectionError();
  };
  const handleNativeError = () => {
    if (expectedRotationClose) {
      expectedRotationClose = false;
      return;
    }
    if (source.readyState !== EventSource.CLOSED) return;
    handlers.onConnectionError();
  };
  source.addEventListener("project-deleted", handleProjectDeleted as EventListener);
  source.addEventListener("project-access-check", handleConnectionError);
  source.addEventListener("stream-error", handleConnectionError);
  source.addEventListener("stream-close", handleExpectedRotation);
  source.addEventListener("error", handleNativeError);

  return () => {
    source.removeEventListener("project-deleted", handleProjectDeleted as EventListener);
    source.removeEventListener("project-access-check", handleConnectionError);
    source.removeEventListener("stream-error", handleConnectionError);
    source.removeEventListener("stream-close", handleExpectedRotation);
    source.removeEventListener("error", handleNativeError);
    source.close();
  };
}
