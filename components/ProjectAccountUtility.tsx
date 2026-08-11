"use client";

import { useEffect, useRef, useState } from "react";
import { createPortal } from "react-dom";
import Link from "next/link";
import { ArrowRight, KeyRound, LoaderCircle } from "lucide-react";
import { useAuthSession } from "@/components/AuthSessionProvider";
import {
  ProjectAccountAuthErrorNotice,
  ProjectAccountPermissionNotice
} from "@/components/ProjectAccountPermissionNotice";
import { useProjectAccess } from "@/components/ProjectAccessGate";
import { ProjectKeyStaffUpgrade } from "@/components/ProjectKeyStaffUpgrade";
import {
  useAutoContextualGuide,
  useContextualGuideAnchor
} from "@/components/guides/ContextualGuideProvider";
import { getSafeInternalPath } from "@/lib/auth/client";
import { resolveProjectAccountPermissionNotice } from "@/lib/projectAccess/accountPresentation";
import {
  isKeyStaffProjectRole,
  isStaffProjectRole
} from "@/lib/projectAccess/core";
import {
  type ProjectJoinNotice
} from "@/lib/projectAccess/joinNotice.client";

/**
 * 프로젝트 navigation과 구분되는 작은 계정·권한 utility입니다.
 * AuthSessionProvider와 ProjectAccessGate의 이미 확인된 상태만 사용하며
 * 이 컴포넌트 자체에서는 session/user/membership query를 만들지 않습니다.
 */
