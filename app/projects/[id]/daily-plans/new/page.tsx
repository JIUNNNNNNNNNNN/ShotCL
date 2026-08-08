"use client";

import dynamic from "next/dynamic";
import { useEffect, useState } from "react";
import { useParams } from "next/navigation";
import { PageLoader } from "@/components/PixelDogLoader";
import { Card } from "@/components/ui/Card";
import { getProject, getProjectBasicInfo } from "@/lib/data/projects";
import { getProjectSceneList } from "@/lib/data/sceneList";
import { listProjectStaffMembers } from "@/lib/data/staffMembers";
import type {
  Project,
  ProjectBasicInfo,
  ProjectSceneItem,
  ProjectStaffDepartment,
  ProjectStaffMember
} from "@/lib/types";

const DailyPlanEditor = dynamic(
  () => import("@/components/DailyPlanEditor").then((module) => module.DailyPlanEditor),
  { ssr: false, loading: () => <PageLoader /> }
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
  const [projectStaffMembers, setProjectStaffMembers] = useState<ProjectStaffMember[]>([]);
  const [projectStaffDepartments, setProjectStaffDepartments] = useState<ProjectStaffDepartment[]>([]);
  const [sceneListItems, setSceneListItems] = useState<ProjectSceneItem[]>([]);
  const [isLoading, setIsLoading] = useState(true);
  const [errorMessage, setErrorMessage] = useState("");

  useEffect(() => {
    if (!projectId) return;

    async function loadProject() {
      void import("@/components/DailyPlanEditor").catch(() => undefined);
      try {
        const [data, basicInfo, staffList, sceneList] = await Promise.all([
          getProject(projectId),
          getProjectBasicInfo(projectId).catch(() => null),
          listProjectStaffMembers(projectId).catch(() => null),
          getProjectSceneList(projectId).catch(() => null)
        ]);
        setProject(data);
        setProjectBasicInfo(data ? basicInfo : null);
        setProjectStaffMembers(data ? staffList?.members ?? [] : []);
        setProjectStaffDepartments(data ? staffList?.departments ?? [] : []);
        setSceneListItems(data ? sceneList?.items ?? [] : []);
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
    return <PageLoader />;
  }

  if (!project) {
    return <Card className="border-field-danger font-bold text-field-danger">{errorMessage || "프로젝트를 찾을 수 없습니다."}</Card>;
  }

  return (
    <DailyPlanEditor
      project={project}
      projectBasicInfo={projectBasicInfo}
      projectStaffMembers={projectStaffMembers}
      projectStaffDepartments={projectStaffDepartments}
      sceneListItems={sceneListItems}
    />
  );
}
