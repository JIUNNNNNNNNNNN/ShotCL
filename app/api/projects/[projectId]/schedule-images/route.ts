import { NextRequest, NextResponse } from "next/server";
import { normalizeDailyPlanMealTimes } from "@/lib/data/mappers";
import { getAccessGrant, ProjectAccessUnavailableError, requireProjectAccessDb } from "@/lib/projectAccess/server";
import {
  createProjectDeleteReceipt,
  ProjectDeleteReceiptError,
  verifyProjectDeleteReceipt
} from "@/lib/projectDeleteReceipt.server";
import { isValidDatabaseProjectId, normalizeProjectId } from "@/lib/projectId";

const STORAGE_BUCKET = "storyboards";
const SCHEDULE_IMAGE_DELETE_RECEIPT_KIND = "schedule-image";

type RouteContext = { params: Promise<{ projectId: string }> };
type ScheduleImageDeleteReceipt = {
  dailyPlanId: string;
  itemId: string;
  imageUrl: string;
  storagePath: string | null;
};

export async function DELETE(request: NextRequest, context: RouteContext) {
  try {
    const projectId = await requireAdminProject(request, context);
    if (projectId instanceof NextResponse) return projectId;
    const body = (await request.json()) as {
      dailyPlanId?: unknown;
      itemId?: unknown;
      imageUrl?: unknown;
      expectedUpdatedAt?: unknown;
    };
    const dailyPlanId = cleanDatabaseId(body.dailyPlanId);
    const itemId = cleanItemId(body.itemId);
    const expectedImageUrl = cleanUrl(body.imageUrl);
    const expectedUpdatedAt = String(body.expectedUpdatedAt ?? "").trim();
    if (!dailyPlanId || !itemId || !expectedImageUrl || !expectedUpdatedAt) {
      return NextResponse.json({ error: "삭제할 기타일정 이미지 정보가 없습니다." }, { status: 400 });
    }

    const supabase = requireProjectAccessDb();
    const { data: plan, error } = await supabase
      .from("daily_plans")
      .select("meal_times,updated_at")
      .eq("project_id", projectId)
      .eq("id", dailyPlanId)
      .maybeSingle();
    if (error) throw error;
    if (!plan) return NextResponse.json({ error: "일촬표를 찾을 수 없습니다." }, { status: 404 });
    if (String(plan.updated_at ?? "") !== expectedUpdatedAt) {
      return scheduleImageConflict(plan);
    }
    const mealTimes = normalizeDailyPlanMealTimes(plan.meal_times);
    const item = mealTimes.find((candidate) => candidate.id === itemId);
    if (!item) return NextResponse.json({ error: "기타일정을 찾을 수 없습니다." }, { status: 404 });
    if (item.imageUrl !== expectedImageUrl) {
      return NextResponse.json({ error: "기타일정 이미지가 다른 화면에서 변경되었습니다." }, { status: 409 });
    }

    const storagePath = scheduleStoragePathFromPublicUrl(
      expectedImageUrl,
      projectId,
      dailyPlanId,
      itemId
    );
    // Receipt creation precedes metadata removal. Storage bytes stay untouched
    // until this operation leaves the shared three-entry Undo stack.
    const receipt = createProjectDeleteReceipt({
      projectId,
      kind: SCHEDULE_IMAGE_DELETE_RECEIPT_KIND,
      payload: { dailyPlanId, itemId, imageUrl: expectedImageUrl, storagePath } satisfies ScheduleImageDeleteReceipt
    });
    const nextMealTimes = mealTimes.map((candidate) => (
      candidate.id === itemId ? { ...candidate, imageUrl: null } : candidate
    ));
    const saved = await saveMealTimes(supabase, projectId, dailyPlanId, nextMealTimes, expectedUpdatedAt);
    if (!saved) return scheduleImageConflict(plan);
    return NextResponse.json({
      ok: true,
      mealTimes: normalizeDailyPlanMealTimes(saved.meal_times),
      updatedAt: String(saved.updated_at ?? ""),
      receipt
    });
  } catch (error) {
    return scheduleImageError(error, "기타일정 이미지를 삭제하지 못했습니다.");
  }
}

