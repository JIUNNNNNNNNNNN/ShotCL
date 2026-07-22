"use client";

import { useEffect, useState } from "react";
import { useParams } from "next/navigation";
import { PixelDogLoader } from "@/components/PixelDogLoader";
import { DailyPlanEditor } from "@/components/DailyPlanEditor";
import { ButtonLink } from "@/components/ui/Button";
import { Card } from "@/components/ui/Card";
import { getDailyPlanWithShots } from "@/lib/data/dailyPlans";
import { getProject } from "@/lib/data/projects";
import type { DailyPlanWithShots, Project } from "@/lib/types";

function useRouteIds() {
  const params = useParams<{ id: string | string[]; dailyPlanId: string | string[] }>();
  const id = Array.isArray(params.id) ? params.id[0] : params.id;
  const dailyPlanId = Array.isArray(params.dailyPlanId) ? params.dailyPlanId[0] : params.dailyPlanId;
  return { projectId: id, dailyPlanId };
}

/** 저장된 일촬표를 다시 열어 수정합니다. */
export default function DailyPlanDetailPage() {
  const { projectId, dailyPlanId } = useRouteIds();
  const [project, setProject] = useState<Project | null>(null);
  const [dailyPlan, setDailyPlan] = useState<DailyPlanWithShots | null>(null);
  const [isLoading, setIsLoading] = useState(true);
  const [errorMessage, setErrorMessage] = useState("");

  useEffect(() => {
    if (!projectId || !dailyPlanId) return;

    async function loadDailyPlan() {
      try {
        const projectData = await getProject(projectId);
        setProject(projectData);
        if (!projectData) {
          setDailyPlan(null);
          setErrorMessage("");
          return;
        }
        const planData = await getDailyPlanWithShots(projectData.id, dailyPlanId);
        setDailyPlan(planData);
        setErrorMessage("");
      } catch (error) {
        setErrorMessage(error instanceof Error ? error.message : "일촬표를 불러오지 못했습니다.");
      } finally {
        setIsLoading(false);
      }
    }

    loadDailyPlan();
  }, [projectId, dailyPlanId]);

  if (isLoading) {
    return <PixelDogLoader size="lg" />;
  }

  if (!project || !dailyPlan) {
    return (
      <Card className="border-field-danger text-field-danger">
        <p className="font-bold">{errorMessage || "일촬표를 찾을 수 없습니다."}</p>
        <ButtonLink href={`/projects/${projectId}/daily-plans`} className="mt-4">
          저장된 일촬표 목록
        </ButtonLink>
      </Card>
    );
  }

  return (
    <DailyPlanEditor
      project={project}
      initialPlan={dailyPlan.plan}
      initialShots={dailyPlan.shots}
    />
  );
}
