import { createClient } from "@supabase/supabase-js";

/** API route에서 RLS를 통과해 Supabase에 기록을 남기기 위한 서버 전용 클라이언트입니다. */
export function getSupabaseServerClient(accessToken?: string | null) {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL?.trim();
  const anonKey = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY?.trim();
  const serviceRoleKey = process.env.SUPABASE_SERVICE_ROLE_KEY?.trim();
  const forceLocalData = process.env.NEXT_PUBLIC_USE_LOCAL_DATA === "true";

  if (!url || forceLocalData || (!anonKey && !serviceRoleKey)) {
    return null;
  }

  const key = serviceRoleKey || anonKey;
  const headers = accessToken ? { Authorization: `Bearer ${accessToken}` } : undefined;

  return createClient(url, key!, {
    auth: {
      autoRefreshToken: false,
      persistSession: false
    },
    global: {
      headers
    }
  });
}

/** 비밀번호 hash와 접근 세션처럼 브라우저에 노출하면 안 되는 테이블 전용입니다. */
export function getSupabaseAdminClient() {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL?.trim();
  const serviceRoleKey = process.env.SUPABASE_SERVICE_ROLE_KEY?.trim();
  const forceLocalData = process.env.NEXT_PUBLIC_USE_LOCAL_DATA === "true";

  if (!url || !serviceRoleKey || forceLocalData) return null;

  return createClient(url, serviceRoleKey, {
    auth: { autoRefreshToken: false, persistSession: false }
  });
}
