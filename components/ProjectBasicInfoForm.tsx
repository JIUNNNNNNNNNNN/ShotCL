"use client";

import { FormEvent, memo, useCallback, useEffect, useMemo, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { Check, ChevronDown, Plus, Save, Trash2, X } from "lucide-react";
import { AutosaveStatus } from "@/components/AutosaveStatus";
import { useProjectDeleteUndo } from "@/components/ProjectDeleteUndoProvider";
import { Button } from "@/components/ui/Button";
import { useAutosave } from "@/hooks/useAutosave";
import {
  deleteProjectBasicInfoEntity,
  finalizeDeletedProjectBasicInfoEntity,
  restoreDeletedProjectBasicInfoEntity
} from "@/lib/data/projects";
import { formatKoreanPhoneNumber } from "@/lib/formatKoreanPhoneNumber";
import {
  createBlankProjectActor,
  createBlankProjectMainStaffMember,
  formatMainStaffEpisodeSummary,
  getDailyPlanMainStaffEpisodeViolations,
  normalizeMainStaffEpisodeNumbers,
  validateProjectBasicInfo
} from "@/lib/projectBasicInfo";
import type { ProjectActor, ProjectBasicInfo, ProjectMainStaffMember } from "@/lib/types";
import {
  useAutoContextualGuide,
  useContextualGuide,
  useContextualGuideAnchor,
  useContextualGuideBlocker
} from "@/components/guides/ContextualGuideProvider";

type ProjectBasicInfoFormProps = {
  projectId: string;
  projectName: string;
  initialValue: ProjectBasicInfo;
  onAutoSave: (value: ProjectBasicInfo) => Promise<void>;
  onComplete: () => void;
};

type ProjectBasicInfoDraft = {
  value: ProjectBasicInfo;
  totalEpisodesDraft: string;
};

const fieldClass =
  "min-h-11 w-full min-w-0 border border-field-border bg-field-input px-3 py-2 text-center text-sm text-field-text outline-none transition focus:border-field-primary focus:ring-2 focus:ring-field-primary/25";

/** 일촬표와 분리된 프로젝트 단위 기본정보만 편집합니다. */
export function ProjectBasicInfoForm({ projectId, projectName, initialValue, onAutoSave, onComplete }: ProjectBasicInfoFormProps) {
  const { deleteWithUndo } = useProjectDeleteUndo();
  const [value, setValue] = useState<ProjectBasicInfo>(() => normalizeProjectBasicInfoForForm(initialValue));
  const [totalEpisodesDraft, setTotalEpisodesDraft] = useState(String(initialValue.totalEpisodes));
  const [isSaving, setIsSaving] = useState(false);
  const [isDraftHydrated, setIsDraftHydrated] = useState(false);
  const [errorMessage, setErrorMessage] = useState("");
  const [isComposing, setIsComposing] = useState(false);
  const [pendingEntityDeleteCount, setPendingEntityDeleteCount] = useState(0);
  const [openEpisodeStaffId, setOpenEpisodeStaffId] = useState<string | null>(null);
  const valueRef = useRef(value);
  const totalEpisodesDraftRef = useRef(totalEpisodesDraft);
  valueRef.current = value;
  totalEpisodesDraftRef.current = totalEpisodesDraft;
  const basicInfoGuideAnchor = useContextualGuideAnchor<HTMLFormElement>("basic-info.form");
  const { completeGuide } = useContextualGuide();
  const basicInfoGuideUseful = useMemo(() => {
    const hasStaff = initialValue.mainStaff.some((member) => (
      member.role.trim() || member.name.trim() || member.phone.trim()
    ));
    const hasActor = initialValue.actors.some((actor) => actor.role.trim() || actor.name.trim());
    return initialValue.totalEpisodes < 1
      || !initialValue.shootingStartDate
      || !initialValue.shootingEndDate
      || (!hasStaff && !hasActor);
  }, [initialValue]);
  useAutoContextualGuide("basic-info.intro", basicInfoGuideUseful);
  useContextualGuideBlocker("basic-info-episode-selector", openEpisodeStaffId !== null);
  const selectableTotalEpisodes = parseSelectableTotalEpisodes(totalEpisodesDraft);
  const episodeLimitViolations = useMemo(
    () => selectableTotalEpisodes
      ? getDailyPlanMainStaffEpisodeViolations(value.mainStaff, selectableTotalEpisodes)
      : [],
    [selectableTotalEpisodes, value.mainStaff]
  );
  const autosaveDraft = useMemo<ProjectBasicInfoDraft>(() => ({ value, totalEpisodesDraft }), [totalEpisodesDraft, value]);
  const draftStorageKey = `shotcl:autosave:project-basic-info:${projectId}`;
  const initialDraftFingerprint = useMemo(() => projectBasicInfoDraftFingerprint({
    value: normalizeProjectBasicInfoForForm(initialValue),
    totalEpisodesDraft: String(initialValue.totalEpisodes)
  }), [initialValue]);

  useEffect(() => {
    try {
      const raw = window.sessionStorage.getItem(draftStorageKey);
      if (raw) {
        const restored = JSON.parse(raw) as ProjectBasicInfoDraft;
        const validation = validateProjectBasicInfo({
          ...restored.value,
          totalEpisodes: Number(restored.totalEpisodesDraft)
        });
        if (validation.ok && projectBasicInfoDraftFingerprint(restored) !== initialDraftFingerprint) {
          setValue({
            ...restored.value,
            mainStaff: restored.value.mainStaff.map((member) => ({
              ...member,
              phone: formatKoreanPhoneNumber(member.phone)
            }))
          });
          setTotalEpisodesDraft(restored.totalEpisodesDraft);
        } else {
          window.sessionStorage.removeItem(draftStorageKey);
        }
      }
    } catch {
      window.sessionStorage.removeItem(draftStorageKey);
    } finally {
      setIsDraftHydrated(true);
    }
  }, [draftStorageKey, initialDraftFingerprint]);

  useEffect(() => {
    if (!isDraftHydrated) return;
    try {
      if (projectBasicInfoDraftFingerprint(autosaveDraft) === initialDraftFingerprint) {
        window.sessionStorage.removeItem(draftStorageKey);
      } else {
        window.sessionStorage.setItem(draftStorageKey, JSON.stringify(autosaveDraft));
      }
    } catch {
      // Storage availability must never block editing or background save.
    }
  }, [autosaveDraft, draftStorageKey, initialDraftFingerprint, isDraftHydrated]);

  const autosave = useAutosave<ProjectBasicInfoDraft>({
    value: autosaveDraft,
    enabled: !isComposing && !isSaving && pendingEntityDeleteCount === 0,
    delayMs: 700,
    scopeKey: `project-basic-info:${projectId}`,
    validate: (draft) => validateProjectBasicInfo({
      ...draft.value,
      totalEpisodes: Number(draft.totalEpisodesDraft)
    }).ok,
    save: async (draft) => {
      const validation = validateProjectBasicInfo({
        ...draft.value,
        totalEpisodes: Number(draft.totalEpisodesDraft)
      });
      if (!validation.ok) throw new Error(validation.error);
      await onAutoSave(validation.value);
    },
    onSaved: (_result, savedDraft, meta) => {
      if (meta.isLatest) {
        setErrorMessage("");
        try {
          if (projectBasicInfoDraftFingerprint(savedDraft) === projectBasicInfoDraftFingerprint(autosaveDraft)) {
            window.sessionStorage.removeItem(draftStorageKey);
          }
        } catch {
          // Ignore unavailable storage; persistence already succeeded.
        }
      }
    },
    onError: (error) => {
      setErrorMessage(error instanceof Error ? error.message : "프로젝트 기본정보를 자동 저장하지 못했습니다.");
    }
  });

  const updateStaff = useCallback((index: number, field: keyof Pick<ProjectMainStaffMember, "role" | "name" | "phone" | "includeInDailyPlan">, nextValue: string | boolean) => {
    setErrorMessage("");
    setValue((current) => ({
      ...current,
      mainStaff: current.mainStaff.map((member, memberIndex) => (
        memberIndex === index
          ? {
            ...member,
            [field]: field === "phone" ? formatKoreanPhoneNumber(String(nextValue)) : nextValue
          }
          : member
      ))
    }));
  }, []);

  const updateStaffEpisodes = useCallback((staffId: string, episodeNumbers: number[] | null) => {
    setErrorMessage("");
    setValue((current) => ({
      ...current,
      mainStaff: current.mainStaff.map((member) => (
        member.id === staffId ? { ...member, episodeNumbers } : member
      ))
    }));
  }, []);

  const deleteStaff = useCallback((index: number) => {
    const currentStaff = valueRef.current.mainStaff;
    const member = currentStaff[index];
    if (!member) return;
    const beforeId = index > 0 ? currentStaff[index - 1].id : "";
    const afterId = index + 1 < currentStaff.length ? currentStaff[index + 1].id : "";
    const replacement = currentStaff.length === 1 ? createFormMainStaffMember() : null;
    const beforeDeleteDraft: ProjectBasicInfoDraft = {
      value: valueRef.current,
      totalEpisodesDraft: totalEpisodesDraftRef.current
    };
    const afterDeleteValue = {
      ...beforeDeleteDraft.value,
      mainStaff: currentStaff
        .filter((candidate) => candidate.id !== member.id)
        .map((candidate, sortOrder) => ({ ...candidate, sortOrder }))
    };
    const afterDeleteDraft: ProjectBasicInfoDraft = {
      value: {
        ...afterDeleteValue,
        mainStaff: afterDeleteValue.mainStaff.length > 0
          ? afterDeleteValue.mainStaff
          : replacement ? [replacement] : []
      },
      totalEpisodesDraft: beforeDeleteDraft.totalEpisodesDraft
    };
    const canMarkDeleteBaseline = validateProjectBasicInfo({
      ...beforeDeleteDraft.value,
      totalEpisodes: Number(beforeDeleteDraft.totalEpisodesDraft)
    }).ok;
    let receipt = "";
    let restoredLocally = false;
    let deleteFailed = false;
    let pendingReleased = false;
    const releasePending = () => {
      if (pendingReleased) return;
      pendingReleased = true;
      setPendingEntityDeleteCount((current) => Math.max(0, current - 1));
    };
    setOpenEpisodeStaffId(null);
    deleteWithUndo({
      key: `basic-info-main-staff:${member.id}`,
      label: member.name.trim() || member.role.trim() || "메인 스태프",
      removeLocal: () => {
        const current = valueRef.current;
        if (!current.mainStaff.some((candidate) => candidate.id === member.id)) return;
        const remaining = current.mainStaff.filter((candidate) => candidate.id !== member.id);
        const nextStaff = (remaining.length > 0 ? remaining : replacement ? [replacement] : [])
          .map((candidate, sortOrder) => ({ ...candidate, sortOrder }));
        const nextValue = { ...current, mainStaff: nextStaff };
        valueRef.current = nextValue;
        setValue(nextValue);
        setPendingEntityDeleteCount((current) => current + 1);
      },
      restoreLocal: () => {
        restoredLocally = true;
        const current = valueRef.current;
        if (!current.mainStaff.some((candidate) => candidate.id === member.id)) {
          const staffWithoutReplacement = replacement
            ? current.mainStaff.filter((candidate) => (
              candidate.id !== replacement.id || !areMainStaffSnapshotsEqual(candidate, replacement)
            ))
            : current.mainStaff;
          const nextStaff = insertMainStaffByAnchors(
            staffWithoutReplacement,
            member,
            beforeId,
            afterId,
            index
          ).map((candidate, sortOrder) => ({ ...candidate, sortOrder }));
          const nextValue = { ...current, mainStaff: nextStaff };
          valueRef.current = nextValue;
          setValue(nextValue);
        }
        if (deleteFailed) releasePending();
      },
      deleteRemote: async () => {
        try {
          await autosave.flush();
          receipt = await deleteProjectBasicInfoEntity(projectId, { kind: "staff", id: member.id });
          if (canMarkDeleteBaseline) {
            autosave.markSaved(restoredLocally ? beforeDeleteDraft : afterDeleteDraft);
          }
          releasePending();
        } catch (error) {
          deleteFailed = true;
          if (restoredLocally) releasePending();
          throw error;
        }
      },
      restoreRemote: async () => {
        await restoreDeletedProjectBasicInfoEntity(projectId, receipt);
        if (canMarkDeleteBaseline) autosave.markSaved(beforeDeleteDraft);
        releasePending();
      },
      finalize: () => finalizeDeletedProjectBasicInfoEntity(projectId, receipt)
    });
  }, [autosave, deleteWithUndo, projectId]);

  const updateTotalEpisodes = useCallback((nextDraft: string) => {
    const digits = nextDraft.replace(/\D/g, "").slice(0, 3);
    const nextTotalEpisodes = parseSelectableTotalEpisodes(digits);
    if (nextTotalEpisodes === null) {
      setTotalEpisodesDraft(digits);
      setOpenEpisodeStaffId(null);
      return;
    }

    setErrorMessage("");
    setTotalEpisodesDraft(digits);
    setOpenEpisodeStaffId(null);
    setValue((current) => ({
      ...current,
      totalEpisodes: nextTotalEpisodes,
      mainStaff: current.mainStaff.map((member) => ({
        ...member,
        episodeNumbers: member.episodeNumbers === null
          ? null
          : normalizeMainStaffEpisodeNumbers(
            member.episodeNumbers.filter((episode) => episode <= nextTotalEpisodes),
            nextTotalEpisodes
          )
      }))
    }));
  }, [value.mainStaff, value.totalEpisodes]);

  const updateActor = useCallback((index: number, field: keyof Pick<ProjectActor, "role" | "name">, nextValue: string) => {
    setValue((current) => ({
      ...current,
      actors: current.actors.map((actor, actorIndex) => (
        actorIndex === index ? { ...actor, [field]: nextValue } : actor
      ))
    }));
  }, []);

  const deleteActor = useCallback((index: number) => {
    const currentActors = valueRef.current.actors;
    const actor = currentActors[index];
    if (!actor) return;
    const beforeId = index > 0 ? currentActors[index - 1].id : "";
    const afterId = index + 1 < currentActors.length ? currentActors[index + 1].id : "";
    const replacement = currentActors.length === 1 ? createBlankProjectActor() : null;
    const beforeDeleteDraft: ProjectBasicInfoDraft = {
      value: valueRef.current,
      totalEpisodesDraft: totalEpisodesDraftRef.current
    };
    const remainingActors = currentActors.filter((candidate) => candidate.id !== actor.id);
    const afterDeleteDraft: ProjectBasicInfoDraft = {
      value: {
        ...beforeDeleteDraft.value,
        actors: remainingActors.length > 0 ? remainingActors : replacement ? [replacement] : []
      },
      totalEpisodesDraft: beforeDeleteDraft.totalEpisodesDraft
    };
    const canMarkDeleteBaseline = validateProjectBasicInfo({
      ...beforeDeleteDraft.value,
      totalEpisodes: Number(beforeDeleteDraft.totalEpisodesDraft)
    }).ok;
    let receipt = "";
    let restoredLocally = false;
    let deleteFailed = false;
    let pendingReleased = false;
    const releasePending = () => {
      if (pendingReleased) return;
      pendingReleased = true;
      setPendingEntityDeleteCount((current) => Math.max(0, current - 1));
    };
    deleteWithUndo({
      key: `basic-info-actor:${actor.id}`,
      label: actor.role.trim() || actor.name.trim() || "배우",
      removeLocal: () => {
        const current = valueRef.current;
        if (!current.actors.some((candidate) => candidate.id === actor.id)) return;
        const remaining = current.actors.filter((candidate) => candidate.id !== actor.id);
        const nextValue = {
          ...current,
          actors: remaining.length > 0 ? remaining : replacement ? [replacement] : []
        };
        valueRef.current = nextValue;
        setValue(nextValue);
        setPendingEntityDeleteCount((current) => current + 1);
      },
      restoreLocal: () => {
        restoredLocally = true;
        const current = valueRef.current;
        if (!current.actors.some((candidate) => candidate.id === actor.id)) {
          const actorsWithoutReplacement = replacement
            ? current.actors.filter((candidate) => (
              candidate.id !== replacement.id || !areActorSnapshotsEqual(candidate, replacement)
            ))
            : current.actors;
          const nextActors = insertActorByAnchors(
            actorsWithoutReplacement,
            actor,
            beforeId,
            afterId,
            index
          );
          const nextValue = { ...current, actors: nextActors };
          valueRef.current = nextValue;
          setValue(nextValue);
        }
        if (deleteFailed) releasePending();
      },
      deleteRemote: async () => {
        try {
          await autosave.flush();
          receipt = await deleteProjectBasicInfoEntity(projectId, { kind: "actor", id: actor.id });
          if (canMarkDeleteBaseline) {
            autosave.markSaved(restoredLocally ? beforeDeleteDraft : afterDeleteDraft);
          }
          releasePending();
        } catch (error) {
          deleteFailed = true;
          if (restoredLocally) releasePending();
          throw error;
        }
      },
      restoreRemote: async () => {
        await restoreDeletedProjectBasicInfoEntity(projectId, receipt);
        if (canMarkDeleteBaseline) autosave.markSaved(beforeDeleteDraft);
        releasePending();
      },
      finalize: () => finalizeDeletedProjectBasicInfoEntity(projectId, receipt)
    });
  }, [autosave, deleteWithUndo, projectId]);

  function handleSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setErrorMessage("");

    const validation = validateProjectBasicInfo({
      ...value,
      totalEpisodes: Number(totalEpisodesDraft)
    });
    if (!validation.ok) {
      setErrorMessage(validation.error);
      return;
    }

    setIsSaving(true);
    // Persist a recoverable tab-local draft before immediate navigation. The
    // exact current snapshot enters the background queue without awaiting it.
    try {
      window.sessionStorage.setItem(draftStorageKey, JSON.stringify(autosaveDraft));
    } catch {
      // Storage availability must not block completion/navigation.
    }
    void autosave.saveNow(autosaveDraft);
    completeGuide("basic-info.intro");
    onComplete();
  }

  return (
    <form
      ref={basicInfoGuideAnchor}
      noValidate
      onSubmit={handleSubmit}
      onBlurCapture={() => {
        if (!isComposing) void autosave.flush();
      }}
      onCompositionStart={() => setIsComposing(true)}
      onCompositionEnd={() => setIsComposing(false)}
      className="mx-auto grid w-full max-w-4xl gap-4"
    >
      <div className="flex flex-wrap items-center justify-center gap-2 px-1 text-center">
        <div className="min-w-0 text-center">
          <p className="ui-density-heading font-display font-black text-field-text">프로젝트 기본정보</p>
          <p className="mt-1 break-words text-sm text-field-muted [overflow-wrap:anywhere]">{projectName}</p>
        </div>
        <span className="rounded-md border border-field-border bg-field-panel px-3 py-1.5 text-xs text-field-muted">
          프로젝트 공통 정보
        </span>
      </div>

      <section className="ui-motion-surface rounded-[var(--radius-card)] border border-field-border bg-field-panel p-3 md:p-5">
        <div className="grid gap-3 md:grid-cols-[0.55fr_1fr_1fr]">
          <label className="grid gap-1.5">
            <span className="text-xs font-bold text-field-subtle">총회차</span>
            <input
              className={fieldClass}
              type="text"
              inputMode="numeric"
              pattern="[0-9]*"
              value={totalEpisodesDraft}
              onChange={(event) => updateTotalEpisodes(event.currentTarget.value)}
              aria-label="총회차"
              required
            />
          </label>
          <DateField
            label="촬영 시작일"
            value={value.shootingStartDate}
            onChange={(shootingStartDate) => setValue((current) => ({ ...current, shootingStartDate }))}
          />
          <DateField
            label="촬영 종료일"
            value={value.shootingEndDate}
            onChange={(shootingEndDate) => setValue((current) => ({ ...current, shootingEndDate }))}
          />
        </div>
      </section>

      <section className="ui-motion-surface rounded-[var(--radius-card)] border border-field-border bg-field-panel p-3 md:p-5">
        <div className="mb-2 grid grid-cols-[2.25rem_minmax(0,1fr)_2.25rem] items-center gap-2">
          <span aria-hidden />
          <div className="min-w-0 text-center">
            <h2 className="text-center text-sm font-bold text-field-text">메인 스태프</h2>
            <p className="text-center text-[11px] text-field-muted">
              인원·직책 중복 제한 없음 · 일촬표 표시는 회차별 최대 3명
            </p>
          </div>
          <Button
            type="button"
            variant="secondary"
            className="h-9 min-h-9 w-9 shrink-0 p-0"
            aria-label="메인 스태프 추가"
            onClick={() => setValue((current) => ({
              ...current,
              mainStaff: [
                ...current.mainStaff,
                createFormMainStaffMember(current.mainStaff.length)
              ]
            }))}
          >
            <Plus className="h-4 w-4" aria-hidden />
          </Button>
        </div>
        <div className="grid grid-cols-2 gap-2 landscape:grid-cols-3">
          {value.mainStaff.map((member, index) => (
            <StaffFields
              key={member.id}
              member={member}
              index={index}
              totalEpisodes={selectableTotalEpisodes}
              isEpisodeSelectorOpen={openEpisodeStaffId === member.id}
              onChange={updateStaff}
              onEpisodeChange={updateStaffEpisodes}
              onEpisodeSelectorOpen={() => setOpenEpisodeStaffId(member.id)}
              onEpisodeSelectorClose={() => setOpenEpisodeStaffId(null)}
              onDelete={deleteStaff}
            />
          ))}
        </div>
        {episodeLimitViolations.length > 0 ? (
          <div className="mt-2 grid gap-1" role="alert">
            {episodeLimitViolations.map(({ episodeNumber, members }) => (
              <p
                key={episodeNumber}
                className="rounded-[10px] border border-field-danger bg-field-panel px-3 py-2 text-xs font-semibold text-field-danger"
              >
                {episodeNumber}회차 일촬표 표시 인원이 {members.length}명입니다. 최대 3명까지 선택할 수 있습니다.
                <span className="mt-0.5 block text-[11px]">
                  {members.map((member) => member.name || member.role || "이름 미입력").join(", ")}
                </span>
              </p>
            ))}
          </div>
        ) : null}
      </section>

      <section className="ui-motion-surface rounded-[var(--radius-card)] border border-field-border bg-field-panel p-3 md:p-5">
        <div className="mb-2 grid grid-cols-[2.25rem_minmax(0,1fr)_auto] items-center gap-2">
          <span aria-hidden />
          <div className="min-w-0 text-center">
            <h2 className="text-center text-sm font-bold text-field-text">배우 정보</h2>
            <p className="break-words text-center text-[11px] text-field-muted [overflow-wrap:anywhere]">역할과 배우 이름은 씬리스트·의상 자료의 기본값으로 사용됩니다.</p>
          </div>
          <Button
            type="button"
            variant="secondary"
            className="min-h-9 px-3 py-1.5 text-xs"
            onClick={() => setValue((current) => ({ ...current, actors: [...current.actors, createBlankProjectActor()] }))}
          >
            <Plus className="h-4 w-4" aria-hidden />
            배우 추가
          </Button>
        </div>

        <div className="grid gap-2">
          {value.actors.map((actor, index) => (
            <ActorFields
              key={actor.id}
              actor={actor}
              index={index}
              onChange={updateActor}
              onDelete={deleteActor}
            />
          ))}
        </div>
      </section>

      {errorMessage ? (
        <p role="alert" className="border border-field-danger bg-field-panel px-4 py-3 text-sm font-semibold text-field-danger">
          {errorMessage}
        </p>
      ) : null}

      <div className="flex flex-wrap items-center justify-end gap-3">
        <AutosaveStatus status={autosave.status} onRetry={autosave.retry} />
        <Button type="submit" disabled={isSaving} className="w-full sm:w-auto sm:min-w-44">
          <Save className="h-4 w-4" aria-hidden />
          {isSaving ? "확인 중" : "완료"}
        </Button>
      </div>
    </form>
  );
}

