import { createClient, type SupabaseClient } from "@supabase/supabase-js";

let browserClient: SupabaseClient | null = null;

/** 브라우저에 키 값을 노출하지 않고, 설정 여부만 화면에서 점검할 때 씁니다. */
export function getSupabaseEnvStatus() {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL?.trim() ?? "";
  const anonKey = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY?.trim() ?? "";
  const forceLocalData = process.env.NEXT_PUBLIC_USE_LOCAL_DATA === "true";
  const enableDevAnonAuth = process.env.NEXT_PUBLIC_ENABLE_DEV_ANON_AUTH === "true";

  return {
    hasUrl: Boolean(url),
    hasAnonKey: Boolean(anonKey),
    forceLocalData,
    enableDevAnonAuth,
    canUseSupabase: Boolean(url && anonKey && !forceLocalData)
  };
}

/** Supabase 환경변수가 모두 있을 때만 실제 Supabase 모드로 전환합니다. */
export function hasSupabaseEnv() {
  return getSupabaseEnvStatus().canUseSupabase;
}

/** 브라우저에서 재사용할 Supabase 클라이언트를 하나만 만듭니다. */
export function getSupabaseBrowserClient() {
  if (!hasSupabaseEnv()) {
    return null;
  }

  if (!browserClient) {
    browserClient = createClient(
      process.env.NEXT_PUBLIC_SUPABASE_URL!,
      process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!
    );
  }

  return browserClient;
}

/** 개발 중 로그인 화면 없이 Supabase RLS를 통과할 익명 인증 세션을 준비합니다. */
export async function ensureSupabaseDevSession() {
  const env = getSupabaseEnvStatus();
  const supabase = getSupabaseBrowserClient();

  if (!supabase || !env.enableDevAnonAuth) {
    return;
  }

  const { data: sessionData, error: sessionError } = await supabase.auth.getSession();
  if (sessionError) {
    throw new Error(`개발용 익명 세션 확인 실패: ${sessionError.message}`);
  }

  if (sessionData.session) {
    return;
  }

  const { error: signInError } = await supabase.auth.signInAnonymously();
  if (signInError) {
    throw new Error(`개발용 익명 로그인 실패: ${signInError.message}. Supabase Auth에서 Anonymous sign-ins를 켰는지 확인하세요.`);
  }
}
