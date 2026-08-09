export type ContextualGuideRequestSource = "auto" | "feature" | "replay";

/** Automatic/feature guides become learned when the user intentionally exits them. */
export function shouldLearnGuideOnExit(source: ContextualGuideRequestSource) {
  return source !== "replay";
}

/** Keeps the existing string-array storage format while tolerating malformed legacy values. */
export function parseCompletedGuideTokens(serialized: string | null) {
  if (!serialized) return new Set<string>();
  try {
    const value = JSON.parse(serialized) as unknown;
    return new Set(
      Array.isArray(value)
        ? value.filter((item): item is string => typeof item === "string" && item.length > 0)
        : []
    );
  } catch {
    return new Set<string>();
  }
}

/** Completion is monotonic, so stale tabs may add tokens but never remove another tab's tokens. */
export function mergeCompletedGuideTokens(
  ...collections: ReadonlyArray<Iterable<string>>
) {
  const merged = new Set<string>();
  for (const collection of collections) {
    for (const token of collection) {
      if (token) merged.add(token);
    }
  }
  return merged;
}

export function serializeCompletedGuideTokens(tokens: Iterable<string>) {
  return JSON.stringify(Array.from(new Set(tokens)).sort());
}

/** Main sequences keep their semantic order while filtering completed and duplicate IDs. */
export function getPendingGuideIds<T extends string>(
  ids: readonly T[],
  isCompleted: (id: T) => boolean
) {
  const seen = new Set<T>();
  return ids.filter((id) => {
    if (seen.has(id)) return false;
    seen.add(id);
    return !isCompleted(id);
  });
}
