"use client";

import {
  Check,
  Copy,
  Link2,
  MoreHorizontal,
  UserRoundPlus
} from "lucide-react";
import { useEffect, useRef, useState, type KeyboardEvent as ReactKeyboardEvent } from "react";
import { Button } from "@/components/ui/Button";
import { Card } from "@/components/ui/Card";
import { copyText } from "@/lib/client/copyText";

type InviteState =
  | { status: "loading" }
  | { status: "inactive" }
  | { status: "active"; inviteUrl: string; createdAt: string }
  | { status: "rotation_required" }
  | { status: "error"; message: string; code: string };

type InvitePayload = {
  ok?: boolean;
  status?: InviteState["status"];
  inviteUrl?: string;
  createdAt?: string;
  error?: string;
  code?: string;
};

type ConfirmAction = "rotate" | "revoke";
type PendingAction = "load" | "ensure" | "rotate" | "revoke" | "copy-message" | "copy-link";

const FEEDBACK_DURATION_MS = 1800;

export function ProjectStaffInviteCard({
  projectId,
  projectName
}: {
  projectId: string;
  projectName: string;
}) {
  const [inviteState, setInviteState] = useState<InviteState>({ status: "loading" });
  const [pendingAction, setPendingAction] = useState<PendingAction | null>("load");
  const [feedback, setFeedback] = useState("");
  const [feedbackIsError, setFeedbackIsError] = useState(false);
  const [menuOpen, setMenuOpen] = useState(false);
  const [confirmAction, setConfirmAction] = useState<ConfirmAction | null>(null);
  const requestInFlightRef = useRef(false);
  const operationSequenceRef = useRef(0);
  const currentProjectIdRef = useRef(projectId);
  const mutationControllerRef = useRef<AbortController | null>(null);
  const copyAfterRotationRef = useRef(false);
  const feedbackTimerRef = useRef<number | null>(null);
  const firstMenuButtonRef = useRef<HTMLButtonElement | null>(null);
  const cancelButtonRef = useRef<HTMLButtonElement | null>(null);
  const managementTriggerContainerRef = useRef<HTMLDivElement | null>(null);
  const primaryActionContainerRef = useRef<HTMLDivElement | null>(null);
  const menuContainerRef = useRef<HTMLDivElement | null>(null);
  const confirmContainerRef = useRef<HTMLElement | null>(null);

  currentProjectIdRef.current = projectId;

  useEffect(() => {
    const operationId = ++operationSequenceRef.current;
    const controller = new AbortController();
    mutationControllerRef.current?.abort();
    mutationControllerRef.current = null;
    copyAfterRotationRef.current = false;
    requestInFlightRef.current = true;
    setInviteState({ status: "loading" });
    setPendingAction("load");
    void requestInviteState(projectId, controller.signal)
      .then((nextState) => {
        if (operationSequenceRef.current !== operationId) return;
        setInviteState(nextState);
      })
      .catch((error) => {
        if (controller.signal.aborted || operationSequenceRef.current !== operationId) return;
        setInviteState({
          status: "error",
          message: error instanceof Error ? error.message : "초대 링크 상태를 불러오지 못했습니다.",
          code: "PROJECT_STAFF_INVITE_REQUEST_FAILED"
        });
      })
      .finally(() => {
        if (controller.signal.aborted || operationSequenceRef.current !== operationId) return;
        requestInFlightRef.current = false;
        setPendingAction(null);
      });
    return () => {
      controller.abort();
      mutationControllerRef.current?.abort();
      mutationControllerRef.current = null;
      operationSequenceRef.current += 1;
      requestInFlightRef.current = false;
    };
  }, [projectId]);

  useEffect(() => () => {
    if (feedbackTimerRef.current !== null) window.clearTimeout(feedbackTimerRef.current);
  }, []);

  useEffect(() => {
    if (menuOpen) firstMenuButtonRef.current?.focus();
  }, [menuOpen]);

  useEffect(() => {
    if (confirmAction) cancelButtonRef.current?.focus();
  }, [confirmAction]);

  useEffect(() => {
    if (!menuOpen && !confirmAction) return;
    const closeOnEscape = (event: KeyboardEvent) => {
      if (event.key !== "Escape") return;
      setMenuOpen(false);
      setConfirmAction(null);
      copyAfterRotationRef.current = false;
      restoreManagementFocus();
    };
    window.addEventListener("keydown", closeOnEscape);
    return () => window.removeEventListener("keydown", closeOnEscape);
  }, [confirmAction, menuOpen]);

  useEffect(() => {
    if (!menuOpen) return;
    const closeOnOutsidePointer = (event: PointerEvent) => {
      const target = event.target;
      if (!(target instanceof Node)) return;
      if (menuContainerRef.current?.contains(target)) return;
      if (managementTriggerContainerRef.current?.contains(target)) return;
      setMenuOpen(false);
    };
    document.addEventListener("pointerdown", closeOnOutsidePointer);
    return () => document.removeEventListener("pointerdown", closeOnOutsidePointer);
  }, [menuOpen]);

  function restoreManagementFocus() {
    window.requestAnimationFrame(() => {
      const target = managementTriggerContainerRef.current?.querySelector("button")
        ?? primaryActionContainerRef.current?.querySelector("button");
      target?.focus();
    });
  }

  function showFeedback(message: string, isError = false) {
    if (feedbackTimerRef.current !== null) window.clearTimeout(feedbackTimerRef.current);
    setFeedback(message);
    setFeedbackIsError(isError);
    if (isError) {
      feedbackTimerRef.current = null;
      return;
    }
    feedbackTimerRef.current = window.setTimeout(() => {
      feedbackTimerRef.current = null;
      setFeedback("");
      setFeedbackIsError(false);
    }, FEEDBACK_DURATION_MS);
  }

  async function runAction(action: "ensure" | "rotate" | "revoke") {
    if (requestInFlightRef.current) return null;
    const requestedProjectId = projectId;
    const operationId = ++operationSequenceRef.current;
    const controller = new AbortController();
    mutationControllerRef.current?.abort();
    mutationControllerRef.current = controller;
    requestInFlightRef.current = true;
    setPendingAction(action);
    setFeedback("");
    setFeedbackIsError(false);
    try {
      const nextState = await mutateInvite(requestedProjectId, action, controller.signal);
      if (
        controller.signal.aborted
        || operationSequenceRef.current !== operationId
        || currentProjectIdRef.current !== requestedProjectId
      ) return null;
      if (nextState.status === "error") {
        showFeedback(nextState.message, true);
        return null;
      }
      setInviteState(nextState);
      return nextState;
    } catch (error) {
      if (controller.signal.aborted || operationSequenceRef.current !== operationId) return null;
      const message = error instanceof Error ? error.message : "초대 링크를 변경하지 못했습니다.";
      showFeedback(message, true);
      return null;
    } finally {
      if (mutationControllerRef.current !== controller || operationSequenceRef.current !== operationId) return;
      mutationControllerRef.current = null;
      requestInFlightRef.current = false;
      setPendingAction(null);
    }
  }

  async function copyInviteMessage() {
    if (requestInFlightRef.current || inviteState.status === "rotation_required") {
      if (inviteState.status === "rotation_required") {
        copyAfterRotationRef.current = true;
        setConfirmAction("rotate");
      }
      return;
    }
    let activeState = inviteState;
    if (activeState.status === "inactive" || activeState.status === "error") {
      const created = await runAction("ensure");
      if (!created || created.status !== "active") return;
      activeState = created;
    }
    if (activeState.status !== "active") return;
    await copyActiveInviteMessage(activeState.inviteUrl);
  }

  async function copyActiveInviteMessage(inviteUrl: string) {
    const requestedProjectId = projectId;
    const operationId = ++operationSequenceRef.current;
    requestInFlightRef.current = true;
    setPendingAction("copy-message");
    try {
      await copyText(buildKakaoInviteMessage(projectName, inviteUrl));
      if (operationSequenceRef.current !== operationId || currentProjectIdRef.current !== requestedProjectId) return;
      showFeedback("복사 완료");
    } catch (error) {
      if (operationSequenceRef.current !== operationId) return;
      showFeedback(error instanceof Error ? error.message : "클립보드에 복사하지 못했습니다.", true);
    } finally {
      if (operationSequenceRef.current !== operationId) return;
      requestInFlightRef.current = false;
      setPendingAction(null);
    }
  }

  async function copyInviteUrl() {
    if (requestInFlightRef.current || inviteState.status !== "active") return;
    const requestedProjectId = projectId;
    const operationId = ++operationSequenceRef.current;
    requestInFlightRef.current = true;
    setPendingAction("copy-link");
    try {
      await copyText(inviteState.inviteUrl);
      if (operationSequenceRef.current !== operationId || currentProjectIdRef.current !== requestedProjectId) return;
      showFeedback("링크 복사 완료");
    } catch (error) {
      if (operationSequenceRef.current !== operationId) return;
      showFeedback(error instanceof Error ? error.message : "링크를 복사하지 못했습니다.", true);
    } finally {
      if (operationSequenceRef.current !== operationId) return;
      requestInFlightRef.current = false;
      setPendingAction(null);
    }
  }

  async function confirmManagementAction() {
    if (!confirmAction || requestInFlightRef.current) return;
    const action = confirmAction;
    setMenuOpen(false);
    const copyAfterRotation = action === "rotate" && copyAfterRotationRef.current;
    copyAfterRotationRef.current = false;
    const result = await runAction(action);
    const shouldRestoreFocus = confirmContainerRef.current?.contains(document.activeElement) ?? false;
    setConfirmAction(null);
    if (shouldRestoreFocus) restoreManagementFocus();
    if (!result) return;
    if (copyAfterRotation && result.status === "active") {
      await copyActiveInviteMessage(result.inviteUrl);
      return;
    }
    showFeedback(action === "rotate" ? "새 링크를 만들었습니다." : "초대 링크를 비활성화했습니다.");
  }

  const isBusy = pendingAction !== null;
  const managementAvailable = inviteState.status === "active" || inviteState.status === "rotation_required";
  const statusText = getStatusText(inviteState);
  const pendingStatus = pendingAction === "rotate"
    ? "새 초대 링크를 만드는 중입니다."
    : pendingAction === "revoke"
      ? "초대 링크를 비활성화하는 중입니다."
      : "";

  function handleMenuKeyDown(event: ReactKeyboardEvent<HTMLDivElement>) {
    if (!["ArrowDown", "ArrowUp", "Home", "End"].includes(event.key)) return;
    const items = Array.from(event.currentTarget.querySelectorAll<HTMLButtonElement>('[role="menuitem"]'));
    if (items.length === 0) return;
    event.preventDefault();
    const currentIndex = items.indexOf(document.activeElement as HTMLButtonElement);
    const nextIndex = event.key === "Home"
      ? 0
      : event.key === "End"
        ? items.length - 1
        : event.key === "ArrowDown"
          ? (currentIndex + 1 + items.length) % items.length
          : (currentIndex - 1 + items.length) % items.length;
    items[nextIndex]?.focus();
  }

  return (
    <Card className="w-full min-w-0 p-3 text-center md:p-3">
      <div className="mx-auto grid h-9 w-9 place-items-center rounded-[var(--radius-control)] border border-field-primary/45 bg-field-primary/10 text-field-primary">
        <UserRoundPlus className="h-4 w-4" aria-hidden />
      </div>
      <h3 id="project-staff-invite-title" className="mt-2 text-sm font-black leading-5 text-field-text">
        스탭 초대
      </h3>
      <p id="project-staff-invite-description" className="mt-1 text-[11px] font-medium leading-[1.55] text-field-muted">
        링크로 참여한 사용자는 일반 스탭 권한으로 등록됩니다.
      </p>

      <div className="mt-3 grid min-w-0 gap-2" aria-busy={isBusy} aria-describedby="project-staff-invite-description">
        <div ref={primaryActionContainerRef}>
          <Button
            className="min-h-11 w-full min-w-0 px-2 text-xs sm:text-sm"
            disabled={isBusy || inviteState.status === "loading"}
            onClick={copyInviteMessage}
          >
            {feedback === "복사 완료" ? <Check className="h-4 w-4 shrink-0" aria-hidden /> : <Copy className="h-4 w-4 shrink-0" aria-hidden />}
            {pendingAction === "ensure" ? "링크 만드는 중" : pendingAction === "copy-message" ? "복사 중" : "카카오톡으로 복사"}
          </Button>
        </div>

        {inviteState.status === "active" ? (
          <Button
            variant="secondary"
            className="min-h-11 w-full min-w-0 px-2 text-xs"
            disabled={isBusy}
            onClick={copyInviteUrl}
          >
            <Link2 className="h-4 w-4 shrink-0" aria-hidden />
            {pendingAction === "copy-link" ? "복사 중" : "링크 복사"}
          </Button>
        ) : null}

        {managementAvailable ? (
          <div ref={managementTriggerContainerRef}>
            <Button
              variant="ghost"
              className="min-h-11 w-full text-xs"
              aria-haspopup="menu"
              aria-expanded={menuOpen}
              disabled={isBusy}
              onClick={() => {
                if (isBusy) return;
                setMenuOpen((current) => !current);
              }}
            >
              <MoreHorizontal className="h-4 w-4" aria-hidden />
              링크 관리
            </Button>
          </div>
        ) : null}
      </div>

      {menuOpen ? (
        <div
          ref={menuContainerRef}
          role="menu"
          aria-label="초대 링크 관리"
          className="ui-motion-menu mt-2 grid gap-1 border border-field-divider bg-field-input p-1 text-left"
          onKeyDown={handleMenuKeyDown}
          onBlur={(event) => {
            if (!event.currentTarget.contains(event.relatedTarget as Node | null)) setMenuOpen(false);
          }}
        >
          <button
            ref={firstMenuButtonRef}
            type="button"
            role="menuitem"
            className="min-h-11 px-3 text-left text-xs font-bold text-field-text hover:bg-field-hover focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-field-primary"
            onClick={() => {
              copyAfterRotationRef.current = false;
              setMenuOpen(false);
              setConfirmAction("rotate");
            }}
          >
            새 링크 만들기
          </button>
          {inviteState.status === "active" ? (
            <button
              type="button"
              role="menuitem"
              className="min-h-11 px-3 text-left text-xs font-bold text-field-danger hover:bg-field-danger/10 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-field-primary"
              onClick={() => {
                copyAfterRotationRef.current = false;
                setMenuOpen(false);
                setConfirmAction("revoke");
              }}
            >
              링크 비활성화
            </button>
          ) : null}
        </div>
      ) : null}

      {confirmAction ? (
        <section
          ref={confirmContainerRef}
          role="alertdialog"
          aria-modal="false"
          aria-labelledby="invite-management-confirm-title"
          aria-describedby="invite-management-confirm-description"
          className="ui-motion-dialog mt-2 border border-field-divider bg-field-dialog p-3 text-left"
        >
          <h4 id="invite-management-confirm-title" className="text-xs font-black leading-5 text-field-text">
            {confirmAction === "rotate" ? "새 링크를 만드시겠습니까?" : "초대 링크를 비활성화하시겠습니까?"}
          </h4>
          <p id="invite-management-confirm-description" className="mt-1 text-[11px] leading-5 text-field-muted">
            {confirmAction === "rotate"
              ? "이전 링크는 즉시 사용할 수 없게 되며, 이미 참여한 스탭의 권한은 유지됩니다."
              : "신규 참여만 차단되며, 이미 참여한 스탭의 접근은 유지됩니다."}
          </p>
          <div className="mt-3 grid grid-cols-2 gap-2">
            <button
              ref={cancelButtonRef}
              type="button"
              className="min-h-11 rounded-[var(--radius-control)] border border-field-divider bg-field-input px-3 py-2 text-xs font-bold text-field-text hover:border-field-subtle hover:bg-field-hover focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-field-primary"
              onClick={() => {
                if (isBusy) return;
                copyAfterRotationRef.current = false;
                setConfirmAction(null);
                restoreManagementFocus();
              }}
            >
              취소
            </button>
            <Button
              variant={confirmAction === "revoke" ? "danger" : "primary"}
              className="min-h-11 text-xs"
              onClick={confirmManagementAction}
            >
              {isBusy
                ? confirmAction === "rotate" ? "만드는 중" : "처리 중"
                : confirmAction === "rotate" ? "새로 만들기" : "비활성화"}
            </Button>
          </div>
        </section>
      ) : null}

      <p
        role={inviteState.status === "error" || feedbackIsError ? "alert" : "status"}
        aria-live={inviteState.status === "error" || feedbackIsError ? undefined : "polite"}
        className={`mt-2 min-h-5 break-words text-[10px] font-bold leading-5 ${inviteState.status === "error" || feedbackIsError ? "text-field-danger" : "text-field-muted"}`}
      >
        {feedback || pendingStatus || statusText}
      </p>
    </Card>
  );
}