export async function PUT(request: NextRequest, context: RouteContext) {
  try {
    const projectId = await requireAdminProject(request, context);
    if (projectId instanceof NextResponse) return projectId;
    const body = (await request.json()) as { receipt?: unknown };
    const snapshot = readScheduleImageDeleteReceipt(projectId, body.receipt);
    const supabase = requireProjectAccessDb();
    const { data: plan, error } = await supabase
      .from("daily_plans")
      .select("meal_times,updated_at")
      .eq("project_id", projectId)
      .eq("id", snapshot.dailyPlanId)
      .maybeSingle();
    if (error) throw error;
    if (!plan) return NextResponse.json({ error: "일촬표를 찾을 수 없습니다." }, { status: 404 });
    const mealTimes = normalizeDailyPlanMealTimes(plan.meal_times);
    const item = mealTimes.find((candidate) => candidate.id === snapshot.itemId);
    if (!item) return NextResponse.json({ error: "기타일정을 찾을 수 없습니다." }, { status: 404 });
    if (item.imageUrl === snapshot.imageUrl) {
      return NextResponse.json({
        ok: true,
        mealTimes,
        updatedAt: String(plan.updated_at ?? ""),
        idempotent: true
      });
    }
    if (item.imageUrl) {
      return NextResponse.json({ error: "다른 이미지가 이미 저장되어 있어 되돌릴 수 없습니다." }, { status: 409 });
    }
    const nextMealTimes = mealTimes.map((candidate) => (
      candidate.id === snapshot.itemId ? { ...candidate, imageUrl: snapshot.imageUrl } : candidate
    ));
    const saved = await saveMealTimes(
      supabase,
      projectId,
      snapshot.dailyPlanId,
      nextMealTimes,
      String(plan.updated_at ?? "")
    );
    if (!saved) return scheduleImageConflict(plan);
    return NextResponse.json({
      ok: true,
      mealTimes: normalizeDailyPlanMealTimes(saved.meal_times),
      updatedAt: String(saved.updated_at ?? "")
    });
  } catch (error) {
    return scheduleImageError(error, "기타일정 이미지 삭제를 되돌리지 못했습니다.");
  }
}

export async function POST(request: NextRequest, context: RouteContext) {
  try {
    const projectId = await requireAdminProject(request, context);
    if (projectId instanceof NextResponse) return projectId;
    const body = (await request.json()) as { receipt?: unknown };
    const snapshot = readScheduleImageDeleteReceipt(projectId, body.receipt);
    if (!snapshot.storagePath) return NextResponse.json({ ok: true, finalized: true });

    const supabase = requireProjectAccessDb();
    const { data: plan, error } = await supabase
      .from("daily_plans")
      .select("meal_times")
      .eq("project_id", projectId)
      .eq("id", snapshot.dailyPlanId)
      .maybeSingle();
    if (error) throw error;
    if (!plan) return NextResponse.json({ error: "일촬표를 찾을 수 없습니다." }, { status: 404 });
    const stillReferenced = normalizeDailyPlanMealTimes(plan.meal_times)
      .some((item) => item.imageUrl === snapshot.imageUrl);
    if (stillReferenced) {
      return NextResponse.json({ ok: true, finalized: false, restored: true });
    }
    const { error: removeError } = await supabase.storage
      .from(STORAGE_BUCKET)
      .remove([snapshot.storagePath]);
    if (removeError) throw removeError;
    return NextResponse.json({ ok: true, finalized: true });
  } catch (error) {
    return scheduleImageError(error, "기타일정 이미지 파일을 정리하지 못했습니다.");
  }
}

async function requireAdminProject(request: NextRequest, context: RouteContext) {
  const { projectId: routeProjectId } = await context.params;
  const projectId = normalizeProjectId(routeProjectId);
  if (!isValidDatabaseProjectId(projectId)) {
    return NextResponse.json({ error: "프로젝트 ID가 올바르지 않습니다." }, { status: 400 });
  }
  const grant = await getAccessGrant(request, projectId);
  if (!grant || grant.role !== "admin") {
    return NextResponse.json({ error: "Key staff 권한이 필요합니다." }, { status: grant ? 403 : 401 });
  }
  return projectId;
}

