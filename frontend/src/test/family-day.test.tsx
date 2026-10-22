import type { ReactNode } from 'react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { act, cleanup, renderHook } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { DashboardData } from '@kidquest/types';
import { useFamilyDayRefresh } from '../hooks/useFamilyDayRefresh';
import { api } from '../services/api';

vi.mock('../services/api', () => ({ api: vi.fn() }));

const dashboard: DashboardData = {
  family: { id: 'family-1', name: 'Родина', timeZone: 'Europe/Kyiv' },
  child: { id: 'child-1', firstName: 'Богдан' },
  counts: {
    children: 1,
    activeTasks: 1,
    activeRewards: 0,
    pendingCompletions: 0,
    pendingRewards: 0,
  },
  balance: 0,
  tasks: [],
  rewards: [],
  today: { approved: 0, total: 1 },
  streak: null,
};
const familyQueries = ['tasks', 'dashboard', 'completions', 'points', 'point-history'];
const clients: QueryClient[] = [];

function mountRefresh() {
  const client = new QueryClient({
    defaultOptions: {
      queries: { retry: false, staleTime: Infinity, gcTime: Infinity, refetchOnWindowFocus: false },
    },
  });
  clients.push(client);
  client.setQueryData(['dashboard', 'child-1'], dashboard);
  const invalidation = vi.spyOn(client, 'invalidateQueries');
  const view = renderHook(({ userId }) => useFamilyDayRefresh(userId), {
    initialProps: { userId: 'child-1' as string | undefined },
    wrapper: ({ children }: { children: ReactNode }) => (
      <QueryClientProvider client={client}>{children}</QueryClientProvider>
    ),
  });
  return { ...view, invalidation };
}

beforeEach(() => {
  vi.useFakeTimers({ toFake: ['Date', 'setInterval', 'clearInterval'] });
  vi.setSystemTime(new Date('2026-10-22T20:59:45Z'));
  vi.mocked(api).mockResolvedValue(dashboard);
});

afterEach(() => {
  cleanup();
  clients.splice(0).forEach((client) => client.clear());
  vi.useRealTimers();
  vi.restoreAllMocks();
  vi.mocked(api).mockReset();
});

describe('Refreshing the family day', () => {
  it('refreshes daily data at Kyiv midnight while the UTC date remains unchanged', () => {
    const { invalidation } = mountRefresh();
    expect(invalidation).not.toHaveBeenCalled();
    act(() => vi.advanceTimersByTime(30_000));
    expect(new Date().toISOString().slice(0, 10)).toBe('2026-10-22');
    expect(invalidation.mock.calls.map(([filter]) => filter?.queryKey?.[0])).toEqual(
      expect.arrayContaining(familyQueries),
    );
    expect(invalidation).toHaveBeenCalledTimes(familyQueries.length);
    act(() => vi.advanceTimersByTime(30_000));
    expect(invalidation).toHaveBeenCalledTimes(familyQueries.length);
  });

  it('does not refresh or fetch again while the family date stays the same', () => {
    vi.setSystemTime(new Date('2026-10-22T10:00:00Z'));
    const { invalidation } = mountRefresh();
    act(() => {
      vi.advanceTimersByTime(5 * 60_000);
      window.dispatchEvent(new Event('focus'));
      document.dispatchEvent(new Event('visibilitychange'));
      window.dispatchEvent(new Event('online'));
    });
    expect(invalidation).not.toHaveBeenCalled();
    expect(api).not.toHaveBeenCalled();
  });

  it('refreshes after sleeping across dates and handles focus, visibility and reconnect events', () => {
    const { invalidation } = mountRefresh();
    for (const [date, target, event] of [
      ['2026-10-23T09:00:00Z', window, 'focus'],
      ['2026-10-24T09:00:00Z', document, 'visibilitychange'],
      ['2026-10-25T09:00:00Z', window, 'online'],
    ] as const) {
      vi.setSystemTime(new Date(date));
      act(() => target.dispatchEvent(new Event(event)));
    }
    expect(invalidation).toHaveBeenCalledTimes(familyQueries.length * 3);
    for (const query of familyQueries)
      expect(
        invalidation.mock.calls.filter(([filter]) => filter?.queryKey?.[0] === query),
      ).toHaveLength(3);
    act(() => window.dispatchEvent(new Event('focus')));
    expect(invalidation).toHaveBeenCalledTimes(familyQueries.length * 3);
  });

  it('keeps the same day during the daylight-saving clock change and refreshes at the next midnight', () => {
    vi.setSystemTime(new Date('2026-10-25T00:30:00Z'));
    const { invalidation } = mountRefresh();
    vi.setSystemTime(new Date('2026-10-25T01:30:00Z'));
    act(() => vi.advanceTimersByTime(30_000));
    expect(invalidation).not.toHaveBeenCalled();
    vi.setSystemTime(new Date('2026-10-25T21:59:45Z'));
    act(() => vi.advanceTimersByTime(30_000));
    expect(invalidation).toHaveBeenCalledTimes(familyQueries.length);
  });

  it('stops polling and removes event handlers on logout and unmount', () => {
    const { rerender, unmount, invalidation } = mountRefresh();
    expect(vi.getTimerCount()).toBe(1);
    rerender({ userId: undefined });
    expect(vi.getTimerCount()).toBe(0);
    vi.setSystemTime(new Date('2026-10-24T10:00:00Z'));
    act(() => {
      vi.advanceTimersByTime(30_000);
      window.dispatchEvent(new Event('focus'));
      document.dispatchEvent(new Event('visibilitychange'));
      window.dispatchEvent(new Event('online'));
    });
    expect(invalidation).not.toHaveBeenCalled();
    expect(api).not.toHaveBeenCalled();
    rerender({ userId: 'child-1' });
    expect(vi.getTimerCount()).toBe(1);
    unmount();
    expect(vi.getTimerCount()).toBe(0);
    vi.setSystemTime(new Date('2026-10-26T10:00:00Z'));
    act(() => window.dispatchEvent(new Event('focus')));
    expect(invalidation).not.toHaveBeenCalled();
  });
});
