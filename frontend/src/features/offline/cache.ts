import type { QueryClient } from '@tanstack/react-query';
import type { TaskDto } from '@kidquest/types';
import type { OfflineOwner, SavedQuery } from './store';

const allowed = new Set([
  'tasks',
  'dashboard',
  'rewards',
  'points',
  'point-history',
  'completions',
  'reward-requests',
  'achievements',
  'calendar',
  'progress',
  'account-profile',
]);
export function cacheable(key: readonly unknown[]) {
  return typeof key[0] === 'string' && allowed.has(key[0]);
}
export function familyDate(timeZone: string, now = new Date()) {
  const parts = new Intl.DateTimeFormat('en-CA', {
    timeZone,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  }).formatToParts(now);
  return `${parts.find((p) => p.type === 'year')!.value}-${parts.find((p) => p.type === 'month')!.value}-${parts.find((p) => p.type === 'day')!.value}`;
}
// These are stale display snapshots only. The backend revalidates the captured version and date.
export function projectTasks(data: TaskDto[], timeZone: string, now = new Date()): TaskDto[] {
  const day = familyDate(timeZone, now);
  return data
    .filter(
      (task) =>
        (!task.startDate || task.startDate <= day) && (!task.endDate || task.endDate >= day),
    )
    .map((task) =>
      task.repeatDaily && task.todayCompletion?.completionDate !== day
        ? { ...task, todayCompletion: null }
        : task,
    );
}
export function restoreQueries(client: QueryClient, owner: OfflineOwner, cache: SavedQuery[]) {
  for (const snapshot of cache) {
    if (!cacheable(snapshot.queryKey)) continue;
    const data =
      snapshot.queryKey[0] === 'tasks' && Array.isArray(snapshot.data)
        ? projectTasks(snapshot.data as TaskDto[], owner.timeZone)
        : snapshot.data;
    client.setQueryData(snapshot.queryKey, data, { updatedAt: snapshot.dataUpdatedAt });
  }
}
export function sessionVersion(token: string): number {
  try {
    const part = token.split('.')[1]!;
    const payload = JSON.parse(atob(part.replace(/-/g, '+').replace(/_/g, '/'))) as {
      ver?: unknown;
    };
    return typeof payload.ver === 'number' && Number.isSafeInteger(payload.ver) && payload.ver >= 0
      ? payload.ver
      : 0;
  } catch {
    return 0;
  }
}