async function requestInviteState(projectId: string, signal: AbortSignal): Promise<InviteState> {
  const response = await fetch(`/api/projects/${encodeURIComponent(projectId)}/staff-invite`, {
    credentials: "same-origin",
    cache: "no-store",
    signal
  });
  return stateFromResponse(response);
}

async function mutateInvite(
  projectId: string,
  action: "ensure" | "rotate" | "revoke",
  signal: AbortSignal
): Promise<InviteState> {
  const response = await fetch(`/api/projects/${encodeURIComponent(projectId)}/staff-invite`, {
    method: "POST",
    credentials: "same-origin",
    cache: "no-store",
    signal,
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ action })
  });
  return stateFromResponse(response);
}

async function stateFromResponse(response: Response): Promise<InviteState> {
  const payload = await readPayload(response);
  if (!response.ok || !payload.ok) {
    return {
      status: "error",
      message: payload.error || "초대 링크 요청을 처리하지 못했습니다.",
      code: payload.code || "PROJECT_STAFF_INVITE_REQUEST_FAILED"
    };
  }
  if (payload.status === "active" && payload.inviteUrl) {
    return { status: "active", inviteUrl: payload.inviteUrl, createdAt: payload.createdAt || "" };
  }
  if (payload.status === "rotation_required") return { status: "rotation_required" };
  return { status: "inactive" };
}

async function readPayload(response: Response): Promise<InvitePayload> {
  try {
    return await response.json() as InvitePayload;
  } catch {
    return {};
  }
}

function buildKakaoInviteMessage(projectName: string, inviteUrl: string) {
  return [
    `[ShotCL] ${projectName} 스탭 초대`,
    "",
    "아래 링크를 열어 프로젝트에 참여해 주세요.",
    inviteUrl,
    "",
    "프로젝트 아이디와 비밀번호 입력 없이 참여할 수 있습니다."
  ].join("\n");
}

function getStatusText(state: InviteState) {
  if (state.status === "loading") return "초대 링크 확인 중";
  if (state.status === "inactive") return "활성 초대 링크 없음";
  if (state.status === "rotation_required") return "서버 키 변경으로 새 링크가 필요합니다.";
  if (state.status === "error") return state.message;
  return "활성 초대 링크를 여러 스탭에게 재사용할 수 있습니다.";
}