function projectBasicInfoDraftFingerprint(draft: ProjectBasicInfoDraft) {
  return JSON.stringify(draft);
}

function normalizeProjectBasicInfoForForm(value: ProjectBasicInfo): ProjectBasicInfo {
  return {
    ...value,
    mainStaff: value.mainStaff.length > 0
      ? value.mainStaff.map((member) => ({ ...member, phone: formatKoreanPhoneNumber(member.phone) }))
      : [createFormMainStaffMember()],
    actors: value.actors.length > 0
      ? value.actors.map((actor) => ({ ...actor }))
      : [createBlankProjectActor()]
  };
}

function DateField({ label, value, onChange }: { label: string; value: string; onChange: (value: string) => void }) {
  return (
    <label className="grid gap-1.5">
      <span className="text-xs font-bold text-field-subtle">{label}</span>
      <input className={fieldClass} type="date" value={value} onChange={(event) => onChange(event.currentTarget.value)} required />
    </label>
  );
}

const StaffFields = memo(function StaffFields({
  member,
  index,
  totalEpisodes,
  isEpisodeSelectorOpen,
  onChange,
  onEpisodeChange,
  onEpisodeSelectorOpen,
  onEpisodeSelectorClose,
  onDelete
}: {
  member: ProjectMainStaffMember;
  index: number;
  totalEpisodes: number | null;
  isEpisodeSelectorOpen: boolean;
  onChange: (index: number, field: keyof Pick<ProjectMainStaffMember, "role" | "name" | "phone" | "includeInDailyPlan">, value: string | boolean) => void;
  onEpisodeChange: (staffId: string, episodeNumbers: number[] | null) => void;
  onEpisodeSelectorOpen: () => void;
  onEpisodeSelectorClose: () => void;
  onDelete: (index: number) => void;
}) {
  return (
    <div className="grid min-w-0 gap-1.5 rounded-[var(--radius-card)] border border-field-border bg-field-soft/50 p-2">
      <div className="flex items-center justify-between gap-1">
        <label className="inline-flex min-w-0 items-center gap-1 text-[10px] font-bold text-field-subtle">
          <input
            type="checkbox"
            checked={member.includeInDailyPlan}
            onChange={(event) => onChange(index, "includeInDailyPlan", event.currentTarget.checked)}
          />
          <span className="break-words [overflow-wrap:anywhere]">일촬표 반영</span>
        </label>
        <button
          type="button"
          className="grid h-7 w-7 shrink-0 place-items-center border border-transparent text-field-danger transition hover:border-field-danger active:scale-95"
          aria-label={`메인 스태프 ${index + 1} 삭제`}
          onClick={() => onDelete(index)}
        >
          <Trash2 className="h-3.5 w-3.5" aria-hidden />
        </button>
      </div>
      <input
        className={`${fieldClass} min-h-9 px-2 py-1 text-xs`}
        value={member.role}
        placeholder="직책"
        aria-label={`메인 스태프 ${index + 1} 직책`}
        onChange={(event) => onChange(index, "role", event.currentTarget.value)}
      />
      <input
        className={`${fieldClass} min-h-9 px-2 py-1 text-xs`}
        value={member.name}
        placeholder="이름"
        aria-label={`메인 스태프 ${index + 1} 이름`}
        onChange={(event) => onChange(index, "name", event.currentTarget.value)}
      />
      <input
        className={`${fieldClass} min-h-9 px-2 py-1 text-xs`}
        type="tel"
        inputMode="tel"
        maxLength={13}
        value={member.phone}
        placeholder="연락처"
        aria-label={`메인 스태프 ${index + 1} 연락처`}
        onChange={(event) => onChange(index, "phone", event.currentTarget.value)}
      />
      <EpisodeSelectionField
        member={member}
        totalEpisodes={totalEpisodes}
        open={isEpisodeSelectorOpen}
        onOpen={onEpisodeSelectorOpen}
        onClose={onEpisodeSelectorClose}
        onChange={(episodeNumbers) => onEpisodeChange(member.id, episodeNumbers)}
      />
    </div>
  );
});

