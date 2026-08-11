import { getSupabaseBrowserClient } from "@/lib/supabase/client";

export type DailyPlanRealtimeUpdate = {
  eventType: "UPDATE";
  newRow: Record<string, unknown>;
  oldRow: Record<string, unknown>;
};

/** Subscribe only to the selected daily plan; callers merge the UPDATE payload locally. */
export function subscribeToDailyPlanChanges(
  projectId: string,
  dailyPlanId: string,
  onChange: (change: DailyPlanRealtimeUpdate) => void
) {
  const supabase = getSupabaseBrowserClient();
  if (!supabase) return () => undefined;

  const channel = supabase
    .channel(`daily-plan:${projectId}:${dailyPlanId}`)
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
        onChange({
          eventType: "UPDATE",
          newRow,
          oldRow: (payload.old ?? {}) as Record<string, unknown>
        });
      }
    )
    .subscribe();

  return () => {
    supabase.removeChannel(channel);
  };
}
