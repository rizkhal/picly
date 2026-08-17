import { createContext, useCallback, useContext, useEffect, useMemo, useState, type PropsWithChildren } from 'react';
import AsyncStorage from '@react-native-async-storage/async-storage';
import { api } from '../api/client';

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

    const refresh = async () => {
      try {
        const next = await api<AuthResponse>('/auth/refresh', {
          method: 'POST',
          body: { refreshToken: session.refreshToken },
        });
        setSession({
          user: {
            id: next.user.id,
            email: next.user.email,
            name: next.user.email.split('@')[0] || 'Picly user',
          },
          accessToken: next.accessToken,
          refreshToken: next.refreshToken,
        });
      } catch {
        // Refresh failed — drop session, user signs in again.
        await AsyncStorage.removeItem(AUTH_KEY);
        setSession(null);
      }
    };

    // Fire once shortly after mount (covers stale access token from last run).
    timer = setTimeout(refresh, 1000);

    return () => {
      if (timer) clearTimeout(timer);
    };
  }, [session?.refreshToken]); // eslint-disable-line react-hooks/exhaustive-deps

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
