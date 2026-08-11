"use client";

import { useEffect, useId, useRef, useState } from "react";
import { ArrowRight, KeyRound, LoaderCircle, X } from "lucide-react";
import { useProjectAccess } from "@/components/ProjectAccessGate";
import { isStaffProjectRole, sanitizePasscode } from "@/lib/projectAccess/core";
import {
  KeyStaffUpgradeError,
  upgradeCurrentProjectToKeyStaff
} from "@/lib/projectAccess/client";

const SUCCESS_MESSAGE_MS = 1800;

/** 일반 Staff에게만 보이는 왼쪽 패널 하단의 compact 권한 전환 utility입니다. */
export function ProjectKeyStaffUpgrade({ projectId }: { projectId: string }) {
  const { role, accessMode, editorEligible, applyVerifiedRole } = useProjectAccess();
  const canUpgrade = accessMode === "member" && editorEligible && isStaffProjectRole(role);
  const [expanded, setExpanded] = useState(false);
  const [password, setPassword] = useState("");
  const [error, setError] = useState("");
  const [pending, setPending] = useState(false);
  const [showSuccess, setShowSuccess] = useState(false);
  const inputRef = useRef<HTMLInputElement | null>(null);
  const pendingRef = useRef(false);
  const expandedRef = useRef(false);
  const currentProjectRef = useRef(projectId);
  const requestGenerationRef = useRef(0);
  const successTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const inputId = useId();
  const statusId = `${inputId}-status`;
  expandedRef.current = expanded;

  useEffect(() => {
    currentProjectRef.current = projectId;
    requestGenerationRef.current += 1;
    pendingRef.current = false;
    setPending(false);
    setExpanded(false);
    setPassword("");
    setError("");
    setShowSuccess(false);
    if (successTimerRef.current) clearTimeout(successTimerRef.current);
    successTimerRef.current = null;
  }, [projectId]);

  useEffect(() => {
    if (!expanded) return undefined;
    const frame = window.requestAnimationFrame(() => inputRef.current?.focus());
    return () => window.cancelAnimationFrame(frame);
  }, [expanded]);

  useEffect(() => {
    if (canUpgrade) return;
    requestGenerationRef.current += 1;
    pendingRef.current = false;
    setPending(false);
    setExpanded(false);
    setPassword("");
    setError("");
  }, [canUpgrade]);

  useEffect(() => () => {
    if (successTimerRef.current) clearTimeout(successTimerRef.current);
  }, []);

  function closeForm() {
    // 이미 전송된 서버 mutation lock은 유지합니다. 성공 응답은 닫힌 뒤에도 role에 반영하고,
    // 실패 메시지만 닫힌 form에 다시 표시하지 않습니다.
    expandedRef.current = false;
    setExpanded(false);
    setPassword("");
    setError("");
  }

  async function handleSubmit(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (pendingRef.current) return;
    if (password.length !== 4) {
      setError("4자리 비밀번호를 입력하세요.");
      return;
    }

    const submittedProjectId = projectId;
    const requestGeneration = requestGenerationRef.current + 1;
    requestGenerationRef.current = requestGeneration;
    pendingRef.current = true;
    setPending(true);
    setError("");
    try {
      const result = await upgradeCurrentProjectToKeyStaff(submittedProjectId, password);
      if (
        currentProjectRef.current !== submittedProjectId
        || requestGenerationRef.current !== requestGeneration
      ) return;
      setPassword("");
      setExpanded(false);
      setShowSuccess(true);
      applyVerifiedRole(result.role);
      if (successTimerRef.current) clearTimeout(successTimerRef.current);
      successTimerRef.current = setTimeout(() => {
        setShowSuccess(false);
        successTimerRef.current = null;
      }, SUCCESS_MESSAGE_MS);
    } catch (caught) {
      if (
        currentProjectRef.current !== submittedProjectId
        || requestGenerationRef.current !== requestGeneration
      ) return;
      if (expandedRef.current) {
        setError(caught instanceof KeyStaffUpgradeError
          ? caught.message
          : "권한을 변경하지 못했습니다.");
      }
    } finally {
      if (
        currentProjectRef.current === submittedProjectId
        && requestGenerationRef.current === requestGeneration
      ) {
        pendingRef.current = false;
        setPending(false);
      }
    }
  }

  if (showSuccess) {
    return (
      <div className="flex-none border-t border-field-divider px-2 py-3 text-center">
        <p role="status" className="text-[11px] font-semibold leading-4 text-field-primary">
          Key staff 권한으로 전환되었습니다.
        </p>
      </div>
    );
  }

  if (!canUpgrade) return null;

  return (
    <div className="flex-none border-t border-field-divider px-2 py-2.5">
      {!expanded ? (
        <button
          type="button"
          className="mx-auto flex min-h-11 w-full items-center justify-center gap-1.5 px-2 text-xs font-semibold text-field-muted transition-colors hover:text-field-text focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-field-primary"
          onClick={() => {
            setError("");
            expandedRef.current = true;
            setExpanded(true);
          }}
        >
          <KeyRound className="h-3.5 w-3.5" aria-hidden />
          <span>Key staff로 전환</span>
        </button>
      ) : (
        <form
          className="min-w-0"
          onSubmit={(event) => void handleSubmit(event)}
          onKeyDown={(event) => {
            if (event.key !== "Escape") return;
            event.preventDefault();
            event.stopPropagation();
            closeForm();
          }}
        >
          <div className="flex min-w-0 items-center justify-between gap-2">
            <label htmlFor={inputId} className="min-w-0 text-[11px] font-semibold leading-4 text-field-subtle">
              Key staff 비밀번호
            </label>
            <button
              type="button"
              aria-label="권한 전환 입력 닫기"
              className="flex h-11 w-11 shrink-0 items-center justify-center text-field-muted transition-colors hover:text-field-text focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-field-primary"
              onClick={closeForm}
            >
              <X className="h-4 w-4" aria-hidden />
            </button>
          </div>
          <div className="flex min-w-0 items-stretch gap-1.5">
            <input
              ref={inputRef}
              id={inputId}
              name="key-staff-passcode"
              type="password"
              inputMode="numeric"
              autoComplete="off"
              maxLength={4}
              value={password}
              aria-describedby={error ? statusId : undefined}
              aria-invalid={Boolean(error)}
              className="h-11 min-w-0 flex-1 rounded-[var(--ui-radius-control)] border border-field-divider bg-field-soft px-2.5 text-center text-sm font-semibold tracking-[0.22em] text-field-text outline-none transition-colors focus:border-field-primary focus:ring-1 focus:ring-field-primary"
              onChange={(event) => {
                setPassword(sanitizePasscode(event.target.value));
                if (error) setError("");
              }}
            />
            <button
              type="submit"
              aria-label="Key staff 비밀번호 확인"
              className="flex h-11 w-11 shrink-0 items-center justify-center rounded-[var(--ui-radius-control)] border border-field-primary/60 text-field-primary transition-colors hover:border-field-primary hover:text-field-text focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-field-primary disabled:cursor-wait disabled:opacity-50"
              disabled={pending}
            >
              {pending
                ? <LoaderCircle className="h-4 w-4 animate-spin" aria-hidden />
                : <ArrowRight className="h-4 w-4" aria-hidden />}
              <span className="sr-only">{pending ? "확인 중" : "확인"}</span>
            </button>
          </div>
          {error ? (
            <p id={statusId} role="alert" className="mt-1.5 break-words text-[10px] font-semibold leading-4 text-field-danger">
              {error}
            </p>
          ) : null}
        </form>
      )}
    </div>
  );
}
