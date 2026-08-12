"use client";

import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useRef
} from "react";
import {
  isProjectDeleteUndoEditableTarget,
  isProjectDeleteUndoShortcut,
  ProjectDeleteUndoController,
  type ProjectDeleteUndoOperation
} from "@/lib/projectDeleteUndo";

type ProjectDeleteRequest = Omit<ProjectDeleteUndoOperation, "projectId">;

type ProjectDeleteUndoContextValue = {
  deleteWithUndo: (operation: ProjectDeleteRequest) => boolean;
  undoLastDelete: () => boolean;
};

const ProjectDeleteUndoContext = createContext<ProjectDeleteUndoContextValue | null>(null);

/** 프로젝트 layout lifetime 동안 하나의 삭제 전용 Undo stack과 keyboard listener만 유지합니다. */
export function ProjectDeleteUndoProvider({
  projectId,
  children
}: {
  projectId: string;
  children: React.ReactNode;
}) {
  const noticeRef = useRef<HTMLParagraphElement | null>(null);
  const noticeTimerRef = useRef<number | null>(null);
  const lifecycleGenerationRef = useRef(0);
  const controllerRef = useRef<ProjectDeleteUndoController | null>(null);
  if (!controllerRef.current) {
    controllerRef.current = new ProjectDeleteUndoController(projectId, {
      onNotice: (notice) => {
        const node = noticeRef.current;
        if (!node) return;
        if (noticeTimerRef.current !== null) window.clearTimeout(noticeTimerRef.current);
        node.textContent = notice.message;
        node.hidden = false;
        noticeTimerRef.current = window.setTimeout(() => {
          noticeTimerRef.current = null;
          node.hidden = true;
          node.textContent = "";
        }, 3_500);
      }
    });
  }

  const deleteWithUndo = useCallback((operation: ProjectDeleteRequest) => (
    controllerRef.current?.execute({ ...operation, projectId }) ?? false
  ), [projectId]);
  const undoLastDelete = useCallback(() => controllerRef.current?.undo() ?? false, []);

  useEffect(() => {
    const controller = controllerRef.current;
    const generation = lifecycleGenerationRef.current + 1;
    lifecycleGenerationRef.current = generation;
    const finalizeAbandonedHistory = () => controller?.dispose();
    window.addEventListener("pagehide", finalizeAbandonedHistory);
    return () => {
      window.removeEventListener("pagehide", finalizeAbandonedHistory);
      // React Strict Mode의 effect probe에서는 다음 setup이 같은 tick에 generation을
      // 올립니다. 실제 project unmount/switch일 때만 남은 파일 정리를 실행합니다.
      queueMicrotask(() => {
        if (lifecycleGenerationRef.current === generation) controller?.dispose();
      });
      if (noticeTimerRef.current !== null) {
        window.clearTimeout(noticeTimerRef.current);
        noticeTimerRef.current = null;
      }
    };
  }, []);

  useEffect(() => {
    function handleKeyDown(event: KeyboardEvent) {
      if (!isProjectDeleteUndoShortcut(event)) return;
      if (isProjectDeleteUndoEditableTarget(event.target, document.activeElement)) return;
      // Canvas-style editors own their entire active modal, even when focus is
      // temporarily on body/SVG rather than an editable descendant.
      if (document.querySelector('[data-local-undo-scope="active"]')) return;
      if (!undoLastDelete()) return;
      event.preventDefault();
    }
    window.addEventListener("keydown", handleKeyDown);
    return () => window.removeEventListener("keydown", handleKeyDown);
  }, [undoLastDelete]);

  const value = useMemo<ProjectDeleteUndoContextValue>(() => ({
    deleteWithUndo,
    undoLastDelete
  }), [deleteWithUndo, undoLastDelete]);

  return (
    <ProjectDeleteUndoContext.Provider value={value}>
      {children}
      <div className="pointer-events-none fixed inset-x-0 bottom-4 z-[140] flex justify-center px-4" aria-live="polite" aria-atomic="true">
        <p
          ref={noticeRef}
          hidden
          className="max-w-sm rounded-[var(--radius-control)] border border-field-divider bg-field-panel px-3 py-2 text-center text-xs font-bold text-field-text shadow-card"
        />
      </div>
    </ProjectDeleteUndoContext.Provider>
  );
}

export function useProjectDeleteUndo() {
  const value = useContext(ProjectDeleteUndoContext);
  if (!value) throw new Error("useProjectDeleteUndo must be used inside ProjectDeleteUndoProvider.");
  return value;
}
