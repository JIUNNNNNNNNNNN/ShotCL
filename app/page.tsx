"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { CalendarDays, ChevronRight, Clock, FolderKanban, Plus } from "lucide-react";
import { PageHeader } from "@/components/PageHeader";
import { SupabaseDebugPanel } from "@/components/SupabaseDebugPanel";
import { listProjects } from "@/lib/data/projects";
import type { Project } from "@/lib/types";

/** 프로젝트 생성일을 데스크탑 카드에서 읽기 쉬운 날짜로 표시합니다. */
function formatCreatedDate(value: string) {
  if (!value) return "생성일 없음";

  try {
    return new Intl.DateTimeFormat("ko-KR", { dateStyle: "medium" }).format(new Date(value));
  } catch {
    return value.slice(0, 10);
  }
}

/** 첫 화면에서 프로젝트 목록을 불러와 현재 촬영 회차를 선택하게 합니다. */
export default function ProjectsPage() {
  const [projects, setProjects] = useState<Project[]>([]);
  const [isLoading, setIsLoading] = useState(true);
  const [errorMessage, setErrorMessage] = useState("");

  useEffect(() => {
    let isMounted = true;

    async function loadProjects() {
      try {
        const data = await listProjects();
        if (isMounted) setProjects(data);
      } catch (error) {
        if (isMounted) setErrorMessage(error instanceof Error ? error.message : "프로젝트를 불러오지 못했습니다.");
      } finally {
        if (isMounted) setIsLoading(false);
      }
    }

    loadProjects();
    return () => {
      isMounted = false;
    };
  }, []);

  return (
    <>
      <PageHeader
        title="프로젝트 목록"
        description="오늘 촬영할 프로젝트를 선택하세요."
        actions={
          <Link
            href="/projects/new"
            className="flex h-11 items-center gap-2 rounded-md border border-field-border bg-white px-3 text-sm font-black text-field-primary"
          >
            <Plus className="h-5 w-5" aria-hidden />
            만들기
          </Link>
        }
      />

      {errorMessage ? (
        <div className="mb-4 rounded-md border border-stage-red bg-stage-red/10 p-4 text-sm font-bold text-stage-red">
          {errorMessage}
        </div>
      ) : null}

      {isLoading ? (
        <div className="rounded-md border border-field-border bg-white p-5 text-field-muted">프로젝트를 불러오는 중입니다.</div>
      ) : projects.length === 0 ? (
        <section className="rounded-md border border-field-border bg-white p-6 md:p-8">
          <div className="grid gap-6 md:grid-cols-[1fr_auto] md:items-center">
            <div>
              <div className="flex h-12 w-12 items-center justify-center rounded-md bg-field-light">
                <FolderKanban className="h-6 w-6 text-field-primary" aria-hidden />
              </div>
              <h2 className="mt-4 text-xl font-black">첫 프로젝트를 만들어보세요</h2>
              <p className="mt-2 max-w-2xl text-base leading-6 text-field-muted">
                프로젝트 생성 후 문서를 올리고 컷 단위 mock 분석으로 진행표를 만들 수 있습니다.
              </p>
            </div>
            <Link
              href="/projects/new"
              className="flex min-h-12 items-center justify-center gap-2 rounded-md bg-field-primary px-5 font-black text-white md:min-w-48"
            >
              <Plus className="h-5 w-5" aria-hidden />
              새 프로젝트 만들기
            </Link>
          </div>
        </section>
      ) : (
        <div className="grid grid-cols-1 gap-4 md:grid-cols-2 lg:grid-cols-3">
          {projects.map((project) => (
            <Link
              key={project.id}
              href={`/projects/${project.id}`}
              className="flex min-h-56 flex-col justify-between rounded-md border border-field-border bg-white p-5 transition hover:border-field-secondary hover:shadow-sm"
            >
              <div>
                <div className="flex items-start justify-between gap-3">
                  <h2 className="min-w-0 break-words text-xl font-black text-field-primary">{project.name}</h2>
                  <ChevronRight className="mt-1 h-6 w-6 shrink-0 text-field-muted" aria-hidden />
                </div>
                <div className="mt-3 grid gap-2 text-sm font-bold text-field-muted">
                  <p className="flex items-center gap-2">
                    <CalendarDays className="h-4 w-4" aria-hidden />
                    {project.shootDate || "촬영일 미정"}
                  </p>
                  <p className="flex items-center gap-2">
                    <Clock className="h-4 w-4" aria-hidden />
                    {formatCreatedDate(project.createdAt)}
                  </p>
                </div>
                {project.description ? <p className="mt-4 line-clamp-3 text-base leading-6 text-field-text">{project.description}</p> : null}
              </div>
              <div className="mt-5 inline-flex min-h-10 items-center justify-center rounded-md border border-field-border bg-field-light px-3 text-sm font-black text-field-primary">
                상세 보기
              </div>
            </Link>
          ))}
        </div>
      )}

      <SupabaseDebugPanel />
    </>
  );
}
