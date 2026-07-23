"use client";

import { useEffect, useState } from "react";
import { useParams, useRouter } from "next/navigation";
import { PixelDogLoader } from "@/components/PixelDogLoader";
import { ProjectBasicInfoForm } from "@/components/ProjectBasicInfoForm";
import { Card } from "@/components/ui/Card";
import { getProject, getProjectBasicInfo, saveProjectBasicInfo } from "@/lib/data/projects";
import type { Project, ProjectBasicInfo } from "@/lib/types";

function useProjectId() {
  const params = useParams<{ id: string | string[] }>();
  return Array.isArray(params.id) ? params.id[0] : params.id;
}

/** 새 프로젝트 생성 직후와 관리자 수정 메뉴가 함께 사용하는 프로젝트 기본정보 화면입니다. */
export default function ProjectBasicInfoPage() {
  const projectId = useProjectId();
  const router = useRouter();
  const [project, setProject] = useState<Project | null>(null);
  const [basicInfo, setBasicInfo] = useState<ProjectBasicInfo | null>(null);
  const [isLoading, setIsLoading] = useState(true);
  const [errorMessage, setErrorMessage] = useState("");

  useEffect(() => {
    if (!projectId) return;
    Promise.all([getProject(projectId), getProjectBasicInfo(projectId)])
      .then(([projectData, basicInfoData]) => {
        setProject(projectData);
        setBasicInfo(basicInfoData);
        setErrorMessage("");
      })
      .catch((error) => setErrorMessage(error instanceof Error ? error.message : "프로젝트 기본정보를 불러오지 못했습니다."))
      .finally(() => setIsLoading(false));
  }, [projectId]);

  if (isLoading) return <PixelDogLoader size="lg" />;
  if (!project || !basicInfo) {
    return (
      <Card className="border-field-danger text-field-danger">
        <p className="font-bold">{errorMessage || "프로젝트를 찾을 수 없습니다."}</p>
      </Card>
    );
  }

  return (
    <ProjectBasicInfoForm
      projectName={project.name}
      initialValue={basicInfo}
      onSave={async (nextValue) => {
        await saveProjectBasicInfo(project.id, nextValue);
        router.replace(`/projects/${project.id}`);
      }}
    />
  );
}
