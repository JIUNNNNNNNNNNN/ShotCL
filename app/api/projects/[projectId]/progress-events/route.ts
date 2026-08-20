import { NextRequest, NextResponse } from "next/server";
import type { RealtimeChannel } from "@supabase/supabase-js";
import {
  getProjectRequestAccess,
  ProjectAccessUnavailableError,
  requireProjectAccessDb
} from "@/lib/projectAccess/server";
import { isValidDatabaseProjectId, normalizeProjectId } from "@/lib/projectId";
import type {
  ProgressDailyPlanStreamEvent,
  ProgressProjectDeletedStreamEvent,
  ProgressShotStreamEvent,
  ProgressSnapshotStreamEvent,
  ProgressStreamEvent
} from "@/lib/realtime/progressEvents";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 60;

type RouteContext = { params: Promise<{ projectId: string }> };

const UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const STREAM_MAX_AGE_MS = 50_000;
const HEARTBEAT_MS = 15_000;
const SUBSCRIBE_TIMEOUT_MS = 8_000;
const SHOT_COLUMNS = "id,project_id,daily_plan_id,analysis_run_id,scene_number,cut_number,shot_number,title,description,location,characters,memo,notes,order_index,status,source_file_id,source_page,source_row,created_at,updated_at";
const DAILY_PLAN_COLUMNS = "id,project_id,title,source_type,source_file_name,shooting_date,episode,director,dop,assistant_director,production,call_time,shoot_start_time,shoot_end_time,meeting_location,shooting_location,shooting_locations,meal_time,meal_times,safety_notice,memo,created_at,updated_at";
const STREAM_HEADERS = {
  "Cache-Control": "private, no-cache, no-store, no-transform",
  "Content-Type": "text/event-stream; charset=utf-8",
  "X-Accel-Buffering": "no",
  Vary: "Cookie"
} as const;

