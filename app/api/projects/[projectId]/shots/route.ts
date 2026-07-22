import { NextRequest, NextResponse } from "next/server";
import { getAccessGrant, ProjectAccessUnavailableError, requireProjectAccessDb } from "@/lib/projectAccess/server";
import { shotDraftToInsertRow } from "@/lib/data/mappers";
import type { ShotDraft } from "@/lib/types";

export async function GET(request: NextRequest, context: { params: Promise<{ projectId: string }> }) {
  try {
    const { projectId } = await context.params;
    const grant = await getAccessGrant(request, projectId);
    if (!grant) return NextResponse.json({ error: "프로젝트 접근 권한이 없습니다." }, { status: 401 });
    const supabase = requireProjectAccessDb();
    const { data, error } = await supabase.from("shots").select("*").eq("project_id", projectId).order("order_index").order("created_at");
    if (error) throw error;
    return NextResponse.json({ shots: data });
  } catch (error) {
    return NextResponse.json({ error: "컷 목록을 불러오지 못했습니다." }, { status: error instanceof ProjectAccessUnavailableError ? 503 : 500 });
  }
}

export async function POST(request: NextRequest, context: { params: Promise<{ projectId: string }> }) {
  try {
    const { projectId } = await context.params;
    const grant = await getAccessGrant(request, projectId);
    if (!grant || grant.role !== "admin") return NextResponse.json({ error: "관리자 권한이 필요합니다." }, { status: grant ? 403 : 401 });
    const body = (await request.json()) as { drafts?: ShotDraft[] };
    const drafts = body.drafts ?? [];
    const supabase = requireProjectAccessDb();
    const { data: lastRows, error: lastError } = await supabase.from("shots").select("order_index").eq("project_id", projectId).order("order_index", { ascending: false }).limit(1);
    if (lastError) throw lastError;
    const maxOrder = lastRows?.[0]?.order_index ?? 0;
    if (!drafts.length) return NextResponse.json({ shots: [] });
    const rows = drafts.map((draft, index) => shotDraftToInsertRow(projectId, draft, maxOrder + index + 1));
    const { data, error } = await supabase.from("shots").insert(rows).select("*").order("order_index");
    if (error) throw error;
    return NextResponse.json({ shots: data });
  } catch (error) {
    return NextResponse.json({ error: "컷을 추가하지 못했습니다." }, { status: error instanceof ProjectAccessUnavailableError ? 503 : 500 });
  }
}

export async function DELETE(request: NextRequest, context: { params: Promise<{ projectId: string }> }) {
  try {
    const { projectId } = await context.params;
    const grant = await getAccessGrant(request, projectId);
    if (!grant || grant.role !== "admin") return NextResponse.json({ error: "관리자 권한이 필요합니다." }, { status: grant ? 403 : 401 });
    const supabase = requireProjectAccessDb();
    const { error } = await supabase.from("shots").delete().eq("project_id", projectId);
    if (error) throw error;
    return NextResponse.json({ success: true });
  } catch (error) {
    return NextResponse.json({ error: "컷 목록을 삭제하지 못했습니다." }, { status: error instanceof ProjectAccessUnavailableError ? 503 : 500 });
  }
}
