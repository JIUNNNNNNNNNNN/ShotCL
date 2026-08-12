export const PROJECT_DELETE_UNDO_LIMIT = 3;

export type ProjectDeleteUndoFailurePhase = "delete" | "restore" | "finalize";

export type ProjectDeleteUndoOperation = {
  key: string;
  projectId: string;
  label: string;
  removeLocal: () => void;
  restoreLocal: () => void;
  deleteRemote: () => Promise<void>;
  restoreRemote: () => Promise<void>;
  finalize?: () => Promise<void>;
};

export type ProjectDeleteUndoNotice = {
  kind: "deleted" | "restored" | "error";
  message: string;
};

type EntryState = "deleting" | "deleted" | "undo-requested" | "restoring" | "restored" | "failed" | "finalized";

type DeleteEntry = {
  operation: ProjectDeleteUndoOperation;
  state: EntryState;
  evicted: boolean;
  deletePromise: Promise<void> | null;
  restorePromise: Promise<void> | null;
  finalizePromise: Promise<void> | null;
};

type ProjectDeleteUndoControllerOptions = {
  limit?: number;
  onNotice?: (notice: ProjectDeleteUndoNotice) => void;
  onFailure?: (phase: ProjectDeleteUndoFailurePhase, operation: ProjectDeleteUndoOperation) => void;
};

/**
 * 프로젝트 안의 파괴적 삭제만 다루는 작은 LIFO 실행기입니다.
 * React page state나 전체 collection snapshot을 소유하지 않고, 각 삭제가 건넨
 * 최소 entity snapshot용 closure만 최대 세 개 유지합니다.
 */
export class ProjectDeleteUndoController {
  readonly projectId: string;
  readonly limit: number;

  private readonly onNotice?: ProjectDeleteUndoControllerOptions["onNotice"];
  private readonly onFailure?: ProjectDeleteUndoControllerOptions["onFailure"];
  private stack: DeleteEntry[] = [];
  private activeKeys = new Set<string>();
  private disposed = false;

  constructor(projectId: string, options: ProjectDeleteUndoControllerOptions = {}) {
    this.projectId = projectId;
    this.limit = Math.max(1, Math.trunc(options.limit ?? PROJECT_DELETE_UNDO_LIMIT));
    this.onNotice = options.onNotice;
    this.onFailure = options.onFailure;
  }

  get size() {
    return this.stack.length;
  }

  execute(operation: ProjectDeleteUndoOperation) {
    if (this.disposed || operation.projectId !== this.projectId || !operation.key || this.activeKeys.has(operation.key)) {
      return false;
    }

    // 사용자 체감 삭제가 네트워크보다 항상 먼저 일어나도록 동기 실행합니다.
    operation.removeLocal();
    const entry: DeleteEntry = {
      operation,
      state: "deleting",
      evicted: false,
      deletePromise: null,
      restorePromise: null,
      finalizePromise: null
    };
    this.activeKeys.add(operation.key);
    this.stack.push(entry);
    this.onNotice?.({
      kind: "deleted",
      message: `${operation.label} 삭제됨 · Command/Ctrl+Z로 되돌리기`
    });

    while (this.stack.length > this.limit) {
      const evicted = this.stack.shift();
      if (evicted) {
        evicted.evicted = true;
        void this.finalizeWhenReady(evicted);
      }
    }

    entry.deletePromise = this.runDelete(entry);
    return true;
  }

  undo() {
    if (this.disposed) return false;
    const entry = this.stack.pop();
    if (!entry) return false;

    entry.state = "undo-requested";
    // 서버 삭제가 아직 pending이어도 UI는 먼저 돌아옵니다.
    entry.operation.restoreLocal();
    if (entry.deletePromise) {
      void entry.deletePromise.then(() => this.restoreWhenReady(entry));
    }
    return true;
  }

