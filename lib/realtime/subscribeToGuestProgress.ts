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
  onProjectDeleted: (projectId: string) => void;
  onConnectionError: () => void;
};

/** One server-authorized stream owns selected-round Guest/legacy updates. */
export function subscribeToGuestProgress(
  projectId: string,
  dailyPlanId: string,
  handlers: GuestProgressStreamHandlers
) {
  const query = new URLSearchParams({ dailyPlanId });
  const source = new EventSource(
    `/api/projects/${encodeURIComponent(projectId)}/progress-events?${query}`
  );
  let expectedRotationClose = false;
  const handleMessage = (message: MessageEvent<string>) => {
    let parsedJson: unknown;
    try {
      parsedJson = JSON.parse(message.data);
    } catch {
      return;
    }
    const event = parseProgressStreamEvent(parsedJson);
    if (!event) return;
    if (event.type === "project-deleted") {
      source.close();
      handlers.onProjectDeleted(event.projectId);
    } else if (event.type === "snapshot") handlers.onSnapshot(event);
    else if (event.type === "shot") handlers.onShot(event);
    else handlers.onDailyPlan(event);
  };

  source.addEventListener("snapshot", handleMessage as EventListener);
  source.addEventListener("shot", handleMessage as EventListener);
  source.addEventListener("daily-plan", handleMessage as EventListener);
  source.addEventListener("project-deleted", handleMessage as EventListener);
  const handleExpectedRotation = () => {
    expectedRotationClose = true;
  };
  const handleStreamFailure = () => {
    expectedRotationClose = false;
    handlers.onConnectionError();
  };
  const handleProjectAccessCheck = () => {
    handlers.onConnectionError();
  };
  source.addEventListener("stream-close", handleExpectedRotation);
  source.addEventListener("stream-error", handleStreamFailure);
  source.addEventListener("project-access-check", handleProjectAccessCheck);
  const handleError = () => {
    if (expectedRotationClose) {
      expectedRotationClose = false;
      return;
    }
    // CONNECTING covers the normal 50s rotation and transient network retry;
    // native EventSource owns both without an extra project GET. A terminal
    // HTTP failure (revoked/404/204) transitions to CLOSED and is probed once.
    if (source.readyState !== EventSource.CLOSED) return;
    // The caller performs one guarded root-project probe only after the native
    // stream has declared the connection terminal.
    handlers.onConnectionError();
  };
  source.addEventListener("error", handleError);
  return () => {
    source.removeEventListener("stream-close", handleExpectedRotation);
    source.removeEventListener("stream-error", handleStreamFailure);
    source.removeEventListener("project-access-check", handleProjectAccessCheck);
    source.removeEventListener("error", handleError);
    source.close();
  };
}
