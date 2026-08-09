"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import {
  LatestAutosaveQueue,
  type AutosaveSaveMeta,
  type AutosaveStatus
} from "@/lib/client/latestAutosaveQueue";
import {
  canRestoreAutosaveDraft,
  createAutosaveDraftWriterId,
  discardAutosaveDraft,
  getAutosaveDraft,
  rememberAutosaveDraft,
  settleAutosaveDraft
} from "@/lib/client/autosaveDraftCache";

type UseAutosaveOptions<T, Result> = {
  value: T;
  enabled: boolean;
  save: (value: T) => Promise<Result>;
  delayMs?: number;
  fingerprint?: (value: T) => string;
  scopeKey?: string;
  initialSavedFingerprint?: string;
  validate?: (value: T) => boolean;
  restoreDraft?: (value: T, savedValue: T | null) => void;
  onSaved?: (result: Result, value: T, meta: AutosaveSaveMeta) => void;
  onError?: (error: unknown, value: T) => void;
};

type QueueHolder<T, Result> = {
  scopeKey: string;
  writerId: number;
  queue: LatestAutosaveQueue<T, Result>;
  bindings: {
    save: (value: T) => Promise<Result>;
    fingerprint: (value: T) => string;
    onSaved?: (result: Result, value: T, meta: AutosaveSaveMeta) => void;
    onError?: (error: unknown, value: T) => void;
  };
};

