"use client";

import dynamic from "next/dynamic";
import { useEffect, useState } from "react";
import { useParams } from "next/navigation";
import { PixelDogLoader } from "@/components/PixelDogLoader";
import { Card } from "@/components/ui/Card";
import { getProject, getProjectBasicInfo } from "@/lib/data/projects";
import type { Project, ProjectBasicInfo } from "@/lib/types";

const DailyPlanEditor = dynamic(
  () => import("@/components/DailyPlanEditor").then((module) => module.DailyPlanEditor),
  { ssr: false, loading: () => <PixelDogLoader size="lg" /> }
);

function useProjectId() {
  const params = useParams<{ id: string | string[] }>();
  const id = params.id;
  return Array.isArray(id) ? id[0] : id;
}

/** 새 웹 일촬표를 빈 양식으로 시작합니다. */
export default function NewDailyPlanPage() {
  const projectId = useProjectId();
  const [project, setProject] = useState<Project | null>(null);
  const [projectBasicInfo, setProjectBasicInfo] = useState<ProjectBasicInfo | null>(null);
  const [isLoading, setIsLoading] = useState(true);
  const [errorMessage, setErrorMessage] = useState("");

  useEffect(() => {
    if (!projectId) return;

    async function loadProject() {
      try {
        const [data, basicInfo] = await Promise.all([
          getProject(projectId),
          getProjectBasicInfo(projectId).catch(() => null)
        ]);
        setProject(data);
        setProjectBasicInfo(data ? basicInfo : null);
        setErrorMessage("");
      } catch (error) {
        setErrorMessage(error instanceof Error ? error.message : "프로젝트 정보를 불러오지 못했습니다.");
      } finally {
        setIsLoading(false);
      }
    }

    loadProject();
  }, [projectId]);

  if (isLoading) {
    return <PixelDogLoader size="lg" />;
  }

  if (!project) {
    return <Card className="border-field-danger font-bold text-field-danger">{errorMessage || "프로젝트를 찾을 수 없습니다."}</Card>;
  }

  return <DailyPlanEditor project={project} projectBasicInfo={projectBasicInfo} />;
}
