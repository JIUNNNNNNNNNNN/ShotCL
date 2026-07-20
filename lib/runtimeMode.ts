/** 브라우저 데이터 저장 방식과 개발용 인증 허용 여부를 한 곳에서 판별합니다. */
export function getRuntimeModeStatus() {
  const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL?.trim() ?? "";
  const supabaseAnonKey = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY?.trim() ?? "";
  const forceLocalData = process.env.NEXT_PUBLIC_USE_LOCAL_DATA === "true";
  const devAnonymousAuthRequested = process.env.NEXT_PUBLIC_ENABLE_DEV_ANON_AUTH === "true";
  const production = process.env.NODE_ENV === "production";
  const localDev = !production;
  const supabaseConfigured = Boolean(supabaseUrl && supabaseAnonKey && !forceLocalData);

  return {
    hasSupabaseUrl: Boolean(supabaseUrl),
    hasSupabaseAnonKey: Boolean(supabaseAnonKey),
    forceLocalData,
    isProduction: production,
    isLocalDev: localDev,
    isSupabaseConfigured: supabaseConfigured,
    isDemoStorageMode: !supabaseConfigured,
    devAnonymousAuthRequested,
    isDevAnonymousAuthEnabled: localDev && devAnonymousAuthRequested
  };
}

export function isProduction() {
  return getRuntimeModeStatus().isProduction;
}

export function isLocalDev() {
  return getRuntimeModeStatus().isLocalDev;
}

export function isSupabaseConfigured() {
  return getRuntimeModeStatus().isSupabaseConfigured;
}

export function isDemoStorageMode() {
  return getRuntimeModeStatus().isDemoStorageMode;
}
