import { NextRequest, NextResponse } from "next/server";
import {
  canAdministerProject,
  getAccessGrant,
  ProjectAccessUnavailableError,
  requireProjectAccessDb
} from "@/lib/projectAccess/server";
import { isValidDatabaseProjectId, normalizeProjectId } from "@/lib/projectId";
import { normalizeShotOverheadDiagram } from "@/lib/shotOverhead";

type RouteContext = { params: Promise<{ projectId: string }> };

const DIAGRAM_TYPE = "overhead";
const SELECT_COLUMNS = "id,project_id,daily_plan_id,shot_ref,diagram_type,data,created_at,updated_at";

export async function GET(request: NextRequest, context: RouteContext) {
  try {
    const projectId = await getValidatedProjectId(context);
    if (!projectId) return NextResponse.json({ error: "프로젝트 ID가 올바르지 않습니다." }, { status: 400 });

    const role = await getDiagramAccessRole(request, projectId);
    if (!role) return NextResponse.json({ error: "프로젝트 접근 권한이 없습니다." }, { status: 403 });

    const dailyPlanId = normalizeKeyPart(request.nextUrl.searchParams.get("dailyPlanId"));
    const shotRef = normalizeKeyPart(request.nextUrl.searchParams.get("shotRef"));
    if (!dailyPlanId || !shotRef) {
      return NextResponse.json({ error: "회차와 컷 식별값이 필요합니다." }, { status: 400 });
    }

    const supabase = requireProjectAccessDb();
    const { data, error } = await supabase
      .from("shot_diagrams")
      .select(SELECT_COLUMNS)
      .eq("project_id", projectId)
      .eq("daily_plan_id", dailyPlanId)
      .eq("shot_ref", shotRef)
      .eq("diagram_type", DIAGRAM_TYPE)
      .maybeSingle();
    if (error) throw error;

    return NextResponse.json({
      ok: true,
      diagram: data ? normalizeShotOverheadDiagram(data.data) : null
    });
  } catch (error) {
    return diagramErrorResponse(error, "부감도를 불러오지 못했습니다.");
  }
}

export async function PUT(request: NextRequest, context: RouteContext) {
  try {
    const projectId = await getValidatedProjectId(context);
    if (!projectId) return NextResponse.json({ error: "프로젝트 ID가 올바르지 않습니다." }, { status: 400 });

    const role = await getDiagramAccessRole(request, projectId);
    if (role !== "admin") return NextResponse.json({ error: "부감도는 Key staff만 저장할 수 있습니다." }, { status: 403 });

    const body = (await request.json()) as {
      dailyPlanId?: unknown;
      shotRef?: unknown;
      data?: unknown;
    };
    const dailyPlanId = normalizeKeyPart(body.dailyPlanId);
    const shotRef = normalizeKeyPart(body.shotRef);
    const diagram = normalizeShotOverheadDiagram(body.data);
    if (!dailyPlanId || !shotRef) {
      return NextResponse.json({ error: "회차와 컷 식별값이 필요합니다." }, { status: 400 });
    }
    if (!diagram) return NextResponse.json({ error: "부감도 데이터 형식이 올바르지 않습니다." }, { status: 400 });

    const supabase = requireProjectAccessDb();
    const { data, error } = await supabase
      .from("shot_diagrams")
      .upsert(
        {
          project_id: projectId,
          daily_plan_id: dailyPlanId,
          shot_ref: shotRef,
          diagram_type: DIAGRAM_TYPE,
          data: diagram,
          updated_at: new Date().toISOString()
        },
        { onConflict: "project_id,daily_plan_id,shot_ref,diagram_type" }
      )
      .select(SELECT_COLUMNS)
      .single();
    if (error) throw error;

    return NextResponse.json({
      ok: true,
      status: "saved",
      diagram: normalizeShotOverheadDiagram(data.data)
    });
  } catch (error) {
    return diagramErrorResponse(error, "부감도를 저장하지 못했습니다.");
  }
}

async function getValidatedProjectId(context: RouteContext) {
  const { projectId: routeProjectId } = await context.params;
  const projectId = normalizeProjectId(routeProjectId);
  return isValidDatabaseProjectId(projectId) ? projectId : null;
}

async function getDiagramAccessRole(request: NextRequest, projectId: string) {
  const grant = await getAccessGrant(request, projectId);
  if (grant) return grant.role;
  return (await canAdministerProject(request, projectId)) ? "admin" : null;
}

function normalizeKeyPart(value: unknown) {
  return typeof value === "string" ? value.trim().slice(0, 500) : "";
}

function diagramErrorResponse(error: unknown, message: string) {
  if (error instanceof ProjectAccessUnavailableError) {
    return NextResponse.json({ error: message, code: "SHOT_DIAGRAM_STORAGE_UNAVAILABLE" }, { status: 503 });
  }
  console.error("[shot-diagrams]", getSafeDatabaseError(error));
  return NextResponse.json({ error: message, code: "SHOT_DIAGRAM_STORAGE_ERROR" }, { status: 500 });
}

function getSafeDatabaseError(error: unknown) {
  if (!error || typeof error !== "object") return { message: String(error) };
  const source = error as { code?: unknown; message?: unknown; details?: unknown; hint?: unknown };
  return {
    code: typeof source.code === "string" ? source.code : undefined,
    message: typeof source.message === "string" ? source.message : "Unknown database error",
    details: typeof source.details === "string" ? source.details : undefined,
    hint: typeof source.hint === "string" ? source.hint : undefined
  };
}
