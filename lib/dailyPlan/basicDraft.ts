import { decodeDailyPlanMemo, encodeDailyPlanMemo, normalizeDailyPlanPrintMeta, type DailyPlanPrintMeta } from "@/lib/dailyPlan/printMeta";
import type { DailyPlan, DailyPlanDraft } from "@/lib/types";

export type DailyPlanBasicValues = {
  title: string;
  episode: string;
  shootingDate: string;
  callTime: string;
  totalCrew: string;
  director: string;
  directorContact: string;
  assistantDirector: string;
  assistantDirectorContact: string;
  production: string;
  producerContact: string;
};

type StoredBasicDraft = {
  draft: DailyPlanDraft;
  savedAt: string;
};

type StoredEditorSnapshot = {
  plan?: DailyPlanDraft;
  printMeta?: DailyPlanPrintMeta;
  savedAt?: string;
};

const BASIC_DRAFT_PREFIX = "today-board:daily-plan-basic-draft";
const EDITOR_DRAFT_PREFIX = "today-board:daily-plan-draft";

export function dailyPlanToDraft(plan: DailyPlan): DailyPlanDraft {
  return {
    title: plan.title,
    sourceType: plan.sourceType,
    sourceFileName: plan.sourceFileName,
    shootingDate: plan.shootingDate,
    episode: plan.episode,
    director: plan.director,
    dop: plan.dop,
    assistantDirector: plan.assistantDirector,
    production: plan.production,
    callTime: plan.callTime,
    shootStartTime: plan.shootStartTime,
    shootEndTime: plan.shootEndTime,
    meetingLocation: plan.meetingLocation,
    shootingLocation: plan.shootingLocation,
    shootingLocations: plan.shootingLocations ?? [],
    mealTime: plan.mealTime,
    mealTimes: plan.mealTimes ?? [],
    safetyNotice: plan.safetyNotice,
    memo: plan.memo
  };
}

export function getDailyPlanBasicValues(draft: DailyPlanDraft): DailyPlanBasicValues {
  const meta = decodeDailyPlanMemo(draft.memo);
  return {
    title: draft.title,
    episode: meta.day || draft.episode,
    shootingDate: draft.shootingDate,
    callTime: draft.callTime,
    totalCrew: meta.totalCrew,
    director: draft.director,
    directorContact: meta.directorContact,
    assistantDirector: draft.assistantDirector,
    assistantDirectorContact: meta.assistantDirectorContact,
    production: draft.production,
    producerContact: meta.producerContact
  };
}

export function applyDailyPlanBasicValues(draft: DailyPlanDraft, values: DailyPlanBasicValues): DailyPlanDraft {
  const meta = decodeDailyPlanMemo(draft.memo);
  return {
    ...draft,
    title: values.title.trim(),
    episode: values.episode.trim(),
    shootingDate: values.shootingDate,
    callTime: values.callTime,
    director: values.director.trim(),
    assistantDirector: values.assistantDirector.trim(),
    production: values.production.trim(),
    memo: encodeDailyPlanMemo({
      ...meta,
      day: values.episode.trim(),
      totalCrew: onlyDigits(values.totalCrew, 4),
      directorContact: values.directorContact,
      assistantDirectorContact: values.assistantDirectorContact,
      producerContact: values.producerContact
    })
  };
}

/** 로컬 편집 복구본 위에 별도 기본 정보 페이지의 최신 값만 덮어씁니다. */
export function mergeDailyPlanBasicDraft(
  restoredPlan: DailyPlanDraft,
  restoredMeta: DailyPlanPrintMeta,
  basicDraft: DailyPlanDraft
) {
  const basicMeta = decodeDailyPlanMemo(basicDraft.memo);
  return {
    plan: {
      ...restoredPlan,
      title: basicDraft.title,
      episode: basicDraft.episode,
      shootingDate: basicDraft.shootingDate,
      callTime: basicDraft.callTime,
      director: basicDraft.director,
      assistantDirector: basicDraft.assistantDirector,
      production: basicDraft.production
    },
    printMeta: normalizeDailyPlanPrintMeta({
      ...restoredMeta,
      day: basicMeta.day,
      totalCrew: basicMeta.totalCrew,
      directorContact: basicMeta.directorContact,
      assistantDirectorContact: basicMeta.assistantDirectorContact,
      producerContact: basicMeta.producerContact
    })
  };
}

export function readNewDailyPlanBasicDraft(projectId: string): DailyPlanDraft | null {
  if (typeof window === "undefined") return null;

  const storedBasic = parseStoredBasicDraft(window.sessionStorage.getItem(getBasicDraftKey(projectId)));
  const editorSnapshot = parseEditorSnapshot(window.localStorage.getItem(getEditorDraftKey(projectId)));
  if (!editorSnapshot?.plan || !editorSnapshot.printMeta) return storedBasic?.draft ?? null;

  const editorDraft: DailyPlanDraft = {
    ...editorSnapshot.plan,
    memo: encodeDailyPlanMemo(editorSnapshot.printMeta)
  };
  if (!storedBasic) return editorDraft;

  const basicSavedAt = Date.parse(storedBasic.savedAt);
  const editorSavedAt = Date.parse(editorSnapshot.savedAt ?? "");
  return Number.isFinite(editorSavedAt) && editorSavedAt > basicSavedAt ? editorDraft : storedBasic.draft;
}

export function writeNewDailyPlanBasicDraft(projectId: string, draft: DailyPlanDraft) {
  if (typeof window === "undefined") return;
  const stored: StoredBasicDraft = { draft, savedAt: new Date().toISOString() };
  window.sessionStorage.setItem(getBasicDraftKey(projectId), JSON.stringify(stored));
}

export function clearNewDailyPlanBasicDraft(projectId: string) {
  if (typeof window === "undefined") return;
  window.sessionStorage.removeItem(getBasicDraftKey(projectId));
}

function getBasicDraftKey(projectId: string) {
  return `${BASIC_DRAFT_PREFIX}:${projectId}`;
}

function getEditorDraftKey(projectId: string) {
  return `${EDITOR_DRAFT_PREFIX}:${projectId}:new`;
}

function parseStoredBasicDraft(value: string | null): StoredBasicDraft | null {
  if (!value) return null;
  try {
    const parsed = JSON.parse(value) as Partial<StoredBasicDraft>;
    return parsed.draft && parsed.savedAt ? { draft: parsed.draft, savedAt: parsed.savedAt } : null;
  } catch {
    return null;
  }
}

function parseEditorSnapshot(value: string | null): StoredEditorSnapshot | null {
  if (!value) return null;
  try {
    return JSON.parse(value) as StoredEditorSnapshot;
  } catch {
    return null;
  }
}

function onlyDigits(value: string, maxLength: number) {
  return String(value ?? "").replace(/\D/g, "").slice(0, maxLength);
}
