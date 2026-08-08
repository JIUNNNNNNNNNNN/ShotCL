export type VisibleSelectionGroup<Key extends string> = {
  key: string;
  itemKeys: readonly Key[];
};

export function visibleSelectionOrder<Key extends string>(
  groups: readonly VisibleSelectionGroup<Key>[],
  collapsedGroupKeys: ReadonlySet<string>,
  trailingKeys: readonly Key[] = []
): Key[] {
  const seen = new Set<Key>();
  const orderedKeys: Key[] = [];
  const append = (key: Key) => {
    if (seen.has(key)) return;
    seen.add(key);
    orderedKeys.push(key);
  };

  for (const group of groups) {
    if (collapsedGroupKeys.has(group.key)) continue;
    for (const key of group.itemKeys) append(key);
  }
  for (const key of trailingKeys) append(key);
  return orderedKeys;
}

export function inclusiveVisibleSelectionRange<Key extends string>(
  visibleKeys: readonly Key[],
  anchorKey: Key | null,
  targetKey: Key
): Key[] {
  const targetIndex = visibleKeys.indexOf(targetKey);
  if (targetIndex < 0) return [];

  if (!anchorKey) return [targetKey];
  const anchorIndex = visibleKeys.indexOf(anchorKey);
  if (anchorIndex < 0) return [targetKey];

  const startIndex = Math.min(anchorIndex, targetIndex);
  const endIndex = Math.max(anchorIndex, targetIndex);
  return visibleKeys.slice(startIndex, endIndex + 1);
}

export function retainVisibleSelection<Key extends string>(
  currentSelection: ReadonlySet<Key>,
  visibleKeySet: ReadonlySet<Key>
): Set<Key> {
  return new Set([...currentSelection].filter((key) => visibleKeySet.has(key)));
}

export function finderSelectionUpdate<Key extends string>({
  currentSelection,
  visibleKeys,
  anchorKey,
  targetKey,
  shiftKey,
  additive
}: {
  currentSelection: ReadonlySet<Key>;
  visibleKeys: readonly Key[];
  anchorKey: Key | null;
  targetKey: Key;
  shiftKey: boolean;
  additive: boolean;
}): { selection: Set<Key>; anchorKey: Key } | null {
  if (!visibleKeys.includes(targetKey)) return null;

  if (shiftKey) {
    const range = inclusiveVisibleSelectionRange(visibleKeys, anchorKey, targetKey);
    if (range.length === 0) return null;
    const selection = additive ? new Set(currentSelection) : new Set<Key>();
    for (const key of range) selection.add(key);
    return {
      selection,
      anchorKey: anchorKey && visibleKeys.includes(anchorKey) ? anchorKey : targetKey
    };
  }

  if (additive) {
    const selection = new Set(currentSelection);
    if (selection.has(targetKey)) selection.delete(targetKey);
    else selection.add(targetKey);
    return { selection, anchorKey: targetKey };
  }

  return { selection: new Set([targetKey]), anchorKey: targetKey };
}