export async function GET(request: NextRequest, context: RouteContext) {
  try {
    const { projectId: routeProjectId } = await context.params;
    const projectId = normalizeProjectId(routeProjectId);
    const dailyPlanId = request.nextUrl.searchParams.get("dailyPlanId")?.trim().toLowerCase() ?? "";
    if (!isValidDatabaseProjectId(projectId) || !UUID_PATTERN.test(dailyPlanId)) {
      return streamJson({ error: "프로젝트 또는 회차 식별값이 올바르지 않습니다." }, 400);
    }

    // Every EventSource connection and automatic reconnect revalidates the
    // active invite, including revoke and project scope, before opening Realtime.
    const access = await getProjectRequestAccess(request, projectId);
    if (!access || (access.mode !== "guest" && access.mode !== "legacy")) {
      return streamJson({ error: "진행도 스트림 접근 권한이 없습니다." }, 403);
    }

    const supabase = requireProjectAccessDb();
    const { data: scopedPlan, error: planError } = await supabase
      .from("daily_plans")
      .select("id")
      .eq("id", dailyPlanId)
      .eq("project_id", projectId)
      .maybeSingle();
    if (planError) throw planError;
    if (!scopedPlan) {
      return streamJson({ error: "선택한 회차를 찾을 수 없습니다." }, 404);
    }

    let channel: RealtimeChannel | null = null;
    let controllerRef: ReadableStreamDefaultController<Uint8Array> | null = null;
    let heartbeatTimer: ReturnType<typeof setInterval> | null = null;
    let lifetimeTimer: ReturnType<typeof setTimeout> | null = null;
    let subscribeTimer: ReturnType<typeof setTimeout> | null = null;
    let closed = false;
    let snapshotReady = false;
    let deletionProbeEmitted = false;
    let bufferedEvents: ProgressStreamEvent[] = [];
    const encoder = new TextEncoder();

    const enqueueText = (value: string) => {
      if (closed || !controllerRef) return;
      try {
        controllerRef.enqueue(encoder.encode(value));
      } catch {
        void cleanup(false);
      }
    };
    const enqueueEvent = (event: ProgressStreamEvent) => {
      if (!snapshotReady && event.type !== "snapshot") {
        bufferedEvents.push(event);
        return;
      }
      enqueueText(`event: ${event.type}\ndata: ${JSON.stringify(event)}\n\n`);
    };
    const handleProjectDeletionSignal = (newRow: Record<string, unknown>) => {
      if (
        String(newRow.project_id ?? "") !== projectId
        || !newRow.deletion_started_at
      ) return;
      const event = {
        type: "project-deleted",
        projectId
      } satisfies ProgressProjectDeletedStreamEvent;
      // This terminal signal must not wait behind the initial snapshot.
      enqueueText(`event: project-deleted\ndata: ${JSON.stringify(event)}\n\n`);
      void cleanup(true);
    };
    const abortStream = () => {
      void cleanup(false);
    };
    const cleanup = async (closeController: boolean) => {
      if (closed) return;
      closed = true;
      if (heartbeatTimer) clearInterval(heartbeatTimer);
      if (lifetimeTimer) clearTimeout(lifetimeTimer);
      if (subscribeTimer) clearTimeout(subscribeTimer);
      request.signal.removeEventListener("abort", abortStream);
      bufferedEvents = [];
      if (closeController && controllerRef) {
        try {
          controllerRef.close();
        } catch {
          // The browser may already have cancelled the stream.
        }
      }
      const activeChannel = channel;
      channel = null;
      if (activeChannel) await supabase.removeChannel(activeChannel).catch(() => undefined);
    };

    const stream = new ReadableStream<Uint8Array>({
      start(controller) {
        controllerRef = controller;
        request.signal.addEventListener("abort", abortStream, { once: true });
        enqueueText("retry: 1500\n\n");

        void (async () => {
          channel = supabase
            .channel(`progress-project:${projectId}`, {
              config: { private: true, broadcast: { ack: true } }
            })
            .on(
              "broadcast",
              { event: "project-deleted" },
              ({ payload }) => {
                if (
                  deletionProbeEmitted
                  || String(payload?.projectId ?? "") !== projectId
                ) return;
                deletionProbeEmitted = true;
                // Broadcast is an untrusted low-latency wake-up. The Guest
                // client probes the canonical root route before leaving.
                enqueueText(`event: project-access-check\ndata: ${JSON.stringify({ projectId })}\n\n`);
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
              (payload) => handleProjectDeletionSignal(recordValue(payload.new))
            )
            .on(
              "postgres_changes",
              {
                event: "UPDATE",
                schema: "public",
                table: "project_deletion_events",
                filter: `project_id=eq.${projectId}`
              },
              (payload) => handleProjectDeletionSignal(recordValue(payload.new))
            )
            .on(
              "postgres_changes",
              {
                event: "*",
                schema: "public",
                table: "shots",
                filter: `daily_plan_id=eq.${dailyPlanId}`
              },
              (payload) => {
                const eventType = normalizeShotEventType(payload.eventType);
                const newRow = sanitizeShotRow(recordValue(payload.new));
                const oldRow = sanitizeShotRow(recordValue(payload.old));
                if (!eventType || !isScopedShotRows(newRow, oldRow, projectId, dailyPlanId)) return;
                enqueueEvent({ type: "shot", eventType, newRow, oldRow } satisfies ProgressShotStreamEvent);
              }
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
                const newRow = sanitizeDailyPlanRow(recordValue(payload.new));
                const oldRow = sanitizeDailyPlanRow(recordValue(payload.old));
                if (String(newRow.id ?? "") !== dailyPlanId || String(newRow.project_id ?? "") !== projectId) return;
                enqueueEvent({
                  type: "daily-plan",
                  eventType: "UPDATE",
                  newRow,
                  oldRow
                } satisfies ProgressDailyPlanStreamEvent);
              }
            );

          await waitForSubscription(
            channel,
            (timer) => {
              subscribeTimer = timer;
            },
            () => {
              enqueueText("event: stream-error\ndata: {}\n\n");
              void cleanup(true);
            }
          );
          subscribeTimer = null;
          if (closed) return;

          // Subscribe first, then snapshot. Events committed while these two
          // scoped reads run are buffered and replayed after the snapshot.
          const [shotsResult, planResult] = await Promise.all([
            supabase
              .from("shots")
              .select(SHOT_COLUMNS)
              .eq("project_id", projectId)
              .eq("daily_plan_id", dailyPlanId)
              .order("order_index")
              .order("created_at"),
            supabase
              .from("daily_plans")
              .select(DAILY_PLAN_COLUMNS)
              .eq("project_id", projectId)
              .eq("id", dailyPlanId)
              .maybeSingle()
          ]);
          if (shotsResult.error) throw shotsResult.error;
          if (planResult.error) throw planResult.error;
          if (!planResult.data) throw new Error("Selected daily plan disappeared.");

          enqueueEvent({
            type: "snapshot",
            shots: (shotsResult.data ?? []).map((row) => sanitizeShotRow(row as Record<string, unknown>)),
            dailyPlan: planResult.data as Record<string, unknown>
          } satisfies ProgressSnapshotStreamEvent);
          snapshotReady = true;
          const replayEvents = bufferedEvents;
          bufferedEvents = [];
          replayEvents.forEach(enqueueEvent);

          heartbeatTimer = setInterval(() => enqueueText(": heartbeat\n\n"), HEARTBEAT_MS);
          lifetimeTimer = setTimeout(() => {
            enqueueText("event: stream-close\ndata: {}\n\n");
            // A bounded lifetime makes EventSource reconnect and re-check invite
            // revocation instead of trusting one stream indefinitely.
            void cleanup(true);
          }, STREAM_MAX_AGE_MS);
        })().catch(() => {
          enqueueText("event: stream-error\ndata: {}\n\n");
          void cleanup(true);
        });
      },
      cancel() {
        return cleanup(false);
      }
    });

    return new Response(stream, { headers: STREAM_HEADERS });
  } catch (error) {
    return streamJson(
      { error: "진행도 실시간 연결을 시작하지 못했습니다." },
      error instanceof ProjectAccessUnavailableError ? 503 : 500
    );
  }
}