function readScheduleImageDeleteReceipt(projectId: string, receipt: unknown): ScheduleImageDeleteReceipt {
  const value = verifyProjectDeleteReceipt<unknown>(receipt, {
    projectId,
    kind: SCHEDULE_IMAGE_DELETE_RECEIPT_KIND
  });
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    throw new ProjectDeleteReceiptError();
  }
  const payload = value as Partial<ScheduleImageDeleteReceipt>;
  const dailyPlanId = cleanDatabaseId(payload.dailyPlanId);
  const itemId = cleanItemId(payload.itemId);
  const imageUrl = cleanUrl(payload.imageUrl);
  if (!dailyPlanId || !itemId || !imageUrl) throw new ProjectDeleteReceiptError();
  const canonicalPath = scheduleStoragePathFromPublicUrl(imageUrl, projectId, dailyPlanId, itemId);
  const storagePath = payload.storagePath === null
    ? null
    : typeof payload.storagePath === "string" ? payload.storagePath : "";
  if (storagePath !== canonicalPath) throw new ProjectDeleteReceiptError();
  return { dailyPlanId, itemId, imageUrl, storagePath };
}

function scheduleStoragePathFromPublicUrl(
  imageUrl: string,
  projectId: string,
  dailyPlanId: string,
  itemId: string
) {
  try {
    const pathname = new URL(imageUrl).pathname;
    const marker = `/storage/v1/object/public/${STORAGE_BUCKET}/`;
    const markerIndex = pathname.indexOf(marker);
    if (markerIndex < 0) return null;
    const storagePath = decodeURIComponent(pathname.slice(markerIndex + marker.length));
    const expectedPrefix = `storyboard-files/${projectId}/schedule-items/${safeName(`${dailyPlanId}-${itemId}`)}/`;
    return storagePath.startsWith(expectedPrefix) && !storagePath.includes("..") ? storagePath : null;
  } catch {
    return null;
  }
}

function safeName(value: string) {
  return value.normalize("NFKD").replace(/[^\w.\-]+/g, "-").replace(/-+/g, "-").replace(/^-|-$/g, "").slice(0, 120) || "storyboard-file";
}

function cleanDatabaseId(value: unknown) {
  const id = String(value ?? "").trim();
  return isValidDatabaseProjectId(id) ? id : "";
}

function cleanItemId(value: unknown) {
  const id = String(value ?? "").trim();
  return id && id.length <= 180 && /^[a-zA-Z0-9_-]+$/.test(id) ? id : "";
}

function cleanUrl(value: unknown) {
  const url = String(value ?? "").trim();
  return url && url.length <= 4000 ? url : "";
}

function saveMealTimes(
  supabase: ReturnType<typeof requireProjectAccessDb>,
  projectId: string,
  dailyPlanId: string,
  mealTimes: ReturnType<typeof normalizeDailyPlanMealTimes>,
  expectedUpdatedAt: string
) {
  return supabase
    .from("daily_plans")
    .update({ meal_times: mealTimes })
    .eq("project_id", projectId)
    .eq("id", dailyPlanId)
    .eq("updated_at", expectedUpdatedAt)
    .select("meal_times,updated_at")
    .maybeSingle()
    .then(({ data, error }) => {
      if (error) throw error;
      return data;
    });
}

function scheduleImageConflict(plan: { meal_times?: unknown; updated_at?: unknown }) {
  return NextResponse.json({
    error: "기타일정 이미지가 다른 화면에서 변경되었습니다.",
    mealTimes: normalizeDailyPlanMealTimes(plan.meal_times),
    latestUpdatedAt: String(plan.updated_at ?? "") || null
  }, { status: 409 });
}

function scheduleImageError(error: unknown, fallback: string) {
  return NextResponse.json(
    { error: error instanceof ProjectDeleteReceiptError ? error.message : fallback },
    { status: error instanceof ProjectDeleteReceiptError ? 400 : error instanceof ProjectAccessUnavailableError ? 503 : 500 }
  );
}