function EpisodeSelectionField({
  member,
  totalEpisodes,
  open,
  onOpen,
  onClose,
  onChange
}: {
  member: ProjectMainStaffMember;
  totalEpisodes: number | null;
  open: boolean;
  onOpen: () => void;
  onClose: () => void;
  onChange: (episodeNumbers: number[] | null) => void;
}) {
  const episodeOptions = useMemo(
    () => totalEpisodes
      ? Array.from({ length: totalEpisodes }, (_, index) => index + 1)
      : [],
    [totalEpisodes]
  );
  const selectedEpisodes = member.episodeNumbers;

  useEffect(() => {
    if (!open) return undefined;
    function handleKeyDown(event: KeyboardEvent) {
      if (event.key === "Escape") onClose();
    }
    window.addEventListener("keydown", handleKeyDown);
    return () => window.removeEventListener("keydown", handleKeyDown);
  }, [onClose, open]);

  function toggleEpisode(episodeNumber: number) {
    if (!totalEpisodes) return;
    const current = selectedEpisodes === null ? episodeOptions : selectedEpisodes;
    const next = current.includes(episodeNumber)
      ? current.filter((episode) => episode !== episodeNumber)
      : [...current, episodeNumber];
    onChange(normalizeMainStaffEpisodeNumbers(next, totalEpisodes));
  }

  return (
    <div className="grid min-w-0 gap-1">
      <span className="text-center text-[10px] font-bold text-field-subtle">참여 회차</span>
      <button
        type="button"
        className={`${fieldClass} flex min-h-9 items-center justify-between gap-2 px-2 py-1 text-xs disabled:cursor-not-allowed disabled:bg-field-soft disabled:text-field-muted`}
        aria-haspopup="dialog"
        aria-expanded={open}
        disabled={!totalEpisodes}
        onClick={onOpen}
      >
        <span className="min-w-0 flex-1 break-words [overflow-wrap:anywhere]">
          {totalEpisodes
            ? formatMainStaffEpisodeSummary(selectedEpisodes)
            : "총회차를 먼저 입력하세요"}
        </span>
        <ChevronDown className="h-3.5 w-3.5 shrink-0" aria-hidden />
      </button>

      {open && totalEpisodes && typeof document !== "undefined"
        ? createPortal(
          <div
            className="fixed inset-0 z-[90] flex items-end justify-center bg-black/75 p-0 sm:items-center sm:p-4"
            onPointerDown={(event) => {
              if (event.currentTarget === event.target) onClose();
            }}
          >
            <section
              role="dialog"
              aria-modal="true"
              aria-label={`${member.name || member.role || "메인 스태프"} 참여 회차 선택`}
              className="ui-motion-dialog flex max-h-[min(78dvh,42rem)] w-full max-w-md flex-col overflow-hidden rounded-[var(--radius-dialog)] border border-field-border bg-field-dialog shadow-dialog"
            >
              <div className="flex items-center justify-between border-b border-field-border px-4 py-3">
                <div className="min-w-0">
                  <p className="text-sm font-bold text-field-text">참여 회차</p>
                  <p className="break-words text-xs text-field-muted [overflow-wrap:anywhere]">
                    {member.role || "직책 미입력"} · {member.name || "이름 미입력"}
                  </p>
                </div>
                <button
                  type="button"
                  className="grid h-9 w-9 shrink-0 place-items-center border border-field-border text-field-muted transition-colors hover:border-field-divider hover:bg-field-hover hover:text-field-text active:scale-95 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-field-primary"
                  aria-label="참여 회차 선택 닫기"
                  onClick={onClose}
                >
                  <X className="h-4 w-4" aria-hidden />
                </button>
              </div>

              <div className="min-h-0 overflow-y-auto p-3 overscroll-contain">
                <button
                  type="button"
                  className="flex min-h-11 w-full items-center gap-3 border border-field-border px-3 py-2 text-left text-sm text-field-text transition-colors hover:border-field-divider hover:bg-field-hover hover:text-field-text active:scale-[0.99]"
                  role="checkbox"
                  aria-checked={selectedEpisodes === null}
                  onClick={() => onChange(null)}
                >
                  <SelectionMark checked={selectedEpisodes === null} />
                  전체 회차
                </button>

                <div className="mt-2 grid grid-cols-2 gap-2">
                  {episodeOptions.map((episodeNumber) => {
                    const checked = selectedEpisodes === null || selectedEpisodes.includes(episodeNumber);
                    return (
                      <button
                        key={episodeNumber}
                        type="button"
                        className="flex min-h-11 items-center gap-2 border border-field-border px-3 py-2 text-left text-sm text-field-text transition-colors hover:border-field-divider hover:bg-field-hover hover:text-field-text active:scale-[0.99]"
                        role="checkbox"
                        aria-checked={checked}
                        onClick={() => toggleEpisode(episodeNumber)}
                      >
                        <SelectionMark checked={checked} />
                        {episodeNumber}회차
                      </button>
                    );
                  })}
                </div>
              </div>

              <div className="grid grid-cols-2 gap-2 border-t border-field-border p-3 pb-[max(0.75rem,env(safe-area-inset-bottom))]">
                <Button type="button" variant="secondary" onClick={() => onChange([])}>
                  전체 해제
                </Button>
                <Button type="button" onClick={onClose}>
                  완료
                </Button>
              </div>
            </section>
          </div>,
          document.body
        )
        : null}
    </div>
  );
}