  /** 프로젝트 전환/unmount에서는 남은 파일 정리 경계만 실행하고 stack을 폐기합니다. */
  dispose() {
    if (this.disposed) return;
    this.disposed = true;
    const remaining = this.stack.splice(0);
    for (const entry of remaining) {
      entry.evicted = true;
      void this.finalizeWhenReady(entry);
    }
  }

  private async runDelete(entry: DeleteEntry) {
    try {
      await entry.operation.deleteRemote();
      if (entry.state === "undo-requested") {
        await this.restoreWhenReady(entry);
      } else if (entry.state === "deleting") {
        entry.state = "deleted";
      }
    } catch {
      const localWasAlreadyRestored = entry.state === "undo-requested" || entry.state === "restoring";
      entry.state = "failed";
      this.removeEntry(entry);
      if (!localWasAlreadyRestored) entry.operation.restoreLocal();
      this.activeKeys.delete(entry.operation.key);
      this.onFailure?.("delete", entry.operation);
      this.onNotice?.({ kind: "error", message: `${entry.operation.label} 삭제를 완료하지 못해 되돌렸습니다.` });
    }
  }

  private restoreWhenReady(entry: DeleteEntry) {
    if (entry.restorePromise) return entry.restorePromise;
    if (entry.state === "failed" || entry.state === "restored" || entry.state === "finalized") {
      return Promise.resolve();
    }
    entry.state = "restoring";
    entry.restorePromise = entry.operation.restoreRemote()
      .then(() => {
        entry.state = "restored";
        this.activeKeys.delete(entry.operation.key);
        this.onNotice?.({ kind: "restored", message: `${entry.operation.label} 삭제를 되돌렸습니다.` });
      })
      .catch(() => {
        entry.state = "failed";
        // 서버 복원이 실패하면 화면도 서버의 삭제 상태로 재조정합니다.
        entry.operation.removeLocal();
        this.activeKeys.delete(entry.operation.key);
        this.onFailure?.("restore", entry.operation);
        this.onNotice?.({ kind: "error", message: "되돌리기를 완료하지 못했습니다." });
      });
    return entry.restorePromise;
  }

  private finalizeWhenReady(entry: DeleteEntry) {
    if (entry.finalizePromise) return entry.finalizePromise;
    entry.finalizePromise = (async () => {
      if (entry.deletePromise) await entry.deletePromise;
      if (entry.state !== "deleted" || !entry.operation.finalize) {
        if (entry.state === "deleted") {
          entry.state = "finalized";
          this.activeKeys.delete(entry.operation.key);
        }
        return;
      }
      try {
        await entry.operation.finalize();
        entry.state = "finalized";
        this.activeKeys.delete(entry.operation.key);
      } catch {
        this.activeKeys.delete(entry.operation.key);
        this.onFailure?.("finalize", entry.operation);
        this.onNotice?.({ kind: "error", message: `${entry.operation.label} 파일 정리를 완료하지 못했습니다.` });
      }
    })();
    return entry.finalizePromise;
  }

  private removeEntry(entry: DeleteEntry) {
    this.stack = this.stack.filter((candidate) => candidate !== entry);
  }
}

export function isProjectDeleteUndoShortcut(event: Pick<KeyboardEvent, "altKey" | "ctrlKey" | "defaultPrevented" | "isComposing" | "key" | "metaKey" | "repeat" | "shiftKey">) {
  if (event.defaultPrevented || event.isComposing || event.repeat || event.altKey || event.shiftKey) return false;
  if (!event.metaKey && !event.ctrlKey) return false;
  return event.key.toLowerCase() === "z";
}

export function isProjectDeleteUndoEditableTarget(target: EventTarget | null, activeElement?: Element | null) {
  return isEditableElement(target) || isEditableElement(activeElement ?? null);
}

function isEditableElement(target: EventTarget | null) {
  if (!(target instanceof Element)) return false;
  return Boolean(target.closest([
    "input",
    "textarea",
    "select",
    "[contenteditable]",
    '[role="textbox"]',
    '[role="combobox"]',
    "[data-local-undo-scope]"
  ].join(",")));
}
