"use client";

import { useCallback, useEffect, useState } from "react";
import Link from "next/link";
import { useParams, useRouter } from "next/navigation";
import { Copy, Plus, Trash2 } from "lucide-react";
import { PixelDogLoader } from "@/components/PixelDogLoader";
import { PageHeader } from "@/components/PageHeader";
import { Button, ButtonLink } from "@/components/ui/Button";
import { Card } from "@/components/ui/Card";
import { deleteDailyPlan, duplicateDailyPlan, listDailyPlans } from "@/lib/data/dailyPlans";
import { getProject } from "@/lib/data/projects";
import type { DailyPlan, Project } from "@/lib/types";

type DailyPlanListItem = DailyPlan & { shotCount: number };

function useProjectId() {
  const params = useParams<{ id: string | string[] }>();
  const id = params.id;
  return Array.isArray(id) ? id[0] : id;
}

/** 저장된 일촬표 목록을 보여주고 복사/삭제를 처리합니다. */
export default function DailyPlansPage() {
  const projectId = useProjectId();
  const router = useRouter();
  const [project, setProject] = useState<Project | null>(null);
  const [plans, setPlans] = useState<DailyPlanListItem[]>([]);
  const [isLoading, setIsLoading] = useState(true);
  const [isBusy, setIsBusy] = useState(false);
  const [errorMessage, setErrorMessage] = useState("");
  const [message, setMessage] = useState("");

  const refresh = useCallback(async () => {
    if (!projectId) return;

    try {
      const projectData = await getProject(projectId);
      setProject(projectData);
      if (!projectData) {
        setPlans([]);
        setErrorMessage("");
        return;
      }
      const planData = await listDailyPlans(projectData.id);
      setPlans(planData);
      setErrorMessage("");
    } catch (error) {
      setErrorMessage(error instanceof Error ? error.message : "저장된 일촬표 목록을 불러오지 못했습니다.");
    } finally {
      setIsLoading(false);
    }
  }, [projectId]);

  useEffect(() => {
    refresh();
  }, [refresh]);

  async function handleDuplicate(planId: string) {
    if (!projectId) return;
    setIsBusy(true);
    setErrorMessage("");
    setMessage("");

    try {
      const duplicated = await duplicateDailyPlan(projectId, planId);
      router.push(`/projects/${projectId}/daily-plans/${duplicated.plan.id}`);
    } catch (error) {
      setErrorMessage(error instanceof Error ? error.message : "일촬표를 복사하지 못했습니다.");
    } finally {
      setIsBusy(false);
    }
  }

  async function handleDelete(plan: DailyPlanListItem) {
    if (!projectId) return;
    const shouldDelete = window.confirm(`"${plan.title}" 일촬표를 삭제할까요? 컷 진행표(shots)는 자동으로 삭제하지 않습니다.`);
    if (!shouldDelete) return;

    setIsBusy(true);
    setErrorMessage("");
    setMessage("");

    try {
      await deleteDailyPlan(projectId, plan.id);
      setMessage("일촬표를 삭제했습니다.");
      await refresh();
    } catch (error) {
      setErrorMessage(error instanceof Error ? error.message : "일촬표를 삭제하지 못했습니다.");
    } finally {
      setIsBusy(false);
    }
  }

  if (isLoading) {
    return <PixelDogLoader />;
  }

  if (!project) {
    return <Card className="border-field-danger font-bold text-field-danger">{errorMessage || "프로젝트를 찾을 수 없습니다."}</Card>;
  }

  return (
    <>
      <PageHeader
        title="저장된 일촬표"
        description={project.name}
        actions={<ButtonLink href={`/projects/${project.id}/daily-plans/new/basic`}><Plus className="h-5 w-5" aria-hidden />새 일촬표 만들기</ButtonLink>}
      />

      <div className="mb-4 grid gap-1">
        <p className="text-sm font-bold leading-6 text-field-muted">저장된 일촬표를 다시 열어 수정하거나, 이전 회차를 복사해 새 일촬표로 시작할 수 있습니다.</p>
        <p className="text-xs font-bold text-field-muted">외부 표 관리는 Google Spreadsheet 연동으로 대체할 예정이며, 현재는 웹 편집기를 이용해주세요.</p>
      </div>

      {message ? <div className="mb-4 rounded-md border border-field-primary bg-field-light p-4 text-sm font-bold text-field-primary">{message}</div> : null}
      {errorMessage ? <div className="mb-4 rounded-md border border-field-danger bg-white p-4 text-sm font-bold text-field-danger">{errorMessage}</div> : null}

      {plans.length === 0 ? (
        <Card>
          <h2 className="text-xl font-black text-field-primary">아직 저장된 일촬표가 없습니다</h2>
          <p className="mt-2 text-base leading-6 text-field-muted">웹 편집기에서 새 일촬표를 만들어 시작하세요.</p>
          <div className="mt-5 md:max-w-xs">
            <ButtonLink href={`/projects/${project.id}/daily-plans/new/basic`}>
              <Plus className="h-5 w-5" aria-hidden />
              새 일촬표 만들기
            </ButtonLink>
          </div>
        </Card>
      ) : (
        <div className="grid gap-4 md:grid-cols-2 xl:grid-cols-3">
          {plans.map((plan) => (
            <Card key={plan.id}>
              <div className="min-w-0">
                <p className="text-xs font-black text-field-muted">{plan.sourceType === "web_editor" ? "웹 편집기" : "가져온 일촬표"}</p>
                <h2 className="mt-1 break-words text-lg font-black text-field-primary">{plan.title || "제목 없는 일촬표"}</h2>
                <p className="mt-2 text-sm font-bold leading-6 text-field-muted">
                  촬영일: {plan.shootingDate || "미정"} · 회차: {plan.episode || "-"} · 컷 {plan.shotCount}개
                </p>
                <p className="mt-1 text-xs font-bold text-field-muted">수정일: {new Date(plan.updatedAt).toLocaleString("ko-KR")}</p>
              </div>
              <div className="mt-4 grid gap-2">
                <Link
                  href={`/projects/${project.id}/daily-plans/${plan.id}`}
                  className="inline-flex min-h-11 items-center justify-center rounded-full border border-field-primary bg-field-primary px-4 text-sm font-black text-white"
                >
                  열기
                </Link>
                <div className="grid grid-cols-2 gap-2">
                  <Button variant="secondary" onClick={() => handleDuplicate(plan.id)} disabled={isBusy}>
                    <Copy className="h-4 w-4" aria-hidden />
                    복사해서 새 일촬표 만들기
                  </Button>
                  <Button variant="danger" onClick={() => handleDelete(plan)} disabled={isBusy}>
                    <Trash2 className="h-4 w-4" aria-hidden />
                    삭제
                  </Button>
                </div>
              </div>
            </Card>
          ))}
        </div>
      )}
    </>
  );
}
