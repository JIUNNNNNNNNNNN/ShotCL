"use client";

const PROJECT_DELETION_NOTICE_KEY = "shotcl:projectDeletionNotice";
const PROJECT_DELETION_NOTICE = "프로젝트와 모든 데이터가 영구 삭제되었습니다.";

/** Hard navigation을 건너 Main에서 한 번만 보여주는 dependency-free 안내입니다. */
export function setProjectDeletionMainNotice() {
  if (typeof window === "undefined") return;
  try {
    window.sessionStorage.setItem(PROJECT_DELETION_NOTICE_KEY, PROJECT_DELETION_NOTICE);
  } catch {
    // The navigation remains valid when sessionStorage is unavailable.
  }
}

export function consumeProjectDeletionMainNotice() {
  if (typeof window === "undefined") return "";
  try {
    const notice = window.sessionStorage.getItem(PROJECT_DELETION_NOTICE_KEY) ?? "";
    window.sessionStorage.removeItem(PROJECT_DELETION_NOTICE_KEY);
    return notice === PROJECT_DELETION_NOTICE ? notice : "";
  } catch {
    return "";
  }
}
