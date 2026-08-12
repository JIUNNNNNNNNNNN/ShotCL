"use client";

import {
  parseProgressStreamEvent,
  type ProgressDailyPlanStreamEvent,
  type ProgressShotStreamEvent,
  type ProgressSnapshotStreamEvent
} from "@/lib/realtime/progressEvents";

export type GuestProgressStreamHandlers = {
  onSnapshot: (event: ProgressSnapshotStreamEvent) => void;
  onShot: (event: ProgressShotStreamEvent) => void;
  onDailyPlan: (event: ProgressDailyPlanStreamEvent) => void;
};

/** One cookie-authenticated stream owns all selected-round Guest updates. */
export function subscribeToGuestProgress(
  projectId: string,
  dailyPlanId: string,
  handlers: GuestProgressStreamHandlers
) {
  const query = new URLSearchParams({ dailyPlanId });
  const source = new EventSource(
    `/api/projects/${encodeURIComponent(projectId)}/progress-events?${query}`
  );
  const handleMessage = (message: MessageEvent<string>) => {
    let parsedJson: unknown;
    try {
      parsedJson = JSON.parse(message.data);
    } catch {
      return;
    }
    const event = parseProgressStreamEvent(parsedJson);
    if (!event) return;
    if (event.type === "snapshot") handlers.onSnapshot(event);
    else if (event.type === "shot") handlers.onShot(event);
    else handlers.onDailyPlan(event);
  };

  source.addEventListener("snapshot", handleMessage as EventListener);
  source.addEventListener("shot", handleMessage as EventListener);
  source.addEventListener("daily-plan", handleMessage as EventListener);
  return () => source.close();
}
