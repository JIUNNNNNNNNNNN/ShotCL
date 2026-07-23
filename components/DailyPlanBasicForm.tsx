"use client";

import { FormEvent, useState } from "react";
import { ArrowRight, Save } from "lucide-react";
import { Button } from "@/components/ui/Button";
import {
  applyDailyPlanBasicValues,
  getDailyPlanBasicValues,
  type DailyPlanBasicValues
} from "@/lib/dailyPlan/basicDraft";
import { formatKoreanPhoneNumber } from "@/lib/formatKoreanPhoneNumber";
import type { DailyPlanDraft } from "@/lib/types";

type DailyPlanBasicFormProps = {
  initialDraft: DailyPlanDraft;
  onSubmit: (draft: DailyPlanDraft) => Promise<void> | void;
  submitLabel?: string;
  statusLabel?: string;
};

const fieldClass =
  "min-h-11 w-full min-w-0 rounded-xl border border-field-border bg-white px-3 py-2 text-center text-sm font-bold text-field-text outline-none transition focus:border-field-primary focus:ring-2 focus:ring-field-light";

/** 새 일촬표와 저장된 일촬표가 함께 쓰는 기본 정보 전용 폼입니다. */
export function DailyPlanBasicForm({
  initialDraft,
  onSubmit,
  submitLabel = "작성 계속",
  statusLabel = "저장 전 초안"
}: DailyPlanBasicFormProps) {
  const [values, setValues] = useState<DailyPlanBasicValues>(() => getDailyPlanBasicValues(initialDraft));
  const [timeDraft, setTimeDraft] = useState(() => formatTimeToDigits(values.callTime));
  const [isSaving, setIsSaving] = useState(false);
  const [errorMessage, setErrorMessage] = useState("");
  const invalidTime = timeDraft.length === 4 && !parseHHMM(timeDraft);

  function update(field: keyof DailyPlanBasicValues, value: string) {
    setValues((current) => ({ ...current, [field]: value }));
  }

  function commitTime(rawValue: string) {
    const digits = onlyDigits(rawValue, 4);
    if (!digits) {
      update("callTime", "");
      return true;
    }
    const normalized = digits.length === 3 ? `0${digits}` : digits;
    const parsed = parseHHMM(normalized);
    if (!parsed) return false;
    setTimeDraft(normalized);
    update("callTime", parsed);
    return true;
  }

  async function handleSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setErrorMessage("");
    if (!values.title.trim()) {
      setErrorMessage("작품명을 입력해주세요.");
      return;
    }
    if (!commitTime(timeDraft)) {
      setErrorMessage("집합시간을 24시간 기준 HHMM 4자리로 입력해주세요.");
      return;
    }

    setIsSaving(true);
    try {
      const nextValues = { ...values, callTime: timeDraft ? parseHHMM(timeDraft) ?? values.callTime : "" };
      await onSubmit(applyDailyPlanBasicValues(initialDraft, nextValues));
    } catch (error) {
      setErrorMessage(error instanceof Error ? error.message : "기본 정보를 저장하지 못했습니다.");
      setIsSaving(false);
    }
  }

  return (
    <form onSubmit={handleSubmit} className="mx-auto grid w-full max-w-4xl gap-4">
      <div className="flex flex-wrap items-end justify-between gap-2 px-1">
        <div>
          <p className="font-display text-xl font-black text-field-primary md:text-2xl">일촬표 기본 정보</p>
          <p className="mt-1 text-sm font-bold text-field-muted">먼저 회차와 촬영 기준 정보를 입력한 뒤 세부 일촬표를 작성하세요.</p>
        </div>
        <span className="rounded-full border border-field-border bg-white px-3 py-1.5 text-xs font-black text-field-muted">{statusLabel}</span>
      </div>

      <section className="rounded-2xl border border-field-border bg-white p-3 md:p-5">
        <div className="grid gap-3 md:grid-cols-[0.7fr_1.3fr]">
          <BasicField label="회차" value={values.episode} onChange={(value) => update("episode", value)} placeholder="1" />
          <BasicField label="작품명" value={values.title} onChange={(value) => update("title", value)} placeholder="작품명" required />
          <BasicField label="촬영일" type="date" value={values.shootingDate} onChange={(value) => update("shootingDate", value)} />
          <label className="grid gap-1.5">
            <span className="text-xs font-black text-field-primary">현장 집합 시간</span>
            <input
              className={`${fieldClass} ${invalidTime ? "border-field-danger focus:border-field-danger" : ""}`}
              type="text"
              inputMode="numeric"
              pattern="[0-9]*"
              maxLength={4}
              value={timeDraft}
              placeholder="HHMM"
              aria-invalid={invalidTime}
              onChange={(event) => {
                const next = onlyDigits(event.currentTarget.value, 4);
                setTimeDraft(next);
                const parsed = parseHHMM(next);
                if (parsed) update("callTime", parsed);
              }}
              onBlur={(event) => commitTime(event.currentTarget.value)}
              onKeyDown={(event) => {
                if (!event.metaKey && !event.ctrlKey && !event.altKey && event.key.length === 1 && !/\d/.test(event.key)) {
                  event.preventDefault();
                }
                if (event.key === "Enter" && !commitTime(event.currentTarget.value)) event.preventDefault();
              }}
            />
          </label>
          <BasicField
            label="총 인원"
            value={values.totalCrew}
            inputMode="numeric"
            pattern="[0-9]*"
            onChange={(value) => update("totalCrew", onlyDigits(value, 4))}
            placeholder="0"
          />
        </div>
      </section>

      <section className="rounded-2xl border border-field-border bg-white p-3 md:p-5">
        <p className="mb-3 text-sm font-black text-field-primary">메인 스태프</p>
        <div className="grid gap-3 lg:grid-cols-3">
          <PersonFields
            role="감독"
            name={values.director}
            contact={values.directorContact}
            onNameChange={(value) => update("director", value)}
            onContactChange={(value) => update("directorContact", value)}
          />
          <PersonFields
            role="조감독"
            name={values.assistantDirector}
            contact={values.assistantDirectorContact}
            onNameChange={(value) => update("assistantDirector", value)}
            onContactChange={(value) => update("assistantDirectorContact", value)}
          />
          <PersonFields
            role="제작"
            name={values.production}
            contact={values.producerContact}
            onNameChange={(value) => update("production", value)}
            onContactChange={(value) => update("producerContact", value)}
          />
        </div>
      </section>

      {errorMessage ? <p className="rounded-xl border border-field-danger bg-white px-4 py-3 text-sm font-bold text-field-danger">{errorMessage}</p> : null}

      <div className="flex justify-end">
        <Button type="submit" disabled={isSaving} className="w-full sm:w-auto sm:min-w-44">
          {submitLabel.includes("저장") ? <Save className="h-4 w-4" aria-hidden /> : <ArrowRight className="h-4 w-4" aria-hidden />}
          {isSaving ? "처리 중" : submitLabel}
        </Button>
      </div>
    </form>
  );
}

