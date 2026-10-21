import { createContext, useContext, useEffect, useState, type ReactNode } from 'react';
import { useQueryClient } from '@tanstack/react-query';
import type { AuthSession, PublicUser } from '@kidquest/types';
import { api, onAuthLost, refreshSession, setAccessToken } from '../../services/api';

interface AuthContextValue {
  user: PublicUser | null;
  loading: boolean;
  establish: (session: AuthSession) => void;
  logout: () => Promise<void>;
}
const AuthContext = createContext<AuthContextValue | null>(null);
export function AuthProvider({ children }: { children: ReactNode }) {
  const [user, setUser] = useState<PublicUser | null>(null);
  const [loading, setLoading] = useState(true);
  const queryClient = useQueryClient();
  useEffect(() => {
    let live = true;
    onAuthLost(() => {
      setUser(null);
      queryClient.clear();
    });
    refreshSession()
      .then((session) => {
        if (live) setUser(session.user);
      })
      .catch(() => {
        /* No persisted session: show the sign-in screen. */
      })
      .finally(() => {
        if (live) setLoading(false);
      });
    return () => {
      live = false;
    };
  }, [queryClient]);
  const establish = (session: AuthSession) => {
    queryClient.clear();
    setAccessToken(session.accessToken);
    setUser(session.user);
  };
  const logout = async () => {
    await api('/auth/logout', { method: 'POST' });
    setAccessToken(null);
    setUser(null);
    queryClient.clear();
  };
  return (
    <AuthContext.Provider value={{ user, loading, establish, logout }}>
      {children}
    </AuthContext.Provider>
  );
}
export function useAuth() {
  const context = useContext(AuthContext);
  if (!context) throw new Error('AuthProvider missing');
  return context;
}
