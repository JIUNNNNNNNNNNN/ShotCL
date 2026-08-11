import type { JoinAccessReason } from "./core.ts";

export type ProjectAccountPresentationStatus =
  | "loading"
  | "unavailable"
  | "anonymous"
  | "syncing"
  | "authenticated"
  | "error";

export type ProjectAccountPermissionNotice =
  | {
    kind: "google-required";
    title: "Google 로그인이 필요합니다.";
    description: "Key staff 비밀번호가 확인되었습니다. 수정·관리 권한을 사용하려면 승인된 Google 계정으로 로그인해 주세요.";
    actionLabel: "Google 로그인";
  }
  | {
    kind: "editor-permission-required";
    title: "수정 권한이 필요합니다.";
    description: "Google 로그인은 완료되었습니다. 이 계정은 현재 수정 권한이 승인되지 않았습니다. 권한이 필요하면 프로젝트 관리자에게 요청해 주세요.";
    actionLabel: null;
  };

export const GOOGLE_REQUIRED_PROJECT_NOTICE: ProjectAccountPermissionNotice = {
  kind: "google-required",
  title: "Google 로그인이 필요합니다.",
  description: "Key staff 비밀번호가 확인되었습니다. 수정·관리 권한을 사용하려면 승인된 Google 계정으로 로그인해 주세요.",
  actionLabel: "Google 로그인"
};

export const EDITOR_PERMISSION_PROJECT_NOTICE: ProjectAccountPermissionNotice = {
  kind: "editor-permission-required",
  title: "수정 권한이 필요합니다.",
  description: "Google 로그인은 완료되었습니다. 이 계정은 현재 수정 권한이 승인되지 않았습니다. 권한이 필요하면 프로젝트 관리자에게 요청해 주세요.",
  actionLabel: null
};

/**
 * Auth failure와 editor permission을 섞지 않는 project account presentation입니다.
 * Join intent는 현재 프로젝트에서만 유효하며 Guest·일반 Staff에는 강한 안내를 만들지 않습니다.
 */
export function resolveProjectAccountPermissionNotice(input: {
  projectId: string;
  joinNoticeProjectId: string | null;
  joinReason: JoinAccessReason;
  isGuest: boolean;
  status: ProjectAccountPresentationStatus;
  isGoogle: boolean;
  editorAllowed: boolean;
}): ProjectAccountPermissionNotice | null {
  if (input.isGuest) return null;
  if (
    input.status === "loading"
    || input.status === "syncing"
    || input.status === "error"
    || input.status === "unavailable"
  ) return null;

  const hasCurrentProjectKeyStaffIntent = input.joinReason === "key_staff_google_required"
    && input.joinNoticeProjectId === input.projectId;

  if (input.status === "anonymous" && !input.isGoogle && hasCurrentProjectKeyStaffIntent) {
    return GOOGLE_REQUIRED_PROJECT_NOTICE;
  }
  if (input.status === "authenticated" && input.isGoogle && !input.editorAllowed) {
    return EDITOR_PERMISSION_PROJECT_NOTICE;
  }
  return null;
}
