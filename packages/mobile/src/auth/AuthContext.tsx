import { createContext, useCallback, useContext, useEffect, useMemo, useState, type PropsWithChildren } from 'react';
import { AppState } from 'react-native';
import AsyncStorage from '@react-native-async-storage/async-storage';
import { api, ApiError } from '../api/client';

const AUTH_KEY = 'picly.auth.v1';

export interface AuthUser {
  id: string;
  email: string;
  name: string;
}

interface Session {
  user: AuthUser;
  accessToken: string;
  refreshToken: string;
}

interface AuthResponse {
  user: { id: string; email: string };
  accessToken: string;
  refreshToken: string;
  expiresIn: number;
}

interface AuthContextValue {
  user: AuthUser | null;
  ready: boolean;
  login: (email: string, password: string) => Promise<void>;
  register: (name: string, email: string, password: string) => Promise<void>;
  logout: () => Promise<void>;
}

const AuthContext = createContext<AuthContextValue | null>(null);

/**
 * Auth against the Picly backend (Hono + Bun). Session (user + tokens) is
 * persisted to AsyncStorage; the access token is refreshed automatically on
 * app start and on expiry.
 */
export function AuthProvider({ children }: PropsWithChildren) {
  const [session, setSession] = useState<Session | null>(null);
  const [ready, setReady] = useState(false);

  // Restore session from storage on mount.
  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const raw = await AsyncStorage.getItem(AUTH_KEY);
        if (!cancelled && raw) setSession(JSON.parse(raw) as Session);
      } catch {
        // Corrupt/absent session — treat as signed out.
      } finally {
        if (!cancelled) setReady(true);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, []);

  // Refresh the access token when the app foregrounds or the token expires.
  useEffect(() => {
    if (!session) return;
    let timer: ReturnType<typeof setTimeout> | undefined;
    let lastRefresh: number | null = null;
    // Keep the LATEST refresh token without re-triggering this effect (the
    // backend rotates tokens on every refresh, so depending on the token in
    // the deps array would cause an endless refresh loop).
    const tokenRef = { current: session.refreshToken };

    const refresh = async () => {
      try {
        const next = await api<AuthResponse>('/auth/refresh', {
          method: 'POST',
          body: { refreshToken: tokenRef.current },
        });
        lastRefresh = Date.now();
        tokenRef.current = next.refreshToken;
        const updated: Session = {
          user: {
            id: next.user.id,
            email: next.user.email,
            name: next.user.email.split('@')[0] || 'Picly user',
          },
          accessToken: next.accessToken,
          refreshToken: next.refreshToken,
        };
        setSession(updated);
        // Persist the rotated tokens so a kill/restart restores the LATEST pair
        // (the backend revoked the previous refresh token on rotation).
        await AsyncStorage.setItem(AUTH_KEY, JSON.stringify(updated));
      } catch (err) {
        // Network failure (backend unreachable) — keep the session so the user
        // stays logged in; we retry on next foreground. Only drop the session
        // when the backend explicitly rejects the token (401).
        const isAuthFailure = err instanceof ApiError && err.status === 401;
        if (isAuthFailure) {
          await AsyncStorage.removeItem(AUTH_KEY);
          setSession(null);
        }
      }
    };

    // Fire once shortly after mount (covers stale access token from last run).
    timer = setTimeout(refresh, 1000);

    // Refresh again whenever the app returns to the foreground (catches
    // long backgrounded sessions and retries failed refreshes). Skip if we
    // just refreshed (e.g. mount timer already fired).
    const sub = AppState.addEventListener('change', (state) => {
      if (state === 'active' && (lastRefresh === null || Date.now() - lastRefresh > 1000)) refresh();
    });

    return () => {
      if (timer) clearTimeout(timer);
      sub.remove();
    };
    // Run once per signed-in user — NOT on token rotation (token changes would
    // restart the effect and cause a refresh loop). Restore + login both set
    // session.user.id, which is stable across refreshes.
  }, [session?.user?.id]); // eslint-disable-line react-hooks/exhaustive-deps

  const persist = useCallback(async (next: Session | null) => {
    setSession(next);
    if (next) {
      await AsyncStorage.setItem(AUTH_KEY, JSON.stringify(next));
    } else {
      await AsyncStorage.removeItem(AUTH_KEY);
    }
  }, []);

  const handleAuthResponse = useCallback(
    async (res: AuthResponse): Promise<void> => {
      const user: AuthUser = {
        id: res.user.id,
        email: res.user.email,
        name: res.user.email.split('@')[0] || 'Picly user',
      };
      await persist({ user, accessToken: res.accessToken, refreshToken: res.refreshToken });
    },
    [persist],
  );

  const login = useCallback(
    async (email: string, password: string) => {
      if (!email.trim() || !password) throw new Error('Email and password are required');
      const res = await api<AuthResponse>('/auth/login', { method: 'POST', body: { email, password } });
      await handleAuthResponse(res);
    },
    [handleAuthResponse],
  );

  const register = useCallback(
    async (name: string, email: string, password: string) => {
      if (!name.trim() || !email.trim() || !password) throw new Error('All fields are required');
      if (password.length < 6) throw new Error('Password must be at least 6 characters');
      const res = await api<AuthResponse>('/auth/register', {
        method: 'POST',
        body: { name, email, password },
      });
      await handleAuthResponse(res);
    },
    [handleAuthResponse],
  );

  const logout = useCallback(async () => {
    if (session?.refreshToken) {
      try {
        await api('/auth/logout', { method: 'POST', body: { refreshToken: session.refreshToken } });
      } catch {
        // Best-effort — always clear local session.
      }
    }
    await persist(null);
  }, [session?.refreshToken, persist]);

  const value = useMemo(
    () => ({ user: session?.user ?? null, ready, login, register, logout }),
    [session, ready, login, register, logout],
  );

  return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>;
}

export function useAuth(): AuthContextValue {
  const ctx = useContext(AuthContext);
  if (!ctx) throw new Error('useAuth must be used within AuthProvider');
  return ctx;
}
