"use client";

import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useRef,
  useState
} from "react";
import type { Session, User } from "@supabase/supabase-js";
import {
  buildGoogleOAuthCallbackUrl,
  clearAccountSession,
  getAccountSessionSyncKey,
  getProjectIdFromInternalPath,
  getSafeInternalPath,
  syncAccountSession,
  type AccountSessionSyncResult
} from "@/lib/auth/client";
import { normalizeTrustedGoogleIdentity } from "@/lib/projectAccess/accountCore";
import { getSupabaseBrowserClient } from "@/lib/supabase/client";

export type AuthSessionStatus =
  | "loading"
  | "unavailable"
  | "anonymous"
  | "syncing"
  | "authenticated"
  | "error";

type AuthSessionContextValue = {
  user: User | null;
  email: string | null;
  isGoogle: boolean;
  isEditorEligible: boolean;
  status: AuthSessionStatus;
  errorMessage: string;
  accountGeneration: number;
  startGoogleOAuth: (nextPath?: string) => Promise<void>;
  signOut: () => Promise<void>;
  refreshAccount: (nextPath?: string) => Promise<AccountSessionSyncResult | null>;
};

type ApplySessionOptions = {
  force?: boolean;
  throwOnError?: boolean;
  projectId?: string | null;
};

const AuthSessionContext = createContext<AuthSessionContextValue | null>(null);
const GOOGLE_LOGIN_ERROR_MESSAGE = "Google 로그인에 실패했습니다. 다시 시도해 주세요.";