function streamJson(body: Record<string, unknown>, status: number) {
  return NextResponse.json(body, {
    status,
    headers: {
      "Cache-Control": "private, no-cache, no-store",
      Vary: "Cookie"
    }
  });
}

function waitForSubscription(
  channel: RealtimeChannel,
  onTimer: (timer: ReturnType<typeof setTimeout>) => void,
  onDisconnected: () => void
) {
  return new Promise<void>((resolve, reject) => {
    let settled = false;
    const finish = (error?: Error) => {
      if (settled) return;
      settled = true;
      if (error) reject(error);
      else resolve();
    };
    const timer = setTimeout(
      () => finish(new Error("Realtime subscription timed out.")),
      SUBSCRIBE_TIMEOUT_MS
    );
    onTimer(timer);
    channel.subscribe((status) => {
      if (status === "SUBSCRIBED") {
        clearTimeout(timer);
        finish();
      } else if (status === "CHANNEL_ERROR" || status === "TIMED_OUT") {
        clearTimeout(timer);
        if (settled) onDisconnected();
        else finish(new Error(`Realtime subscription failed: ${status}`));
      } else if (status === "CLOSED" && settled) {
        onDisconnected();
      }
    });
  });
}

function normalizeShotEventType(value: unknown): ProgressShotStreamEvent["eventType"] | null {
  return value === "INSERT" || value === "UPDATE" || value === "DELETE" ? value : null;
}

function recordValue(value: unknown): Record<string, unknown> {
  return value && typeof value === "object" && !Array.isArray(value)
    ? value as Record<string, unknown>
    : {};
}

function isScopedShotRows(
  newRow: Record<string, unknown>,
  oldRow: Record<string, unknown>,
  projectId: string,
  dailyPlanId: string
) {
  const row = Object.keys(newRow).length > 0 ? newRow : oldRow;
  return String(row.project_id ?? "") === projectId
    && String(row.daily_plan_id ?? "") === dailyPlanId;
}

const SHOT_EVENT_KEYS = new Set(SHOT_COLUMNS.split(","));
const DAILY_PLAN_EVENT_KEYS = new Set(DAILY_PLAN_COLUMNS.split(","));

function sanitizeShotRow(row: Record<string, unknown>) {
  return Object.fromEntries(
    Object.entries(row).filter(([key]) => SHOT_EVENT_KEYS.has(key))
  );
}

function sanitizeDailyPlanRow(row: Record<string, unknown>) {
  return Object.fromEntries(
    Object.entries(row).filter(([key]) => DAILY_PLAN_EVENT_KEYS.has(key))
  );
}
