export type InteractionGuideSession<T> = {
  steps: readonly T[];
  index: number;
};

/** Manual tours are ephemeral snapshots. Starting again always begins at step 1. */
export function startInteractionGuideSession<T>(
  steps: readonly T[]
): InteractionGuideSession<T> | null {
  return steps.length > 0 ? { steps: [...steps], index: 0 } : null;
}

export function moveInteractionGuideSession<T>(
  session: InteractionGuideSession<T>,
  direction: -1 | 1
): InteractionGuideSession<T> {
  const index = Math.min(
    session.steps.length - 1,
    Math.max(0, session.index + direction)
  );
  return index === session.index ? session : { ...session, index };
}

/**
 * When dynamic content disappears, continue with the next still-valid target.
 * Returning null cleanly ends a tour whose remaining targets are all gone.
 */
export function skipUnavailableInteractionGuideSteps<T>(
  session: InteractionGuideSession<T>,
  isAvailable: (step: T) => boolean
): InteractionGuideSession<T> | null {
  for (let index = session.index + 1; index < session.steps.length; index += 1) {
    if (isAvailable(session.steps[index])) return { ...session, index };
  }
  return null;
}
