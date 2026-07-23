import { NextRequest, NextResponse } from "next/server";

type LegacyStaffRouteContext = {
  params: Promise<{ projectId: string; dailyPlanId: string }>;
};

/** 기존 회차별 API 호출도 프로젝트 단위 스탭 API로 안전하게 전달합니다. */
export async function GET(request: NextRequest, context: LegacyStaffRouteContext) {
  return redirectToProjectStaffRoute(request, context);
}

/** 308 redirect로 PUT method와 body를 그대로 유지합니다. */
export async function PUT(request: NextRequest, context: LegacyStaffRouteContext) {
  return redirectToProjectStaffRoute(request, context);
}

async function redirectToProjectStaffRoute(request: NextRequest, context: LegacyStaffRouteContext) {
  const { projectId } = await context.params;
  return NextResponse.redirect(
    new URL(`/api/projects/${encodeURIComponent(projectId)}/staff-list`, request.url),
    308
  );
}
