"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { ArrowRight, UserRoundPlus } from "lucide-react";
import { useCallback, useEffect, useRef, useState } from "react";
import { Button } from "@/components/ui/Button";
import { Card } from "@/components/ui/Card";

type InviteScreenState =
  | { status: "valid"; projectName: string; projectId: string; destination: string }
  | { status: "already_member"; projectName: string; projectId: string; destination: string }
  | { status: "invalid" }
  | { status: "unavailable" };

type InviteApiPayload = {
  ok?: boolean;
  status?: string;
  projectId?: string;
  projectName?: string;
  destination?: string;
  error?: string;
};

export function ProjectInviteRedeemer({
  token,
  initialState
}: {
  token: string;
  initialState: InviteScreenState;
}) {
  const router = useRouter();
  const [state, setState] = useState(initialState);
  const [isJoining, setIsJoining] = useState(false);
  const [errorMessage, setErrorMessage] = useState("");
  const requestInFlightRef = useRef(false);
  const autoJoinAttemptedRef = useRef(false);
  const joinControllerRef = useRef<AbortController | null>(null);
  const mountedRef = useRef(true);

  useEffect(() => {
    mountedRef.current = true;
    return () => {
      mountedRef.current = false;
      joinControllerRef.current?.abort();
    };
  }, []);

  const openProgress = useCallback((destination: string) => {
    // POST 응답의 Set-Cookie가 반영된 뒤 새 project layout을 client navigation으로 엽니다.
    router.replace(destination);
  }, [router]);

  const joinProject = useCallback(async () => {
    if (requestInFlightRef.current || state.status !== "valid") return;
    requestInFlightRef.current = true;
    setIsJoining(true);
    setErrorMessage("");
    const controller = new AbortController();
    joinControllerRef.current = controller;
    try {
      const response = await fetch(`/api/project-invites/${encodeURIComponent(token)}`, {
        method: "POST",
        credentials: "same-origin",
        cache: "no-store",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ action: "join" }),
        signal: controller.signal
      });
      const payload = await readPayload(response);
      if (controller.signal.aborted || !mountedRef.current) return;
      if (!response.ok || !payload.ok || !payload.projectId || !payload.destination) {
        if (payload.status === "invalid") {
          setState({ status: "invalid" });
          setErrorMessage("");
          return;
        }
        if (payload.status === "unavailable") {
          setState({ status: "unavailable" });
          setErrorMessage("");
          return;
        }
        throw new Error(payload.error || "프로젝트에 참여하지 못했습니다.");
      }
      if (controller.signal.aborted || !mountedRef.current) return;
      openProgress(payload.destination);
    } catch (error) {
      if (controller.signal.aborted || !mountedRef.current) return;
      setErrorMessage(error instanceof Error ? error.message : "프로젝트에 참여하지 못했습니다.");
    } finally {
      if (joinControllerRef.current === controller) joinControllerRef.current = null;
      if (!mountedRef.current) return;
      setIsJoining(false);
      requestInFlightRef.current = false;
    }
  }, [openProgress, state]);

  useEffect(() => {
    if (state.status !== "valid" || autoJoinAttemptedRef.current) return;
    autoJoinAttemptedRef.current = true;
    void joinProject();
  }, [joinProject, state.status]);

  const valid = state.status === "valid" || state.status === "already_member";
  const alreadyMember = state.status === "already_member";

  return (
    <section className="mx-auto flex min-h-[calc(100dvh-8rem)] w-full max-w-md items-center justify-center py-4">
      <Card className="w-full p-5 text-center sm:p-6">
        <div className="mx-auto grid h-11 w-11 place-items-center rounded-[var(--radius-control)] border border-field-primary/55 bg-field-primary/10 text-field-primary">
          <UserRoundPlus className="h-5 w-5" aria-hidden />
        </div>
        <p className="mt-4 text-xs font-black uppercase tracking-[0.08em] text-field-primary">ShotCL</p>

        {valid ? (
          <>
            <h1 className="mt-2 break-words text-xl font-black leading-7 text-field-text">
              {state.projectName}
            </h1>
            <p className="mt-2 text-sm font-bold leading-6 text-field-subtle">
              {alreadyMember ? "이미 참여 중인 프로젝트입니다." : "게스트 화면을 준비하고 있습니다."}
            </p>
            <p className="mt-1 text-xs leading-5 text-field-muted">
              초대 링크에서는 진행도와 시나리오를 읽기 전용으로 확인할 수 있습니다.
            </p>

            <div className="mt-6 grid gap-2">
              {alreadyMember ? (
                <Button className="min-h-11 w-full" onClick={() => openProgress(state.destination)}>
                  진행도 열기
                  <ArrowRight className="h-4 w-4" aria-hidden />
                </Button>
              ) : (
                <>
                  <p role="status" aria-live="polite" className="min-h-11 py-3 text-sm font-bold text-field-primary">
                    {isJoining ? "진행도를 여는 중…" : errorMessage ? "자동 연결에 실패했습니다." : "초대 링크 확인 중…"}
                  </p>
                  {errorMessage ? (
                    <Button
                      className="min-h-11 w-full"
                      disabled={isJoining}
                      onClick={() => {
                        autoJoinAttemptedRef.current = true;
                        void joinProject();
                      }}
                    >
                      다시 시도
                      <ArrowRight className="h-4 w-4" aria-hidden />
                    </Button>
                  ) : null}
                </>
              )}
            </div>
          </>
        ) : (
          <>
            <h1 className="mt-4 text-lg font-black leading-7 text-field-text">
              {state.status === "unavailable" ? "초대 기능을 준비 중입니다" : "초대 링크를 열 수 없습니다"}
            </h1>
            <p className="mt-2 text-sm leading-6 text-field-muted">
              {state.status === "unavailable"
                ? "잠시 후 다시 시도해주세요."
                : "초대 링크가 유효하지 않거나 비활성화되었습니다."}
            </p>
            {state.status === "unavailable" ? (
              <Button
                variant="secondary"
                className="mt-5 min-h-11 w-full"
                onClick={() => window.location.reload()}
              >
                다시 시도
              </Button>
            ) : null}
          </>
        )}

        <p aria-live="polite" className="mt-3 min-h-5 text-xs font-bold leading-5 text-field-danger">
          {errorMessage}
        </p>

        <Link
          href="/"
          aria-disabled={isJoining}
          tabIndex={isJoining ? -1 : undefined}
          onClick={(event) => {
            if (isJoining) event.preventDefault();
          }}
          className={`mt-1 inline-flex min-h-11 w-full items-center justify-center rounded-[var(--radius-control)] border border-field-divider bg-field-input px-3 py-2 text-sm font-bold text-field-text transition-colors hover:border-field-subtle hover:bg-field-hover focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-field-primary ${isJoining ? "pointer-events-none opacity-50" : ""}`}
        >
          Main으로 돌아가기
        </Link>
      </Card>
    </section>
  );
}

async function readPayload(response: Response): Promise<InviteApiPayload> {
  try {
    return await response.json() as InviteApiPayload;
  } catch {
    return {};
  }
}

export type { InviteScreenState };
