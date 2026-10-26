import { createContext, useContext, useEffect, useRef, useState, type ReactNode } from 'react';
import { useQueryClient } from '@tanstack/react-query';
import { liveQuery } from 'dexie';
import type { DashboardData, TaskDto } from '@kidquest/types';
import { useAuth } from '../../app/providers/AuthProvider';
import { api, serverConnection, onConnectionStatus } from '../../services/api';
import { uk } from '../../lib/i18n';
import { registerServiceWorker } from '../../services/service-worker';
import { cacheable, projectTasks, familyDate } from './cache';
import { offlineStore, type QueuedTask, OfflineStorageError } from './store';
import { createOfflineSync, type OfflineSync } from './sync';

interface OfflineContextValue {
  connected?: boolean;
  shellState?: 'CHECKING' | 'READY' | 'UNAVAILABLE' | 'DEV';
  ready: boolean;
  available: boolean;
  cachedAt: string | null;
  pending: QueuedTask[];
  syncing: boolean;
  timeZone: string;
  queueTask: (task: TaskDto, files: File[]) => Promise<void>;
  retry: (operationId: string) => Promise<void>;
  discard: (operationId: string) => Promise<void>;
  sync: () => Promise<void>;
}
const unavailable = async () => {
  throw new OfflineStorageError('STORAGE_UNAVAILABLE', uk.offlineStorageHint);
};
const defaults: OfflineContextValue = {
  ready: true,
  available: false,
  cachedAt: null,
  pending: [],
  syncing: false,
  timeZone: 'Europe/Kyiv',
  queueTask: unavailable,
  retry: unavailable,
  discard: unavailable,
  sync: async () => undefined,
};
const OfflineContext = createContext<OfflineContextValue>(defaults);
export function OfflineProvider({ children }: { children: ReactNode }) {
  const { user, offlineOwner: owner } = useAuth();
  const client = useQueryClient();
  const [shellState, setShellState] = useState<'CHECKING' | 'READY' | 'UNAVAILABLE' | 'DEV'>(
    import.meta.env.PROD ? 'CHECKING' : 'DEV',
  );
  const [connected, setConnected] = useState(serverConnection);
  useEffect(() => onConnectionStatus(setConnected), []);
  const [ready, setReady] = useState(false);
  const [available, setAvailable] = useState(false);
  const [cachedAt, setCachedAt] = useState<string | null>(null);
  const [pending, setPending] = useState<QueuedTask[]>([]);
  const [syncing, setSyncing] = useState(false);
  const [timeZone, setTimeZone] = useState(owner?.timeZone || 'Europe/Kyiv');
  useEffect(() => {
    if (!import.meta.env.PROD) return;
    let live = true;
    void registerServiceWorker()
      .then(() => {
        if (live) setShellState('READY');
      })
      .catch((error: unknown) => {
        if (live) setShellState('UNAVAILABLE');
        console.warn(
          'KidQuest offline shell unavailable',
          error instanceof Error ? error.message : 'Service worker unavailable',
        );
      });
    return () => {
      live = false;
    };
  }, []);
  const runner = useRef<OfflineSync | null>(null);
  const sessionRef = useRef(owner?.sessionId);
  sessionRef.current = owner?.sessionId;
  const sync = async () => {
    if (!navigator.onLine || !runner.current) return;
    const running = runner.current;
    setSyncing(true);
    try {
      await running.run();
    } catch {
      /* The queue remains durable. A later online/focus/timer event retries verification. */
    } finally {
      if (runner.current === running) setSyncing(false);
    }
  };
  useEffect(() => {
    let live = true;
    setReady(false);
    setAvailable(false);
    setPending([]);
    setCachedAt(null);
    if (user?.role !== 'CHILD' || !owner) {
      setReady(true);
      return;
    }
    const sid = owner.sessionId;
    setTimeZone(owner.timeZone);
    const refresh = async () => {
      if (sessionRef.current !== sid) return;
      await Promise.all(
        [
          'tasks',
          'dashboard',
          'completions',
          'points',
          'point-history',
          'reward-requests',
          'achievements',
          'calendar',
          'progress',
          'notifications',
        ].map((key) => client.invalidateQueries({ queryKey: [key] })),
      );
    };
    const currentRunner = createOfflineSync(owner, async (completion) => {
      if (sessionRef.current !== sid) return;
      client.setQueryData<TaskDto[]>(['tasks'], (tasks) =>
        tasks?.map((task) =>
          task.id === completion.taskId &&
          (!task.repeatDaily || completion.completionDate === familyDate(owner.timeZone))
            ? { ...task, todayCompletion: completion }
            : task,
        ),
      );
      await refresh();
    });
    runner.current = currentRunner;
    const subscription = liveQuery(() => offlineStore.restore()).subscribe({
      next: (snapshot) => {
        if (!live || snapshot.owner?.sessionId !== sid) return;
        setAvailable(true);
        setReady(true);
        setPending(snapshot.pending);
        setTimeZone(snapshot.owner.timeZone);
        const latest = Math.max(0, ...snapshot.cache.map((q) => q.dataUpdatedAt));
        setCachedAt(latest ? new Date(latest).toISOString() : null);
      },
      error: () => {
        if (live) {
          setAvailable(false);
          setReady(true);
        }
      },
    });
    const save = async (query: {
      queryKey: readonly unknown[];
      queryHash: string;
      state: { data: unknown; dataUpdatedAt: number; status: string };
    }) => {
      if (
        !cacheable(query.queryKey) ||
        query.state.data === undefined ||
        query.state.status !== 'success'
      )
        return;
      if (query.queryKey[0] === 'dashboard') {
        const zone = (query.state.data as DashboardData).family?.timeZone;
        if (zone && zone !== owner.timeZone) await offlineStore.setTimeZone(sid, zone);
      }
      await offlineStore.putCache(sid, {
        key: query.queryHash,
        queryKey: query.queryKey,
        data: query.state.data,
        dataUpdatedAt: query.state.dataUpdatedAt,
      });
    };
    for (const query of client.getQueryCache().getAll())
      void save(query).catch(() => {
        if (live) setAvailable(false);
      });
    const unsubscribe = client.getQueryCache().subscribe((event) => {
      if (event.type === 'updated' && event.action.type === 'success')
        void save(event.query).catch(() => {
          if (live) setAvailable(false);
        });
    });
    let waking = false;
    const wake = () => {
      if (waking) return;
      waking = true;
      void (async () => {
        try {
          if (!navigator.onLine || !live || sessionRef.current !== sid) return;
          if (!serverConnection()) {
            try {
              await api('/health');
            } catch {
              return;
            }
            if (!live || sessionRef.current !== sid) return;
            // Refresh stale child reads once on recovery, even when there is no work to send.
            await client.invalidateQueries({ predicate: (query) => cacheable(query.queryKey) });
          }
          if (live && sessionRef.current === sid) await sync();
        } finally {
          waking = false;
        }
      })();
    };
    window.addEventListener('online', wake);
    window.addEventListener('focus', wake);
    const timer = window.setInterval(wake, 5_000);
    // Download the child resources once, including pages not visited yet, for the next offline launch.
    const prefetch = [
      { key: ['tasks'], path: '/tasks' },
      { key: ['rewards'], path: '/rewards' },
      { key: ['points'], path: '/points' },
      { key: ['point-history'], path: '/points/history' },
      { key: ['completions'], path: '/task-completions' },
      { key: ['reward-requests', 'active'], path: '/reward-requests' },
      { key: ['account-profile', user.id], path: '/account/profile' },
      { key: ['achievements', user.id], path: '/achievements' },
    ];
    for (const resource of prefetch)
      void client.prefetchQuery({ queryKey: resource.key, queryFn: () => api(resource.path) });
    wake();
    return () => {
      live = false;
      currentRunner.stop();
      if (runner.current === currentRunner) runner.current = null;
      subscription.unsubscribe();
      unsubscribe();
      window.removeEventListener('online', wake);
      window.removeEventListener('focus', wake);
      window.clearInterval(timer);
    };
    // The immutable owner session is the privacy boundary; display updates do not restart in-flight sends.
  }, [owner?.sessionId, user?.id, client]);
  useEffect(() => {
    if (!owner) return;
    const normalize = () => {
      const tasks = client.getQueryData<TaskDto[]>(['tasks']);
      if (!tasks) return;
      const projected = projectTasks(tasks, timeZone);
      if (JSON.stringify(projected) !== JSON.stringify(tasks))
        client.setQueryData(['tasks'], projected, {
          updatedAt: client.getQueryState(['tasks'])?.dataUpdatedAt,
        });
    };
    const timer = window.setInterval(normalize, 30_000);
    window.addEventListener('focus', normalize);
    return () => {
      window.clearInterval(timer);
      window.removeEventListener('focus', normalize);
    };
  }, [owner?.sessionId, owner, client, timeZone]);
  const queueTask = async (task: TaskDto, files: File[]) => {
    if (!owner || !available) return unavailable();
    const sid = owner.sessionId;
    await offlineStore.enqueue(sid, task, files);
    if (sessionRef.current !== sid) throw new OfflineStorageError('OWNER_CHANGED', uk.authLost);
    setPending(await offlineStore.list(sid));
    void sync();
  };
  const retry = async (id: string) => {
    if (!owner) return unavailable();
    await offlineStore.retry(owner.sessionId, id);
    setPending(await offlineStore.list(owner.sessionId));
    void sync();
  };
  const discard = async (id: string) => {
    if (!owner) return unavailable();
    await offlineStore.discard(owner.sessionId, id);
    setPending(await offlineStore.list(owner.sessionId));
  };
  return (
    <OfflineContext.Provider
      value={{
        shellState,
        connected,
        ready,
        available,
        cachedAt,
        pending,
        syncing,
        timeZone,
        queueTask,
        retry,
        discard,
        sync,
      }}
    >
      {children}
    </OfflineContext.Provider>
  );
}
export const useOffline = () => useContext(OfflineContext);
