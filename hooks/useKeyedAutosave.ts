"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import {
  LatestAutosaveQueue,
  type AutosaveSaveMeta,
  type AutosaveStatus
} from "@/lib/client/latestAutosaveQueue";
import {
  createAutosaveDraftWriterId,
  discardAutosaveDraft,
  getAutosaveDraft,
  rememberAutosaveDraft,
  settleAutosaveDraft
} from "@/lib/client/autosaveDraftCache";

type UseKeyedAutosaveOptions<T, Result> = {
  values: readonly T[];
  getKey: (value: T) => string;
  enabled: boolean;
  save: (value: T, key: string) => Promise<Result>;
  delayMs?: number;
  fingerprint?: (value: T) => string;
  scopeKey?: string;
  validate?: (value: T, key: string) => boolean;
  restoreDrafts?: (drafts: ReadonlyArray<{ value: T; savedValue: T | null }>) => void;
  onSaved?: (result: Result, value: T, meta: AutosaveSaveMeta, key: string) => void;
  onError?: (error: unknown, value: T, key: string) => void;
};

type KeyedQueueBindings<T, Result> = {
  getKey: (value: T) => string;
  save: (value: T, key: string) => Promise<Result>;
  fingerprint: (value: T) => string;
  onSaved?: (result: Result, value: T, meta: AutosaveSaveMeta, key: string) => void;
  onError?: (error: unknown, value: T, key: string) => void;
};

type KeyedQueueHolder<T, Result> = {
  scopeKey: string;
  queues: Map<string, LatestAutosaveQueue<T, Result>>;
  writerIds: Map<string, number>;
  pendingRestoreKeys: Set<string>;
  bindings: KeyedQueueBindings<T, Result>;
};

/**
 * 각 entity key마다 독립적인 debounce + single-flight latest-wins queue를 둡니다.
 * 한 entity의 느린 요청이나 오류는 다른 entity의 저장을 막지 않습니다.
 */
