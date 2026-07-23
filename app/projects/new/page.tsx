"use client";

import { FormEvent, useState } from "react";
import { useRouter } from "next/navigation";
import Link from "next/link";
import { Save } from "lucide-react";
import { PageHeader } from "@/components/PageHeader";
import { createProject } from "@/lib/data/projects";

const fieldClass =
  "min-h-12 w-full rounded-md border border-field-border bg-white px-3 py-3 text-base text-field-text outline-none transition focus:border-field-primary focus:ring-2 focus:ring-field-light";

/** HTML date input에 넣을 오늘 날짜를 로컬 시간 기준으로 만듭니다. */
function getTodayInputValue() {
  const now = new Date();
  const offsetDate = new Date(now.getTime() - now.getTimezoneOffset() * 60_000);
  return offsetDate.toISOString().slice(0, 10);
}

/** 프로젝트명, 촬영일, 설명만 받아 MVP 프로젝트를 생성합니다. */
export default function NewProjectPage() {
  const router = useRouter();
  const [name, setName] = useState("");
  const [shootDate, setShootDate] = useState(getTodayInputValue());
  const [description, setDescription] = useState("");
  const [isSaving, setIsSaving] = useState(false);
  const [errorMessage, setErrorMessage] = useState("");

  async function handleSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setErrorMessage("");
    setIsSaving(true);

    try {
      const project = await createProject({
        name: name.trim(),
        shootDate,
        description: description.trim()
      });
      router.push(`/projects/${project.id}/daily-plans/new/basic`);
    } catch (error) {
      setErrorMessage(error instanceof Error ? error.message : "프로젝트를 만들지 못했습니다.");
      setIsSaving(false);
    }
  }

  return (
    <section className="mx-auto grid w-full max-w-6xl gap-6">
      <PageHeader title="새 프로젝트" description="촬영일과 프로젝트 정보를 입력하세요." />

      <form onSubmit={handleSubmit} className="grid w-full max-w-2xl gap-5 rounded-md border border-field-border bg-white p-5 shadow-sm md:p-6">
        <label className="grid gap-2">
          <span className="text-sm font-black text-field-primary">프로젝트명 <span className="text-field-danger">*</span></span>
          <input
            required
            value={name}
            onChange={(event) => setName(event.target.value)}
            placeholder="단편영화 A"
            className={fieldClass}
          />
        </label>

        <label className="grid gap-2">
          <span className="text-sm font-black text-field-primary">촬영일</span>
          <input
            type="date"
            value={shootDate}
            onChange={(event) => setShootDate(event.target.value)}
            className={fieldClass}
          />
        </label>

        <label className="grid gap-2">
          <span className="text-sm font-black text-field-primary">설명</span>
          <textarea
            value={description}
            onChange={(event) => setDescription(event.target.value)}
            placeholder="1회차 야외 촬영"
            rows={4}
            className={`${fieldClass} resize-none`}
          />
        </label>

        {errorMessage ? (
          <div className="rounded-md border border-field-danger bg-white p-3 text-sm font-bold leading-5 text-field-danger">
            <p>프로젝트 생성에 실패했습니다.</p>
            <p className="mt-1 break-words font-medium">{errorMessage}</p>
          </div>
        ) : null}

        <div className="grid gap-3 pt-1 sm:grid-cols-[160px_1fr] sm:justify-end">
          <Link
            href="/"
            className="flex min-h-12 items-center justify-center rounded-md border border-field-border bg-white px-4 text-base font-black text-field-primary"
          >
            취소
          </Link>
          <button
            type="submit"
            disabled={isSaving || !name.trim()}
            className="flex min-h-12 items-center justify-center gap-2 rounded-md bg-field-primary px-4 text-base font-black text-white disabled:cursor-not-allowed disabled:opacity-50"
          >
            <Save className="h-5 w-5" aria-hidden />
            {isSaving ? "저장 중" : "프로젝트 생성"}
          </button>
        </div>
      </form>
    </section>
  );
}
