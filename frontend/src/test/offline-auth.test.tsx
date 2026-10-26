import 'fake-indexeddb/auto';
import { Blob as NodeBlob, File as NodeFile } from 'node:buffer';
import { QueryClient, QueryClientProvider, onlineManager } from '@tanstack/react-query';
import { act, cleanup, render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { MemoryRouter } from 'react-router-dom';
import { afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import type { DashboardData, PublicUser, TaskDto, RewardDto } from '@kidquest/types';
import { AuthProvider, useAuth } from '../app/providers/AuthProvider';
import { ThemeProvider } from '../app/providers/ThemeProvider';
import { OfflineProvider } from '../features/offline/OfflineProvider';
import { offlineStore, type OfflineOwner } from '../features/offline/store';
import { Router } from '../app/router/Router';
import { resetApiSession } from '../services/api';
import { uk } from '../lib/i18n';

const child: PublicUser = {
  id: 'offline-child',
  email: 'offline-child@example.test',
  firstName: 'Богдан',
  lastName: null,
  role: 'CHILD',
  familyId: 'offline-family',
};
const parent: PublicUser = { ...child, id: 'offline-parent', role: 'PARENT', firstName: 'Олена' };
const token = `e30.${btoa(JSON.stringify({ ver: 0, sub: child.id }))}.private-test-signature`;
const task: TaskDto = {
  id: 'offline-task',
  updatedAt: '2026-10-23T09:00:00Z',
  title: 'Зібрати іграшки офлайн',
  description: 'Поклади іграшки на місце',
  categoryId: 'home',
  category: { id: 'home', name: 'Дім', icon: 'ListChecks', color: 'primary' },
  icon: 'ListChecks',
  color: 'primary',
  points: 20,
  isRequired: true,
  repeatDaily: true,
  photoRequired: true,
  startDate: null,
  endDate: null,
  startTime: null,
  endTime: null,
  isActive: true,
  todayCompletion: null,
};
const reward: RewardDto = {
  id: 'offline-reward',
  title: 'Сімейна прогулянка офлайн',
  description: 'Парк і морозиво',
  icon: 'Gift',
  imageUrl: null,
  cost: 40,
  type: 'ACTIVITY',
  isActive: true,
  createdAt: '2026-10-23T08:00:00Z',
};
const dashboard: DashboardData = {
  family: { id: child.familyId, name: 'Родина офлайн', timeZone: 'Pacific/Kiritimati' },
  child: { id: 'child-record', firstName: child.firstName },
  counts: {
    children: 1,
    activeTasks: 1,
    activeRewards: 1,
    pendingCompletions: 0,
    pendingRewards: 0,
  },
  balance: 80,
  streak: 2,
  today: { approved: 0, total: 1 },
  tasks: [
    {
      id: task.id,
      title: task.title,
      description: task.description,
      category: task.category.name,
      points: task.points,
      photoRequired: true,
    },
  ],
  rewards: [reward],
};
function response(data: unknown, status = 200) {
  return new Response(
    JSON.stringify(
      status < 400
        ? { success: true, data }
        : {
            success: false,
            error: { code: 'SESSION_EXPIRED', message: 'Сесію завершено.' },
          },
    ),
    { status, headers: { 'Content-Type': 'application/json' } },
  );
}
function server(user = child) {
  const state = { mode: 'online' as 'online' | 'offline' | 'unauthorized', user, tasks: [task] };
  const fetchMock = vi.fn(async (input: RequestInfo | URL) => {
    const path = new URL(String(input), 'http://localhost').pathname.replace('/api/v1', '');
    if (state.mode === 'offline') throw new TypeError('Failed to fetch');
    if (path === '/auth/refresh')
      return state.mode === 'unauthorized'
        ? response(null, 401)
        : response({ user: state.user, accessToken: token });
    if (path === '/auth/logout') return response(null);
    if (path === '/health') return response({ status: 'ok' });
    if (path === '/me') return response(state.user);
    if (path === '/statistics') return response(dashboard);
    if (path === '/tasks') return response(state.tasks);
    if (path === '/rewards') return response([reward]);
    if (path === '/points') return response({ childId: 'child-record', balance: 80 });
    if (path === '/points/history')
      return response([
        {
          id: 'points-1',
          childId: 'child-record',
          type: 'TASK_REWARD',
          amount: 80,
          description: 'Попередня підтверджена перемога',
          createdAt: '2026-10-22T09:00:00Z',
        },
      ]);
    if (path === '/account/profile')
      return response({
        user: state.user,
        family: dashboard.family,
        childId: 'child-record',
        createdAt: '2026-10-01T00:00:00Z',
      });
    if (path === '/achievements')
      return response({ childId: 'child-record', timeZone: dashboard.family.timeZone, items: [] });
    if (path === '/notifications') return response({ items: [], nextCursor: null, unreadCount: 0 });
    if (path === '/notifications/status') return response({ pushConfigured: false });
    if (['/task-completions', '/reward-requests', '/family/members'].includes(path))
      return response([]);
    throw new Error(`Unexpected request ${path}`);
  });
  vi.stubGlobal('fetch', fetchMock);
  return { state, fetchMock };
}
const clients: QueryClient[] = [];
const authProbe: { current: ReturnType<typeof useAuth> | null } = { current: null };
function AuthProbe() {
  authProbe.current = useAuth();
  return null;
}
function mount(path = '/child') {
  const client = new QueryClient({
    defaultOptions: { queries: { retry: false, staleTime: 30_000 }, mutations: { retry: false } },
  });
  clients.push(client);
  const view = render(
    <QueryClientProvider client={client}>
      <ThemeProvider>
        <MemoryRouter initialEntries={[path]}>
          <AuthProvider>
            <OfflineProvider>
              <AuthProbe />
              <Router />
            </OfflineProvider>
          </AuthProvider>
        </MemoryRouter>
      </ThemeProvider>
    </QueryClientProvider>,
  );
  return { ...view, client };
}
function offline() {
  Object.defineProperty(navigator, 'onLine', { configurable: true, value: false });
  onlineManager.setOnline(false);
}
function online() {
  Object.defineProperty(navigator, 'onLine', { configurable: true, value: true });
  onlineManager.setOnline(true);
}
function reload(view: ReturnType<typeof mount>, path = '/child') {
  view.unmount();
  view.client.clear();
  resetApiSession();
  return mount(path);
}
async function cachedChild() {
  const mock = server();
  const view = mount();
  await screen.findByRole('heading', { name: task.title });
  await waitFor(async () => {
    const snapshot = await offlineStore.restore();
    expect(snapshot.owner?.user.id).toBe(child.id);
    expect(snapshot.owner?.timeZone).toBe(dashboard.family.timeZone);
    expect(snapshot.cache.map((item) => item.queryKey[0])).toEqual(
      expect.arrayContaining([
        'tasks',
        'dashboard',
        'rewards',
        'point-history',
        'completions',
        'account-profile',
      ]),
    );
  });
  return { ...mock, view };
}
async function queueOnePhoto() {
  const user = userEvent.setup();
  const complete = await screen.findByRole('button', { name: uk.completeTask });
  await waitFor(() => expect(complete).toBeEnabled());
  await user.click(complete);
  const photo = new NodeFile(['saved-photo-bytes'], 'room.jpg', { type: 'image/jpeg' });
  await user.upload(screen.getByLabelText(/Фото виконання/), photo as unknown as File);
  await user.click(screen.getByRole('button', { name: uk.taskQueueSubmit }));
  await screen.findByText(uk.taskQueued);
  const snapshot = await offlineStore.restore();
  expect(snapshot.pending).toHaveLength(1);
  return snapshot.pending[0]!;
}
beforeAll(async () => {
  await Promise.all([
    import('../pages/DashboardPage'),
    import('../pages/QuestsPage'),
    import('../pages/RewardsPage'),
    import('../pages/auth/AuthPage'),
  ]);
});
beforeEach(async () => {
  resetApiSession();
  localStorage.clear();
  await offlineStore.clear();
  online();
  vi.stubGlobal('Blob', NodeBlob);
  vi.stubGlobal('File', NodeFile);
});
afterEach(async () => {
  cleanup();
  clients.splice(0).forEach((client) => client.clear());
  resetApiSession();
  await offlineStore.clear();
  localStorage.clear();
  online();
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
});

describe('Offline authentication with real IndexedDB and application routes', () => {
  it('refreshes a recently persisted snapshot after an online reload instead of waiting for staleTime', async () => {
    const { state, view } = await cachedChild();
    const updated = { ...task, title: 'Оновлений квест після перезавантаження' };
    state.tasks = [updated];
    reload(view, '/child/adventure');
    await screen.findByRole('heading', { name: updated.title });
    expect(screen.queryByRole('heading', { name: task.title })).not.toBeInTheDocument();
  });

  it('precaches online, restores tasks/rewards/history after an offline reload and durably saves a photo without persisting JWT', async () => {
    const { state, fetchMock, view } = await cachedChild();
    state.mode = 'offline';
    offline();
    reload(view, '/child/adventure');
    expect(await screen.findByRole('heading', { name: task.title })).toBeInTheDocument();
    const operation = await queueOnePhoto();
    const stored = await offlineStore.db.queue.get(operation.operationId);
    expect(stored?.photos[0]?.bytes?.byteLength).toBe('saved-photo-bytes'.length);
    expect(await new NodeBlob([stored!.photos[0]!.bytes!]).text()).toBe('saved-photo-bytes');
    expect(operation.completionDate).toBe(
      new Intl.DateTimeFormat('en-CA', { timeZone: dashboard.family.timeZone }).format(new Date()),
    );
    await userEvent.setup().click(screen.getAllByRole('link', { name: uk.rewards })[0]!);
    expect(await screen.findByRole('heading', { name: reward.title })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: uk.requestReward })).toBeDisabled();
    await userEvent.setup().click(screen.getAllByRole('link', { name: uk.home })[0]!);
    expect(await screen.findByText('Попередня підтверджена перемога')).toBeInTheDocument();
    expect((await offlineStore.restore()).pending[0]?.operationId).toBe(operation.operationId);
    const persisted = JSON.stringify({
      metadata: await offlineStore.db.metadata.toArray(),
      cache: await offlineStore.db.cache.toArray(),
      queue: await offlineStore.db.queue.toArray(),
      local: { ...localStorage },
    });
    expect(persisted).not.toContain(token);
    expect(persisted).not.toContain('accessToken');
    expect(persisted).not.toContain('refreshToken');
    expect(fetchMock.mock.calls.some(([url]) => String(url).includes('/submit'))).toBe(false);
  });

  it('keeps cached dashboard, tasks and history readable during an API outage while navigator remains online', async () => {
    const { state, view } = await cachedChild();
    state.mode = 'offline';
    const restored = reload(view);
    expect(await screen.findByRole('heading', { name: task.title })).toBeInTheDocument();
    await act(async () => {
      await Promise.all(
        ['tasks', 'dashboard', 'point-history'].map((key) =>
          restored.client.invalidateQueries({ queryKey: [key] }),
        ),
      );
    });
    expect(navigator.onLine).toBe(true);
    expect(restored.client.getQueryState(['tasks'])?.error).toMatchObject({ status: 0 });
    expect(restored.client.getQueryState(['dashboard', child.id])?.error).toMatchObject({
      status: 0,
    });
    expect(restored.client.getQueryState(['point-history'])?.error).toMatchObject({ status: 0 });
    expect(screen.getByRole('heading', { name: task.title })).toBeInTheDocument();
    expect(screen.getByText('Попередня підтверджена перемога')).toBeInTheDocument();
    expect(screen.queryByRole('alert')).not.toBeInTheDocument();
    expect(await screen.findByText(uk.offlineChild)).toBeInTheDocument();
  });
  it('refreshes cached child reads once when health recovers without any queued work', async () => {
    const { state, fetchMock, view } = await cachedChild();
    state.mode = 'offline';
    await act(async () => {
      await view.client.invalidateQueries({ queryKey: ['tasks'] });
    });
    expect(view.client.getQueryState(['tasks'])?.error).toMatchObject({ status: 0 });
    expect(navigator.onLine).toBe(true);
    expect((await offlineStore.restore()).pending).toEqual([]);
    const updatedTask = { ...task, title: 'Новий квест після відновлення зв’язку' };
    state.tasks = [updatedTask];
    state.mode = 'online';
    fetchMock.mockClear();
    const invalidation = vi.spyOn(view.client, 'invalidateQueries');
    await act(async () => {
      window.dispatchEvent(new Event('online'));
    });
    expect(await screen.findByRole('heading', { name: updatedTask.title })).toBeInTheDocument();
    expect(fetchMock.mock.calls.filter(([url]) => String(url).endsWith('/health'))).toHaveLength(1);
    const recoveryInvalidations = invalidation.mock.calls.length;
    expect(recoveryInvalidations).toBeGreaterThan(0);
    await act(async () => {
      window.dispatchEvent(new Event('online'));
    });
    expect(invalidation).toHaveBeenCalledTimes(recoveryInvalidations);
    expect(fetchMock.mock.calls.some(([url]) => String(url).includes('/submit'))).toBe(false);
  });
  it('clears queued photos and cache on offline logout, and the next boot never renews its old cookie', async () => {
    const { state, fetchMock, view } = await cachedChild();
    state.mode = 'offline';
    offline();
    const offlineView = reload(view, '/child/adventure');
    await queueOnePhoto();
    await userEvent.setup().click(screen.getByRole('button', { name: uk.logout }));
    expect(await screen.findByRole('button', { name: uk.login })).toBeInTheDocument();
    await waitFor(async () => {
      const snapshot = await offlineStore.restore();
      expect(snapshot).toMatchObject({ owner: null, cache: [], pending: [], signedOut: true });
      expect(await offlineStore.db.queue.count()).toBe(0);
    });
    expect(localStorage.getItem('kidquest:signed-out')).toBe('1');
    const refreshes = fetchMock.mock.calls.filter(([url]) =>
      String(url).endsWith('/auth/refresh'),
    ).length;
    state.mode = 'online';
    online();
    reload(offlineView);
    expect(await screen.findByRole('button', { name: uk.login })).toBeInTheDocument();
    expect(
      fetchMock.mock.calls.filter(([url]) => String(url).endsWith('/auth/refresh')),
    ).toHaveLength(refreshes);
  });

  it('retains the owner, cached reads and exact queued photo operation after a transient renewal failure', async () => {
    const { state, view } = await cachedChild();
    state.mode = 'offline';
    offline();
    const offlineView = reload(view, '/child/adventure');
    const operation = await queueOnePhoto();
    reload(offlineView);
    expect(await screen.findByText('Попередня підтверджена перемога')).toBeInTheDocument();
    const snapshot = await offlineStore.restore();
    expect(snapshot.owner?.user.id).toBe(child.id);
    expect(snapshot.signedOut).toBe(false);
    expect(snapshot.pending[0]?.operationId).toBe(operation.operationId);
    expect((await offlineStore.db.queue.get(operation.operationId))?.photos).toHaveLength(1);
  });

  it('purges cached family data and queued photos when the refresh cookie is definitively rejected', async () => {
    const { state, view } = await cachedChild();
    state.mode = 'offline';
    offline();
    const offlineView = reload(view, '/child/adventure');
    await queueOnePhoto();
    state.mode = 'unauthorized';
    online();
    reload(offlineView);
    expect(await screen.findByRole('button', { name: uk.login })).toBeInTheDocument();
    await waitFor(async () =>
      expect(await offlineStore.restore()).toMatchObject({
        owner: null,
        cache: [],
        pending: [],
        signedOut: true,
      }),
    );
    expect(screen.queryByText(task.title)).not.toBeInTheDocument();
  });

  it.each(['logout', 'forgetSession'] as const)(
    'fences a late owner lookup during renewal after %s has cleared the session',
    async (action) => {
      const { view } = await cachedChild();
      const previous = await offlineStore.owner();
      expect(previous?.user.id).toBe(child.id);
      let release!: (owner: OfflineOwner | null) => void;
      const delayedOwner = new Promise<OfflineOwner | null>((resolve) => {
        release = resolve;
      });
      const ownerLookup = vi.spyOn(offlineStore, 'owner').mockImplementation(() => delayedOwner);
      const activation = vi.spyOn(offlineStore, 'activate');
      let renewal!: Promise<void>;
      act(() => {
        renewal = authProbe.current!.revalidate();
      });
      await waitFor(() => expect(ownerLookup).toHaveBeenCalled());
      expect(screen.getByRole('heading', { name: task.title })).toBeInTheDocument();
      await act(async () => {
        await authProbe.current![action]();
      });
      expect(await screen.findByRole('button', { name: uk.login })).toBeInTheDocument();
      expect(await offlineStore.restore()).toMatchObject({
        owner: null,
        cache: [],
        pending: [],
        signedOut: true,
      });
      await act(async () => {
        release(previous);
        await renewal;
      });
      ownerLookup.mockRestore();
      expect(activation).not.toHaveBeenCalled();
      expect(await offlineStore.restore()).toMatchObject({
        owner: null,
        cache: [],
        pending: [],
        signedOut: true,
      });
      expect(localStorage.getItem('kidquest:signed-out')).toBe('1');
      expect(authProbe.current?.user).toBeNull();
      expect(view.client.getQueryData(['tasks'])).toBeUndefined();
    },
  );
  it('keeps a parent session online-only and removes the previous child offline identity', async () => {
    const { state, view } = await cachedChild();
    state.user = parent;
    const parentView = reload(view, '/parent');
    expect(
      await screen.findByRole('heading', { name: uk.greeting(parent.firstName) }),
    ).toBeInTheDocument();
    expect(await offlineStore.restore()).toMatchObject({ owner: null, cache: [], pending: [] });
    state.mode = 'offline';
    offline();
    reload(parentView, '/parent');
    expect(await screen.findByRole('button', { name: uk.login })).toBeInTheDocument();
    expect(screen.queryByText(task.title)).not.toBeInTheDocument();
  });
});