export function ProjectAccountUtility({
  projectId,
  returnTo,
  joinNotice = null,
  onDismissJoinNotice
}: {
  projectId: string;
  returnTo: string;
  joinNotice?: ProjectJoinNotice | null;
  onDismissJoinNotice?: () => void;
}) {
  const {
    email,
    errorMessage: sessionError,
    isEditorEligible: accountEditorEligible,
    isGoogle,
    startGoogleOAuth,
    status
  } = useAuthSession();
  const {
    accessMode,
    editorEligible: projectEditorEligible,
    isGuest,
    role
  } = useProjectAccess();
  const [actionError, setActionError] = useState("");
  const [homeNoticeTarget, setHomeNoticeTarget] = useState<HTMLElement | null>(null);
  const keyStaffIntentHistoryRef = useRef({ projectId, seen: false });
  if (keyStaffIntentHistoryRef.current.projectId !== projectId) {
    keyStaffIntentHistoryRef.current = { projectId, seen: false };
  }
  if (
    joinNotice?.projectId === projectId
    && joinNotice.reason === "key_staff_google_required"
  ) {
    keyStaffIntentHistoryRef.current.seen = true;
  }
  const safeReturnTo = getSafeInternalPath(returnTo, `/projects/${encodeURIComponent(projectId)}`);
  const accountHref = `/login?next=${encodeURIComponent(safeReturnTo)}`;
  const isPending = status === "loading" || status === "syncing";
  const isKeyStaff = isKeyStaffProjectRole(role);
  const isStaff = isStaffProjectRole(role);
  const accountGuideAnchorRef = useContextualGuideAnchor<HTMLElement>("shell.google-account");
  const authSettled = status === "anonymous" || status === "authenticated";
  const permissionNotice = resolveProjectAccountPermissionNotice({
    projectId,
    joinNoticeProjectId: joinNotice?.projectId ?? null,
    joinReason: joinNotice?.reason ?? null,
    isGuest,
    status,
    isGoogle,
    editorAllowed: accountEditorEligible
  });
  const authErrorMessage = actionError || (
    status === "error" ? sessionError : ""
  );
  const visiblePermissionNotice = authErrorMessage ? null : permissionNotice;
  const keyStaffGoogleGuideEligible = visiblePermissionNotice?.kind === "google-required";
  const guideEligible = !isGuest
    && isStaff
    && authSettled
    && !isGoogle
    && !actionError
    && !sessionError
    && !keyStaffIntentHistoryRef.current.seen
    && !keyStaffGoogleGuideEligible;
  useAutoContextualGuide(
    "home.google-account-connect",
    guideEligible
  );
  useAutoContextualGuide(
    "home.key-staff-google-required",
    keyStaffGoogleGuideEligible
  );
  const canUpgrade = isStaff
    && accessMode === "member"
    && isGoogle
    && accountEditorEligible
    && projectEditorEligible;

  useEffect(() => {
    const nextTarget = document.getElementById(`project-account-permission-slot-${projectId}`);
    setHomeNoticeTarget((current) => current === nextTarget ? current : nextTarget);
  });

  if (isGuest || (!isStaff && !isKeyStaff)) return null;

  async function handleGoogleLogin() {
    if (isPending || status === "unavailable") return;
    setActionError("");
    try {
      await startGoogleOAuth(safeReturnTo);
      onDismissJoinNotice?.();
    } catch (error) {
      setActionError(error instanceof Error ? error.message : "Google 로그인을 시작하지 못했습니다.");
    }
  }

  return (
    <aside
      ref={guideEligible || keyStaffGoogleGuideEligible ? accountGuideAnchorRef : undefined}
      aria-label="Google 계정과 프로젝트 권한"
      className="flex-none border-t border-field-divider px-2 py-2.5"
    >
      {visiblePermissionNotice?.kind === "google-required" ? (
        <div className="grid gap-1 px-1 pb-1">
          <p className="text-[10px] font-semibold leading-4 text-field-muted">
            Key staff 비밀번호 확인됨 · 승인된 Google 계정 필요
          </p>
          <button
            type="button"
            disabled={isPending || status === "unavailable"}
            onClick={() => void handleGoogleLogin()}
            className="inline-flex min-h-11 w-full items-center gap-2 text-left text-xs font-bold text-field-text transition-colors hover:text-field-primary focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-field-primary disabled:cursor-not-allowed disabled:opacity-50"
          >
            <GoogleMark />
            <span>Google 로그인</span>
            <ArrowRight className="h-3.5 w-3.5 shrink-0" aria-hidden />
          </button>
        </div>
      ) : isKeyStaff ? (
        isGoogle ? (
          <>
            <ConnectedAccountLink href={accountHref} label="Key staff" email={email} />
            {visiblePermissionNotice?.kind === "editor-permission-required" ? (
              <p className="mt-1 px-1 text-[10px] font-semibold leading-4 text-field-muted">
                현재 Google 계정에는 수정 권한이 없습니다.
              </p>
            ) : null}
          </>
        ) : (
          <div className="flex min-h-11 items-center gap-2 px-1" aria-label="Key staff 권한">
            <span className="grid h-7 w-7 shrink-0 place-items-center rounded-[var(--ui-radius-control)] border border-field-divider bg-field-soft text-field-muted">
              <KeyRound className="h-3.5 w-3.5" aria-hidden />
            </span>
            <span className="text-xs font-bold leading-4 text-field-text">Key staff · Google 인증 필요</span>
          </div>
        )
      ) : isPending ? (
        <div className="flex min-h-11 items-center gap-2 px-1 text-xs font-semibold text-field-muted" role="status">
          <LoaderCircle className="h-3.5 w-3.5 shrink-0 animate-spin" aria-hidden />
          <span>Google 계정 확인 중</span>
        </div>
      ) : status === "error" ? (
        <div className="flex min-h-11 items-center gap-2 px-1 text-xs font-semibold text-field-muted">
          <GoogleMark />
          <span>Google 계정 확인 필요</span>
        </div>
      ) : isGoogle ? (
        <>
          <ConnectedAccountLink href={accountHref} label="Google 연결됨" email={email} />
          {canUpgrade ? (
            <>
              <p className="mt-1 px-1 text-[10px] leading-4 text-field-muted">
                Key staff 비밀번호를 확인하면 수정 권한을 사용할 수 있습니다.
              </p>
              <ProjectKeyStaffUpgrade projectId={projectId} embedded />
            </>
          ) : status === "authenticated" ? (
            <p className="mt-1 px-1 text-[10px] font-semibold leading-4 text-field-muted">
              {visiblePermissionNotice?.kind === "editor-permission-required"
                ? "이 계정에는 수정 권한이 없습니다. 권한이 필요하면 프로젝트 관리자에게 요청해 주세요."
                : "현재 프로젝트의 수정 권한을 확인할 수 없습니다."}
            </p>
          ) : null}
        </>
      ) : (
        <>
          <button
            type="button"
            disabled={status === "unavailable"}
            onClick={() => void handleGoogleLogin()}
            className="inline-flex min-h-11 max-w-full items-center gap-2 px-1 text-left text-xs font-bold text-field-text transition-colors hover:text-field-primary focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-field-primary disabled:cursor-not-allowed disabled:opacity-50"
          >
            <GoogleMark />
            <span>Google 로그인</span>
            <ArrowRight className="h-3.5 w-3.5 shrink-0" aria-hidden />
          </button>
          <p className="px-1 text-[10px] leading-4 text-field-muted">
            프로젝트를 계정에 저장하고 권한을 확인합니다.
          </p>
        </>
      )}

      {actionError || (!isPending && status === "error" && sessionError) ? (
        <p role="alert" className="mt-1 break-words px-1 text-[10px] font-semibold leading-4 text-field-danger">
          {actionError || sessionError}
        </p>
      ) : null}

      {homeNoticeTarget && authErrorMessage ? createPortal(
        <ProjectAccountAuthErrorNotice onRetry={() => void handleGoogleLogin()} />,
        homeNoticeTarget
      ) : homeNoticeTarget && visiblePermissionNotice ? createPortal(
          <ProjectAccountPermissionNotice
            notice={visiblePermissionNotice}
            disabled={isPending || status === "unavailable"}
            onGoogleLogin={visiblePermissionNotice.kind === "google-required"
              ? () => void handleGoogleLogin()
              : undefined}
            onDismiss={visiblePermissionNotice.kind === "google-required"
              ? onDismissJoinNotice
              : undefined}
          />,
          homeNoticeTarget
        ) : null}
    </aside>
  );
}

function ConnectedAccountLink({
  href,
  label,
  email
}: {
  href: string;
  label: string;
  email: string | null;
}) {
  return (
    <Link
      href={href}
      aria-label={`${label}${email ? ` ${email}` : ""} · 계정 관리`}
      title="Google 계정 관리"
      className="inline-flex min-h-11 max-w-full items-center gap-2 px-1 text-left focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-field-primary"
    >
      <GoogleMark />
      <span className="min-w-0">
        <span className="block text-xs font-bold leading-4 text-field-text">{label}</span>
        {email ? (
          <span className="block max-w-[11rem] truncate text-[10px] leading-4 text-field-muted">
            {email}
          </span>
        ) : null}
      </span>
      <ArrowRight className="h-3.5 w-3.5 shrink-0 text-field-muted" aria-hidden />
    </Link>
  );
}

function GoogleMark() {
  return (
    <span
      className="grid h-7 w-7 shrink-0 place-items-center rounded-[var(--ui-radius-control)] border border-field-divider bg-field-soft text-[11px] font-black text-field-text"
      aria-hidden
    >
      G
    </span>
  );
}
