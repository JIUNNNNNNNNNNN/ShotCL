"use client";

import dynamic from "next/dynamic";
import { useEffect, useState } from "react";
import { useParams } from "next/navigation";
import { PageLoader } from "@/components/PixelDogLoader";
import { ButtonLink } from "@/components/ui/Button";
import { Card } from "@/components/ui/Card";
import { getDailyPlanWithShots } from "@/lib/data/dailyPlans";
import { getProject, getProjectBasicInfo } from "@/lib/data/projects";
import { getProjectSceneList } from "@/lib/data/sceneList";
import { listProjectStaffMembers } from "@/lib/data/staffMembers";
import type {
  DailyPlanWithShots,
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
  const [projectBasicInfo, setProjectBasicInfo] = useState<ProjectBasicInfo | null>(null);
  const [projectStaffMembers, setProjectStaffMembers] = useState<ProjectStaffMember[]>([]);
  const [projectStaffDepartments, setProjectStaffDepartments] = useState<ProjectStaffDepartment[]>([]);
  const [sceneListItems, setSceneListItems] = useState<ProjectSceneItem[]>([]);
  const [dailyPlan, setDailyPlan] = useState<DailyPlanWithShots | null>(null);
  const [isLoading, setIsLoading] = useState(true);
  const [errorMessage, setErrorMessage] = useState("");

  useEffect(() => {
    if (!projectId || !dailyPlanId) return;

    async function loadDailyPlan() {
      void import("@/components/DailyPlanEditor").catch(() => undefined);
      try {
        const [projectData, planData, basicInfo, staffList, sceneList] = await Promise.all([
          getProject(projectId),
          getDailyPlanWithShots(projectId, dailyPlanId),
          getProjectBasicInfo(projectId).catch(() => null),
          listProjectStaffMembers(projectId).catch(() => null),
          getProjectSceneList(projectId).catch(() => null)
        ]);
        setProject(projectData);
        if (!projectData) {
          setDailyPlan(null);
          setProjectBasicInfo(null);
          setProjectStaffMembers([]);
          setProjectStaffDepartments([]);
          setSceneListItems([]);
          setErrorMessage("");
          return;
        }
        setDailyPlan(planData);
        setProjectBasicInfo(basicInfo);
        setProjectStaffMembers(staffList?.members ?? []);
        setProjectStaffDepartments(staffList?.departments ?? []);
        setSceneListItems(sceneList?.items ?? []);
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
    return <PageLoader />;
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
      projectBasicInfo={projectBasicInfo}
      projectStaffMembers={projectStaffMembers}
      projectStaffDepartments={projectStaffDepartments}
      sceneListItems={sceneListItems}
      initialPlan={dailyPlan.plan}
      initialShots={dailyPlan.shots}
    />
  );
}
