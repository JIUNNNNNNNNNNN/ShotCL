"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import { useRouter } from "next/navigation";
import { PageLoader } from "@/components/PixelDogLoader";
import { useProjectAccess } from "@/components/ProjectAccessGate";
import { ProjectBasicInfoForm } from "@/components/ProjectBasicInfoForm";
import { ProjectPageActionsMenu } from "@/components/ProjectPageActionsMenu";
import { ProjectPermanentDeleteDialog } from "@/components/ProjectPermanentDeleteDialog";
import { useProjectWorkspace } from "@/components/ProjectWorkspaceContext";
import { Card } from "@/components/ui/Card";
import type { ProjectPageActionMenuRegistration } from "@/components/ProjectPageActions";
import { getProjectBasicInfo, saveProjectBasicInfo } from "@/lib/data/projects";
import { setProjectDeletionMainNotice } from "@/lib/projectAccess/projectDeletionNotice.client";
import { markProjectDeletedInThisTab } from "@/lib/projectAccess/deletedProjectMarker.client";
import type { ProjectBasicInfo } from "@/lib/types";

/** 새 프로젝트 생성 직후와 관리자 수정 메뉴가 함께 사용하는 프로젝트 기본정보 화면입니다. */
export default function ProjectBasicInfoPage() {
  const router = useRouter();
  const { isCreator } = useProjectAccess();
  const { project, projectId, updateProjectBasicInfo } = useProjectWorkspace();
  const [basicInfo, setBasicInfo] = useState<ProjectBasicInfo | null>(null);
  const [isLoading, setIsLoading] = useState(true);
  const [errorMessage, setErrorMessage] = useState("");
  const [isDeleteDialogOpen, setIsDeleteDialogOpen] = useState(false);

  const projectSettingsActionMenu = useMemo<ProjectPageActionMenuRegistration | null>(() => (
    isCreator && project
      ? {
          key: "projectSettings",
          scopeKey: `project-settings:${project.id}`,
          actions: {
            projectPermanentDelete: {
              onSelect: () => setIsDeleteDialogOpen(true)
            }
          }
        }
      : null
  ), [isCreator, project]);

  useEffect(() => {
    if (!projectId) {
      setErrorMessage("프로젝트를 찾을 수 없습니다.");
      setIsLoading(false);
      return undefined;
    }

    let active = true;
    setIsLoading(true);
    void getProjectBasicInfo(projectId)
      .then((basicInfoData) => {
        if (!active) return;
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

  const persistBasicInfo = useCallback(async (nextValue: ProjectBasicInfo) => {
    if (!project) throw new Error("프로젝트를 찾을 수 없습니다.");
    const saved = await saveProjectBasicInfo(project.id, nextValue);
    setBasicInfo(saved);
    updateProjectBasicInfo(saved);
  }, [project, updateProjectBasicInfo]);

  const completeBasicInfo = useCallback(() => {
    if (project) router.replace(`/projects/${project.id}`);
  }, [project, router]);

  const handleProjectDeleted = useCallback(async () => {
    if (!projectId) return;
    markProjectDeletedInThisTab(projectId);
    setProjectDeletionMainNotice();
    try {
      const { clearDeletedProjectClientState } = await import("@/lib/projectAccess/projectDeletion.client");
      clearDeletedProjectClientState(projectId);
    } catch {
      // Server deletion already succeeded. The marker and hard navigation keep this fail-closed.
    }
    // Hard replace tears down active Realtime/subscriptions and discards the
    // in-memory Next route tree so browser back cannot paint a stale project.
    window.location.replace("/");
  }, [projectId]);

  if (isLoading) return <PageLoader />;
  if (!project || !basicInfo) {
    return (
      <Card className="border-field-danger text-field-danger">
        <p className="font-bold">{errorMessage || "프로젝트를 찾을 수 없습니다."}</p>
      </Card>
    );
  }

  return (
    <>
      <ProjectBasicInfoForm
        projectId={project.id}
        projectName={project.name}
        initialValue={basicInfo}
        onAutoSave={persistBasicInfo}
        onComplete={completeBasicInfo}
        headerAction={<ProjectPageActionsMenu registration={projectSettingsActionMenu} />}
      />
      {isCreator && isDeleteDialogOpen ? (
        <ProjectPermanentDeleteDialog
          key={`${project.id}:permanent-delete`}
          open
          projectId={project.id}
          projectName={project.name}
          onClose={() => setIsDeleteDialogOpen(false)}
          onDeleted={handleProjectDeleted}
        />
      ) : null}
    </>
  );
}
