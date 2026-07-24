"use client";

import { FormEvent, memo, useCallback, useState } from "react";
import { Plus, Save, Trash2 } from "lucide-react";
import { Button } from "@/components/ui/Button";
import { formatKoreanPhoneNumber } from "@/lib/formatKoreanPhoneNumber";
import { validateProjectBasicInfo } from "@/lib/projectBasicInfo";
import type { ProjectActor, ProjectBasicInfo } from "@/lib/types";

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
    mainStaff: {
      director: { ...initialValue.mainStaff.director, phone: formatKoreanPhoneNumber(initialValue.mainStaff.director.phone) },
      assistantDirector: {
        ...initialValue.mainStaff.assistantDirector,
        phone: formatKoreanPhoneNumber(initialValue.mainStaff.assistantDirector.phone)
      },
      producer: { ...initialValue.mainStaff.producer, phone: formatKoreanPhoneNumber(initialValue.mainStaff.producer.phone) }
    },
    actors: initialValue.actors.length > 0 ? initialValue.actors.map((actor) => ({ ...actor })) : [{ role: "", name: "" }]
  }));
  const [totalEpisodesDraft, setTotalEpisodesDraft] = useState(String(initialValue.totalEpisodes));
  const [isSaving, setIsSaving] = useState(false);
  const [errorMessage, setErrorMessage] = useState("");

  const updateStaff = useCallback((role: keyof ProjectBasicInfo["mainStaff"], field: "name" | "phone", nextValue: string) => {
    setValue((current) => ({
      ...current,
      mainStaff: {
        ...current.mainStaff,
        [role]: {
          ...current.mainStaff[role],
          [field]: field === "phone" ? formatKoreanPhoneNumber(nextValue) : nextValue
        }
      }
    }));
  }, []);

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
        <span className="rounded-full border border-field-border bg-white px-3 py-1.5 text-xs font-black text-field-muted">
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
              onChange={(event) => {
                const digits = event.currentTarget.value.replace(/\D/g, "").slice(0, 3);
                setTotalEpisodesDraft(digits);
              }}
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
        <h2 className="mb-3 text-sm font-black text-field-primary">메인 스태프</h2>
        <div className="grid gap-3 lg:grid-cols-3">
          <StaffFields
            role="director"
            label="감독"
            name={value.mainStaff.director.name}
            phone={value.mainStaff.director.phone}
            onChange={updateStaff}
          />
          <StaffFields
            role="assistantDirector"
            label="조감독"
            name={value.mainStaff.assistantDirector.name}
            phone={value.mainStaff.assistantDirector.phone}
            onChange={updateStaff}
          />
          <StaffFields
            role="producer"
            label="제작"
            name={value.mainStaff.producer.name}
            phone={value.mainStaff.producer.phone}
            onChange={updateStaff}
          />
        </div>
      </section>

      <section className="rounded-2xl border border-field-border bg-white p-3 md:p-5">
        <div className="mb-3 flex items-center justify-between gap-2">
          <h2 className="text-sm font-black text-field-primary">배우 정보</h2>
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
  role,
  label,
  name,
  phone,
  onChange
}: {
  role: keyof ProjectBasicInfo["mainStaff"];
  label: string;
  name: string;
  phone: string;
  onChange: (role: keyof ProjectBasicInfo["mainStaff"], field: "name" | "phone", value: string) => void;
}) {
  return (
    <div className="grid gap-2 rounded-xl border border-field-border bg-field-soft/50 p-2">
      <p className="text-center text-xs font-black text-field-primary">{label}</p>
      <input className={fieldClass} value={name} placeholder={`${label} 이름`} onChange={(event) => onChange(role, "name", event.currentTarget.value)} />
      <input
        className={fieldClass}
        type="tel"
        inputMode="tel"
        maxLength={13}
        value={phone}
        placeholder={`${label} 연락처`}
        aria-label={`${label} 연락처`}
        onChange={(event) => onChange(role, "phone", event.currentTarget.value)}
      />
    </div>
  );
});

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
        className="grid h-10 w-10 place-items-center rounded-full border border-field-danger bg-white text-field-danger transition active:scale-95"
        aria-label={`배우 ${index + 1} 삭제`}
        onClick={() => onDelete(index)}
      >
        <Trash2 className="h-4 w-4" aria-hidden />
      </button>
    </div>
  );
});
