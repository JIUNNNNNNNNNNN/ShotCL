export const PROJECT_PERMANENT_DELETE_CONFIRMATION_PHRASE = "영구 삭제";

export type ProjectPermanentDeletionConfirmation = {
  projectName: string;
  confirmationPhrase: typeof PROJECT_PERMANENT_DELETE_CONFIRMATION_PHRASE;
};

/**
 * The destructive endpoint accepts only the two confirmation fields. Owner
 * identity and the deletion target always come from the authenticated request
 * and route UUID, never from browser-provided flags or user IDs.
 */
export function parseProjectPermanentDeletionConfirmation(
  value: unknown
): ProjectPermanentDeletionConfirmation | null {
  if (!value || typeof value !== "object" || Array.isArray(value)) return null;
  const source = value as Record<string, unknown>;
  const keys = Object.keys(source).sort();
  if (
    keys.length !== 2
    || keys[0] !== "confirmationPhrase"
    || keys[1] !== "projectName"
  ) return null;
  if (
    typeof source.projectName !== "string"
    || typeof source.confirmationPhrase !== "string"
  ) return null;

  const projectName = source.projectName.trim();
  if (
    !projectName
    || source.confirmationPhrase !== PROJECT_PERMANENT_DELETE_CONFIRMATION_PHRASE
  ) return null;

  return {
    projectName,
    confirmationPhrase: PROJECT_PERMANENT_DELETE_CONFIRMATION_PHRASE
  };
}

/** Every persisted upload path in the current app is under one of these UUID namespaces. */
export function getProjectStoragePrefixes(projectId: string) {
  return [
    `projects/${projectId}`,
    `storyboard-files/${projectId}`
  ] as const;
}
