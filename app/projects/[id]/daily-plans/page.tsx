"use client";

import { useEffect, useRef } from "react";
import { useRouter } from "next/navigation";
import { PageLoader } from "@/components/PixelDogLoader";
import { useProjectWorkspace } from "@/components/ProjectWorkspaceContext";
import { ButtonLink } from "@/components/ui/Button";
import { Card } from "@/components/ui/Card";
import { confirmUnsavedChangesNavigation } from "@/hooks/useUnsavedChangesGuard";
import { buildDailyPlanRoundHref, buildNewDailyPlanHref } from "@/lib/projectNavigation";

/**
 * 이전 회차 선택 URL을 보존합니다. 회차 선택과 관리 작업은 프로젝트 좌측
 * navigation이 담당하며, 회차가 하나뿐일 때만 canonical 상세 URL로 바로 이동합니다.
 */
export default function DailyPlansPage() {
  const router = useRouter();
  const { project, dailyPlans, isLoading, error } = useProjectWorkspace();
  const redirectAttemptRef = useRef("");

  useEffect(() => {
    if (isLoading || error || !project || dailyPlans.length !== 1) {
      redirectAttemptRef.current = "";
      return;
    }

    const dailyPlanId = dailyPlans[0]?.id.trim();
    if (!dailyPlanId) return;
    const target = buildDailyPlanRoundHref(project.id, dailyPlanId);
    if (redirectAttemptRef.current === target) return;
    redirectAttemptRef.current = target;
    if (!confirmUnsavedChangesNavigation()) return;
    router.replace(target);
  }, [dailyPlans, error, isLoading, project, router]);

  if (isLoading) return <PageLoader />;

  if (!project) {
    return (
      <Card className="border-field-danger font-bold text-field-danger">
        {error || "프로젝트를 찾을 수 없습니다."}
      </Card>
    );
  }

  if (error) {
    return <Card className="border-field-danger font-bold text-field-danger">{error}</Card>;
  }

  if (dailyPlans.length === 0) {
    return (
      <section className="flex min-h-[min(28rem,calc(100dvh-8rem))] min-w-0 items-center justify-center px-3 py-6">
        <Card className="w-full max-w-md text-center">
          <h1 className="ui-density-heading break-words font-display font-black text-field-text [overflow-wrap:anywhere]">{project.name}</h1>
          <p className="mt-3 text-sm leading-6 text-field-muted">아직 저장된 일촬표가 없습니다.</p>
          <ButtonLink
            href={buildNewDailyPlanHref(project.id)}
            className="mt-5"
          >
            새 일촬표 만들기
          </ButtonLink>
        </Card>
      </section>
    );
  }

  return (
    <section className="flex min-h-[min(24rem,calc(100dvh-8rem))] min-w-0 items-center justify-center px-3 py-6">
      <Card className="w-full max-w-md text-center">
        <h1 className="ui-density-heading break-words font-display font-black text-field-text [overflow-wrap:anywhere]">{project.name}</h1>
        <p className="mt-3 text-sm leading-6 text-field-muted">
          좌측 일촬표 메뉴에서 회차를 선택하세요.
        </p>
      </Card>
    </section>
  );
}
