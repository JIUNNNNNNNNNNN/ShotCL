"use client";

import {
  useEffect,
  useRef,
  useState,
  type FormEvent,
  type KeyboardEvent as ReactKeyboardEvent
} from "react";
import { createPortal } from "react-dom";
import { LoaderCircle, TriangleAlert, X } from "lucide-react";
import { Button } from "@/components/ui/Button";
import {
  permanentlyDeleteProject,
  PROJECT_PERMANENT_DELETE_PHRASE
} from "@/lib/data/projectPermanentDeletion";
import {
  beginProjectPermanentDeletionHere,
  endProjectPermanentDeletionHere
} from "@/lib/projectAccess/projectDeletionInitiator.client";

type ProjectPermanentDeleteDialogProps = {
  open: boolean;
  projectId: string;
  projectName: string;
  onClose: () => void;
  onDeleted: () => void | Promise<void>;
};

const DELETION_SCOPE = [
  "프로젝트 기본정보와 프로젝트 이름·비밀번호",
  "시나리오, 씬, 컷, 진행도와 OK·OMIT 기록",
  "일촬표, 회차, 시간표, 장소, 공지와 메모",
  "스태프·배우 이름, 연락처와 프로젝트 개인정보",
  "캘린더, 촬영 일정과 의상 데이터",
  "콘티, 부감도, Shot Diagram과 편집 데이터",
  "집합장소 사진, Archive, Reference Asset와 모든 업로드 파일",
  "멤버십, Staff·Kakao·Guest 초대 링크와 접근 권한",
  "프로젝트에 속한 삭제 영수증과 Undo 기록"
] as const;

