"use client";

import { useCallback, useEffect, useState } from "react";
import { useParams, useRouter } from "next/navigation";
import { PageLoader } from "@/components/PixelDogLoader";
import { ProjectBasicInfoForm } from "@/components/ProjectBasicInfoForm";
import { useProjectWorkspace } from "@/components/ProjectWorkspaceContext";
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
  const { updateProjectBasicInfo } = useProjectWorkspace();
  const [project, setProject] = useState<Project | null>(null);
  const [basicInfo, setBasicInfo] = useState<ProjectBasicInfo | null>(null);
  const [isLoading, setIsLoading] = useState(true);
  const [errorMessage, setErrorMessage] = useState("");

  useEffect(() => {
    if (!projectId) {
      setErrorMessage("프로젝트를 찾을 수 없습니다.");
      setIsLoading(false);
      return undefined;
    }

    let active = true;
    setIsLoading(true);
    void Promise.all([getProject(projectId), getProjectBasicInfo(projectId)])
      .then(([projectData, basicInfoData]) => {
        if (!active) return;
        setProject(projectData);
        setBasicInfo(basicInfoData);
        setErrorMessage("");
      })
      .catch((error) => {
        if (!active) return;
        setErrorMessage(error instanceof Error ? error.message : "프로젝트 기본정보를 불러오지 못했습니다.");
      })
      .finally(() => {
        if (active) setIsLoading(false);
      });

    return () => {
      active = false;
    };
  }, [projectId]);

  const saveBasicInfo = useCallback(async (nextValue: ProjectBasicInfo) => {
    if (!project) throw new Error("프로젝트를 찾을 수 없습니다.");
    const saved = await saveProjectBasicInfo(project.id, nextValue);
    setBasicInfo(saved);
    updateProjectBasicInfo(saved);
    router.replace(`/projects/${project.id}`);
  }, [project, router, updateProjectBasicInfo]);

  if (isLoading) return <PageLoader />;
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
      onSave={saveBasicInfo}
    />
  );
}
