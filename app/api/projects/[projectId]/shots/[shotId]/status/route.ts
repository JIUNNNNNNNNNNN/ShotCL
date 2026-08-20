import { NextRequest, NextResponse } from "next/server";
import {
  getProjectRequestAccess,
  ProjectAccessUnavailableError,
  requireProjectAccessDb
} from "@/lib/projectAccess/server";
import { isValidDatabaseProjectId, normalizeProjectId } from "@/lib/projectId";
import {
  isGuestProgressStatusTransitionAllowed,
  parseProgressStatusMutationPayload
} from "@/lib/projectAccess/guestApiAccess";

export async function PATCH(request: NextRequest, context: { params: Promise<{ projectId: string; shotId: string }> }) {
  try {
    const { projectId: routeProjectId, shotId } = await context.params;
    const projectId = normalizeProjectId(routeProjectId);
    if (!isValidDatabaseProjectId(projectId)) return NextResponse.json({ error: "프로젝트 ID가 올바르지 않습니다." }, { status: 400 });
    if (!isValidDatabaseProjectId(shotId)) return NextResponse.json({ error: "컷 ID가 올바르지 않습니다." }, { status: 400 });

    const access = await getProjectRequestAccess(request, projectId);
    const grant = access?.grant ?? null;
    const isGuest = access?.mode === "guest";
    const canUpdateStatus = grant?.role === "admin"
      || (access?.mode === "member" && access.editorEligible)
      || isGuest;
    // 유효한 invite Guest에게도 이 status endpoint만 열며 legacy grant와
    // 비허용 계정의 다른 mutation 권한은 확장하지 않습니다.
    if (!grant || !canUpdateStatus) {
      return NextResponse.json(
        { error: "컷 상태 변경 권한이 없습니다." },
        { status: grant ? 403 : 401 }
      );
    }

    const status = parseProgressStatusMutationPayload(await request.json().catch(() => null));
    if (!status) return NextResponse.json({ error: "허용되지 않은 상태 변경 요청입니다." }, { status: 400 });

    const supabase = requireProjectAccessDb();
    const { data: current, error: currentError } = await supabase.from("shots").select("id,status").eq("id", shotId).eq("project_id", projectId).maybeSingle();
    if (currentError) throw currentError;
    if (!current) return NextResponse.json({ error: "컷을 찾을 수 없습니다." }, { status: 404 });
    if (
      isGuest
      && !isGuestProgressStatusTransitionAllowed(current.status, status)
    ) {
      return NextResponse.json({ error: "Guest는 OK 또는 OMIT 상태만 변경할 수 있습니다." }, { status: 403 });
    }

    const { data, error } = await supabase.from("shots").update({ status }).eq("id", shotId).eq("project_id", projectId).select("*").single();
    if (error) throw error;
    return NextResponse.json({ shot: data });
  } catch (error) {
    return NextResponse.json({ error: "컷 상태를 변경하지 못했습니다." }, { status: error instanceof ProjectAccessUnavailableError ? 503 : 500 });
  }
}
