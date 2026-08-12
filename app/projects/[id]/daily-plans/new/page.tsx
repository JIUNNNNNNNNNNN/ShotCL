"use client";

import dynamic from "next/dynamic";
import { useEffect, useState } from "react";
import { PageLoader } from "@/components/PixelDogLoader";
import { useProjectWorkspace } from "@/components/ProjectWorkspaceContext";
import { Card } from "@/components/ui/Card";
import { getProjectBasicInfo } from "@/lib/data/projects";
import { getProjectSceneList } from "@/lib/data/sceneList";
import { listProjectStaffMembers } from "@/lib/data/staffMembers";
import type {
  ProjectBasicInfo,
  ProjectSceneItem,
  ProjectStaffDepartment,
  ProjectStaffMember
} from "@/lib/types";

const DailyPlanEditor = dynamic(
  () => import("@/components/DailyPlanEditor").then((module) => module.DailyPlanEditor),
  { ssr: false, loading: () => <PageLoader /> }
);

/** 새 웹 일촬표를 빈 양식으로 시작합니다. */
export default function NewDailyPlanPage() {
  const { project, projectId } = useProjectWorkspace();
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
        const [basicInfo, staffList, sceneList] = await Promise.all([
          getProjectBasicInfo(projectId).catch(() => null),
          listProjectStaffMembers(projectId).catch(() => null),
          getProjectSceneList(projectId).catch(() => null)
        ]);
        setProjectBasicInfo(project ? basicInfo : null);
        setProjectStaffMembers(project ? staffList?.members ?? [] : []);
        setProjectStaffDepartments(project ? staffList?.departments ?? [] : []);
        setSceneListItems(project ? sceneList?.items ?? [] : []);
        setErrorMessage("");
      } catch (error) {
        setErrorMessage(error instanceof Error ? error.message : "프로젝트 정보를 불러오지 못했습니다.");
      } finally {
        setIsLoading(false);
      }
    }

    loadProject();
  }, [project, projectId]);

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
