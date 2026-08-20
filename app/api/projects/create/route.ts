import { NextRequest, NextResponse } from "next/server";
import { cleanProjectName, isValidPasscode, normalizeProjectName } from "@/lib/projectAccess/core";
import {
  hashPasscode,
  ProjectAccessUnavailableError,
  requireProjectAccessDb
} from "@/lib/projectAccess/server";
import {
  resolveShotclAuthenticatedAccount,
  ShotclAccountUnavailableError
} from "@/lib/projectAccess/accountServer";

export async function POST(request: NextRequest) {
  try {
    const account = await resolveShotclAuthenticatedAccount(request);
    if (!account) {
      return NextResponse.json(
        {
          error: "Google 계정으로 로그인한 뒤 프로젝트를 만들 수 있습니다.",
          code: "GOOGLE_ACCOUNT_REQUIRED"
        },
        { status: 401 }
      );
    }
    if (!account.isEditor) {
      return NextResponse.json(
        {
          error: "이 계정에는 프로젝트 생성 권한이 없습니다. 현재 테스트 버전에서는 승인된 계정만 새 프로젝트를 만들 수 있습니다.",
          code: "EDITOR_ACCOUNT_REQUIRED"
        },
        { status: 403 }
      );
    }

    const body = (await request.json()) as { projectName?: string; adminPassword?: string; progressPassword?: string; shootDate?: string };
    const projectName = cleanProjectName(body.projectName ?? "");
    const adminPassword = body.adminPassword ?? "";
    const progressPassword = body.progressPassword ?? "";
    if (!projectName || !isValidPasscode(adminPassword) || !isValidPasscode(progressPassword)) {
      return NextResponse.json({ error: "프로젝트 이름과 4자리 비밀번호 2개를 입력하세요." }, { status: 400 });
    }
    if (adminPassword === progressPassword) {
      return NextResponse.json({ error: "Key staff 비밀번호와 Staff 비밀번호는 서로 달라야 합니다." }, { status: 400 });
    }

    const supabase = requireProjectAccessDb();
    const normalizedName = normalizeProjectName(projectName);
    const { data: duplicate, error: duplicateError } = await supabase.from("projects").select("id").eq("normalized_name", normalizedName).limit(1);
    if (duplicateError) throw duplicateError;
    if (duplicate.length) return NextResponse.json({ error: "이미 존재하는 프로젝트 이름입니다" }, { status: 409 });

    const [adminSecret, progressSecret] = await Promise.all([hashPasscode(adminPassword), hashPasscode(progressPassword)]);
    const projectId = crypto.randomUUID();
    const { data: project, error: projectError } = await supabase.rpc(
      "create_project_with_access",
      {
        p_project_id: projectId,
        p_creator_user_id: account.userId,
        p_project_name: projectName,
        p_normalized_name: normalizedName,
        p_shoot_date: body.shootDate || null,
        p_admin_password_hash: adminSecret.hash,
        p_admin_password_salt: adminSecret.salt,
        p_progress_password_hash: progressSecret.hash,
        p_progress_password_salt: progressSecret.salt
      }
    );
    if (projectError) {
      if (projectError.code === "23505") return NextResponse.json({ error: "이미 존재하는 프로젝트 이름입니다" }, { status: 409 });
      throw projectError;
    }

    if (!project || typeof project !== "object" || Array.isArray(project)) {
      throw new Error("Project creation RPC returned an invalid result.");
    }
    return NextResponse.json(
      { success: true, project: { ...project, access_role: "admin" }, role: "admin" },
      { status: 201 }
    );
  } catch (error) {
    const unavailable = error instanceof ProjectAccessUnavailableError || error instanceof ShotclAccountUnavailableError;
    const message = unavailable ? error.message : "프로젝트를 만들지 못했습니다.";
    return NextResponse.json({ error: message }, { status: unavailable ? 503 : 500 });
  }
}