function SelectionMark({ checked }: { checked: boolean }) {
  return (
    <span
      className={`grid h-5 w-5 shrink-0 place-items-center border ${
        checked
          ? "border-field-primary bg-field-primary text-field-accent-foreground"
          : "border-field-border bg-field-panel text-transparent"
      }`}
      aria-hidden
    >
      <Check className="h-3.5 w-3.5" />
    </span>
  );
}

const ActorFields = memo(function ActorFields({
  actor,
  index,
  onChange,
  onDelete
}: {
  actor: ProjectActor;
  index: number;
  onChange: (index: number, field: keyof Pick<ProjectActor, "role" | "name">, value: string) => void;
  onDelete: (index: number) => void;
}) {
  return (
    <div className="grid grid-cols-[minmax(0,1fr)_minmax(0,1fr)_2.5rem] items-center gap-2 rounded-[var(--radius-card)] border border-field-border bg-field-soft/50 p-2">
      <input
        className={fieldClass}
        value={actor.role}
        placeholder="역할"
        aria-label={`배우 ${index + 1} 역할`}
        onChange={(event) => onChange(index, "role", event.currentTarget.value)}
      />
      <input
        className={fieldClass}
        value={actor.name}
        placeholder="배우이름"
        aria-label={`배우 ${index + 1} 이름`}
        onChange={(event) => onChange(index, "name", event.currentTarget.value)}
      />
      <button
        type="button"
        className="grid h-10 w-10 place-items-center border border-field-danger bg-field-panel text-field-danger transition-colors hover:bg-field-danger/15 active:scale-95"
        aria-label={`배우 ${index + 1} 삭제`}
        onClick={() => onDelete(index)}
      >
        <Trash2 className="h-4 w-4" aria-hidden />
      </button>
    </div>
  );
});

