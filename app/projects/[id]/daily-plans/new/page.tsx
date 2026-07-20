"use client";

import { useEffect, useState } from "react";
import { useParams } from "next/navigation";
import { DailyPlanEditor } from "@/components/DailyPlanEditor";
import { Card } from "@/components/ui/Card";
import { getProject } from "@/lib/data/projects";
import type { Project } from "@/lib/types";

function useProjectId() {
  const params = useParams<{ id: string | string[] }>();
  const id = params.id;
  return Array.isArray(id) ? id[0] : id;
}

/** 새 웹 일촬표를 빈 양식으로 시작합니다. */
export default function NewDailyPlanPage() {
  const projectId = useProjectId();
  const [project, setProject] = useState<Project | null>(null);
  const [isLoading, setIsLoading] = useState(true);
  const [errorMessage, setErrorMessage] = useState("");

  useEffect(() => {
    if (!projectId) return;
    getProject(projectId)
      .then((data) => {
        setProject(data);
        setErrorMessage("");
      })
      .catch((error) => setErrorMessage(error instanceof Error ? error.message : "프로젝트 정보를 불러오지 못했습니다."))
      .finally(() => setIsLoading(false));
  }, [projectId]);

  if (isLoading) {
    return <Card className="text-field-muted">새 일촬표 화면을 불러오는 중입니다.</Card>;
  }

  if (!project) {
    return <Card className="border-field-danger font-bold text-field-danger">{errorMessage || "프로젝트를 찾을 수 없습니다."}</Card>;
  }

  return <DailyPlanEditor project={project} />;
}
