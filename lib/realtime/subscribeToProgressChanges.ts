import { subscribeToLocalProjectChanges } from "@/lib/data/localStore";
import { getSupabaseBrowserClient } from "@/lib/supabase/client";
import type { DailyPlanRealtimeUpdate } from "@/lib/realtime/subscribeToDailyPlan";
import type { ShotRealtimeChange } from "@/lib/realtime/subscribeToShots";

export function subscribeToProgressChanges(
  projectId: string,
  dailyPlanId: string,
  handlers: {
    onShotChanges: (changes: ShotRealtimeChange[] | null) => void;
    onDailyPlanChange: (change: DailyPlanRealtimeUpdate) => void;
    onProjectDeleted: (projectId: string) => void;
    onConnectionError: () => void;
  }
) {
  const supabase = getSupabaseBrowserClient();
  let active = true;
  let flushScheduled = false;
  let pendingShotChanges: ShotRealtimeChange[] = [];
  let requiresShotSnapshot = false;
  let hasSubscribed = false;
  const flushShotChanges = () => {
    flushScheduled = false;
    if (!active) return;
    const changes = requiresShotSnapshot ? null : pendingShotChanges;
    pendingShotChanges = [];
    requiresShotSnapshot = false;
    handlers.onShotChanges(changes);
  };
  const queueShotChange = (change?: ShotRealtimeChange) => {
    if (change) pendingShotChanges.push(change);
    else requiresShotSnapshot = true;
    if (flushScheduled) return;
    flushScheduled = true;
    queueMicrotask(flushShotChanges);
  };

  if (!supabase) {
    const unsubscribe = subscribeToLocalProjectChanges(projectId, queueShotChange);
    return () => {
      active = false;
      pendingShotChanges = [];
      unsubscribe();
    };
  }

  const handleProjectDeletionSignal = (newRow: Record<string, unknown>) => {
    const deletedProjectId = String(newRow.project_id ?? "");
    if (deletedProjectId !== projectId || !String(newRow.deletion_started_at ?? "").trim()) return;
    active = false;
    pendingShotChanges = [];
    void supabase.removeChannel(channel);
    handlers.onProjectDeleted(deletedProjectId);
  };

  const channel = supabase
    .channel(`progress-project:${projectId}`, {
      config: { private: true, broadcast: { ack: true } }
    })
    .on(
      "broadcast",
      { event: "project-deleted" },
      ({ payload }) => {
        if (!active || String(payload?.projectId ?? "") !== projectId) return;
        // Broadcast is only a low-latency wake-up. The canonical root probe
        // re-authorizes the terminal state before any local state is removed.
        handlers.onConnectionError();
      }
    )
    .on(
      "postgres_changes",
      {
        event: "*",
        schema: "public",
        table: "shots",
        filter: `daily_plan_id=eq.${dailyPlanId}`
      },
      (payload) => queueShotChange({
        eventType: payload.eventType,
        newRow: (payload.new ?? {}) as Record<string, unknown>,
        oldRow: (payload.old ?? {}) as Record<string, unknown>
      })
    )
    .on(
      "postgres_changes",
      {
        event: "UPDATE",
        schema: "public",
        table: "daily_plans",
        filter: `id=eq.${dailyPlanId}`
      },
      (payload) => {
        const newRow = (payload.new ?? {}) as Record<string, unknown>;
        if (String(newRow.project_id ?? "") !== projectId) return;
        handlers.onDailyPlanChange({
          eventType: "UPDATE",
          newRow,
          oldRow: (payload.old ?? {}) as Record<string, unknown>
        });
      }
    )
    .on(
      "postgres_changes",
      {
        event: "INSERT",
        schema: "public",
        table: "project_deletion_events",
        filter: `project_id=eq.${projectId}`
      },
      (payload) => handleProjectDeletionSignal((payload.new ?? {}) as Record<string, unknown>)
    )
    .on(
      "postgres_changes",
      {
        event: "UPDATE",
        schema: "public",
        table: "project_deletion_events",
        filter: `project_id=eq.${projectId}`
      },
      (payload) => handleProjectDeletionSignal((payload.new ?? {}) as Record<string, unknown>)
    )
    .subscribe((status) => {
      if (!active) return;
      if (status === "SUBSCRIBED") {
        // The initial healthy join adds no project request. A later rejoin is
        // an unexpected-disconnect boundary and receives the same guarded
        // canonical probe as CHANNEL_ERROR/TIMED_OUT/CLOSED.
        if (!hasSubscribed) {
          hasSubscribed = true;
          return;
        }
      }
      // Supabase owns reconnects for this same channel. A single canonical
      // project probe at the page boundary distinguishes deletion/access loss
      // from a transient transport failure without creating another channel.
      handlers.onConnectionError();
    });

  return () => {
    active = false;
    pendingShotChanges = [];
    supabase.removeChannel(channel);
  };
}