/** 페이지의 local draft를 유지한 채 debounce + single-flight latest-wins로 저장합니다. */
export function useAutosave<T, Result = void>({
  value,
  enabled,
  save,
  delayMs = 700,
  fingerprint = defaultFingerprint,
  scopeKey = "default",
  initialSavedFingerprint,
  validate,
  restoreDraft,
  onSaved,
  onError
}: UseAutosaveOptions<T, Result>) {
  const [status, setStatus] = useState<AutosaveStatus>("idle");
  const [error, setError] = useState<unknown | null>(null);
  const mountedRef = useRef(true);
  const validateRef = useRef(validate);
  const restoreDraftRef = useRef(restoreDraft);
  const valueRef = useRef(value);
  const restoredScopeRef = useRef<string | null>(null);
  validateRef.current = validate;
  restoreDraftRef.current = restoreDraft;
  valueRef.current = value;

  const holderRef = useRef<QueueHolder<T, Result> | null>(null);

  const createHolder = useCallback((
    initialValue: T,
    initialScopeKey: string,
    bindings: QueueHolder<T, Result>["bindings"],
    savedFingerprint?: string,
    savedValue?: T | null
  ): QueueHolder<T, Result> => {
    const writerId = createAutosaveDraftWriterId();
    let queue: LatestAutosaveQueue<T, Result>;
    queue = new LatestAutosaveQueue<T, Result>({
      delayMs,
      initialFingerprint: savedFingerprint ?? bindings.fingerprint(initialValue),
      initialValue: savedValue ?? initialValue,
      fingerprint: (nextValue) => bindings.fingerprint(nextValue),
      save: (nextValue) => bindings.save(nextValue),
      onStatusChange: (nextStatus, nextError) => {
        if (!mountedRef.current || holderRef.current?.queue !== queue) return;
        setStatus(nextStatus);
        setError(nextError);
      },
      onSaved: (result, savedValue, meta) => {
        settleAutosaveDraft(
          initialScopeKey,
          bindings.fingerprint(savedValue),
          savedValue,
          writerId
        );
        if (!mountedRef.current) return;
        // Retired scopes still reconcile their own entity through the
        // callbacks captured in their holder. Only their status UI is hidden.
        bindings.onSaved?.(result, savedValue, meta);
      },
      onError: (saveError, failedValue) => {
        if (!mountedRef.current) return;
        bindings.onError?.(saveError, failedValue);
      }
    });
    return { scopeKey: initialScopeKey, writerId, queue, bindings };
  }, [delayMs]);
  const currentBindings: QueueHolder<T, Result>["bindings"] = {
    save,
    fingerprint,
    onSaved,
    onError
  };
  if (!holderRef.current) {
    holderRef.current = createHolder(
      value,
      scopeKey,
      currentBindings,
      initialSavedFingerprint ?? fingerprint(value),
      value
    );
  } else if (holderRef.current.scopeKey === scopeKey) {
    holderRef.current.bindings.save = save;
    holderRef.current.bindings.fingerprint = fingerprint;
    holderRef.current.bindings.onSaved = onSaved;
    holderRef.current.bindings.onError = onError;
  }

  useEffect(() => {
    const current = holderRef.current;
    if (!current || current.scopeKey === scopeKey) return;

    // Scope changes are committed in an effect so render never starts network
    // work or sets state. The retired queue keeps its own callbacks and flushes
    // the previous entity without writing through the next entity's handler.
    const next = createHolder(
      value,
      scopeKey,
      currentBindings,
      initialSavedFingerprint ?? fingerprint(value),
      value
    );
    holderRef.current = next;
    setStatus("idle");
    setError(null);
    current.queue.dispose({ flush: true });
  // A new scope must use the value/callbacks from that committed render; the
  // effect intentionally runs only when the entity scope changes.
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [createHolder, scopeKey]);

  useEffect(() => {
    const holder = holderRef.current;
    if (!holder || holder.scopeKey !== scopeKey) return;
    const queue = holder.queue;
    if (!enabled || validateRef.current?.(value) === false) {
      queue.pause();
      return;
    }
    const cached = getAutosaveDraft<T>(scopeKey);
    const shouldRestore = restoredScopeRef.current !== scopeKey;
    restoredScopeRef.current = scopeKey;
    const currentFingerprint = fingerprint(value);
    if (shouldRestore && cached) {
      if (
        canRestoreAutosaveDraft(cached, currentFingerprint)
        && restoreDraftRef.current
      ) {
        // Let the restored React state become the queue input on the next
        // render. Scheduling the raw cache here can race a merge callback.
        queue.pause();
        restoreDraftRef.current(cached.value, cached.savedValue);
        return;
      }
      // A current value that differs from the cache baseline is newer. Never
      // replace it with an older navigation draft.
      discardAutosaveDraft(scopeKey, holder.writerId);
    }
    rememberAutosaveDraft(
      scopeKey,
      value,
      currentFingerprint,
      queue.getSavedFingerprint(),
      queue.getSavedValue(),
      holder.writerId
    );
    queue.schedule(value);
    queue.resume();
  }, [enabled, fingerprint, scopeKey, value]);

  useEffect(() => {
    const flushPending = () => {
      void holderRef.current?.queue.flush();
    };
    window.addEventListener("pagehide", flushPending);
    return () => {
      window.removeEventListener("pagehide", flushPending);
      flushPending();
    };
  }, []);

  useEffect(() => {
    mountedRef.current = true;
    return () => {
      mountedRef.current = false;
      holderRef.current?.queue.dispose({ flush: true });
    };
  }, []);

  const flush = useCallback(() => holderRef.current?.queue.flush() ?? Promise.resolve(true), []);
  const saveNow = useCallback((nextValue: T) => {
    const holder = holderRef.current;
    if (!holder) return Promise.resolve(true);
    rememberAutosaveDraft(
      holder.scopeKey,
      nextValue,
      holder.bindings.fingerprint(nextValue),
      holder.queue.getSavedFingerprint(),
      holder.queue.getSavedValue(),
      holder.writerId
    );
    return holder.queue.saveNow(nextValue);
  }, []);
  const retry = useCallback(() => holderRef.current?.queue.retry(), []);
  const markSaved = useCallback((savedValue: T = valueRef.current) => {
    const holder = holderRef.current;
    if (!holder) return;
    holder.queue.markSaved(savedValue);
    settleAutosaveDraft(
      holder.scopeKey,
      holder.bindings.fingerprint(savedValue),
      savedValue,
      holder.writerId
    );
  }, []);

  return {
    status,
    error,
    flush,
    saveNow,
    retry,
    markSaved,
    isPending: status === "dirty" || status === "saving",
    isError: status === "error"
  };
}

function defaultFingerprint<T>(value: T) {
  return JSON.stringify(value);
}
