"use client";

import { useEffect, useState } from "react";
import { useParams, useRouter } from "next/navigation";
import { DailyPlanBasicForm } from "@/components/DailyPlanBasicForm";
import { PixelDogLoader } from "@/components/PixelDogLoader";
import { Card } from "@/components/ui/Card";
import { createBlankDailyPlanDraft } from "@/lib/data/dailyPlans";
import { readNewDailyPlanBasicDraft, writeNewDailyPlanBasicDraft } from "@/lib/dailyPlan/basicDraft";
import { getProject } from "@/lib/data/projects";
import type { DailyPlanDraft, Project } from "@/lib/types";

function useProjectId() {
  const params = useParams<{ id: string | string[] }>();
  return Array.isArray(params.id) ? params.id[0] : params.id;
}

/** DB row를 만들기 전에 첫 일촬표의 기본 정보 초안만 준비합니다. */
export default function NewDailyPlanBasicPage() {
  const projectId = useProjectId();
  const router = useRouter();
  const [project, setProject] = useState<Project | null>(null);
  const [initialDraft, setInitialDraft] = useState<DailyPlanDraft | null>(null);
  const [isLoading, setIsLoading] = useState(true);
  const [errorMessage, setErrorMessage] = useState("");

  useEffect(() => {
    if (!projectId) return;
    getProject(projectId)
      .then((data) => {
        setProject(data);
        if (data) setInitialDraft(readNewDailyPlanBasicDraft(data.id) ?? createBlankDailyPlanDraft(data));
        setErrorMessage("");
      })
      .catch((error) => setErrorMessage(error instanceof Error ? error.message : "프로젝트 정보를 불러오지 못했습니다."))
      .finally(() => setIsLoading(false));
  }, [projectId]);

  if (isLoading) return <PixelDogLoader size="lg" />;
  if (!project || !initialDraft) {
    return <Card className="border-field-danger font-bold text-field-danger">{errorMessage || "프로젝트를 찾을 수 없습니다."}</Card>;
  }

  return (
    <DailyPlanBasicForm
      initialDraft={initialDraft}
      onSubmit={(draft) => {
        writeNewDailyPlanBasicDraft(project.id, draft);
        router.push(`/projects/${project.id}/daily-plans/new`);
      }}
    />
  );
}
