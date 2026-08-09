export type AutosaveConflictKind =
  | "scene-item"
  | "scene-reference"
  | "staff-member"
  | "staff-department"
  | "scenario-asset"
  | "daily-plan";

/** 최신 서버 snapshot을 보존하되 편집 중인 local draft는 호출부가 유지하도록 하는 typed conflict입니다. */
export class AutosaveConflictError<T> extends Error {
  readonly kind: AutosaveConflictKind;
  readonly latest: T | null;

  constructor(kind: AutosaveConflictKind, message: string, latest: T | null) {
    super(message);
    this.name = "AutosaveConflictError";
    this.kind = kind;
    this.latest = latest;
  }
}
