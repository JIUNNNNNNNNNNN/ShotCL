import { NextRequest, NextResponse } from "next/server";
import { cleanProjectName, isValidPasscode, normalizeProjectName } from "@/lib/projectAccess/core";
import {
  ensureSessionToken,
  hashPasscode,
  ProjectAccessUnavailableError,
  requireProjectAccessDb,
  saveAccessGrant
} from "@/lib/projectAccess/server";

export async function POST(request: NextRequest) {
  try {
    const body = (await request.json()) as { projectName?: string; adminPassword?: string; progressPassword?: string; shootDate?: string };
    const projectName = cleanProjectName(body.projectName ?? "");
    const adminPassword = body.adminPassword ?? "";
    const progressPassword = body.progressPassword ?? "";
    if (!projectName || !isValidPasscode(adminPassword) || !isValidPasscode(progressPassword)) {
      return NextResponse.json({ error: "프로젝트 이름과 4자리 비밀번호 2개를 입력하세요." }, { status: 400 });
    }
    if (adminPassword === progressPassword) {
      return NextResponse.json({ error: "관리자 비밀번호와 진행도 비밀번호는 서로 달라야 합니다." }, { status: 400 });
    }

    const supabase = requireProjectAccessDb();
    const normalizedName = normalizeProjectName(projectName);
    const { data: duplicate, error: duplicateError } = await supabase.from("projects").select("id").eq("normalized_name", normalizedName).limit(1);
    if (duplicateError) throw duplicateError;
    if (duplicate.length) return NextResponse.json({ error: "이미 존재하는 프로젝트 이름입니다" }, { status: 409 });

    const [adminSecret, progressSecret] = await Promise.all([hashPasscode(adminPassword), hashPasscode(progressPassword)]);
    const { data: project, error: projectError } = await supabase
      .from("projects")
      .insert({
        name: projectName,
        normalized_name: normalizedName,
        shoot_date: body.shootDate || null,
        description: "",
        share_enabled: true
      })
      .select("id,name,shoot_date,description,created_at,share_enabled")
      .single();
    if (projectError) {
      if (projectError.code === "23505") return NextResponse.json({ error: "이미 존재하는 프로젝트 이름입니다" }, { status: 409 });
      throw projectError;
    }

    const { error: credentialError } = await supabase.from("project_access_credentials").insert({
      project_id: project.id,
      admin_password_hash: adminSecret.hash,
      admin_password_salt: adminSecret.salt,
      progress_password_hash: progressSecret.hash,
      progress_password_salt: progressSecret.salt
    });
    if (credentialError) {
      await supabase.from("projects").delete().eq("id", project.id);
      throw credentialError;
    }

    const response = NextResponse.json({ success: true, project: { ...project, access_role: "admin" }, role: "admin" }, { status: 201 });
    const token = ensureSessionToken(request, response);
    try {
      await saveAccessGrant(token, project.id, "admin");
    } catch (error) {
      await supabase.from("projects").delete().eq("id", project.id);
      throw error;
    }
    return response;
  } catch (error) {
    const message = error instanceof ProjectAccessUnavailableError ? error.message : "프로젝트를 만들지 못했습니다.";
    return NextResponse.json({ error: message }, { status: error instanceof ProjectAccessUnavailableError ? 503 : 500 });
  }
}