export function useKeyedAutosave<T, Result = void>({
  values,
  getKey,
  enabled,
  save,
  delayMs = 700,
  fingerprint = defaultFingerprint,
  scopeKey = "default",
  validate,
  restoreDrafts,
  onSaved,
  onError
}: UseKeyedAutosaveOptions<T, Result>) {
  const [status, setStatus] = useState<AutosaveStatus>("idle");
  const [error, setError] = useState<unknown | null>(null);
  const mountedRef = useRef(true);
  const validateRef = useRef(validate);
  const restoreDraftsRef = useRef(restoreDrafts);
  const holderRef = useRef<KeyedQueueHolder<T, Result> | null>(null);
  validateRef.current = validate;
  restoreDraftsRef.current = restoreDrafts;

  const publishAggregateStatus = useCallback((holder: KeyedQueueHolder<T, Result>) => {
    if (!mountedRef.current || holderRef.current !== holder) return;
    let nextStatus: AutosaveStatus = "idle";
    let nextError: unknown | null = null;
    for (const queue of holder.queues.values()) {
      const queueStatus = queue.getStatus();
      if (queueStatus === "error") {
        nextStatus = "error";
        nextError ??= queue.getError();
        continue;
      }
      if (nextStatus === "error") continue;
      if (queueStatus === "saving") {
        nextStatus = "saving";
        continue;
      }
      if (nextStatus === "saving") continue;
      if (queueStatus === "dirty") {
        nextStatus = "dirty";
        continue;
      }
      if (nextStatus === "dirty") continue;
      if (queueStatus === "saved") nextStatus = "saved";
    }
    setStatus(nextStatus);
    setError(nextError);
  }, []);

  const createHolder = useCallback((
    nextScopeKey: string,
    bindings: KeyedQueueBindings<T, Result>
  ): KeyedQueueHolder<T, Result> => ({
    scopeKey: nextScopeKey,
    queues: new Map(),
    writerIds: new Map(),
    pendingRestoreKeys: new Set(),
    bindings
  }), []);

  const createQueue = useCallback((
    holder: KeyedQueueHolder<T, Result>,
    key: string,
    initialValue: T
  ) => {
    const draftKey = `${holder.scopeKey}:${key}`;
    const cached = getAutosaveDraft<T>(draftKey);
    if (cached) holder.pendingRestoreKeys.add(key);
    const writerId = createAutosaveDraftWriterId();
    holder.writerIds.set(key, writerId);
    let queue: LatestAutosaveQueue<T, Result>;
    queue = new LatestAutosaveQueue<T, Result>({
      delayMs,
      initialFingerprint: holder.bindings.fingerprint(initialValue),
      initialValue,
      fingerprint: (nextValue) => holder.bindings.fingerprint(nextValue),
      save: (nextValue) => holder.bindings.save(nextValue, key),
      onStatusChange: () => {
        if (holder.queues.get(key) !== queue) return;
        publishAggregateStatus(holder);
      },
      onSaved: (result, savedValue, meta) => {
        settleAutosaveDraft(
          draftKey,
          holder.bindings.fingerprint(savedValue),
          savedValue,
          writerId
        );
        if (!mountedRef.current) return;
        holder.bindings.onSaved?.(result, savedValue, meta, key);
      },
      onError: (saveError, failedValue) => {
        if (!mountedRef.current) return;
        holder.bindings.onError?.(saveError, failedValue, key);
      }
    });
    return queue;
  }, [delayMs, publishAggregateStatus]);

  const currentBindings: KeyedQueueBindings<T, Result> = {
    getKey,
    save,
    fingerprint,
    onSaved,
    onError
  };
  if (!holderRef.current) {
    holderRef.current = createHolder(scopeKey, currentBindings);
  } else if (holderRef.current.scopeKey === scopeKey) {
    holderRef.current.bindings.getKey = getKey;
    holderRef.current.bindings.save = save;
    holderRef.current.bindings.fingerprint = fingerprint;
    holderRef.current.bindings.onSaved = onSaved;
    holderRef.current.bindings.onError = onError;
  }

  useEffect(() => {
    const current = holderRef.current;
    if (!current || current.scopeKey === scopeKey) return;

    const next = createHolder(scopeKey, currentBindings);
    holderRef.current = next;
    setStatus("idle");
    setError(null);
    for (const queue of current.queues.values()) queue.dispose({ flush: true });
  // A committed scope change must capture that render's callbacks. Retired
  // holders keep their own bindings while their independent queues flush.
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [createHolder, scopeKey]);

  useEffect(() => {
    const holder = holderRef.current;
    if (!holder || holder.scopeKey !== scopeKey) return;
    const activeKeys = new Set<string>();
    const restoredValues: Array<{ value: T; savedValue: T | null }> = [];
    for (const value of values) {
      const key = holder.bindings.getKey(value);
      if (!key || activeKeys.has(key)) continue;
      activeKeys.add(key);
      let queue = holder.queues.get(key);
      if (!queue) {
        queue = createQueue(holder, key, value);
        holder.queues.set(key, queue);
      }
      if (!enabled || validateRef.current?.(value, key) === false) {
        queue.pause();
        continue;
      }
      const draftKey = `${holder.scopeKey}:${key}`;
      const cached = getAutosaveDraft<T>(draftKey);
      const shouldRestore = holder.pendingRestoreKeys.delete(key);
      const writerId = holder.writerIds.get(key);
      if (!writerId) continue;
      const currentFingerprint = holder.bindings.fingerprint(value);
      if (shouldRestore && cached) {
        if (
          cached.fingerprint !== currentFingerprint
          && restoreDraftsRef.current
        ) {
          // Keyed consumers receive the cache baseline and merge only the
          // user's changed fields into the current server value. This also
          // preserves a draft when another client changed unrelated fields.
          // Never schedule the raw cached object before that merge render.
          queue.pause();
          restoredValues.push({ value: cached.value, savedValue: cached.savedValue });
          continue;
        }
        discardAutosaveDraft(draftKey, writerId);
      }
      rememberAutosaveDraft(
        draftKey,
        value,
        currentFingerprint,
        queue.getSavedFingerprint(),
        queue.getSavedValue(),
        writerId
      );
      queue.schedule(value);
      queue.resume();
    }
    if (restoredValues.length > 0) restoreDraftsRef.current?.(restoredValues);
    for (const [key, queue] of holder.queues) {
      if (activeKeys.has(key)) continue;
      queue.dispose({ flush: false });
      holder.queues.delete(key);
      holder.writerIds.delete(key);
    }
    publishAggregateStatus(holder);
  }, [createQueue, enabled, publishAggregateStatus, scopeKey, validate, values]);

  useEffect(() => {
    const flushPending = () => {
      const queues = [...(holderRef.current?.queues.values() ?? [])];
      void Promise.all(queues.map((queue) => queue.flush()));
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
      for (const queue of holderRef.current?.queues.values() ?? []) {
        queue.dispose({ flush: true });
      }
    };
  }, []);

  const flushKeys = useCallback(async (keys: Iterable<string>) => {
    const queues = holderRef.current?.queues;
    if (!queues) return true;
    const selected = [...new Set(keys)].flatMap((key) => {
      const queue = queues.get(key);
      return queue ? [queue] : [];
    });
    const results = await Promise.all(selected.map((queue) => queue.flush()));
    return results.every(Boolean);
  }, []);

  const flush = useCallback(() => {
    const keys = holderRef.current?.queues.keys() ?? [];
    return flushKeys(keys);
  }, [flushKeys]);

  const flushValues = useCallback(async (nextValues: readonly T[]) => {
    const holder = holderRef.current;
    if (!holder) return true;
    const selected: LatestAutosaveQueue<T, Result>[] = [];
    for (const value of nextValues) {
      const key = holder.bindings.getKey(value);
      if (!key || validateRef.current?.(value, key) === false) return false;
      const queue = holder.queues.get(key);
      if (!queue) continue;
      const writerId = holder.writerIds.get(key);
      if (!writerId) continue;
      rememberAutosaveDraft(
        `${holder.scopeKey}:${key}`,
        value,
        holder.bindings.fingerprint(value),
        queue.getSavedFingerprint(),
        queue.getSavedValue(),
        writerId
      );
      queue.schedule(value);
      queue.resume();
      selected.push(queue);
    }
    const results = await Promise.all(selected.map((queue) => queue.flush()));
    return results.every(Boolean);
  }, []);

  const retryKeys = useCallback((keys: Iterable<string>) => {
    const queues = holderRef.current?.queues;
    if (!queues) return;
    for (const key of new Set(keys)) queues.get(key)?.retry();
  }, []);

  const retry = useCallback(() => {
    const keys = holderRef.current?.queues.keys() ?? [];
    retryKeys(keys);
  }, [retryKeys]);

  const markSaved = useCallback((savedValues: readonly T[]) => {
    const holder = holderRef.current;
    if (!holder) return;
    for (const value of savedValues) {
      const key = holder.bindings.getKey(value);
      if (!key) continue;
      let queue = holder.queues.get(key);
      if (!queue) {
        queue = createQueue(holder, key, value);
        holder.queues.set(key, queue);
      }
      queue.markSaved(value);
      const writerId = holder.writerIds.get(key);
      if (writerId) {
        settleAutosaveDraft(
          `${holder.scopeKey}:${key}`,
          holder.bindings.fingerprint(value),
          value,
          writerId
        );
      }
    }
    publishAggregateStatus(holder);
  }, [createQueue, publishAggregateStatus]);

  return {
    status,
    error,
    flush,
    flushKeys,
    flushValues,
    retry,
    retryKeys,
    markSaved,
    isPending: status === "dirty" || status === "saving",
    isError: status === "error"
  };
}

function defaultFingerprint<T>(value: T) {
  return JSON.stringify(value);
}