/** 일반 삭제 Undo와 분리된 owner 전용 2문구 destructive confirmation입니다. */
export function ProjectPermanentDeleteDialog({
  open,
  projectId,
  projectName,
  onClose,
  onDeleted
}: ProjectPermanentDeleteDialogProps) {
  const [projectNameConfirmation, setProjectNameConfirmation] = useState("");
  const [phraseConfirmation, setPhraseConfirmation] = useState("");
  const [isDeleting, setIsDeleting] = useState(false);
  const [errorMessage, setErrorMessage] = useState("");
  const dialogRef = useRef<HTMLElement | null>(null);
  const projectNameInputRef = useRef<HTMLInputElement | null>(null);
  const submissionLockedRef = useRef(false);

  const projectNameMatches = projectNameConfirmation.trim() === projectName.trim();
  const phraseMatches = phraseConfirmation === PROJECT_PERMANENT_DELETE_PHRASE;
  const canDelete = projectNameMatches && phraseMatches && !isDeleting;

  useEffect(() => {
    if (!open) return undefined;
    const previouslyFocused = document.activeElement instanceof HTMLElement
      ? document.activeElement
      : null;
    const previousOverflow = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    setProjectNameConfirmation("");
    setPhraseConfirmation("");
    setErrorMessage("");
    setIsDeleting(false);
    submissionLockedRef.current = false;
    const frame = window.requestAnimationFrame(() => projectNameInputRef.current?.focus());
    return () => {
      window.cancelAnimationFrame(frame);
      document.body.style.overflow = previousOverflow;
      endProjectPermanentDeletionHere(projectId);
      if (previouslyFocused?.isConnected) previouslyFocused.focus({ preventScroll: true });
    };
  }, [open, projectId]);

  useEffect(() => {
    if (!open) return undefined;
    const handleEscape = (event: KeyboardEvent) => {
      if (event.key !== "Escape" || submissionLockedRef.current) return;
      event.preventDefault();
      setProjectNameConfirmation("");
      setPhraseConfirmation("");
      setErrorMessage("");
      endProjectPermanentDeletionHere(projectId);
      onClose();
    };
    window.addEventListener("keydown", handleEscape);
    return () => window.removeEventListener("keydown", handleEscape);
  }, [onClose, open, projectId]);

  if (!open || typeof document === "undefined") return null;

  async function handleSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!canDelete || submissionLockedRef.current) return;
    submissionLockedRef.current = true;
    beginProjectPermanentDeletionHere(projectId);
    setIsDeleting(true);
    setErrorMessage("");
    try {
      await permanentlyDeleteProject({
        projectId,
        projectName: projectNameConfirmation,
        confirmationPhrase: phraseConfirmation
      });
      await onDeleted();
    } catch (error) {
      submissionLockedRef.current = false;
      setIsDeleting(false);
      setErrorMessage(error instanceof Error ? error.message : "프로젝트를 영구 삭제하지 못했습니다.");
    }
  }

  function requestClose() {
    if (submissionLockedRef.current) return;
    setProjectNameConfirmation("");
    setPhraseConfirmation("");
    setErrorMessage("");
    endProjectPermanentDeletionHere(projectId);
    onClose();
  }

  return createPortal(
    <div
      className="fixed inset-0 z-[100] flex items-end justify-center bg-black/80 p-0 sm:items-center sm:p-4"
      onPointerDown={(event) => {
        if (event.target === event.currentTarget) requestClose();
      }}
    >
      <section
        ref={dialogRef}
        role="alertdialog"
        aria-modal="true"
        aria-labelledby="project-permanent-delete-title"
        aria-describedby="project-permanent-delete-description"
        aria-busy={isDeleting || undefined}
        className="ui-motion-dialog flex max-h-[min(92dvh,48rem)] w-full max-w-xl flex-col overflow-hidden rounded-t-[var(--radius-dialog)] border border-field-danger/70 bg-field-dialog shadow-dialog sm:rounded-[var(--radius-dialog)]"
        onKeyDown={handleDialogKeyDown}
      >
        <header className="flex items-start gap-3 border-b border-field-danger/40 px-4 py-4 sm:px-5">
          <span className="grid h-9 w-9 shrink-0 place-items-center rounded-full border border-field-danger/60 bg-field-danger/10 text-field-danger">
            <TriangleAlert className="h-5 w-5" aria-hidden />
          </span>
          <div className="min-w-0 flex-1">
            <h2 id="project-permanent-delete-title" className="font-display text-lg font-black text-field-text">
              프로젝트 영구 삭제
            </h2>
            <p id="project-permanent-delete-description" className="mt-1 text-xs font-bold leading-5 text-field-danger">
              이 작업은 되돌릴 수 없으며 Cmd/Ctrl+Z로 복구되지 않습니다.
            </p>
          </div>
          <button
            type="button"
            aria-label="프로젝트 영구 삭제 창 닫기"
            disabled={isDeleting}
            onClick={requestClose}
            className="grid h-9 w-9 shrink-0 place-items-center rounded-md border border-field-border text-field-muted transition hover:border-field-divider hover:bg-field-hover hover:text-field-text focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-field-danger disabled:cursor-not-allowed disabled:opacity-50"
          >
            <X className="h-4 w-4" aria-hidden />
          </button>
        </header>

        <form onSubmit={handleSubmit} className="min-h-0 overflow-y-auto overscroll-contain px-4 py-4 sm:px-5">
          <div className="rounded-[var(--radius-control)] border border-field-danger/40 bg-field-danger/5 p-3">
            <p className="text-sm font-black text-field-text">다음 프로젝트 범위가 모두 삭제됩니다.</p>
            <ul className="mt-2 grid gap-1.5 text-xs font-bold leading-5 text-field-muted sm:grid-cols-2">
              {DELETION_SCOPE.map((item) => (
                <li key={item} className="flex gap-2">
                  <span aria-hidden className="text-field-danger">•</span>
                  <span>{item}</span>
                </li>
              ))}
            </ul>
          </div>

          <div className="mt-4 rounded-[var(--radius-control)] border border-field-border bg-field-panel p-3">
            <p className="text-xs font-bold text-field-muted">현재 프로젝트</p>
            <p className="mt-1 break-words font-display text-base font-black text-field-text [overflow-wrap:anywhere]">
              {projectName}
            </p>
          </div>

          <div className="mt-4 grid gap-4">
            <label className="grid gap-1.5">
              <span className="text-xs font-bold leading-5 text-field-subtle">
                확인을 위해 프로젝트 이름 “{projectName}”을 입력하세요.
              </span>
              <input
                ref={projectNameInputRef}
                value={projectNameConfirmation}
                onChange={(event) => {
                  setProjectNameConfirmation(event.currentTarget.value);
                  setErrorMessage("");
                }}
                disabled={isDeleting}
                autoComplete="off"
                spellCheck={false}
                aria-invalid={projectNameConfirmation.length > 0 && !projectNameMatches || undefined}
                className="min-h-11 w-full rounded-md border border-field-border bg-field-input px-3 py-2 text-sm font-bold text-field-text outline-none transition focus:border-field-danger focus:ring-2 focus:ring-field-danger/25 disabled:cursor-not-allowed disabled:opacity-60"
              />
            </label>

            <label className="grid gap-1.5">
              <span className="text-xs font-bold leading-5 text-field-subtle">
                계속하려면 “{PROJECT_PERMANENT_DELETE_PHRASE}”를 정확히 입력하세요.
              </span>
              <input
                value={phraseConfirmation}
                onChange={(event) => {
                  setPhraseConfirmation(event.currentTarget.value);
                  setErrorMessage("");
                }}
                disabled={isDeleting}
                autoComplete="off"
                spellCheck={false}
                aria-invalid={phraseConfirmation.length > 0 && !phraseMatches || undefined}
                className="min-h-11 w-full rounded-md border border-field-border bg-field-input px-3 py-2 text-sm font-black text-field-text outline-none transition focus:border-field-danger focus:ring-2 focus:ring-field-danger/25 disabled:cursor-not-allowed disabled:opacity-60"
              />
            </label>
          </div>

          {errorMessage ? (
            <p role="alert" className="mt-4 rounded-md border border-field-danger/50 bg-field-danger/10 px-3 py-2 text-xs font-bold leading-5 text-field-danger">
              {errorMessage}
            </p>
          ) : null}

          <div className="mt-5 grid gap-2 sm:grid-cols-2">
            <Button
              type="button"
              variant="secondary"
              disabled={isDeleting}
              onClick={requestClose}
              className="min-h-11"
            >
              취소
            </Button>
            <Button
              type="submit"
              variant="danger"
              disabled={!canDelete}
              aria-busy={isDeleting || undefined}
              className="min-h-11"
            >
              {isDeleting ? <LoaderCircle className="h-4 w-4 animate-spin motion-reduce:animate-none" aria-hidden /> : null}
              모든 프로젝트 데이터 영구 삭제
            </Button>
          </div>
        </form>
      </section>
    </div>,
    document.body
  );
}

function handleDialogKeyDown(event: ReactKeyboardEvent<HTMLElement>) {
  if (event.key !== "Tab") return;
  const focusable = Array.from(event.currentTarget.querySelectorAll<HTMLElement>(
    'button:not([disabled]), input:not([disabled]), [href], [tabindex]:not([tabindex="-1"])'
  ));
  if (focusable.length === 0) return;
  const first = focusable[0];
  const last = focusable[focusable.length - 1];
  if (event.shiftKey && document.activeElement === first) {
    event.preventDefault();
    last.focus();
  } else if (!event.shiftKey && document.activeElement === last) {
    event.preventDefault();
    first.focus();
  }
}