export function AuthSessionProvider({ children }: { children: React.ReactNode }) {
  const [user, setUser] = useState<User | null>(null);
  const [isEditorEligible, setIsEditorEligible] = useState(false);
  const [status, setStatus] = useState<AuthSessionStatus>("loading");
  const [errorMessage, setErrorMessage] = useState("");
  const [accountGeneration, setAccountGeneration] = useState(0);
  const mountedRef = useRef(true);
  const operationRef = useRef(0);
  const synchronizedUserIdRef = useRef("");
  const lastSynchronizedTokenRef = useRef<string | null>(null);
  const lastSynchronizedProjectIdRef = useRef<string | null>(null);
  const lastSyncResultRef = useRef<AccountSessionSyncResult | null>(null);
  const accountMutationQueueRef = useRef<Promise<void>>(Promise.resolve());
  const inFlightSyncRef = useRef<{
    key: string;
    promise: Promise<AccountSessionSyncResult>;
  } | null>(null);

  const enqueueAccountMutation = useCallback(function enqueueAccountMutation<T>(
    mutation: () => Promise<T>
  ) {
    const queuedMutation = accountMutationQueueRef.current
      .catch(() => undefined)
      .then(mutation);
    accountMutationQueueRef.current = queuedMutation.then(
      () => undefined,
      () => undefined
    );
    return queuedMutation;
  }, []);

  const applySession = useCallback(async (
    session: Session | null,
    options: ApplySessionOptions = {}
  ) => {
    const {
      force = false,
      throwOnError = false,
      projectId: requestedProjectId = null
    } = options;
    const projectId = requestedProjectId?.trim().toLowerCase() || null;
    const operationId = operationRef.current + 1;
    operationRef.current = operationId;
    const nextUser = session?.user ?? null;
    if (mountedRef.current) setUser(nextUser);

    if (!session) {
      const alreadyCleared = lastSynchronizedTokenRef.current === "";
      if (!force && alreadyCleared) {
        if (mountedRef.current) {
          setIsEditorEligible(false);
          setStatus("anonymous");
          setErrorMessage("");
        }
        return null;
      }
      try {
        await enqueueAccountMutation(clearAccountSession);
      } catch (error) {
        // Supabase session이 없는 상태는 우선 유지하되, server cookie 정리 실패는 표시합니다.
        if (mountedRef.current && operationRef.current === operationId) {
          setErrorMessage(error instanceof Error ? error.message : "서버 계정 세션을 종료하지 못했습니다.");
        }
      }
      if (!mountedRef.current || operationRef.current !== operationId) return null;
      lastSynchronizedTokenRef.current = "";
      lastSynchronizedProjectIdRef.current = null;
      lastSyncResultRef.current = null;
      synchronizedUserIdRef.current = "";
      setIsEditorEligible(false);
      setStatus("anonymous");
      setAccountGeneration((current) => current + 1);
      return null;
    }

    const token = session.access_token;
    if (
      !force
      && lastSynchronizedTokenRef.current === token
      && lastSyncResultRef.current
      && (!projectId || lastSynchronizedProjectIdRef.current === projectId)
    ) {
      if (mountedRef.current) {
        setIsEditorEligible(lastSyncResultRef.current.editorEligible);
        setStatus("authenticated");
        setErrorMessage("");
      }
      return lastSyncResultRef.current;
    }

    if (mountedRef.current) {
      setStatus("syncing");
      setErrorMessage("");
      if (synchronizedUserIdRef.current !== session.user.id) setIsEditorEligible(false);
    }

    const syncKey = getAccountSessionSyncKey(token, projectId);
    try {
      let syncPromise: Promise<AccountSessionSyncResult>;
      if (inFlightSyncRef.current?.key === syncKey) {
        syncPromise = inFlightSyncRef.current.promise;
      } else {
        syncPromise = enqueueAccountMutation(() => syncAccountSession(token, projectId));
        inFlightSyncRef.current = { key: syncKey, promise: syncPromise };
      }
      const result = await syncPromise;
      if (!mountedRef.current || operationRef.current !== operationId) return result;
      lastSynchronizedTokenRef.current = token;
      lastSynchronizedProjectIdRef.current = projectId;
      lastSyncResultRef.current = result;
      synchronizedUserIdRef.current = session.user.id;
      setIsEditorEligible(result.editorEligible);
      setStatus("authenticated");
      setErrorMessage("");
      setAccountGeneration((current) => current + 1);
      return result;
    } catch (error) {
      if (mountedRef.current && operationRef.current === operationId) {
        lastSynchronizedTokenRef.current = null;
        lastSynchronizedProjectIdRef.current = null;
        lastSyncResultRef.current = null;
        synchronizedUserIdRef.current = "";
        setIsEditorEligible(false);
        setStatus("error");
        setErrorMessage(GOOGLE_LOGIN_ERROR_MESSAGE);
      }
      if (throwOnError) throw error;
      return null;
    } finally {
      if (inFlightSyncRef.current?.key === syncKey) inFlightSyncRef.current = null;
    }
  }, [enqueueAccountMutation]);

  useEffect(() => {
    mountedRef.current = true;
    let authEventVersion = 0;
    const supabase = getSupabaseBrowserClient();
    if (!supabase) {
      setStatus("unavailable");
      setUser(null);
      setIsEditorEligible(false);
      return () => {
        mountedRef.current = false;
      };
    }

    const initialSessionVersion = authEventVersion;
    void supabase.auth.getSession().then(({ data, error }) => {
      if (!mountedRef.current) return;
      // OAuth callback처럼 초기 getSession 중 auth event가 도착한 경우에는
      // 더 최신 event의 session을 오래된 초기 응답으로 덮지 않습니다.
      if (authEventVersion !== initialSessionVersion) return;
      if (error) {
        setStatus("error");
        setErrorMessage("로그인 상태를 확인하지 못했습니다. 잠시 후 다시 시도해 주세요.");
        return;
      }
      void applySession(data.session, {
        projectId: getCurrentCallbackProjectId()
      });
    });

    const { data: listener } = supabase.auth.onAuthStateChange((_event, session) => {
      authEventVersion += 1;
      // auth callback 안에서 다시 Supabase API를 호출하지 않도록 다음 task에서 동기화합니다.
      window.setTimeout(() => {
        if (mountedRef.current) {
          void applySession(session, {
            projectId: getCurrentCallbackProjectId()
          });
        }
      }, 0);
    });

    return () => {
      mountedRef.current = false;
      operationRef.current += 1;
      listener.subscription.unsubscribe();
    };
  }, [applySession]);

  const refreshAccount = useCallback(async (nextPath = "/") => {
    const supabase = getSupabaseBrowserClient();
    if (!supabase) return null;
    const { data, error } = await supabase.auth.getSession();
    if (error) throw error;
    // callback의 auth event와 같은 token/project key를 공유합니다. 이미 진행 중이거나
    // 완료된 sync를 재사용해 /api/auth/session POST가 중복되지 않게 합니다.
    return applySession(data.session, {
      throwOnError: true,
      projectId: getProjectIdFromInternalPath(nextPath)
    });
  }, [applySession]);

  const startGoogleOAuth = useCallback(async (nextPath = "/") => {
    const supabase = getSupabaseBrowserClient();
    if (!supabase) throw new Error("Google 로그인을 사용할 수 없습니다.");
    const previousEditorEligible = isEditorEligible;
    setIsEditorEligible(false);
    setStatus("syncing");
    setErrorMessage("");
    const redirectTo = buildGoogleOAuthCallbackUrl(
      window.location.origin,
      getSafeInternalPath(nextPath)
    );
    const { error } = await supabase.auth.signInWithOAuth({
      provider: "google",
      options: { redirectTo }
    });
    if (error) {
      setIsEditorEligible(previousEditorEligible);
      setStatus(user ? "authenticated" : "anonymous");
      setErrorMessage(GOOGLE_LOGIN_ERROR_MESSAGE);
      throw new Error(GOOGLE_LOGIN_ERROR_MESSAGE);
    }
  }, [isEditorEligible, user]);

  const signOut = useCallback(async () => {
    const supabase = getSupabaseBrowserClient();
    // 이미 진행 중인 token sync가 DELETE 대기 중에 이전 계정 상태와 cookie를
    // 다시 확정하지 못하게, 로그아웃 동작이 먼저 최신 operation을 소유합니다.
    operationRef.current += 1;
    setIsEditorEligible(false);
    setStatus("syncing");
    setErrorMessage("");
    if (!supabase) {
      await applySession(null, { force: true });
      return;
    }

    let serverLogoutError: Error | null = null;
    try {
      // 먼저 app HttpOnly cookie를 지워 Supabase logout 성공 뒤 계정 cookie가
      // 남는 창을 만들지 않습니다. 이전 token sync도 같은 queue에서 먼저 끝납니다.
      await enqueueAccountMutation(clearAccountSession);
    } catch (error) {
      // DELETE 응답은 DB 오류여도 cookie를 만료시킵니다. 로컬 Supabase session도
      // 계속 종료하되, server row revoke 실패는 마지막에 사용자에게 알립니다.
      serverLogoutError = error instanceof Error
        ? error
        : new Error("서버 계정 세션을 종료하지 못했습니다.");
    }
    // 위 DELETE 응답은 DB revoke 실패(500)여도 Set-Cookie를 만료합니다. 이후
    // SIGNED_OUT listener와 명시적 정리는 이 marker를 보고 같은 DELETE를 반복하지 않습니다.
    lastSynchronizedTokenRef.current = "";
    lastSynchronizedProjectIdRef.current = null;
    lastSyncResultRef.current = null;
    synchronizedUserIdRef.current = "";
    setAccountGeneration((current) => current + 1);

    const { error: authError } = await supabase.auth.signOut();
    if (authError) {
      const { data } = await supabase.auth.getSession();
      if (data.session) await applySession(data.session, { force: true });
      else await applySession(null);
      const message = "로그아웃을 완료하지 못했습니다. 잠시 후 다시 시도해 주세요.";
      setErrorMessage(message);
      throw new Error(message);
    }
    await applySession(null);
    if (serverLogoutError) {
      setErrorMessage("로그아웃은 완료됐지만 이전 서버 세션 폐기를 확인하지 못했습니다.");
      throw serverLogoutError;
    }
  }, [applySession, enqueueAccountMutation]);

  const email = user?.email?.trim() || null;
  const isGoogle = hasGoogleIdentity(user);
  const value = useMemo<AuthSessionContextValue>(() => ({
    user,
    email,
    isGoogle,
    isEditorEligible,
    status,
    errorMessage,
    accountGeneration,
    startGoogleOAuth,
    signOut,
    refreshAccount
  }), [
    accountGeneration,
    email,
    errorMessage,
    isEditorEligible,
    isGoogle,
    refreshAccount,
    signOut,
    startGoogleOAuth,
    status,
    user
  ]);

  return <AuthSessionContext.Provider value={value}>{children}</AuthSessionContext.Provider>;
}

export function useAuthSession() {
  const context = useContext(AuthSessionContext);
  if (!context) throw new Error("useAuthSession must be used inside AuthSessionProvider");
  return context;
}

function getCurrentCallbackProjectId() {
  if (typeof window === "undefined" || window.location.pathname !== "/auth/callback") return null;
  const nextPath = new URLSearchParams(window.location.search).get("next");
  return getProjectIdFromInternalPath(nextPath);
}

function hasGoogleIdentity(user: User | null) {
  if (!user) return false;
  return normalizeTrustedGoogleIdentity({
    id: user.id,
    email: user.email,
    emailConfirmedAt: user.email_confirmed_at,
    provider: user.app_metadata?.provider,
    providers: user.app_metadata?.providers,
    identities: user.identities
  }) !== null;
}
