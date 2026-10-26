import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { MemoryRouter } from 'react-router-dom';
import { afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import type {
  PublicUser,
  TaskDto,
  TaskCompletionDto,
  RewardDto,
  RewardRequestDto,
  PointTransactionDto,
  DashboardData,
} from '@kidquest/types';
import { AuthProvider } from '../app/providers/AuthProvider';
import { ThemeProvider } from '../app/providers/ThemeProvider';
import { Router } from '../app/router/Router';
import { resetApiSession } from '../services/api';
import { uk } from '../lib/i18n';

const workflowOffline = vi.hoisted(() => ({
  ready: true,
  available: true,
  timeZone: 'UTC',
  cachedAt: null,
  pending: [] as Array<{
    operationId: string;
    taskId: string;
    taskTitle: string;
    completedAt: string;
    completionDate: string;
    status: 'PENDING';
    attempts: number;
    nextAttemptAt: number;
    errorCode: null;
    errorMessage: null;
  }>,
  syncing: false,
  queueTask: vi.fn(),
  retry: vi.fn(),
  discard: vi.fn(),
  sync: vi.fn(),
}));
vi.mock('../features/offline/OfflineProvider', () => ({
  useOffline: () => workflowOffline,
  OfflineProvider: ({ children }: { children: React.ReactNode }) => children,
}));
const category = {
  id: '11111111-1111-4111-8111-111111111111',
  name: 'Дім',
  icon: 'ListChecks',
  color: 'primary',
};
const task: TaskDto = {
  id: '22222222-2222-4222-8222-222222222222',
  updatedAt: '2026-10-21T09:00:00Z',
  title: 'Прибрати кімнату',
  description: 'Поклади іграшки на місце',
  categoryId: category.id,
  category,
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
const completion: TaskCompletionDto = {
  id: '33333333-3333-4333-8333-333333333333',
  taskId: task.id,
  childId: 'child-1',
  childName: 'Богдан',
  taskTitle: task.title,
  status: 'SUBMITTED',
  operationId: '66666666-6666-4666-8666-666666666666',
  completionDate: '2026-10-21',
  pointsSnapshot: 20,
  submittedAt: '2026-10-21T10:00:00Z',
  reviewedAt: null,
  rejectionReason: null,
  photos: [
    { id: 'photo-1', url: '/api/v1/task-photos/photo-1', mimeType: 'image/webp', size: 40 },
    { id: 'photo-2', url: '/api/v1/task-photos/photo-2', mimeType: 'image/webp', size: 40 },
  ],
};
const reward: RewardDto = {
  id: '44444444-4444-4444-8444-444444444444',
  title: 'Похід у парк',
  description: 'Сімейна прогулянка',
  icon: 'Gift',
  imageUrl: null,
  cost: 50,
  type: 'ACTIVITY',
  isActive: true,
  createdAt: '2026-10-21T09:00:00Z',
};
const parent: PublicUser = {
  id: 'parent-user',
  email: 'parent@example.test',
  familyId: 'family-1',
  firstName: 'Олена',
  lastName: '',
  role: 'PARENT',
};
const child: PublicUser = { ...parent, id: 'child-user', firstName: 'Богдан', role: 'CHILD' };

function success(data: unknown, status = 200) {
  return new Response(JSON.stringify({ success: true, data }), {
    status,
    headers: { 'Content-Type': 'application/json' },
  });
}
function mockWorkflows({
  role = 'CHILD',
  balance = 0,
  pendingCompletion = false,
  failFirstSubmit = false,
  initialRewardRequest = false,
  staleReviewOnce = false,
}: {
  role?: 'CHILD' | 'PARENT';
  balance?: number;
  pendingCompletion?: boolean;
  failFirstSubmit?: boolean;
  initialRewardRequest?: boolean;
  staleReviewOnce?: boolean;
} = {}) {
  const state = {
    tasks: [structuredClone(task)],
    categories: [category],
    rewards: [structuredClone(reward)],
    completions: pendingCompletion ? [structuredClone(completion)] : ([] as TaskCompletionDto[]),
    requests: [] as RewardRequestDto[],
    balance,
    transactions: [] as PointTransactionDto[],
  };
  if (initialRewardRequest)
    state.requests.push({
      id: 'request-1',
      rewardId: reward.id,
      rewardTitle: reward.title,
      childId: 'child-1',
      childName: 'Богдан',
      status: 'PENDING',
      costSnapshot: reward.cost,
      operationId: 'operation-1',
      reviewedAt: null,
      issuedAt: null,
      rejectionReason: null,
      createdAt: '2026-10-21T10:00:00Z',
    });
  let failedSubmit = false;
  let rejectedStaleReview = false;
  const fetchMock = vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
    const requestUrl = new URL(String(input), 'http://localhost');
    const path = requestUrl.pathname.replace('/api/v1', '');
    const method = init?.method || 'GET';
    if (path === '/auth/refresh')
      return success({ user: role === 'PARENT' ? parent : child, accessToken: 'workflow-access' });
    if (path === '/family/members') return success([parent, child]);
    if (path === '/statistics')
      return success({
        family: { id: 'family-1', name: 'Родина', timeZone: 'Europe/Kyiv' },
        child: { id: 'child-1', firstName: 'Богдан' },
        counts: {
          children: 1,
          activeTasks: state.tasks.length,
          activeRewards: state.rewards.length,
          pendingCompletions: state.completions.filter((item) => item.status === 'SUBMITTED')
            .length,
          pendingRewards: state.requests.filter((item) => item.status === 'PENDING').length,
        },
        balance: state.balance,
        tasks: state.tasks.map((item) => ({ ...item, category: item.category.name })),
        rewards: state.rewards,
        today: {
          approved: state.completions.filter((item) => item.status === 'APPROVED').length,
          total: state.tasks.length,
        },
        streak: null,
      } satisfies DashboardData);
    if (path === '/task-categories') {
      if (method === 'POST') {
        const body = JSON.parse(String(init?.body));
        state.categories.push({
          ...category,
          id: '55555555-5555-4555-8555-555555555555',
          name: body.name,
        });
        return success(state.categories.at(-1), 201);
      }
      return success(state.categories);
    }
    if (path === '/tasks') {
      if (method === 'POST') {
        const body = JSON.parse(String(init?.body));
        state.tasks.push({
          ...task,
          ...body,
          id: 'new-task',
          category: state.categories.find((item) => item.id === body.categoryId),
        });
        return success(state.tasks.at(-1), 201);
      }
      return success(state.tasks);
    }
    if (path.endsWith('/submit')) {
      if (failFirstSubmit && !failedSubmit) {
        failedSubmit = true;
        throw new TypeError('Failed to fetch');
      }
      state.tasks[0]!.todayCompletion = { ...completion, photos: [] };
      state.completions.push({ ...completion, photos: [] });
      return success(completion, 201);
    }
    if (path.startsWith('/tasks/')) {
      if (method === 'DELETE')
        state.tasks = state.tasks.filter((item) => item.id !== path.split('/')[2]);
      if (method === 'PATCH')
        Object.assign(
          state.tasks.find((item) => item.id === path.split('/')[2])!,
          JSON.parse(String(init?.body)),
        );
      return success(null);
    }
    if (path === '/task-completions')
      return success(
        requestUrl.searchParams.has('status')
          ? state.completions.filter((item) =>
              requestUrl.searchParams.get('status')!.split(',').includes(item.status),
            )
          : state.completions,
      );
    if (path.startsWith('/task-photos/'))
      return new Response(new Blob(['photo'], { type: 'image/webp' }), {
        headers: { 'Content-Type': 'image/webp' },
      });
    if (path.endsWith('/approve') && path.startsWith('/task-completions/')) {
      if (staleReviewOnce && !rejectedStaleReview) {
        rejectedStaleReview = true;
        state.completions[0]!.operationId = '77777777-7777-4777-8777-777777777777';
        return new Response(
          JSON.stringify({
            success: false,
            error: {
              code: 'STALE_SUBMISSION',
              message: 'Стан виконання змінився. Оновіть список.',
            },
          }),
          { status: 409, headers: { 'Content-Type': 'application/json' } },
        );
      }
      state.completions[0]!.status = 'APPROVED';
      state.balance += 20;
      state.transactions.push({
        id: 'transaction-1',
        childId: 'child-1',
        type: 'TASK_REWARD',
        amount: 20,
        description: task.title,
        createdAt: '2026-10-21T10:00:00Z',
      });
      return success(state.completions[0]);
    }
    if (path.endsWith('/reject') && path.startsWith('/task-completions/')) {
      state.completions[0]!.status = 'REJECTED';
      state.completions[0]!.rejectionReason = JSON.parse(String(init?.body)).reason || null;
      return success(state.completions[0]);
    }
    if (path === '/points') return success({ childId: 'child-1', balance: state.balance });
    if (path === '/points/history') return success(state.transactions);
    if (path === '/rewards') {
      if (method === 'POST') {
        state.rewards.push({ ...reward, ...JSON.parse(String(init?.body)), id: 'new-reward' });
        return success(state.rewards.at(-1), 201);
      }
      return success(state.rewards);
    }
    if (path.endsWith('/request')) {
      state.requests.push({
        id: 'request-1',
        rewardId: reward.id,
        rewardTitle: reward.title,
        childId: 'child-1',
        childName: 'Богдан',
        status: 'PENDING',
        costSnapshot: reward.cost,
        operationId: JSON.parse(String(init?.body)).operationId,
        reviewedAt: null,
        issuedAt: null,
        rejectionReason: null,
        createdAt: '2026-10-21T10:00:00Z',
      });
      return success(state.requests[0], 201);
    }
    if (path.startsWith('/rewards/')) {
      if (method === 'PATCH')
        Object.assign(
          state.rewards.find((item) => item.id === path.split('/')[2])!,
          JSON.parse(String(init?.body)),
        );
      if (method === 'DELETE')
        state.rewards = state.rewards.filter((item) => item.id !== path.split('/')[2]);
      return success(null);
    }
    if (path === '/reward-requests')
      return success(
        requestUrl.searchParams.has('status')
          ? state.requests.filter((item) =>
              requestUrl.searchParams.get('status')!.split(',').includes(item.status),
            )
          : state.requests,
      );
    if (path.startsWith('/reward-requests/')) {
      if (path.endsWith('/approve')) {
        state.requests[0]!.status = 'APPROVED';
        state.balance -= state.requests[0]!.costSnapshot;
      }
      if (path.endsWith('/issue')) state.requests[0]!.status = 'ISSUED';
      if (path.endsWith('/reject')) state.requests[0]!.status = 'REJECTED';
      return success(state.requests[0]);
    }
    throw new Error(`Unexpected request ${method} ${path}`);
  });
  vi.stubGlobal('fetch', fetchMock);
  return { state, fetchMock };
}

