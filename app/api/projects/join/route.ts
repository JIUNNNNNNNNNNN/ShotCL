import { NextRequest, NextResponse } from "next/server";
import {
  cleanProjectName,
  getJoinAccessReason,
  isValidPasscode,
  normalizeProjectName,
  type SharedProjectRole
} from "@/lib/projectAccess/core";
import {
  burnPasscodeVerification,
  clearProjectGuestInviteCookie,
  clearJoinFailures,
  ensureSessionToken,
  getJoinAttemptKey,
  getProjectJoinAttemptKey,
  isJoinRateLimited,
  ProjectAccessUnavailableError,
  requireProjectAccessDb,
  saveAccessGrant,
  recordJoinFailure,
  verifyPasscode
} from "@/lib/projectAccess/server";
import {
  resolveShotclAuthenticatedAccount,
  ShotclAccountUnavailableError
} from "@/lib/projectAccess/accountServer";

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
    const { data: project, error: projectError } = await supabase
      .from("projects")
      .select("id,name,shoot_date,description,created_at,share_enabled")
      .eq("normalized_name", normalizedName)
      .eq("share_enabled", true)
      .maybeSingle();
    if (projectError) throw projectError;
    const attemptKey = project
      ? getProjectJoinAttemptKey(request, project.id)
      : getJoinAttemptKey(request, normalizedName);
    if (await isJoinRateLimited(attemptKey)) {
      return NextResponse.json({ error: "잠시 후 다시 시도해주세요" }, { status: 429, headers: { "Retry-After": "900" } });
    }
    if (!project) {
      await burnPasscodeVerification(password);
      await recordJoinFailure(attemptKey);
      return NextResponse.json({ error: INVALID_MESSAGE }, { status: 401 });
    }

    const { data: credentials, error: credentialError } = await supabase.from("project_access_credentials").select("*").eq("project_id", project.id).maybeSingle();
    if (credentialError) throw credentialError;
    if (!credentials) {
      await burnPasscodeVerification(password);
      await recordJoinFailure(attemptKey, project.id);
      return NextResponse.json({ error: INVALID_MESSAGE }, { status: 401 });
    }

    const [matchesAdmin, matchesProgress] = await Promise.all([
      verifyPasscode(password, credentials.admin_password_hash, credentials.admin_password_salt),
      verifyPasscode(password, credentials.progress_password_hash, credentials.progress_password_salt)
    ]);
    const passwordRole: SharedProjectRole | null = matchesAdmin ? "admin" : matchesProgress ? "progress" : null;
    if (!passwordRole) {
      await recordJoinFailure(attemptKey, project.id);
      return NextResponse.json({ error: INVALID_MESSAGE }, { status: 401 });
    }
    await clearJoinFailures(attemptKey);

    const account = await resolveShotclAuthenticatedAccount(request);
    let role: SharedProjectRole = "progress";
    if (account) {
      const { data: existingMembership, error: membershipReadError } = await supabase
        .from("project_members")
        .select("role")
        .eq("project_id", project.id)
        .eq("user_id", account.userId)
        .maybeSingle();
      if (membershipReadError) throw membershipReadError;
      const membershipRole = existingMembership?.role === "admin" || (passwordRole === "admin" && account.isEditor)
        ? "admin"
        : "crew";
      const { error: membershipError } = await supabase.from("project_members").upsert({
        project_id: project.id,
        user_id: account.userId,
        role: membershipRole
      }, { onConflict: "project_id,user_id" });
      if (membershipError) throw membershipError;
      role = account.isEditor && membershipRole === "admin" ? "admin" : "progress";
    }

    const response = NextResponse.json({
      success: true,
      projectId: project.id,
      projectName: project.name,
      role,
      reason: getJoinAccessReason(passwordRole, Boolean(account))
    });
    if (!account) {
      // 기존 이름/비밀번호 참여는 호환을 위해 남기되, 계정 없는 cookie grant는
      // 어떤 비밀번호를 썼더라도 읽기 전용 Staff로만 발급합니다.
      const token = ensureSessionToken(request, response);
      await saveAccessGrant(token, project.id, "progress");
    }
    // 비밀번호 Join은 사용자가 방금 명시적으로 선택한 Staff/member 흐름입니다.
    // 과거 또는 같은 프로젝트의 guest capability가 이후 access 판정을 가로채지 않게 합니다.
    clearProjectGuestInviteCookie(response);
    return response;
  } catch (error) {
    const unavailable = error instanceof ProjectAccessUnavailableError || error instanceof ShotclAccountUnavailableError;
    const message = unavailable ? error.message : "프로젝트에 참여하지 못했습니다.";
    return NextResponse.json({ error: message }, { status: unavailable ? 503 : 500 });
  }
}
