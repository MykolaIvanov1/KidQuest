import { createContext, useContext, useEffect, useRef, useState, type ReactNode } from 'react';
import { useQueryClient } from '@tanstack/react-query';
import { liveQuery } from 'dexie';
import type { AuthSession, PublicUser, DashboardData } from '@kidquest/types';
import {
  api,
  onAuthLost,
  refreshSession,
  setAccessToken,
  resetApiSession,
  setApiIdentity,
  isConnectionFailure,
} from '../../services/api';
import { useFamilyDayRefresh } from '../../hooks/useFamilyDayRefresh';
import { attachPushSession, cleanupPushSession } from '../../features/notifications/push';
import { offlineStore, type OfflineOwner } from '../../features/offline/store';
import { cacheable, restoreQueries, sessionVersion } from '../../features/offline/cache';

interface AuthContextValue {
  user: PublicUser | null;
  loading: boolean;
  accountChanged: boolean;
  offlineOwner: OfflineOwner | null;
  establish: (session: AuthSession) => Promise<void>;
  logout: () => Promise<void>;
  forgetSession: () => Promise<void>;
  revalidate: () => Promise<void>;
}
const AuthContext = createContext<AuthContextValue | null>(null);
const AUTH_EVENT = 'kidquest:auth-state';
const SIGNED_OUT = 'kidquest:signed-out';
let persistence = Promise.resolve<unknown>(undefined);
function serial<T>(work: () => Promise<T>): Promise<T> {
  const next = persistence.then(work, work);
  persistence = next.catch(() => undefined);
  return next;
}
function localSignedOut(value: boolean) {
  try {
    if (value) localStorage.setItem(SIGNED_OUT, '1');
    else localStorage.removeItem(SIGNED_OUT);
  } catch {
    /* IndexedDB marker is the second fence. */
  }
}
function isSignedOut() {
  try {
    return localStorage.getItem(SIGNED_OUT) === '1';
  } catch {
    return false;
  }
}
function broadcast(userId: string | null) {
  try {
    localStorage.setItem(AUTH_EVENT, JSON.stringify({ userId, nonce: crypto.randomUUID() }));
  } catch {
    /* Dexie still signals metadata changes. */
  }
}
function FamilyDayRefresh({ userId }: { userId?: string }) {
  useFamilyDayRefresh(userId);
  return null;
}
export function AuthProvider({ children }: { children: ReactNode }) {
  const [user, setUser] = useState<PublicUser | null>(null);
  const [loading, setLoading] = useState(true);
  const [accountChanged, setAccountChanged] = useState(false);
  const [offlineOwner, setOfflineOwner] = useState<OfflineOwner | null>(null);
  const client = useQueryClient();
  const generation = useRef(0);
  const ownerRef = useRef<OfflineOwner | null>(null);
  const userRef = useRef<PublicUser | null>(null);
  userRef.current = user;
  ownerRef.current = offlineOwner;
  const clearLocal = () => {
    ownerRef.current = null;
    userRef.current = null;
    resetApiSession();
    setUser(null);
    setOfflineOwner(null);
    client.clear();
  };
  const prepare = async (session: AuthSession, attempt: number) => {
    if (attempt !== generation.current) return;
    setApiIdentity(session.user.id);
    setAccessToken(session.accessToken);
    let owner: OfflineOwner | null = null;
    try {
      const previous = await offlineStore.owner();
      if (attempt !== generation.current) return;
      let zone = previous?.user.id === session.user.id ? previous.timeZone : undefined;
      if (session.user.role === 'CHILD' && !zone) {
        const dashboard = await api<DashboardData>('/statistics');
        zone = dashboard.family.timeZone;
        if (attempt !== generation.current) return;
        client.setQueryData(['dashboard', session.user.id], dashboard);
      }
      if (attempt !== generation.current) return;
      owner = await serial(() =>
        attempt === generation.current
          ? offlineStore.activate(session.user, sessionVersion(session.accessToken), zone)
          : Promise.resolve(null),
      );
      if (attempt !== generation.current) return;
      const snapshot = await offlineStore.restore();
      if (attempt !== generation.current) return;
      if (owner && snapshot.owner?.sessionId === owner.sessionId) {
        restoreQueries(client, owner, snapshot.cache);
        // An online bootstrap must refresh persisted snapshots even inside staleTime.
        await client.invalidateQueries({
          predicate: (query) => cacheable(query.queryKey),
          refetchType: 'none',
        });
      }
    } catch {
      /* Browser storage can be unavailable; online reading still works. */
    }
    if (attempt !== generation.current) return;
    setAccessToken(session.accessToken);
    ownerRef.current = owner;
    userRef.current = session.user;
    setOfflineOwner(owner);
    setUser(session.user);
  };
  useEffect(() => {
    if (!user) return;
    return attachPushSession(user.id, () => {
      void client.invalidateQueries();
    });
  }, [user, client]);
  useEffect(() => {
    let live = true;
    const attempt = ++generation.current;
    onAuthLost(() => {
      if (!live) return;
      generation.current += 1;
      const oldOwner = ownerRef.current;
      localSignedOut(true);
      clearLocal();
      setLoading(false);
      void cleanupPushSession(false);
      void serial(() => offlineStore.markSignedOut(oldOwner?.sessionId)).catch(() => undefined);
    });
    const storage = (event: StorageEvent) => {
      if (event.key !== AUTH_EVENT || !event.newValue) return;
      try {
        const next = JSON.parse(event.newValue) as { userId: unknown };
        if (next.userId === userRef.current?.id) return;
        generation.current += 1;
        clearLocal();
        setLoading(false);
        void cleanupPushSession(false);
      } catch {
        /* Ignore malformed local UI signals. */
      }
    };
    window.addEventListener('storage', storage);
    void (async () => {
      const snapshot = await offlineStore.restore().catch(() => null);
      if (!live || attempt !== generation.current) return;
      if (isSignedOut() || snapshot?.signedOut) {
        if (navigator.onLine && attempt === generation.current)
          await api('/auth/logout', { method: 'POST', signal: AbortSignal.timeout(3000) }).catch(
            () => undefined,
          );
        return;
      }
      try {
        const session = await refreshSession();
        if (live) await prepare(session, attempt);
      } catch (error) {
        if (!live || attempt !== generation.current) return;
        if (isConnectionFailure(error) && snapshot?.owner?.user.role === 'CHILD') {
          setApiIdentity(snapshot.owner.user.id);
          restoreQueries(client, snapshot.owner, snapshot.cache);
          setOfflineOwner(snapshot.owner);
          setUser(snapshot.owner.user);
        } else if (!isConnectionFailure(error)) {
          await serial(() => offlineStore.markSignedOut(snapshot?.owner?.sessionId)).catch(
            () => undefined,
          );
        }
      }
    })().finally(() => {
      if (live) setLoading(false);
    });
    return () => {
      live = false;
      generation.current += 1;
      window.removeEventListener('storage', storage);
    };
    // Authentication bootstraps once for this query client; callbacks read the current refs.
  }, [client]);
  useEffect(() => {
    if (!offlineOwner) return;
    const subscription = liveQuery(() => offlineStore.owner()).subscribe({
      next: (current) => {
        if (
          ownerRef.current?.sessionId !== offlineOwner.sessionId ||
          current?.sessionId === offlineOwner.sessionId
        )
          return;
        generation.current += 1;
        clearLocal();
        void cleanupPushSession(false);
      },
      error: () => {
        /* Storage failure disables offline operations in OfflineProvider. */
      },
    });
    return () => subscription.unsubscribe();
  }, [offlineOwner?.sessionId, client]);
  const establish = async (session: AuthSession) => {
    const attempt = ++generation.current;
    const cleanup = cleanupPushSession();
    resetApiSession();
    client.clear();
    await cleanup;
    if (attempt !== generation.current) return;
    localSignedOut(false);
    setAccountChanged(false);
    await prepare(session, attempt);
    if (attempt === generation.current) broadcast(session.user.id);
  };
  const logout = async () => {
    const oldOwner = ownerRef.current;
    const attempt = ++generation.current;
    setLoading(true);
    const pushCleanup = cleanupPushSession();
    localSignedOut(true);
    clearLocal();
    broadcast(null);
    try {
      await serial(() => offlineStore.markSignedOut(oldOwner?.sessionId)).catch(() => undefined);
      if (attempt !== generation.current) return;
      // Keep the login UI closed until this cookie-changing response is settled.
      try {
        await api('/auth/logout', { method: 'POST', signal: AbortSignal.timeout(3000) });
      } catch (error) {
        if (attempt !== generation.current) return;
        if (!isConnectionFailure(error)) throw error;
      }
      await pushCleanup;
    } finally {
      if (attempt === generation.current) setLoading(false);
    }
  };
  const forgetSession = async () => {
    const oldOwner = ownerRef.current;
    generation.current += 1;
    setAccountChanged(true);
    localSignedOut(true);
    clearLocal();
    broadcast(null);
    const cleanup = cleanupPushSession(false);
    await serial(() => offlineStore.markSignedOut(oldOwner?.sessionId)).catch(() => undefined);
    await cleanup;
  };
  const revalidate = async () => {
    const attempt = generation.current;
    try {
      await prepare(await refreshSession(), attempt);
    } catch (error) {
      if (!isConnectionFailure(error) && attempt === generation.current) {
        generation.current += 1;
        const oldOwner = ownerRef.current;
        localSignedOut(true);
        clearLocal();
        await serial(() => offlineStore.markSignedOut(oldOwner?.sessionId)).catch(() => undefined);
      }
      throw error;
    }
  };
  return (
    <AuthContext.Provider
      value={{
        user,
        loading,
        accountChanged,
        offlineOwner,
        establish,
        logout,
        forgetSession,
        revalidate,
      }}
    >
      <FamilyDayRefresh userId={user?.id} />
      {children}
    </AuthContext.Provider>
  );
}
export function useAuth() {
  const context = useContext(AuthContext);
  if (!context) throw new Error('AuthProvider missing');
  return context;
}
