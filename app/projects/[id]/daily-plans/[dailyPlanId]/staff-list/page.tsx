import { redirect } from "next/navigation";

/** 기존 회차별 URL 북마크는 프로젝트 공통 스탭 리스트로 이동합니다. */
export default async function LegacyStaffListPage({
  params
}: {
  params: Promise<{ id: string; dailyPlanId: string }>;
}) {
  const { id } = await params;
  redirect(`/projects/${encodeURIComponent(id)}/staff-list`);
}
