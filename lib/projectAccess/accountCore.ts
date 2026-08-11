export type ShotclGoogleIdentityInput = {
  id?: unknown;
  email?: unknown;
  emailConfirmedAt?: unknown;
  provider?: unknown;
};

export type EffectiveProjectRoleInput = {
  accountAuthenticated: boolean;
  accountEligible: boolean;
  isOwner: boolean;
  membershipRole: unknown;
  guestInviteActive: boolean;
  legacyGrantRole: unknown;
};

export function normalizeShotclAccountEmail(value: unknown) {
  return typeof value === "string" ? value.trim().toLowerCase() : "";
}

/** 서버 전용 환경변수의 쉼표/줄바꿈 목록을 정규화하고 중복을 제거합니다. */
export function parseShotclEditorGoogleEmails(value: string | undefined) {
  if (!value?.trim()) return [];
  return [...new Set(
    value
      .split(/[\n,]/)
      .map(normalizeShotclAccountEmail)
      .filter(Boolean)
  )];
}

export function isShotclEditorGoogleEmail(
  email: unknown,
  allowlistedEmails: readonly string[]
) {
  const normalizedEmail = normalizeShotclAccountEmail(email);
  return Boolean(normalizedEmail && allowlistedEmails.includes(normalizedEmail));
}

/** Google이 primary provider이고 이메일 확인이 끝난 Supabase 사용자만 신뢰합니다. */
export function normalizeTrustedGoogleIdentity(
  value: ShotclGoogleIdentityInput
) {
  const id = typeof value.id === "string" ? value.id.trim() : "";
  const email = normalizeShotclAccountEmail(value.email);
  const provider = typeof value.provider === "string"
    ? value.provider.trim().toLowerCase()
    : "";
  const emailConfirmedAt = typeof value.emailConfirmedAt === "string"
    ? value.emailConfirmedAt.trim()
    : "";
  if (!id || !email || provider !== "google" || !emailConfirmedAt) return null;
  return { id, email, provider: "google" as const, emailConfirmedAt };
}

/**
 * admin은 allowlisted Google 계정이 해당 프로젝트 owner/admin membership일 때만
 * 유효합니다. 초대 링크와 기존 passcode 세션은 읽기 전용 Staff로 축소합니다.
 */
export function resolveEffectiveProjectRole(input: EffectiveProjectRoleInput) {
  if (input.accountAuthenticated) {
    if (input.accountEligible && (input.isOwner || input.membershipRole === "admin")) {
      return "admin" as const;
    }
    if (input.isOwner || input.membershipRole === "admin" || input.membershipRole === "crew") {
      return "progress" as const;
    }
    return input.guestInviteActive ? "progress" as const : null;
  }
  if (input.guestInviteActive || input.legacyGrantRole === "admin" || input.legacyGrantRole === "progress") {
    return "progress" as const;
  }
  return null;
}
