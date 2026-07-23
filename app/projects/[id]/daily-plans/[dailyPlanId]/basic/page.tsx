"use client";

import { useEffect, useState } from "react";
import { useParams, useRouter } from "next/navigation";
import { DailyPlanBasicForm } from "@/components/DailyPlanBasicForm";
import { PixelDogLoader } from "@/components/PixelDogLoader";
import { Card } from "@/components/ui/Card";
import { dailyPlanShotToDraft, getDailyPlanWithShots, saveDailyPlanWithShots } from "@/lib/data/dailyPlans";
import { dailyPlanToDraft } from "@/lib/dailyPlan/basicDraft";
import { getProject } from "@/lib/data/projects";
import type { DailyPlanWithShots, Project } from "@/lib/types";

function useRouteIds() {
  const params = useParams<{ id: string | string[]; dailyPlanId: string | string[] }>();
  return {
    projectId: Array.isArray(params.id) ? params.id[0] : params.id,
    dailyPlanId: Array.isArray(params.dailyPlanId) ? params.dailyPlanId[0] : params.dailyPlanId
  };
}

/** 저장된 일촬표의 기본 정보만 같은 dailyPlan ID로 수정합니다. */
export default function DailyPlanBasicPage() {
  const { projectId, dailyPlanId } = useRouteIds();
  const router = useRouter();
  const [project, setProject] = useState<Project | null>(null);
  const [dailyPlan, setDailyPlan] = useState<DailyPlanWithShots | null>(null);
  const [isLoading, setIsLoading] = useState(true);
  const [errorMessage, setErrorMessage] = useState("");

  useEffect(() => {
    if (!projectId || !dailyPlanId) return;
    Promise.all([getProject(projectId), getDailyPlanWithShots(projectId, dailyPlanId)])
      .then(([projectData, planData]) => {
        setProject(projectData);
        setDailyPlan(planData);
        setErrorMessage("");
      })
      .catch((error) => setErrorMessage(error instanceof Error ? error.message : "기본 정보를 불러오지 못했습니다."))
      .finally(() => setIsLoading(false));
  }, [dailyPlanId, projectId]);

  if (isLoading) return <PixelDogLoader size="lg" />;
  if (!project || !dailyPlan) {
    return <Card className="border-field-danger font-bold text-field-danger">{errorMessage || "일촬표를 찾을 수 없습니다."}</Card>;
  }

  return (
    <DailyPlanBasicForm
      initialDraft={dailyPlanToDraft(dailyPlan.plan)}
      submitLabel="저장하고 편집 계속"
      statusLabel="저장된 일촬표"
      onSubmit={async (draft) => {
        await saveDailyPlanWithShots({
          projectId: project.id,
          dailyPlanId: dailyPlan.plan.id,
          plan: draft,
          shots: dailyPlan.shots.map(dailyPlanShotToDraft)
        });
        router.push(`/projects/${project.id}/daily-plans/${dailyPlan.plan.id}`);
      }}
    />
  );
}
