import { NextRequest, NextResponse } from "next/server";
import type { RealtimeChannel } from "@supabase/supabase-js";
import {
  getProjectRequestAccess,
  ProjectAccessUnavailableError,
  requireProjectAccessDb
} from "@/lib/projectAccess/server";
import { isValidDatabaseProjectId, normalizeProjectId } from "@/lib/projectId";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 60;

type RouteContext = { params: Promise<{ projectId: string }> };

const STREAM_MAX_AGE_MS = 50_000;
const HEARTBEAT_MS = 15_000;
const SUBSCRIBE_TIMEOUT_MS = 8_000;
const STREAM_HEADERS = {
  "Cache-Control": "private, no-cache, no-store, no-transform",
  "Content-Type": "text/event-stream; charset=utf-8",
  "X-Accel-Buffering": "no",
  Vary: "Cookie"
} as const;

/** Snapshot-free deletion/access boundary for non-Progress project routes. */
export async function GET(request: NextRequest, context: RouteContext) {
  try {
    const { projectId: routeProjectId } = await context.params;
    const projectId = normalizeProjectId(routeProjectId);
    if (!isValidDatabaseProjectId(projectId) || request.nextUrl.searchParams.size !== 0) {
      return streamJson({ error: "프로젝트 식별값이 올바르지 않습니다." }, 400);
    }
    const access = await getProjectRequestAccess(request, projectId);
    if (!access) {
      return streamJson({ error: "프로젝트 접근 권한이 없습니다." }, 403);
    }

    const supabase = requireProjectAccessDb();
    let channel: RealtimeChannel | null = null;
    let controllerRef: ReadableStreamDefaultController<Uint8Array> | null = null;
    let heartbeatTimer: ReturnType<typeof setInterval> | null = null;
    let lifetimeTimer: ReturnType<typeof setTimeout> | null = null;
    let subscribeTimer: ReturnType<typeof setTimeout> | null = null;
    let closed = false;
    let deletionProbeEmitted = false;
    const encoder = new TextEncoder();

    const enqueueText = (value: string) => {
      if (closed || !controllerRef) return;
      try {
        controllerRef.enqueue(encoder.encode(value));
      } catch {
        void cleanup(false);
      }
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
    const emitProjectDeleted = (row: Record<string, unknown>) => {
      if (
        String(row.project_id ?? "") !== projectId
        || !String(row.deletion_started_at ?? "").trim()
      ) return;
      enqueueText(`event: project-deleted\ndata: ${JSON.stringify({ projectId })}\n\n`);
      void cleanup(true);
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
            .on("broadcast", { event: "project-deleted" }, ({ payload }) => {
              if (
                deletionProbeEmitted
                || String(payload?.projectId ?? "") !== projectId
              ) return;
              deletionProbeEmitted = true;
              enqueueText(`event: project-access-check\ndata: ${JSON.stringify({ projectId })}\n\n`);
            })
            .on(
              "postgres_changes",
              {
                event: "INSERT",
                schema: "public",
                table: "project_deletion_events",
                filter: `project_id=eq.${projectId}`
              },
              (payload) => emitProjectDeleted(recordValue(payload.new))
            )
            .on(
              "postgres_changes",
              {
                event: "UPDATE",
                schema: "public",
                table: "project_deletion_events",
                filter: `project_id=eq.${projectId}`
              },
              (payload) => emitProjectDeleted(recordValue(payload.new))
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
          heartbeatTimer = setInterval(() => enqueueText(": heartbeat\n\n"), HEARTBEAT_MS);
          lifetimeTimer = setTimeout(() => {
            enqueueText("event: stream-close\ndata: {}\n\n");
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
      { error: "프로젝트 연결 상태를 확인하지 못했습니다." },
      error instanceof ProjectAccessUnavailableError ? 503 : 500
    );
  }
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

function recordValue(value: unknown): Record<string, unknown> {
  return value && typeof value === "object" && !Array.isArray(value)
    ? value as Record<string, unknown>
    : {};
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
