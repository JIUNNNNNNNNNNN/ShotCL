export type ShotclGoogleIdentityInput = {
  id?: unknown;
  email?: unknown;
  emailConfirmedAt?: unknown;
  provider?: unknown;
  providers?: unknown;
  identities?: unknown;
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

/**
 * Supabase 사용자의 연결된 identity를 우선 확인하고, identities가 생략되는
 * 응답 경로에서는 trusted app_metadata.providers만 보조로 봅니다.
 * primary provider 한 필드만으로는 연결된 Google identity를 증명하지 않습니다.
 */
export function hasLinkedGoogleIdentity(
  value: Pick<ShotclGoogleIdentityInput, "email" | "provider" | "providers" | "identities">
) {
  const canonicalEmail = normalizeShotclAccountEmail(value.email);
  const linkedGoogleIdentities = Array.isArray(value.identities)
    ? value.identities.filter((identity) => {
      if (!identity || typeof identity !== "object" || Array.isArray(identity)) return false;
      return normalizeAuthProvider((identity as { provider?: unknown }).provider) === "google";
    })
    : [];

  if (linkedGoogleIdentities.length > 0) {
    return linkedGoogleIdentities.some((identity) => {
      const identityData = (identity as { identity_data?: unknown }).identity_data;
      if (!identityData || typeof identityData !== "object" || Array.isArray(identityData)) {
        return true;
      }
      const data = identityData as { email?: unknown; email_verified?: unknown };
      const identityEmail = normalizeShotclAccountEmail(data.email);
      if (data.email_verified === false) return false;
      return !identityEmail || identityEmail === canonicalEmail;
    });
  }
  if (Array.isArray(value.identities) && value.identities.length > 0) return false;
  if (Array.isArray(value.providers)
    && value.providers.some((provider) => normalizeAuthProvider(provider) === "google")) {
    return true;
  }
  return false;
}

/** Google identity가 연결되고 이메일 확인이 끝난 Supabase 사용자만 신뢰합니다. */
export function normalizeTrustedGoogleIdentity(
  value: ShotclGoogleIdentityInput
) {
  const id = typeof value.id === "string" ? value.id.trim() : "";
  const email = normalizeShotclAccountEmail(value.email);
  const emailConfirmedAt = typeof value.emailConfirmedAt === "string"
    ? value.emailConfirmedAt.trim()
    : "";
  if (!id || !email || !emailConfirmedAt || !hasLinkedGoogleIdentity(value)) return null;
  return { id, email, provider: "google" as const, emailConfirmedAt };
}

function normalizeAuthProvider(value: unknown) {
  return typeof value === "string" ? value.trim().toLowerCase() : "";
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
