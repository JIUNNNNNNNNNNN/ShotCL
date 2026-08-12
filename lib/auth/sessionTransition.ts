export type BackgroundAccountSyncInput = {
  authEvent: string | null;
  requestedProjectId: string | null;
  synchronizedProjectId: string | null;
  synchronizedUserId: string;
  nextUserId: string;
  previousEditorEligible: boolean | null;
};

/**
 * A refreshed JWT for the already-resolved account still needs to rotate the
 * server HttpOnly session, but it must not temporarily revoke the client
 * capability. A project hint is excluded unless it was already synchronized:
 * a new hint can link membership and is therefore a foreground transition.
 */
export function shouldUseBackgroundAccountSync(input: BackgroundAccountSyncInput) {
  return input.authEvent === "TOKEN_REFRESHED"
    && input.previousEditorEligible !== null
    && Boolean(input.nextUserId)
    && input.synchronizedUserId === input.nextUserId
    && (
      !input.requestedProjectId
      || input.requestedProjectId === input.synchronizedProjectId
    );
}

export type AccountGenerationTransitionInput = {
  background: boolean;
  previousUserId: string;
  nextUserId: string;
  previousEditorEligible: boolean | null;
  nextEditorEligible: boolean;
};

/** Account consumers invalidate only when the resolved identity/capability changed. */
export function shouldAdvanceAccountGeneration(input: AccountGenerationTransitionInput) {
  if (!input.background) return true;
  return input.previousUserId !== input.nextUserId
    || input.previousEditorEligible === null
    || input.previousEditorEligible !== input.nextEditorEligible;
}
