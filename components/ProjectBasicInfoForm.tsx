"use client";

import { FormEvent, memo, useCallback, useEffect, useMemo, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { Check, ChevronDown, Plus, Save, Trash2, X } from "lucide-react";
import { Button } from "@/components/ui/Button";
import { formatKoreanPhoneNumber } from "@/lib/formatKoreanPhoneNumber";
import {
  createBlankProjectMainStaffMember,
  formatMainStaffEpisodeSummary,
  getDailyPlanMainStaffEpisodeViolations,
  normalizeMainStaffEpisodeNumbers,
  validateProjectBasicInfo
} from "@/lib/projectBasicInfo";
import type { ProjectActor, ProjectBasicInfo, ProjectMainStaffMember } from "@/lib/types";
import { useUnsavedChangesGuard } from "@/hooks/useUnsavedChangesGuard";

type ProjectBasicInfoFormProps = {
  projectName: string;
  initialValue: ProjectBasicInfo;
  onSave: (value: ProjectBasicInfo) => Promise<void>;
};

const fieldClass =
  "min-h-11 w-full min-w-0 rounded-xl border border-field-border bg-white px-3 py-2 text-center text-sm font-bold text-field-text outline-none transition focus:border-field-primary focus:ring-2 focus:ring-field-light";

/** 일촬표와 분리된 프로젝트 단위 기본정보만 편집합니다. */
export function ProjectBasicInfoForm({ projectName, initialValue, onSave }: ProjectBasicInfoFormProps) {
  const [value, setValue] = useState<ProjectBasicInfo>(() => ({
    ...initialValue,
    mainStaff: initialValue.mainStaff.length > 0
      ? initialValue.mainStaff.map((member) => ({ ...member, phone: formatKoreanPhoneNumber(member.phone) }))
      : [createFormMainStaffMember()],
    actors: initialValue.actors.length > 0 ? initialValue.actors.map((actor) => ({ ...actor })) : [{ role: "", name: "" }]
  }));
  const [totalEpisodesDraft, setTotalEpisodesDraft] = useState(String(initialValue.totalEpisodes));
  const [isSaving, setIsSaving] = useState(false);
  const [errorMessage, setErrorMessage] = useState("");
  const [openEpisodeStaffId, setOpenEpisodeStaffId] = useState<string | null>(null);
  const savedFingerprintRef = useRef(JSON.stringify({ value, totalEpisodesDraft }));
  const selectableTotalEpisodes = parseSelectableTotalEpisodes(totalEpisodesDraft);
  const episodeLimitViolations = useMemo(
    () => selectableTotalEpisodes
      ? getDailyPlanMainStaffEpisodeViolations(value.mainStaff, selectableTotalEpisodes)
      : [],
    [selectableTotalEpisodes, value.mainStaff]
  );
  useUnsavedChangesGuard(
    JSON.stringify({ value, totalEpisodesDraft }) !== savedFingerprintRef.current
  );

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
    setOpenEpisodeStaffId(null);
    setValue((current) => ({
      ...current,
      mainStaff: current.mainStaff.length === 1
        ? [createFormMainStaffMember()]
        : current.mainStaff.filter((_, memberIndex) => memberIndex !== index)
          .map((member, sortOrder) => ({ ...member, sortOrder }))
    }));
  }, []);

  const updateTotalEpisodes = useCallback((nextDraft: string) => {
    const digits = nextDraft.replace(/\D/g, "").slice(0, 3);
    const nextTotalEpisodes = parseSelectableTotalEpisodes(digits);
    if (nextTotalEpisodes === null) {
      setTotalEpisodesDraft(digits);
      setOpenEpisodeStaffId(null);
      return;
    }

    const previousTotalEpisodes = value.totalEpisodes;
    if (nextTotalEpisodes < previousTotalEpisodes) {
      const affected = value.mainStaff
        .map((member) => ({
          member,
          removedEpisodes: member.episodeNumbers?.filter((episode) => episode > nextTotalEpisodes) ?? []
        }))
        .filter(({ removedEpisodes }) => removedEpisodes.length > 0);

      if (affected.length > 0) {
        const affectedEpisodes = [...new Set(
          affected.flatMap(({ removedEpisodes }) => removedEpisodes)
        )].sort((left, right) => left - right);
        const affectedStaff = affected
          .map(({ member }) => member.name.trim() || member.role.trim() || "이름 미입력 스태프")
          .join(", ");
        const confirmed = window.confirm(
          `총회차를 ${nextTotalEpisodes}회차로 줄이면 ${affectedStaff}의 ${affectedEpisodes.join(", ")}회차 선택이 제거됩니다. 계속할까요?`
        );
        if (!confirmed) {
          setTotalEpisodesDraft(String(previousTotalEpisodes));
          return;
        }
      }
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

  const updateActor = useCallback((index: number, field: keyof ProjectActor, nextValue: string) => {
    setValue((current) => ({
      ...current,
      actors: current.actors.map((actor, actorIndex) => (
        actorIndex === index ? { ...actor, [field]: nextValue } : actor
      ))
    }));
  }, []);

  const deleteActor = useCallback((index: number) => {
    setValue((current) => ({
      ...current,
      actors: current.actors.length === 1
        ? [{ role: "", name: "" }]
        : current.actors.filter((_, actorIndex) => actorIndex !== index)
    }));
  }, []);

  async function handleSubmit(event: FormEvent<HTMLFormElement>) {
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
    try {
      await onSave(validation.value);
    } catch (error) {
      setErrorMessage(error instanceof Error ? error.message : "프로젝트 기본정보를 저장하지 못했습니다.");
      setIsSaving(false);
    }
  }

  return (
    <form noValidate onSubmit={handleSubmit} className="mx-auto grid w-full max-w-4xl gap-4">
      <div className="flex flex-wrap items-center justify-between gap-2 px-1">
        <div className="min-w-0">
          <p className="font-display text-xl font-black text-field-primary md:text-2xl">프로젝트 기본정보</p>
          <p className="mt-1 truncate text-sm font-bold text-field-muted">{projectName}</p>
        </div>
        <span className="rounded-[3px] border border-field-border bg-white px-3 py-1.5 text-xs font-black text-field-muted">
          프로젝트 공통 정보
        </span>
      </div>

      <section className="rounded-2xl border border-field-border bg-white p-3 md:p-5">
        <div className="grid gap-3 md:grid-cols-[0.55fr_1fr_1fr]">
          <label className="grid gap-1.5">
            <span className="text-xs font-black text-field-primary">총회차</span>
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

      <section className="rounded-2xl border border-field-border bg-white p-3 md:p-5">
        <div className="mb-2 flex items-center justify-between gap-2">
          <div className="min-w-0">
            <h2 className="text-sm font-black text-field-primary">메인 스태프</h2>
            <p className="text-[11px] font-bold text-field-muted">
              인원·직책 중복 제한 없음 · 일촬표 표시는 회차별 최대 3명
            </p>
          </div>
          <Button
            type="button"
            variant="secondary"
            className="h-9 min-h-9 w-9 shrink-0 rounded-[3px] p-0"
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
                className="rounded-lg border border-field-danger bg-white px-3 py-2 text-xs font-bold text-field-danger"
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

      <section className="rounded-2xl border border-field-border bg-white p-3 md:p-5">
        <div className="mb-2 flex items-center justify-between gap-2">
          <div className="min-w-0">
            <h2 className="text-sm font-black text-field-primary">배우 정보</h2>
            <p className="truncate text-[11px] font-bold text-field-muted">역할과 배우 이름은 씬리스트·의상 자료의 기본값으로 사용됩니다.</p>
          </div>
          <Button
            type="button"
            variant="secondary"
            className="min-h-9 px-3 py-1.5 text-xs"
            onClick={() => setValue((current) => ({ ...current, actors: [...current.actors, { role: "", name: "" }] }))}
          >
            <Plus className="h-4 w-4" aria-hidden />
            배우 추가
          </Button>
        </div>

        <div className="grid gap-2">
          {value.actors.map((actor, index) => (
            <ActorFields
              key={index}
              actor={actor}
              index={index}
              onChange={updateActor}
              onDelete={deleteActor}
            />
          ))}
        </div>
      </section>

      {errorMessage ? (
        <p className="rounded-xl border border-field-danger bg-white px-4 py-3 text-sm font-bold text-field-danger">
          {errorMessage}
        </p>
      ) : null}

      <div className="flex justify-end">
        <Button type="submit" disabled={isSaving} className="w-full sm:w-auto sm:min-w-44">
          <Save className="h-4 w-4" aria-hidden />
          {isSaving ? "저장 중" : "저장"}
        </Button>
      </div>
    </form>
  );
}

function DateField({ label, value, onChange }: { label: string; value: string; onChange: (value: string) => void }) {
  return (
    <label className="grid gap-1.5">
      <span className="text-xs font-black text-field-primary">{label}</span>
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
    <div className="grid min-w-0 gap-1.5 rounded-xl border border-field-border bg-field-soft/50 p-2">
      <div className="flex items-center justify-between gap-1">
        <label className="inline-flex min-w-0 items-center gap-1 text-[10px] font-black text-field-primary">
          <input
            type="checkbox"
            checked={member.includeInDailyPlan}
            onChange={(event) => onChange(index, "includeInDailyPlan", event.currentTarget.checked)}
          />
          <span className="truncate">일촬표 반영</span>
        </label>
        <button
          type="button"
          className="grid h-7 w-7 shrink-0 place-items-center rounded-[3px] text-field-danger transition active:scale-95"
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
      <span className="text-center text-[10px] font-black text-field-primary">참여 회차</span>
      <button
        type="button"
        className={`${fieldClass} flex min-h-9 items-center justify-between gap-2 px-2 py-1 text-xs disabled:cursor-not-allowed disabled:bg-field-soft disabled:text-field-muted`}
        aria-haspopup="dialog"
        aria-expanded={open}
        disabled={!totalEpisodes}
        onClick={onOpen}
      >
        <span className="min-w-0 flex-1 truncate">
          {totalEpisodes
            ? formatMainStaffEpisodeSummary(selectedEpisodes)
            : "총회차를 먼저 입력하세요"}
        </span>
        <ChevronDown className="h-3.5 w-3.5 shrink-0" aria-hidden />
      </button>

      {open && totalEpisodes && typeof document !== "undefined"
        ? createPortal(
          <div
            className="fixed inset-0 z-[90] flex items-end justify-center bg-black/25 p-0 sm:items-center sm:p-4"
            onPointerDown={(event) => {
              if (event.currentTarget === event.target) onClose();
            }}
          >
            <section
              role="dialog"
              aria-modal="true"
              aria-label={`${member.name || member.role || "메인 스태프"} 참여 회차 선택`}
              className="flex max-h-[min(78dvh,42rem)] w-full max-w-md flex-col overflow-hidden rounded-t-2xl border border-field-border bg-white shadow-xl sm:rounded-2xl"
            >
              <div className="flex items-center justify-between border-b border-field-border px-4 py-3">
                <div className="min-w-0">
                  <p className="text-sm font-black text-field-primary">참여 회차</p>
                  <p className="truncate text-xs font-bold text-field-muted">
                    {member.role || "직책 미입력"} · {member.name || "이름 미입력"}
                  </p>
                </div>
                <button
                  type="button"
                  className="grid h-9 w-9 shrink-0 place-items-center rounded-[3px] border border-field-border text-field-muted transition hover:bg-field-soft active:scale-95"
                  aria-label="참여 회차 선택 닫기"
                  onClick={onClose}
                >
                  <X className="h-4 w-4" aria-hidden />
                </button>
              </div>

              <div className="min-h-0 overflow-y-auto p-3 overscroll-contain">
                <button
                  type="button"
                  className="flex min-h-11 w-full items-center gap-3 rounded-xl border border-field-border px-3 py-2 text-left text-sm font-bold text-field-text transition hover:bg-field-soft active:scale-[0.99]"
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
                        className="flex min-h-11 items-center gap-2 rounded-xl border border-field-border px-3 py-2 text-left text-sm font-bold text-field-text transition hover:bg-field-soft active:scale-[0.99]"
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
      className={`grid h-5 w-5 shrink-0 place-items-center rounded-md border ${
        checked
          ? "border-field-primary bg-field-primary text-white"
          : "border-field-border bg-white text-transparent"
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
  onChange: (index: number, field: keyof ProjectActor, value: string) => void;
  onDelete: (index: number) => void;
}) {
  return (
    <div className="grid grid-cols-[minmax(0,1fr)_minmax(0,1fr)_2.5rem] items-center gap-2 rounded-xl border border-field-border bg-field-soft/50 p-2">
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
        className="grid h-10 w-10 place-items-center rounded-[3px] border border-field-danger bg-white text-field-danger transition active:scale-95"
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

function parseSelectableTotalEpisodes(value: string) {
  if (!/^\d+$/.test(value)) return null;
  const parsed = Number(value);
  return Number.isInteger(parsed) && parsed >= 1 ? parsed : null;
}