function renderWorkflow(path: string) {
  const client = new QueryClient({
    defaultOptions: { queries: { retry: false }, mutations: { retry: false } },
  });
  return render(
    <QueryClientProvider client={client}>
      <ThemeProvider>
        <AuthProvider>
          <MemoryRouter initialEntries={[path]}>
            <Router />
          </MemoryRouter>
        </AuthProvider>
      </ThemeProvider>
    </QueryClientProvider>,
  );
}

beforeAll(async () => {
  await Promise.all([
    import('../pages/QuestsPage'),
    import('../pages/RewardsPage'),
    import('../pages/DashboardPage'),
  ]);
  Object.defineProperty(URL, 'createObjectURL', {
    configurable: true,
    value: vi.fn(() => 'blob:private-photo'),
  });
  Object.defineProperty(URL, 'revokeObjectURL', { configurable: true, value: vi.fn() });
});
beforeEach(() => {
  resetApiSession();
  localStorage.clear();
  workflowOffline.pending = [];
  workflowOffline.queueTask.mockReset().mockResolvedValue(undefined);
});
afterEach(() => {
  vi.unstubAllGlobals();
  vi.unstubAllEnvs();
});

describe('Quest and reward workflows', () => {
  it('defaults new quests to daily repetition and submits the checked value', async () => {
    const { fetchMock } = mockWorkflows({ role: 'PARENT' });
    const user = userEvent.setup();
    renderWorkflow('/parent/quests');
    await user.click(await screen.findByRole('button', { name: uk.newTask }));
    expect(screen.getByRole('checkbox', { name: uk.repeatDaily })).toBeChecked();
    expect(screen.getByRole('checkbox', { name: uk.repeatDaily })).toHaveAccessibleDescription(
      uk.repeatDailyHint,
    );
    await user.type(screen.getByLabelText(uk.title), 'Щоденна зарядка');
    await user.selectOptions(screen.getByLabelText(uk.category), category.id);
    await user.click(screen.getByRole('button', { name: uk.save }));
    const card = (await screen.findByRole('heading', { name: 'Щоденна зарядка' })).closest(
      'article',
    )!;
    expect(within(card).getByText(uk.dailyBadge)).toBeInTheDocument();
    const creation = fetchMock.mock.calls.find(
      ([url, init]) => String(url).endsWith('/tasks') && init?.method === 'POST',
    )!;
    expect(JSON.parse(String(creation[1]?.body)).repeatDaily).toBe(true);
  });

  it('creates a quest without repetition, preserves false on edit, and can enable daily repetition', async () => {
    const { fetchMock } = mockWorkflows({ role: 'PARENT' });
    const user = userEvent.setup();
    renderWorkflow('/parent/quests');
    await user.click(await screen.findByRole('button', { name: uk.newTask }));
    await user.type(screen.getByLabelText(uk.title), 'Прибрати шафу');
    await user.selectOptions(screen.getByLabelText(uk.category), category.id);
    await user.click(screen.getByRole('checkbox', { name: uk.repeatDaily }));
    await user.click(screen.getByRole('button', { name: uk.save }));
    const heading = await screen.findByRole('heading', { name: 'Прибрати шафу' });
    expect(within(heading.closest('article')!).getByText(uk.noRepeatBadge)).toBeInTheDocument();
    const creation = fetchMock.mock.calls.find(
      ([url, init]) => String(url).endsWith('/tasks') && init?.method === 'POST',
    )!;
    expect(JSON.parse(String(creation[1]?.body)).repeatDaily).toBe(false);
    await user.click(within(heading.closest('article')!).getByRole('button', { name: uk.edit }));
    expect(screen.getByRole('checkbox', { name: uk.repeatDaily })).not.toBeChecked();
    await user.type(screen.getByLabelText(uk.description), 'Склади речі на полички.');
    await user.click(screen.getByRole('button', { name: uk.save }));
    await waitFor(() =>
      expect(screen.queryByRole('checkbox', { name: uk.repeatDaily })).not.toBeInTheDocument(),
    );
    const edits = () =>
      fetchMock.mock.calls.filter(
        ([url, init]) => String(url).endsWith('/tasks/new-task') && init?.method === 'PATCH',
      );
    expect(JSON.parse(String(edits()[0]![1]?.body)).repeatDaily).toBe(false);
    await user.click(
      within(screen.getByRole('heading', { name: 'Прибрати шафу' }).closest('article')!).getByRole(
        'button',
        { name: uk.edit },
      ),
    );
    expect(screen.getByRole('checkbox', { name: uk.repeatDaily })).not.toBeChecked();
    await user.click(screen.getByRole('checkbox', { name: uk.repeatDaily }));
    await user.click(screen.getByRole('button', { name: uk.save }));
    await waitFor(() =>
      expect(
        within(
          screen.getByRole('heading', { name: 'Прибрати шафу' }).closest('article')!,
        ).getByText(uk.dailyBadge),
      ).toBeInTheDocument(),
    );
    expect(JSON.parse(String(edits()[1]![1]?.body)).repeatDaily).toBe(true);
  });

  it.each([true, false])(
    'shows the repetition mode on child quest cards: repeatDaily=%s',
    async (repeatDaily) => {
      const { state } = mockWorkflows();
      state.tasks[0]!.repeatDaily = repeatDaily;
      renderWorkflow('/child/adventure');
      const card = (await screen.findByRole('heading', { name: task.title })).closest('article')!;
      expect(
        within(card).getByText(repeatDaily ? uk.dailyBadge : uk.noRepeatBadge),
      ).toBeInTheDocument();
    },
  );

  it('creates and edits calendar dates and can clear them without changing the task time window', async () => {
    const { fetchMock } = mockWorkflows({ role: 'PARENT' });
    const user = userEvent.setup();
    renderWorkflow('/parent/quests');
    await user.click(await screen.findByRole('button', { name: uk.newTask }));
    await user.type(screen.getByLabelText(uk.title), 'Листопадовий квест');
    await user.selectOptions(screen.getByLabelText(uk.category), category.id);
    fireEvent.change(screen.getByLabelText(uk.startDate), { target: { value: '2026-11-01' } });
    fireEvent.change(screen.getByLabelText(uk.endDate), { target: { value: '2026-11-05' } });
    fireEvent.change(screen.getByLabelText(uk.startTime), { target: { value: '08:00' } });
    fireEvent.change(screen.getByLabelText(uk.endTime), { target: { value: '11:00' } });
    await user.click(screen.getByRole('button', { name: uk.save }));
    const heading = await screen.findByRole('heading', { name: 'Листопадовий квест' });
    const created = fetchMock.mock.calls.find(
      ([url, init]) => String(url).endsWith('/tasks') && init?.method === 'POST',
    )!;
    expect(JSON.parse(String(created[1]?.body))).toMatchObject({
      startDate: '2026-11-01',
      endDate: '2026-11-05',
      startTime: '08:00',
      endTime: '11:00',
    });
    expect(within(heading.closest('article')!).getByLabelText(uk.taskDateRange)).toHaveTextContent(
      '1 листопада 2026 р. – 5 листопада 2026 р.',
    );
    await user.click(within(heading.closest('article')!).getByRole('button', { name: uk.edit }));
    expect(screen.getByLabelText(uk.startDate)).toHaveValue('2026-11-01');
    expect(screen.getByLabelText(uk.endDate)).toHaveValue('2026-11-05');
    fireEvent.change(screen.getByLabelText(uk.endDate), { target: { value: '2026-11-06' } });
    await user.click(screen.getByRole('button', { name: uk.save }));
    await waitFor(() =>
      expect(
        fetchMock.mock.calls.filter(
          ([url, init]) => String(url).endsWith('/tasks/new-task') && init?.method === 'PATCH',
        ),
      ).toHaveLength(1),
    );
    await user.click(
      within(
        screen.getByRole('heading', { name: 'Листопадовий квест' }).closest('article')!,
      ).getByRole('button', { name: uk.edit }),
    );
    expect(screen.getByLabelText(uk.endDate)).toHaveValue('2026-11-06');
    fireEvent.change(screen.getByLabelText(uk.startDate), { target: { value: '' } });
    fireEvent.change(screen.getByLabelText(uk.endDate), { target: { value: '' } });
    await user.click(screen.getByRole('button', { name: uk.save }));
    await waitFor(() =>
      expect(
        within(
          screen.getByRole('heading', { name: 'Листопадовий квест' }).closest('article')!,
        ).queryByLabelText(uk.taskDateRange),
      ).not.toBeInTheDocument(),
    );
    const edits = fetchMock.mock.calls.filter(
      ([url, init]) => String(url).endsWith('/tasks/new-task') && init?.method === 'PATCH',
    );
    expect(JSON.parse(String(edits[0]![1]?.body))).toMatchObject({
      startDate: '2026-11-01',
      endDate: '2026-11-06',
    });
    expect(JSON.parse(String(edits[1]![1]?.body))).toMatchObject({
      startDate: null,
      endDate: null,
      startTime: '08:00',
      endTime: '11:00',
    });
  });

  it('rejects a reversed date range but accepts the same inclusive start and end day', async () => {
    const { fetchMock } = mockWorkflows({ role: 'PARENT' });
    const user = userEvent.setup();
    renderWorkflow('/parent/quests');
    await user.click(await screen.findByRole('button', { name: uk.newTask }));
    await user.type(screen.getByLabelText(uk.title), 'Квест на один день');
    await user.selectOptions(screen.getByLabelText(uk.category), category.id);
    fireEvent.change(screen.getByLabelText(uk.startDate), { target: { value: '2026-11-10' } });
    fireEvent.change(screen.getByLabelText(uk.endDate), { target: { value: '2026-11-09' } });
    await user.click(screen.getByRole('button', { name: uk.save }));
    expect(
      await screen.findByText('Дата завершення має бути не раніше дати початку'),
    ).toBeInTheDocument();
    expect(
      fetchMock.mock.calls.some(
        ([url, init]) => String(url).endsWith('/tasks') && init?.method === 'POST',
      ),
    ).toBe(false);
    fireEvent.change(screen.getByLabelText(/^Дата завершення/), {
      target: { value: '2026-11-10' },
    });
    await user.click(screen.getByRole('button', { name: uk.save }));
    expect(await screen.findByRole('heading', { name: 'Квест на один день' })).toBeInTheDocument();
  });

  it.each([
    { startDate: '2026-01-01', endDate: null, expected: 'З 1 січня 2026 р.' },
    { startDate: null, endDate: '2026-01-01', expected: 'До 1 січня 2026 р. включно' },
    { startDate: '2026-01-01', endDate: '2026-01-01', expected: '1 січня 2026 р.' },
  ])(
    'renders calendar boundaries in Ukrainian without shifting the date: $expected',
    async ({ startDate, endDate, expected }) => {
      vi.stubEnv('TZ', 'Pacific/Kiritimati');
      const { state } = mockWorkflows({ role: 'PARENT' });
      state.tasks[0]!.startDate = startDate;
      state.tasks[0]!.endDate = endDate;
      renderWorkflow('/parent/quests');
      expect(await screen.findByLabelText(uk.taskDateRange)).toHaveTextContent(expected);
    },
  );
  it('creates a family category and uses it in a quest editor', async () => {
    const { state } = mockWorkflows({ role: 'PARENT' });
    const user = userEvent.setup();
    renderWorkflow('/parent/quests');
    await user.click(await screen.findByText(uk.newCategory));
    await user.type(screen.getByLabelText(uk.categoryName), 'Здоров’я');
    await user.click(screen.getByRole('button', { name: uk.addCategory }));
    expect(await screen.findByText(uk.saved)).toBeInTheDocument();
    await user.click(screen.getByRole('button', { name: uk.newTask }));
    expect(await screen.findByRole('option', { name: 'Здоров’я' })).toBeInTheDocument();
    expect(state.categories).toHaveLength(2);
  });
  it('creates and edits a quest with shared validation, then soft-deletes through the API', async () => {
    const { state, fetchMock } = mockWorkflows({ role: 'PARENT' });
    const user = userEvent.setup();
    renderWorkflow('/parent/quests');
    await user.click(await screen.findByRole('button', { name: uk.newTask }));
    await user.type(screen.getByLabelText(uk.title), 'Ранкова зарядка');
    await user.selectOptions(screen.getByLabelText(uk.category), category.id);
    await user.click(screen.getByRole('button', { name: uk.save }));
    expect(await screen.findByRole('heading', { name: 'Ранкова зарядка' })).toBeInTheDocument();
    const card = screen.getByRole('heading', { name: 'Ранкова зарядка' }).closest('article')!;
    await user.click(within(card).getByRole('button', { name: uk.edit }));
    await user.clear(screen.getByLabelText(uk.taskPoints));
    await user.type(screen.getByLabelText(uk.taskPoints), '35');
    await user.click(screen.getByRole('button', { name: uk.save }));
    await waitFor(() => expect(state.tasks.at(-1)!.points).toBe(35));
    await user.click(
      within(
        screen.getByRole('heading', { name: 'Ранкова зарядка' }).closest('article')!,
      ).getByRole('button', { name: uk.remove }),
    );
    await user.click(screen.getByRole('button', { name: uk.confirmRemove }));
    await waitFor(() =>
      expect(screen.queryByRole('heading', { name: 'Ранкова зарядка' })).not.toBeInTheDocument(),
    );
    expect(
      fetchMock.mock.calls.some(
        ([url, init]) => String(url).endsWith('/tasks/new-task') && init?.method === 'DELETE',
      ),
    ).toBe(true);
  });

  it('requires a photo and queues one durable completion without changing server state or points', async () => {
    const { state, fetchMock } = mockWorkflows();
    workflowOffline.queueTask.mockImplementation(async (selectedTask: TaskDto) => {
      workflowOffline.pending = [
        {
          operationId: 'saved-operation',
          taskId: selectedTask.id,
          taskTitle: selectedTask.title,
          completedAt: new Date().toISOString(),
          completionDate: new Date().toISOString().slice(0, 10),
          status: 'PENDING',
          attempts: 0,
          nextAttemptAt: 0,
          errorCode: null,
          errorMessage: null,
        },
      ];
    });
    const user = userEvent.setup();
    renderWorkflow('/child/adventure');
    await user.click(await screen.findByRole('button', { name: uk.completeTask }));
    await user.click(screen.getByRole('button', { name: uk.taskQueueSubmit }));
    expect(await screen.findByText(uk.photoRequiredError)).toBeInTheDocument();
    expect(workflowOffline.queueTask).not.toHaveBeenCalled();
    const photo = new File(['test-image'], 'room.jpg', { type: 'image/jpeg' });
    await user.upload(screen.getByLabelText(/Фото виконання/), photo);
    await user.click(screen.getByRole('button', { name: uk.taskQueueSubmit }));
    expect(await screen.findByText(uk.taskQueued)).toBeInTheDocument();
    expect(workflowOffline.queueTask).toHaveBeenCalledWith(task, [photo]);
    expect(screen.queryByRole('button', { name: uk.completeTask })).not.toBeInTheDocument();
    expect(state.tasks[0]!.todayCompletion).toBeNull();
    expect(state.balance).toBe(0);
    expect(fetchMock.mock.calls.filter(([url]) => String(url).endsWith('/submit'))).toHaveLength(0);
  });
  it('loads multiple private photos with authorization and approves a submitted quest', async () => {
    const { state, fetchMock } = mockWorkflows({ role: 'PARENT', pendingCompletion: true });
    const user = userEvent.setup();
    renderWorkflow('/parent');
    const heading = await screen.findByRole('heading', { name: uk.taskReview });
    const panel = heading.closest('section')!;
    await user.click(await within(panel).findByRole('button', { name: /Переглянути фото/ }));
    await waitFor(() => expect(within(panel).getAllByRole('img')).toHaveLength(2));
    const photoCall = fetchMock.mock.calls.find(([url]) => String(url).includes('/task-photos/'))!;
    expect(new Headers(photoCall[1]?.headers).get('Authorization')).toBe('Bearer workflow-access');
    await user.click(within(panel).getByRole('button', { name: uk.approve }));
    expect(await screen.findByText(uk.approvedPoints(20))).toBeInTheDocument();
    expect(state.balance).toBe(20);
    expect(state.completions[0]!.status).toBe('APPROVED');
    const review = fetchMock.mock.calls.find(([url]) =>
      String(url).endsWith(`/task-completions/${completion.id}/approve`),
    )!;
    expect(JSON.parse(String(review[1]?.body))).toEqual({ operationId: completion.operationId });
    expect(
      fetchMock.mock.calls.some(([url]) =>
        String(url).endsWith('/task-completions?status=SUBMITTED'),
      ),
    ).toBe(true);
  });

  it('disables review for a legacy completion without a submission operationId', async () => {
    const { state } = mockWorkflows({ role: 'PARENT', pendingCompletion: true });
    state.completions[0]!.operationId = null;
    renderWorkflow('/parent');
    const panel = (await screen.findByRole('heading', { name: uk.taskReview })).closest('section')!;
    expect(await within(panel).findByText(uk.reviewUnavailable)).toBeInTheDocument();
    expect(within(panel).getByRole('button', { name: uk.approve })).toBeDisabled();
    expect(within(panel).getByRole('button', { name: uk.reject })).toBeDisabled();
  });

  it('shows a stale-review conflict and reloads the current submission before another approval', async () => {
    const { fetchMock } = mockWorkflows({
      role: 'PARENT',
      pendingCompletion: true,
      staleReviewOnce: true,
    });
    const user = userEvent.setup();
    renderWorkflow('/parent');
    const panel = (await screen.findByRole('heading', { name: uk.taskReview })).closest('section')!;
    await user.click(await within(panel).findByRole('button', { name: uk.approve }));
    expect(await within(panel).findByRole('alert')).toHaveTextContent(
      'Стан виконання змінився. Оновіть список.',
    );
    await user.click(within(panel).getByRole('button', { name: uk.refreshReviews }));
    await waitFor(() =>
      expect(
        fetchMock.mock.calls.filter(([url]) =>
          String(url).endsWith('/task-completions?status=SUBMITTED'),
        ),
      ).toHaveLength(2),
    );
    await user.click(within(panel).getByRole('button', { name: uk.approve }));
    expect(await within(panel).findByText(uk.approvedPoints(20))).toBeInTheDocument();
    const reviews = fetchMock.mock.calls.filter(([url]) =>
      String(url).endsWith(`/task-completions/${completion.id}/approve`),
    );
    expect(JSON.parse(String(reviews[1]![1]?.body)).operationId).toBe(
      '77777777-7777-4777-8777-777777777777',
    );
  });

  it('rejects a submitted quest with a supportive reason without adding points', async () => {
    const { state } = mockWorkflows({ role: 'PARENT', pendingCompletion: true });
    const user = userEvent.setup();
    renderWorkflow('/parent');
    const panel = (await screen.findByRole('heading', { name: uk.taskReview })).closest('section')!;
    await user.click(await within(panel).findByRole('button', { name: uk.reject }));
    await user.type(within(panel).getByLabelText(uk.rejectionReason), 'Спробуй ще скласти книжки.');
    await user.click(within(panel).getAllByRole('button', { name: uk.reject }).at(-1)!);
    expect(await screen.findByText(uk.rejected)).toBeInTheDocument();
    expect(state.completions[0]!.rejectionReason).toBe('Спробуй ще скласти книжки.');
    expect(state.balance).toBe(0);
  });

  it('creates, edits and soft-deletes a reward from the parent catalog', async () => {
    const { state } = mockWorkflows({ role: 'PARENT' });
    const user = userEvent.setup();
    renderWorkflow('/parent/rewards');
    await user.click(await screen.findByRole('button', { name: uk.newReward }));
    await user.type(screen.getByLabelText(uk.title), 'Сімейний пікнік');
    await user.selectOptions(screen.getByLabelText(uk.rewardType), 'ACTIVITY');
    await user.click(screen.getByRole('button', { name: uk.save }));
    const heading = await screen.findByRole('heading', { name: 'Сімейний пікнік' });
    await user.click(within(heading.closest('article')!).getByRole('button', { name: uk.edit }));
    await user.clear(screen.getByLabelText(uk.cost));
    await user.type(screen.getByLabelText(uk.cost), '80');
    await user.click(screen.getByRole('button', { name: uk.save }));
    await waitFor(() => expect(state.rewards.at(-1)!.cost).toBe(80));
    await user.click(
      within(
        screen.getByRole('heading', { name: 'Сімейний пікнік' }).closest('article')!,
      ).getByRole('button', { name: uk.remove }),
    );
    await user.click(screen.getByRole('button', { name: uk.confirmRemove }));
    await waitFor(() =>
      expect(screen.queryByRole('heading', { name: 'Сімейний пікнік' })).not.toBeInTheDocument(),
    );
    expect(state.rewards).toHaveLength(1);
  });

  it('disables unaffordable rewards and sends a pending request without spending points', async () => {
    const { state, fetchMock } = mockWorkflows({ balance: 100 });
    const user = userEvent.setup();
    renderWorkflow('/child/rewards');
    await user.click(await screen.findByRole('button', { name: uk.requestReward }));
    expect(await screen.findByText(uk.rewardRequested)).toBeInTheDocument();
    expect(state.balance).toBe(100);
    expect(state.requests[0]!.status).toBe('PENDING');
    const call = fetchMock.mock.calls.find(([url]) => String(url).endsWith('/request'))!;
    expect(JSON.parse(String(call[1]?.body)).operationId).toMatch(/^[0-9a-f-]{36}$/);
  });

  it('prevents requesting a reward when the confirmed balance is insufficient', async () => {
    mockWorkflows({ balance: 20 });
    renderWorkflow('/child/rewards');
    expect(await screen.findByRole('button', { name: uk.insufficientPoints })).toBeDisabled();
  });

  it('lets a parent approve and issue a reward through distinct actions', async () => {
    const { state, fetchMock } = mockWorkflows({
      role: 'PARENT',
      balance: 100,
      initialRewardRequest: true,
    });
    const user = userEvent.setup();
    renderWorkflow('/parent/rewards');
    await user.click(await screen.findByRole('button', { name: uk.approve }));
    expect(await screen.findByText(uk.rewardApproved)).toBeInTheDocument();
    expect(state.balance).toBe(50);
    await user.click(screen.getByRole('button', { name: uk.issueReward }));
    expect(await screen.findByText(uk.rewardIssued)).toBeInTheDocument();
    expect(state.requests[0]!.status).toBe('ISSUED');
    expect(state.balance).toBe(50);
    const approval = fetchMock.mock.calls.find(([url]) =>
      String(url).endsWith('/reward-requests/request-1/approve'),
    )!;
    expect(JSON.parse(String(approval[1]?.body))).toEqual({});
    expect(
      fetchMock.mock.calls.some(([url]) =>
        String(url).endsWith('/reward-requests?status=PENDING,APPROVED'),
      ),
    ).toBe(true);
  });

  it('keeps reward requests disabled until active request history has loaded', async () => {
    const { state, fetchMock } = mockWorkflows({ balance: 100, initialRewardRequest: true });
    const original = fetchMock.getMockImplementation()!;
    let complete!: (response: Response) => void;
    const delayed = new Promise<Response>((resolve) => {
      complete = resolve;
    });
    fetchMock.mockImplementation((input, init) =>
      String(input).endsWith('/reward-requests?status=PENDING,APPROVED')
        ? delayed
        : original(input, init),
    );
    renderWorkflow('/child/rewards');
    await screen.findByRole('heading', { name: reward.title, level: 2 });
    expect(screen.queryByRole('button', { name: uk.requestReward })).not.toBeInTheDocument();
    expect(screen.getByRole('button', { name: uk.loading })).toBeDisabled();
    complete(success(state.requests));
    expect(await screen.findByRole('button', { name: uk.rewardStates.PENDING })).toBeDisabled();
  });

  it('shows failed active-request loading without presenting an affordable reward as unaffordable', async () => {
    const { fetchMock } = mockWorkflows({ balance: 100 });
    const original = fetchMock.getMockImplementation()!;
    fetchMock.mockImplementation((input, init) =>
      String(input).endsWith('/reward-requests?status=PENDING,APPROVED')
        ? Promise.reject(new TypeError('Failed to fetch'))
        : original(input, init),
    );
    renderWorkflow('/child/rewards');
    expect(await screen.findByRole('alert')).toHaveTextContent(uk.genericError);
    expect(screen.queryByRole('button', { name: uk.insufficientPoints })).not.toBeInTheDocument();
    expect(screen.getByRole('button', { name: uk.loading })).toBeDisabled();
  });
});
