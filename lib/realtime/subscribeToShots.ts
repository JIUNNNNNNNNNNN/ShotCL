import { subscribeToLocalProjectChanges } from "@/lib/data/localStore";
import { getSupabaseBrowserClient } from "@/lib/supabase/client";

/** Supabase Realtime 또는 로컬 개발 이벤트로 컷 변경을 구독합니다. */
export function subscribeToShotChanges(projectId: string, onChange: () => void) {
  const supabase = getSupabaseBrowserClient();

  if (!supabase) {
    return subscribeToLocalProjectChanges(projectId, onChange);
  }

  const channel = supabase
    .channel(`shots:${projectId}`)
    .on(
      "postgres_changes",
      {
        event: "*",
        schema: "public",
        table: "shots",
        filter: `project_id=eq.${projectId}`
      },
      () => onChange()
    )
    .subscribe();

  return () => {
    supabase.removeChannel(channel);
  };
}
