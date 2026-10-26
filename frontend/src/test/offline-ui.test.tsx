import { QueryClient, QueryClientProvider, onlineManager } from '@tanstack/react-query';
import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { TaskDto } from '@kidquest/types';
import { TaskList } from '../features/quests/TaskList';
import { OfflineStatus } from '../features/offline/OfflineStatus';
import { uk } from '../lib/i18n';
import { QueryState } from '../features/workflows/common';
import { ApiError } from '../services/api';

const offline = vi.hoisted(() => ({
  timeZone: 'UTC',
  connected: undefined as boolean | undefined,
  ready: true,
  available: true,
  cachedAt: '2026-10-23T09:00:00.000Z' as string | null,
  pending: [] as Array<{
    operationId: string;
    taskId: string;
    taskTitle: string;
    completedAt: string;
    completionDate: string;
    status: 'PENDING' | 'SENDING' | 'FAILED';
    attempts: number;
    nextAttemptAt: number;
    errorCode: string | null;
    errorMessage: string | null;
  }>,
  syncing: false,
  queueTask: vi.fn(),
  retry: vi.fn(),
  discard: vi.fn(),
  sync: vi.fn(),
}));
vi.mock('../features/offline/OfflineProvider', () => ({ useOffline: () => offline }));
const task: TaskDto = {
  id: 'task-1',
  updatedAt: '2026-10-23T09:00:00Z',
  title: 'Прибрати іграшки',
  description: 'Поклади іграшки на місце',
  categoryId: 'category-1',
  category: { id: 'category-1', name: 'Дім', icon: 'ListChecks', color: 'primary' },
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
function queued(status: 'PENDING' | 'SENDING' | 'FAILED' = 'PENDING') {
  return {
    operationId: 'operation-1',
    taskId: task.id,
    taskTitle: task.title,
    completedAt: new Date().toISOString(),
    completionDate: new Date().toISOString().slice(0, 10),
    status,
    attempts: 1,
    nextAttemptAt: 0,
    errorCode: status === 'FAILED' ? 'TASK_CHANGED' : null,
    errorMessage: status === 'FAILED' ? 'Батьки змінили квест. Онови список.' : null,
  };
}
function mount(withTask = false, parent = false, taskData = task) {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  client.setQueryData(['tasks'], [taskData]);
  return render(
    <QueryClientProvider client={client}>
      <OfflineStatus />
      {withTask && <TaskList parent={parent} />}
    </QueryClientProvider>,
  );
}
beforeEach(() => {
  vi.clearAllMocks();
  offline.ready = true;
  offline.connected = undefined;
  offline.available = true;
  offline.cachedAt = '2026-10-23T09:00:00.000Z';
  offline.pending = [];
  offline.syncing = false;
  offline.queueTask.mockResolvedValue(undefined);
  offline.retry.mockResolvedValue(undefined);
  offline.discard.mockResolvedValue(undefined);
  offline.sync.mockResolvedValue(undefined);
  Object.defineProperty(navigator, 'onLine', { configurable: true, value: false });
  onlineManager.setOnline(false);
  vi.stubGlobal(
    'fetch',
    vi.fn(
      async () =>
        new Response(JSON.stringify({ success: true, data: [task] }), {
          headers: { 'Content-Type': 'application/json' },
        }),
    ),
  );
});
afterEach(() => {
  onlineManager.setOnline(true);
  Object.defineProperty(navigator, 'onLine', { configurable: true, value: true });
  vi.unstubAllGlobals();
});

describe('Child offline task controls', () => {
  it('checks required photos and durably queues files while offline without claiming submission or points', async () => {
    offline.queueTask.mockImplementation(async () => {
      offline.pending = [queued()];
    });
    mount(true);
    const user = userEvent.setup();
    await user.click(screen.getByRole('button', { name: uk.completeTask }));
    await user.click(screen.getByRole('button', { name: uk.taskQueueSubmit }));
    expect(screen.getByText(uk.photoRequiredError)).toBeInTheDocument();
    expect(offline.queueTask).not.toHaveBeenCalled();
    const photo = new File(['photo'], 'room.jpg', { type: 'image/jpeg' });
    await user.upload(screen.getByLabelText(/Фото виконання/), photo);
    await user.click(screen.getByRole('button', { name: uk.taskQueueSubmit }));
    expect(offline.queueTask).toHaveBeenCalledWith(task, [photo]);
    expect(await screen.findByText(uk.taskQueued)).toBeInTheDocument();
    expect(screen.queryByText(uk.taskStates.SUBMITTED)).not.toBeInTheDocument();
    expect(screen.queryByRole('button', { name: uk.completeTask })).not.toBeInTheDocument();
    expect(
      vi
        .mocked(fetch)
        .mock.calls.every(([, options]) => !options?.method || options.method === 'GET'),
    ).toBe(true);
  });

  it('retains selected photos when local saving fails and allows the same selection to be retried', async () => {
    offline.queueTask.mockRejectedValueOnce(new Error('Не вистачає місця для фото.'));
    mount(true);
    const user = userEvent.setup();
    await user.click(screen.getByRole('button', { name: uk.completeTask }));
    const photo = new File(['photo'], 'room.png', { type: 'image/png' });
    await user.upload(screen.getByLabelText(/Фото виконання/), photo);
    await user.click(screen.getByRole('button', { name: uk.taskQueueSubmit }));
    expect(await screen.findByRole('alert')).toHaveTextContent('Не вистачає місця для фото.');
    expect(screen.getByText(uk.photoCount(1))).toBeInTheDocument();
    await user.click(screen.getByRole('button', { name: uk.taskQueueSubmit }));
    await waitFor(() => expect(offline.queueTask).toHaveBeenCalledTimes(2));
    expect(offline.queueTask.mock.calls[1]).toEqual([task, [photo]]);
  });

  it.each(['PENDING', 'SENDING', 'FAILED'] as const)(
    'blocks a second completion while the saved operation is %s',
    (status) => {
      offline.pending = [queued(status)];
      mount(true);
      expect(screen.queryByRole('button', { name: uk.completeTask })).not.toBeInTheDocument();
      const label =
        status === 'FAILED'
          ? uk.taskQueueFailed
          : status === 'SENDING'
            ? uk.taskQueueSending
            : uk.taskQueued;
      expect(screen.getByText(label)).toBeInTheDocument();
    },
  );

  it('allows today’s repeated quest when yesterday’s saved operation remains unresolved', () => {
    offline.pending = [{ ...queued('FAILED'), completionDate: '2000-01-01' }];
    mount(true);
    expect(screen.getByRole('button', { name: uk.completeTask })).toBeEnabled();
  });

  it('keeps a nonrepeating quest blocked while an older saved operation remains unresolved', () => {
    offline.pending = [{ ...queued(), completionDate: '2000-01-01' }];
    mount(true, false, { ...task, repeatDaily: false });
    expect(screen.queryByRole('button', { name: uk.completeTask })).not.toBeInTheDocument();
    expect(screen.getByText(uk.taskQueued)).toBeInTheDocument();
  });
  it('disables completion and explains when local storage is unavailable', () => {
    offline.available = false;
    mount(true);
    expect(screen.getByRole('button', { name: uk.completeTask })).toBeDisabled();
    expect(screen.getByText(uk.offlineStorageUnavailable)).toBeInTheDocument();
    expect(screen.getByText(uk.taskQueueStorageHint)).toBeInTheDocument();
  });

  it('explains terminal rejection, retries the retained operation and confirms local deletion', async () => {
    Object.defineProperty(navigator, 'onLine', { configurable: true, value: true });
    offline.pending = [queued('FAILED')];
    mount();
    expect(screen.getByText('Батьки змінили квест. Онови список.')).toBeInTheDocument();
    expect(screen.getByText(uk.offlinePhotosKept)).toBeInTheDocument();
    const user = userEvent.setup();
    await user.click(screen.getByRole('button', { name: uk.retry }));
    expect(offline.retry).toHaveBeenCalledWith('operation-1');
    await user.click(screen.getByRole('button', { name: uk.offlineDiscard }));
    expect(offline.discard).not.toHaveBeenCalled();
    expect(screen.getByText(uk.offlineDiscardHint)).toBeInTheDocument();
    await user.click(screen.getByRole('button', { name: uk.cancel }));
    expect(offline.discard).not.toHaveBeenCalled();
    await user.click(screen.getByRole('button', { name: uk.offlineDiscard }));
    await user.click(screen.getByRole('button', { name: uk.offlineConfirmDiscard }));
    expect(offline.discard).toHaveBeenCalledWith('operation-1');
  });

  it('shows the saved-data offline banner when the browser has a network but the API is unavailable', () => {
    Object.defineProperty(navigator, 'onLine', { configurable: true, value: true });
    offline.connected = false;
    mount();
    expect(screen.getByText(uk.offlineChild)).toBeInTheDocument();
    expect(screen.getByText(/Останні збережені дані:/)).toBeInTheDocument();
    expect(screen.queryByText(uk.offlineReady)).not.toBeInTheDocument();
  });

  it('keeps cached reads usable without transient network, server or throttling error banners', () => {
    const retry = vi.fn();
    const view = render(
      <QueryState
        pending={false}
        error={new ApiError(0, 'NETWORK_ERROR', 'Немає зв’язку')}
        retry={retry}
        hasData
      />,
    );
    expect(screen.queryByRole('alert')).not.toBeInTheDocument();
    view.rerender(
      <QueryState
        pending={false}
        error={new ApiError(503, 'UNAVAILABLE', 'Спробуйте пізніше')}
        retry={retry}
        hasData
      />,
    );
    expect(screen.queryByRole('alert')).not.toBeInTheDocument();
    view.rerender(
      <QueryState
        pending={false}
        error={new ApiError(429, 'RATE_LIMIT', 'Забагато запитів')}
        retry={retry}
        hasData
      />,
    );
    expect(screen.queryByRole('alert')).not.toBeInTheDocument();
  });

  it('retains error and retry without cached data and preserves definitive business errors with cached data', async () => {
    const retry = vi.fn();
    const view = render(
      <QueryState
        pending={false}
        error={new ApiError(0, 'NETWORK_ERROR', 'Немає зв’язку')}
        retry={retry}
      />,
    );
    expect(screen.getByRole('alert')).toHaveTextContent('Немає зв’язку');
    await userEvent.setup().click(screen.getByRole('button', { name: uk.retry }));
    expect(retry).toHaveBeenCalledOnce();
    view.rerender(
      <QueryState
        pending={false}
        error={new ApiError(403, 'FORBIDDEN', 'Немає доступу до квесту')}
        retry={retry}
        hasData
      />,
    );
    expect(screen.getByRole('alert')).toHaveTextContent('Немає доступу до квесту');
  });
  it('offers manual sync online and keeps retry disabled offline', async () => {
    offline.pending = [queued('FAILED')];
    const view = mount();
    expect(screen.getByRole('button', { name: uk.retry })).toBeDisabled();
    expect(screen.queryByRole('button', { name: uk.offlineSyncNow })).not.toBeInTheDocument();
    view.unmount();
    Object.defineProperty(navigator, 'onLine', { configurable: true, value: true });
    offline.pending = [queued()];
    mount();
    await userEvent.setup().click(screen.getByRole('button', { name: uk.offlineSyncNow }));
    expect(offline.sync).toHaveBeenCalledOnce();
  });
});
