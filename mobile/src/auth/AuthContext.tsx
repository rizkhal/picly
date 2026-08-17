import { createContext, useCallback, useContext, useEffect, useMemo, useState, type PropsWithChildren } from 'react';
import AsyncStorage from '@react-native-async-storage/async-storage';

const AUTH_KEY = 'picly.auth.v1';

export interface AuthUser {
  email: string;
  name: string;
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
 * Local-first auth stub. No network calls — the account lives in AsyncStorage
 * only, matching Picly's privacy promise. Swap the internals for the real
 * backend client when accounts go online.
 */
export function AuthProvider({ children }: PropsWithChildren) {
  const [user, setUser] = useState<AuthUser | null>(null);
  const [ready, setReady] = useState(false);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const raw = await AsyncStorage.getItem(AUTH_KEY);
        if (!cancelled && raw) setUser(JSON.parse(raw) as AuthUser);
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

  const persist = useCallback(async (next: AuthUser | null) => {
    setUser(next);
    if (next) {
      await AsyncStorage.setItem(AUTH_KEY, JSON.stringify(next));
    } else {
      await AsyncStorage.removeItem(AUTH_KEY);
    }
  }, []);

  const login = useCallback(
    async (email: string, password: string) => {
      // MOCK — replace with real auth request. Any non-empty credentials pass.
      if (!email.trim() || !password) throw new Error('Email and password are required');
      await persist({ email: email.trim().toLowerCase(), name: email.trim().split('@')[0] || 'Picly user' });
    },
    [persist],
  );

  const register = useCallback(
    async (name: string, email: string, password: string) => {
      // MOCK — replace with real registration request.
      if (!name.trim() || !email.trim() || !password) throw new Error('All fields are required');
      if (password.length < 6) throw new Error('Password must be at least 6 characters');
      await persist({ email: email.trim().toLowerCase(), name: name.trim() });
    },
    [persist],
  );

  const logout = useCallback(async () => {
    await persist(null);
  }, [persist]);

  const value = useMemo(
    () => ({ user, ready, login, register, logout }),
    [user, ready, login, register, logout],
  );

  return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>;
}

export function useAuth(): AuthContextValue {
  const ctx = useContext(AuthContext);
  if (!ctx) throw new Error('useAuth must be used within AuthProvider');
  return ctx;
}
