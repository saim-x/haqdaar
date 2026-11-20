import { createContext, useCallback, useContext, useEffect, useMemo, useRef, useSyncExternalStore } from 'react';
import type { ReactNode } from 'react';
import { api, request, setAuthBridge } from '../api/client';
import type { AuthTokens, LoginResponse, MeResponse } from '../api/types';
import type { PersonaKey } from './personas';
import {
  getActFor,
  getSession,
  getSnapshot,
  setActFor as setActForStore,
  setSession,
  setStatus,
  subscribe,
  type ActFor,
  type AuthStatus,
  type Session,
} from './session';

interface AuthContextValue {
  status: AuthStatus;
  session: Session | null;
  actFor: ActFor | null;
  demoLogin(personaKey: PersonaKey): Promise<Session>;
  loginWithPassword(email: string, password: string): Promise<Session>;
  requestOtp(phone: string): Promise<{ challenge_id: string; expires_in_sec: number }>;
  verifyOtp(challengeId: string, code: string): Promise<Session>;
  logout(): Promise<void>;
  setActFor(next: ActFor | null): void;
  refreshMe(): Promise<void>;
}

const AuthContext = createContext<AuthContextValue | null>(null);

function toSession(payload: LoginResponse): Session {
  const expiresIn = payload.expires_in ?? 900;
  return {
    accessToken: payload.access_token,
    refreshToken: payload.refresh_token,
    expiresAt: Date.now() + expiresIn * 1000,
    user: payload.user,
    citizen: payload.citizen ?? null,
    tenant: null,
  };
}

export function AuthProvider({ children }: { children: ReactNode }) {
  const snapshot = useSyncExternalStore(subscribe, getSnapshot, getSnapshot);
  const refreshing = useRef<Promise<string | null> | null>(null);

  const doRefresh = useCallback(async (): Promise<string | null> => {
    const current = getSession();
    if (!current) return null;
    if (refreshing.current) return refreshing.current;

    const task = (async () => {
      try {
        const res = await request<AuthTokens>('/auth/refresh', {
          method: 'POST',
          body: { refresh_token: current.refreshToken },
          anonymous: true,
          noRetry: true,
        });
        const tokens = res.data;
        if (!tokens) return null;
        const next: Session = {
          ...current,
          accessToken: tokens.access_token,
          refreshToken: tokens.refresh_token,
          expiresAt: Date.now() + (tokens.expires_in ?? 900) * 1000,
        };
        setSession(next);
        return next.accessToken;
      } catch {
        return null;
      } finally {
        refreshing.current = null;
      }
    })();

    refreshing.current = task;
    return task;
  }, []);

  // Wire the API client to this store exactly once.
  useEffect(() => {
    setAuthBridge({
      getAccessToken: () => getSession()?.accessToken ?? null,
      getActForCitizen: () => getActFor()?.citizenId ?? null,
      refresh: doRefresh,
      onUnauthorized: () => setSession(null),
    });
    return () => setAuthBridge(null);
  }, [doRefresh]);

  // Refresh proactively when the persisted access token has already expired.
  useEffect(() => {
    const current = getSession();
    if (!current) {
      setStatus('anon');
      return;
    }
    if (current.expiresAt !== null && current.expiresAt - 30_000 < Date.now()) {
      void doRefresh().then((token) => {
        if (!token) setSession(null);
      });
    }
  }, [doRefresh]);

  const hydrate = useCallback(async (payload: LoginResponse): Promise<Session> => {
    const base = toSession(payload);
    setSession(base);
    try {
      const me = await api.get<MeResponse>('/auth/me');
      const withMe: Session = { ...base, user: me.user, citizen: me.citizen, tenant: me.tenant };
      setSession(withMe);
      return withMe;
    } catch {
      return base;
    }
  }, []);

  const demoLogin = useCallback(
    async (personaKey: PersonaKey) => {
      const payload = await api.post<LoginResponse>('/auth/demo-login', { persona_key: personaKey }, { anonymous: true });
      return hydrate(payload);
    },
    [hydrate],
  );

  const loginWithPassword = useCallback(
    async (email: string, password: string) => {
      const payload = await api.post<LoginResponse>('/auth/login', { email, password }, { anonymous: true });
      return hydrate(payload);
    },
    [hydrate],
  );

  const requestOtp = useCallback(async (phone: string) => {
    return api.post<{ challenge_id: string; expires_in_sec: number }>(
      '/auth/otp/request',
      { phone, purpose: 'LOGIN' },
      { anonymous: true },
    );
  }, []);

  const verifyOtp = useCallback(
    async (challengeId: string, code: string) => {
      const payload = await api.post<LoginResponse>(
        '/auth/otp/verify',
        { challenge_id: challengeId, code },
        { anonymous: true },
      );
      return hydrate(payload);
    },
    [hydrate],
  );

  const logout = useCallback(async () => {
    const current = getSession();
    if (current) {
      try {
        await api.post('/auth/logout', { refresh_token: current.refreshToken });
      } catch {
        /* logging out locally is enough */
      }
    }
    setSession(null);
  }, []);

  const refreshMe = useCallback(async () => {
    const me = await api.get<MeResponse>('/auth/me');
    const current = getSession();
    if (!current) return;
    setSession({ ...current, user: me.user, citizen: me.citizen, tenant: me.tenant });
  }, []);

  const value = useMemo<AuthContextValue>(
    () => ({
      status: snapshot.status,
      session: snapshot.session,
      actFor: snapshot.actFor,
      demoLogin,
      loginWithPassword,
      requestOtp,
      verifyOtp,
      logout,
      setActFor: setActForStore,
      refreshMe,
    }),
    [snapshot, demoLogin, loginWithPassword, requestOtp, verifyOtp, logout, refreshMe],
  );

  return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>;
}

export function useAuth(): AuthContextValue {
  const ctx = useContext(AuthContext);
  if (!ctx) throw new Error('useAuth must be used inside <AuthProvider>');
  return ctx;
}
