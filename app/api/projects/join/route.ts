import { NextRequest, NextResponse } from "next/server";
import { cleanProjectName, isValidPasscode, normalizeProjectName, type SharedProjectRole } from "@/lib/projectAccess/core";
import {
  burnPasscodeVerification,
  clearJoinFailures,
  ensureSessionToken,
  getJoinAttemptKey,
  isJoinRateLimited,
  ProjectAccessUnavailableError,
  requireProjectAccessDb,
  saveAccessGrant,
  recordJoinFailure,
  verifyPasscode
} from "@/lib/projectAccess/server";

const INVALID_MESSAGE = "프로젝트 이름 또는 비밀번호가 올바르지 않습니다";

export async function POST(request: NextRequest) {
  try {
    const body = (await request.json()) as { projectName?: string; password?: string };
    const projectName = cleanProjectName(body.projectName ?? "");
    const password = body.password ?? "";
    if (!projectName || !isValidPasscode(password)) {
      return NextResponse.json({ error: "프로젝트 이름과 4자리 비밀번호를 입력하세요" }, { status: 400 });
    }

    const supabase = requireProjectAccessDb();
    const normalizedName = normalizeProjectName(projectName);
    const attemptKey = getJoinAttemptKey(request, normalizedName);
    if (await isJoinRateLimited(attemptKey)) {
      return NextResponse.json({ error: "잠시 후 다시 시도해주세요" }, { status: 429, headers: { "Retry-After": "900" } });
    }
    const { data: project, error: projectError } = await supabase
      .from("projects")
      .select("id,name,shoot_date,description,created_at,share_enabled")
      .eq("normalized_name", normalizedName)
      .eq("share_enabled", true)
      .maybeSingle();
    if (projectError) throw projectError;
    if (!project) {
      await burnPasscodeVerification(password);
      await recordJoinFailure(attemptKey);
      return NextResponse.json({ error: INVALID_MESSAGE }, { status: 401 });
    }

    const { data: credentials, error: credentialError } = await supabase.from("project_access_credentials").select("*").eq("project_id", project.id).maybeSingle();
    if (credentialError) throw credentialError;
    if (!credentials) {
      await burnPasscodeVerification(password);
      await recordJoinFailure(attemptKey);
      return NextResponse.json({ error: INVALID_MESSAGE }, { status: 401 });
    }

    const [matchesAdmin, matchesProgress] = await Promise.all([
      verifyPasscode(password, credentials.admin_password_hash, credentials.admin_password_salt),
      verifyPasscode(password, credentials.progress_password_hash, credentials.progress_password_salt)
    ]);
    const role: SharedProjectRole | null = matchesAdmin ? "admin" : matchesProgress ? "progress" : null;
    if (!role) {
      await recordJoinFailure(attemptKey);
      return NextResponse.json({ error: INVALID_MESSAGE }, { status: 401 });
    }
    await clearJoinFailures(attemptKey);

    const response = NextResponse.json({ success: true, projectId: project.id, projectName: project.name, role });
    const token = ensureSessionToken(request, response);
    await saveAccessGrant(token, project.id, role);
    return response;
  } catch (error) {
    const message = error instanceof ProjectAccessUnavailableError ? error.message : "프로젝트에 참여하지 못했습니다.";
    return NextResponse.json({ error: message }, { status: error instanceof ProjectAccessUnavailableError ? 503 : 500 });
  }
}
