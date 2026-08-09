export type SceneListEditorKeyAction =
  | "allow"
  | "exit"
  | "defer-enter-exit"
  | "ime-only";

export type SceneListEditorKeyInput = {
  key: string;
  shiftKey?: boolean;
  multiline?: boolean;
  compositionActive?: boolean;
  compositionJustEnded?: boolean;
  nativeIsComposing?: boolean;
  legacyKeyCode?: number;
};

export type SceneListCompositionEndResult = {
  replacementValue: string | null;
  shouldExit: boolean;
};

export function getSceneListEditorKeyAction({
  key,
  shiftKey = false,
  multiline = false,
  compositionActive = false,
  compositionJustEnded = false,
  nativeIsComposing = false,
  legacyKeyCode
}: SceneListEditorKeyInput): SceneListEditorKeyAction {
  const isImeBoundary = compositionActive
    || compositionJustEnded
    || nativeIsComposing
    || legacyKeyCode === 229;

  if (key === "Enter") {
    if (isImeBoundary) return "defer-enter-exit";
    if (multiline && shiftKey) return "allow";
    return "exit";
  }

  if (key === "Escape") {
    return isImeBoundary ? "ime-only" : "exit";
  }

  return "allow";
}

export function resolveSceneListCompositionEnd(
  controlledValue: string,
  completedDomValue: string,
  pendingEnterExit: boolean
): SceneListCompositionEndResult {
  return {
    replacementValue: completedDomValue === controlledValue ? null : completedDomValue,
    shouldExit: pendingEnterExit
  };
}
