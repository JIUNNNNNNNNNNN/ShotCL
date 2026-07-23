import { subscribeToLocalProjectChanges } from "@/lib/data/localStore";
import { getSupabaseBrowserClient } from "@/lib/supabase/client";

/** Supabase Realtime 또는 로컬 개발 이벤트로 컷 변경을 구독합니다. */
export function subscribeToShotChanges(projectId: string, onChange: () => void, dailyPlanId?: string) {
  const supabase = getSupabaseBrowserClient();
  let refreshTimer: ReturnType<typeof setTimeout> | null = null;
  const scheduleChange = () => {
    if (refreshTimer) clearTimeout(refreshTimer);
    refreshTimer = setTimeout(() => {
      refreshTimer = null;
      onChange();
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
      scheduleChange
    )
    .subscribe();

  return () => {
    if (refreshTimer) clearTimeout(refreshTimer);
    supabase.removeChannel(channel);
  };
}
