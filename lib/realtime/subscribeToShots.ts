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
  let refreshTimer: ReturnType<typeof setTimeout> | null = null;
  let pendingChanges: ShotRealtimeChange[] = [];
  let requiresFullRefresh = false;
  const scheduleChange = (change?: ShotRealtimeChange) => {
    if (change) pendingChanges.push(change);
    else requiresFullRefresh = true;
    if (refreshTimer) clearTimeout(refreshTimer);
    refreshTimer = setTimeout(() => {
      refreshTimer = null;
      const changes = requiresFullRefresh ? null : pendingChanges;
      pendingChanges = [];
      requiresFullRefresh = false;
      onChange(changes);
    }, 80);
  };

  if (!supabase) {
    const unsubscribe = subscribeToLocalProjectChanges(projectId, scheduleChange);
    return () => {
      if (refreshTimer) clearTimeout(refreshTimer);
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
    if (refreshTimer) clearTimeout(refreshTimer);
    supabase.removeChannel(channel);
  };
}
