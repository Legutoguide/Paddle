import { createContext, useContext, useState, useCallback, useEffect } from 'react';
import type { AppUser } from '@/types/window';
import { hasPermission, type Permission } from './permissions';

interface AuthContextValue {
  user: AppUser | null;
  loading: boolean;
  login: (username: string, password: string) => Promise<void>;
  logout: () => Promise<void>;
  refresh: () => Promise<void>;
  can: (permission: Permission) => boolean;
}

const AuthContext = createContext<AuthContextValue | null>(null);

export function AuthProvider({ children }: { children: React.ReactNode }) {
  const [user, setUser] = useState<AppUser | null>(null);
  const [loading, setLoading] = useState(true);

  const refresh = useCallback(async () => {
    const session = await window.api.auth.currentSession();
    setUser(session);
  }, []);

  useEffect(() => {
    refresh().finally(() => setLoading(false));
  }, [refresh]);

  const login = useCallback(async (username: string, password: string) => {
    const loggedIn = await window.api.auth.login(username, password);
    setUser(loggedIn);
  }, []);

  const logout = useCallback(async () => {
    await window.api.auth.logout();
    setUser(null);
  }, []);

  const can = useCallback((permission: Permission) => hasPermission(user?.role, permission), [user]);

  return (
    <AuthContext.Provider value={{ user, loading, login, logout, refresh, can }}>{children}</AuthContext.Provider>
  );
}

export function useAuth(): AuthContextValue {
  const ctx = useContext(AuthContext);
  if (!ctx) throw new Error('useAuth must be used within AuthProvider');
  return ctx;
}

