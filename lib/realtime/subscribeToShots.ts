import { subscribeToLocalProjectChanges } from "@/lib/data/localStore";
import { getSupabaseBrowserClient } from "@/lib/supabase/client";

export type ShotRealtimeChange = {
  eventType: "INSERT" | "UPDATE" | "DELETE";
  newRow: Record<string, unknown>;
  oldRow: Record<string, unknown>;
};

/** Supabase Realtime 또는 로컬 개발 이벤트로 컷 변경을 구독합니다. */
export function subscribeToShotChanges(
  projectId: string,
  onChange: (changes: ShotRealtimeChange[] | null) => void,
  dailyPlanId?: string
) {
  const supabase = getSupabaseBrowserClient();
  let flushScheduled = false;
  let active = true;
  let pendingChanges: ShotRealtimeChange[] = [];
  let requiresFullRefresh = false;
  const flushChanges = () => {
    flushScheduled = false;
    if (!active) return;
    const changes = requiresFullRefresh ? null : pendingChanges;
    pendingChanges = [];
    requiresFullRefresh = false;
    onChange(changes);
  };
  const scheduleChange = (change?: ShotRealtimeChange) => {
    if (change) pendingChanges.push(change);
    else requiresFullRefresh = true;
    if (flushScheduled) return;
    flushScheduled = true;
    // Coalesce only payloads delivered in the same task. There is no visible
    // debounce delay for remote status changes.
    queueMicrotask(flushChanges);
  };

  if (!supabase) {
    const unsubscribe = subscribeToLocalProjectChanges(projectId, scheduleChange);
    return () => {
      active = false;
      pendingChanges = [];
      unsubscribe();
    };
  }

  const channel = supabase
    .channel(`shots:${projectId}:${dailyPlanId ?? "all"}`)
    .on(
      "postgres_changes",
      {
        event: "*",
        schema: "public",
        table: "shots",
        filter: dailyPlanId
          ? `daily_plan_id=eq.${dailyPlanId}`
          : `project_id=eq.${projectId}`
      },
      (payload) => scheduleChange({
        eventType: payload.eventType,
        newRow: (payload.new ?? {}) as Record<string, unknown>,
        oldRow: (payload.old ?? {}) as Record<string, unknown>
      })
    )
    .subscribe();

  return () => {
    active = false;
    pendingChanges = [];
    supabase.removeChannel(channel);
  };
}
