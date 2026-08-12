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
  }
) {
  const supabase = getSupabaseBrowserClient();
  let active = true;
  let flushScheduled = false;
  let pendingShotChanges: ShotRealtimeChange[] = [];
  let requiresShotSnapshot = false;
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

  const channel = supabase
    .channel(`progress:${projectId}:${dailyPlanId}`)
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
    .subscribe();

  return () => {
    active = false;
    pendingShotChanges = [];
    supabase.removeChannel(channel);
  };
}
