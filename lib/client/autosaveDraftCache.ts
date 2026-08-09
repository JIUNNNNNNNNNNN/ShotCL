export type AutosaveDraftRecord<T> = {
  value: T;
  fingerprint: string;
  savedFingerprint: string;
  savedValue: T | null;
  writerId: number;
};

// Route transitions can unmount an editor while its non-blocking flush is in
// flight. Keep only the latest local snapshot in memory so reopening the same
// entity restores the unsaved value without adding a database/query layer.
const draftCache = new Map<string, AutosaveDraftRecord<unknown>>();
let nextWriterId = 0;

/**
 * 같은 entity가 route 전환 중 잠시 두 editor에 의해 flush될 수 있으므로
 * cache mutation의 소유자를 단조 증가하는 id로 구분합니다.
 */
export function createAutosaveDraftWriterId() {
  nextWriterId += 1;
  return nextWriterId;
}

export function getAutosaveDraft<T>(key: string): AutosaveDraftRecord<T> | null {
  return (draftCache.get(key) as AutosaveDraftRecord<T> | undefined) ?? null;
}

export function rememberAutosaveDraft<T>(
  key: string,
  value: T,
  fingerprint: string,
  savedFingerprint: string,
  savedValue: T | null,
  writerId: number
) {
  const current = draftCache.get(key);
  if (current && current.writerId > writerId) return;
  if (fingerprint === savedFingerprint) {
    if (!current || current.writerId <= writerId) draftCache.delete(key);
    return;
  }
  draftCache.set(key, {
    value,
    fingerprint,
    savedFingerprint,
    savedValue,
    writerId
  });
}

/** 현재 UI가 cache의 저장 기준값 그대로일 때에만 안전하게 복원할 수 있습니다. */
export function canRestoreAutosaveDraft<T>(
  draft: AutosaveDraftRecord<T>,
  currentFingerprint: string
) {
  return draft.savedFingerprint === currentFingerprint
    && draft.fingerprint !== currentFingerprint;
}

/**
 * 저장 성공 시 같은 writer의 더 최신 초안은 유지하면서 기준값만 전진시킵니다.
 * 이전 route의 늦은 응답은 더 새 writer가 만든 cache를 변경할 수 없습니다.
 */
export function settleAutosaveDraft<T>(
  key: string,
  savedFingerprint: string,
  savedValue: T,
  writerId: number
) {
  const current = draftCache.get(key);
  if (!current || current.writerId > writerId) return;
  if (current.fingerprint === savedFingerprint) {
    draftCache.delete(key);
    return;
  }
  draftCache.set(key, {
    ...current,
    savedFingerprint,
    savedValue,
    writerId
  });
}

/** 호환되지 않는 이전 초안을 새 editor만 폐기할 수 있게 합니다. */
export function discardAutosaveDraft(key: string, writerId: number) {
  const current = draftCache.get(key);
  if (current && current.writerId <= writerId) draftCache.delete(key);
}
