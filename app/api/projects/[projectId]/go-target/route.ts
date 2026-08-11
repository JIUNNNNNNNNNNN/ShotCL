import { NextRequest, NextResponse } from "next/server";
import { getKoreaDateOnly } from "@/lib/koreaDate";
import { calculateDailyProgress, calculateDailyProgressByPlan } from "@/lib/progress/dailyProgress";
import { resolveRelevantProgressRound } from "@/lib/progress/resolveRelevantRound";
import {
  getAccessGrant,
  ProjectAccessUnavailableError,
  requireProjectAccessDb
} from "@/lib/projectAccess/server";
import { isValidDatabaseProjectId, normalizeProjectId } from "@/lib/projectId";

export const dynamic = "force-dynamic";
export const revalidate = 0;

const NO_STORE_HEADERS = {
  "Cache-Control": "private, no-store, max-age=0",
  Vary: "Cookie"
};
const EMPTY_PROGRESS = calculateDailyProgress([]);

type GoPlanRow = {
  id?: unknown;
  shooting_date?: unknown;
  episode?: unknown;
};

type GoProgressRow = {
  id?: unknown;
  daily_plan_id?: unknown;
  status?: unknown;
};

/**
 * Go에 필요한 최소 field만 최신 조회해, 권한이 확인된 한 프로젝트 안에서
 * canonical 진행도 기준의 대상 회차를 결정합니다.
 */
export async function GET(
  request: NextRequest,
  context: { params: Promise<{ projectId: string }> }
) {
  let projectId = "";
  try {
    const { projectId: routeProjectId } = await context.params;
    projectId = normalizeProjectId(routeProjectId);
    if (!isValidDatabaseProjectId(projectId)) {
      return NextResponse.json(
        { ok: false, error: "프로젝트 ID가 올바르지 않습니다." },
        { status: 400, headers: NO_STORE_HEADERS }
      );
    }

    // service-role 조회보다 먼저 현재 cookie grant를 검증해 project 격리를 보장합니다.
    const grant = await getAccessGrant(request, projectId);
    if (!grant) {
      return NextResponse.json(
        { ok: false, error: "프로젝트 접근 권한이 없습니다." },
        { status: 401, headers: NO_STORE_HEADERS }
      );
    }

    const supabase = requireProjectAccessDb();
    const [
      { data: planRows, error: planError },
      { data: progressRows, error: progressError }
    ] = await Promise.all([
      supabase
        .from("daily_plans")
        .select("id,shooting_date,episode")
        .eq("project_id", projectId),
      supabase
        .from("shots")
        .select("id,daily_plan_id,status")
        .eq("project_id", projectId)
    ]);
    if (planError) throw planError;
    if (progressError) throw progressError;

    const plans = ((planRows ?? []) as GoPlanRow[]).flatMap((row) => {
      const id = String(row.id ?? "").trim();
      if (!id) return [];
      return [{
        id,
        shootingDate: String(row.shooting_date ?? "").trim(),
        episode: String(row.episode ?? "").trim()
      }];
    });
    const accessiblePlanIds = new Set(plans.map((plan) => plan.id));
    const progressByPlan = calculateDailyProgressByPlan(
      ((progressRows ?? []) as GoProgressRow[]).flatMap((row, index) => {
        const dailyPlanId = String(row.daily_plan_id ?? "").trim();
        if (!accessiblePlanIds.has(dailyPlanId)) return [];
        return [{
          id: String(row.id ?? `${dailyPlanId}:go-progress:${index}`),
          dailyPlanId,
          status: row.status
        }];
      })
    );
    const todayKorea = getKoreaDateOnly();
    if (!todayKorea) throw new Error("대한민국 현재 날짜를 계산하지 못했습니다.");

    const resolution = resolveRelevantProgressRound(
      plans.map((plan) => ({
        ...plan,
        progress: progressByPlan.get(plan.id) ?? EMPTY_PROGRESS
      })),
      todayKorea
    );

    if (resolution.status === "invalid-today") {
      throw new Error("대한민국 현재 날짜가 올바르지 않습니다.");
    }
    if (resolution.status === "resolved") {
      return NextResponse.json(
        {
          ok: true,
          targetDailyPlanId: resolution.round.id,
          reason: resolution.reason
        },
        { headers: NO_STORE_HEADERS }
      );
    }

    return NextResponse.json(
      {
        ok: true,
        targetDailyPlanId: null,
        reason: "empty"
      },
      { headers: NO_STORE_HEADERS }
    );
  } catch (error) {
    console.error("[go-target] 대상 회차 판정 실패", {
      projectId: projectId || null,
      message: error instanceof Error ? error.message : "unknown error"
    });
    return NextResponse.json(
      { ok: false, error: "열어야 할 회차를 확인하지 못했습니다." },
      {
        status: error instanceof ProjectAccessUnavailableError ? 503 : 500,
        headers: NO_STORE_HEADERS
      }
    );
  }
}