function createFormMainStaffMember(sortOrder = 0, includeInDailyPlan = true) {
  const member = createBlankProjectMainStaffMember(sortOrder);
  return {
    ...member,
    includeInDailyPlan,
    id: `${member.id}_${Date.now()}_${Math.random().toString(16).slice(2)}`
  };
}

function insertMainStaffByAnchors(
  members: ProjectMainStaffMember[],
  member: ProjectMainStaffMember,
  beforeId: string,
  afterId: string,
  fallbackIndex: number
) {
  if (members.some((candidate) => candidate.id === member.id)) return members;
  const beforeIndex = beforeId ? members.findIndex((candidate) => candidate.id === beforeId) : -1;
  const afterIndex = afterId ? members.findIndex((candidate) => candidate.id === afterId) : -1;
  const insertionIndex = beforeIndex >= 0
    ? beforeIndex + 1
    : afterIndex >= 0
      ? afterIndex
      : Math.max(0, Math.min(fallbackIndex, members.length));
  const next = [...members];
  next.splice(insertionIndex, 0, member);
  return next;
}

function areMainStaffSnapshotsEqual(left: ProjectMainStaffMember, right: ProjectMainStaffMember) {
  return JSON.stringify(left) === JSON.stringify(right);
}

function insertActorByAnchors(
  actors: ProjectActor[],
  actor: ProjectActor,
  beforeId: string,
  afterId: string,
  fallbackIndex: number
) {
  if (actors.some((candidate) => candidate.id === actor.id)) return actors;
  const beforeIndex = beforeId ? actors.findIndex((candidate) => candidate.id === beforeId) : -1;
  const afterIndex = afterId ? actors.findIndex((candidate) => candidate.id === afterId) : -1;
  const insertionIndex = beforeIndex >= 0
    ? beforeIndex + 1
    : afterIndex >= 0
      ? afterIndex
      : Math.max(0, Math.min(fallbackIndex, actors.length));
  const next = [...actors];
  next.splice(insertionIndex, 0, actor);
  return next;
}

function areActorSnapshotsEqual(left: ProjectActor, right: ProjectActor) {
  return left.id === right.id && left.role === right.role && left.name === right.name;
}

function parseSelectableTotalEpisodes(value: string) {
  if (!/^\d+$/.test(value)) return null;
  const parsed = Number(value);
  return Number.isInteger(parsed) && parsed >= 1 ? parsed : null;
}