function BasicField({
  label,
  value,
  type = "text",
  placeholder,
  required,
  inputMode,
  pattern,
  onChange
}: {
  label: string;
  value: string;
  type?: string;
  placeholder?: string;
  required?: boolean;
  inputMode?: "numeric";
  pattern?: string;
  onChange: (value: string) => void;
}) {
  return (
    <label className="grid gap-1.5">
      <span className="text-xs font-black text-field-primary">{label}</span>
      <input
        className={fieldClass}
        type={type}
        value={value}
        placeholder={placeholder}
        required={required}
        inputMode={inputMode}
        pattern={pattern}
        onChange={(event) => onChange(event.currentTarget.value)}
      />
    </label>
  );
}

function PersonFields({
  role,
  name,
  contact,
  onNameChange,
  onContactChange
}: {
  role: string;
  name: string;
  contact: string;
  onNameChange: (value: string) => void;
  onContactChange: (value: string) => void;
}) {
  return (
    <div className="grid gap-2 rounded-xl border border-field-border bg-field-soft/50 p-2">
      <p className="text-center text-xs font-black text-field-primary">{role}</p>
      <input className={fieldClass} value={name} placeholder="이름" onChange={(event) => onNameChange(event.currentTarget.value)} />
      <input
        className={fieldClass}
        type="tel"
        inputMode="numeric"
        pattern="[0-9]*"
        value={contact}
        placeholder="연락처"
        onChange={(event) => onContactChange(formatKoreanPhoneNumber(event.currentTarget.value))}
      />
    </div>
  );
}

function onlyDigits(value: string, maxLength: number) {
  return String(value ?? "").replace(/\D/g, "").slice(0, maxLength);
}

function formatTimeToDigits(value: string) {
  return onlyDigits(value, 4);
}

function parseHHMM(value: string) {
  if (!/^\d{4}$/.test(value)) return null;
  const hours = Number(value.slice(0, 2));
  const minutes = Number(value.slice(2));
  return hours <= 23 && minutes <= 59 ? `${value.slice(0, 2)}:${value.slice(2)}` : null;
}
