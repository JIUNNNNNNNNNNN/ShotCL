"use client";

import dynamic from "next/dynamic";
import { useEffect, useState } from "react";
import { useParams } from "next/navigation";
import { DailyPlanReadOnlyView } from "@/components/DailyPlanReadOnlyView";
import { PageLoader } from "@/components/PixelDogLoader";
import { useProjectAccess } from "@/components/ProjectAccessGate";
import { useProjectWorkspace } from "@/components/ProjectWorkspaceContext";
import { ButtonLink } from "@/components/ui/Button";
import { Card } from "@/components/ui/Card";
import { getDailyPlanWithShotsFromApi } from "@/lib/data/dailyPlanRead";
import type {
  DailyPlanWithShots,
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
  const params = useParams<{ dailyPlanId: string | string[] }>();
  const dailyPlanId = Array.isArray(params.dailyPlanId) ? params.dailyPlanId[0] : params.dailyPlanId;
  return { dailyPlanId };
}

/** 저장된 일촬표를 다시 열어 수정합니다. */
export default function DailyPlanDetailPage() {
  const { dailyPlanId } = useRouteIds();
  const { isGuest } = useProjectAccess();

  return isGuest ? (
    <GuestDailyPlanDetail dailyPlanId={dailyPlanId} />
  ) : (
    <EditableDailyPlanDetail dailyPlanId={dailyPlanId} />
  );
}

/**
 * Guest는 scoped detail GET 한 번으로 canonical 문서만 그립니다. Editor import,
 * autosave, staff/basic-info/scene-list lookup은 이 component tree에 들어오지 않습니다.
 */
function GuestDailyPlanDetail({ dailyPlanId }: { dailyPlanId: string }) {
  const { project, projectId } = useProjectWorkspace();
  const requestKey = `${projectId}:${dailyPlanId}`;
  const [result, setResult] = useState<{
    requestKey: string;
    dailyPlan: DailyPlanWithShots | null;
    errorMessage: string;
    isLoading: boolean;
  }>(() => ({
    requestKey: "",
    dailyPlan: null,
    errorMessage: "",
    isLoading: true
  }));

  useEffect(() => {
    if (!projectId || !dailyPlanId) return;
    const abortController = new AbortController();
    setResult({
      requestKey,
      dailyPlan: null,
      errorMessage: "",
      isLoading: true
    });

    void getDailyPlanWithShotsFromApi(projectId, dailyPlanId, {
      signal: abortController.signal
    }).then((dailyPlan) => {
      if (abortController.signal.aborted) return;
      setResult({
        requestKey,
        dailyPlan,
        errorMessage: dailyPlan ? "" : "일촬표를 찾을 수 없습니다.",
        isLoading: false
      });
    }).catch((error) => {
      if (abortController.signal.aborted) return;
      setResult({
        requestKey,
        dailyPlan: null,
        errorMessage: error instanceof Error ? error.message : "일촬표를 불러오지 못했습니다.",
        isLoading: false
      });
    });

    return () => abortController.abort();
  }, [dailyPlanId, projectId, requestKey]);

  if (result.requestKey !== requestKey || result.isLoading) {
    return <PageLoader />;
  }

  if (!project || !result.dailyPlan) {
    return (
      <Card className="border-field-danger text-field-danger">
        <p className="font-bold">{result.errorMessage || "일촬표를 찾을 수 없습니다."}</p>
        <ButtonLink href={`/projects/${projectId}/daily-plans`} className="mt-4">
          저장된 일촬표 목록
        </ButtonLink>
      </Card>
    );
  }

  return (
    <DailyPlanReadOnlyView
      plan={result.dailyPlan.plan}
      shots={result.dailyPlan.shots}
    />
  );
}

/** 기존 인증 사용자용 editor 경로는 그대로 유지합니다. */
function EditableDailyPlanDetail({ dailyPlanId }: { dailyPlanId: string }) {
  const { project, projectId } = useProjectWorkspace();
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
        const [dailyPlansData, projectsData, staffData, sceneData] = await Promise.all([
          import("@/lib/data/dailyPlans"),
          import("@/lib/data/projects"),
          import("@/lib/data/staffMembers"),
          import("@/lib/data/sceneList")
        ]);
        const [planData, basicInfo, staffList, sceneList] = await Promise.all([
          dailyPlansData.getDailyPlanWithShots(projectId, dailyPlanId),
          projectsData.getProjectBasicInfo(projectId).catch(() => null),
          staffData.listProjectStaffMembers(projectId).catch(() => null),
          sceneData.getProjectSceneList(projectId).catch(() => null)
        ]);
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
