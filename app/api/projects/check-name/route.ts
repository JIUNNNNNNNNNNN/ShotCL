import { NextResponse } from "next/server";
import { cleanProjectName, normalizeProjectName } from "@/lib/projectAccess/core";
import { ProjectAccessUnavailableError, requireProjectAccessDb } from "@/lib/projectAccess/server";

export async function POST(request: Request) {
  try {
    const body = (await request.json()) as { projectName?: string };
    const projectName = cleanProjectName(body.projectName ?? "");
    if (!projectName) return NextResponse.json({ available: false, reason: "프로젝트 이름을 입력하세요." }, { status: 400 });

    const supabase = requireProjectAccessDb();
    const { data, error } = await supabase.from("projects").select("id").eq("normalized_name", normalizeProjectName(projectName)).limit(1);
    if (error) throw error;
    return NextResponse.json({ available: data.length === 0, reason: data.length ? "이미 존재하는 프로젝트 이름입니다" : "" });
  } catch (error) {
    const message = error instanceof ProjectAccessUnavailableError ? error.message : "프로젝트 이름을 확인하지 못했습니다.";
    return NextResponse.json({ available: false, reason: message }, { status: error instanceof ProjectAccessUnavailableError ? 503 : 500 });
  }
}
