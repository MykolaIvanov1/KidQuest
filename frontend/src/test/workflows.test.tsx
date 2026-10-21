import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { render, screen, waitFor, within } from '@testing-library/react';
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
import { setAccessToken } from '../services/api';
import { uk } from '../lib/i18n';

const category = {
  id: '11111111-1111-4111-8111-111111111111',
  name: 'Дім',
  icon: 'ListChecks',
  color: 'primary',
};
const task: TaskDto = {
  id: '22222222-2222-4222-8222-222222222222',
  title: 'Прибрати кімнату',
  description: 'Поклади іграшки на місце',
  categoryId: category.id,
  category,
  icon: 'ListChecks',
  color: 'primary',
  points: 20,
  isRequired: true,
  photoRequired: true,
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
}: {
  role?: 'CHILD' | 'PARENT';
  balance?: number;
  pendingCompletion?: boolean;
  failFirstSubmit?: boolean;
  initialRewardRequest?: boolean;
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
  const fetchMock = vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
    const path = String(input).replace('/api/v1', '');
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
    if (path === '/task-completions') return success(state.completions);
    if (path.startsWith('/task-photos/'))
      return new Response(new Blob(['photo'], { type: 'image/webp' }), {
        headers: { 'Content-Type': 'image/webp' },
      });
    if (path.endsWith('/approve') && path.startsWith('/task-completions/')) {
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
    if (path === '/reward-requests') return success(state.requests);
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
  setAccessToken(null);
});
afterEach(() => {
  vi.unstubAllGlobals();
});

describe('Quest and reward workflows', () => {
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

  it('requires a photo and preserves operationId when a failed submission is retried', async () => {
    const { state, fetchMock } = mockWorkflows({ failFirstSubmit: true });
    const user = userEvent.setup();
    renderWorkflow('/child/adventure');
    await user.click(await screen.findByRole('button', { name: uk.completeTask }));
    await user.click(screen.getByRole('button', { name: uk.submitTask }));
    expect(await screen.findByText(uk.photoRequiredError)).toBeInTheDocument();
    await user.upload(
      screen.getByLabelText(/Фото виконання/),
      new File(['test-image'], 'room.jpg', { type: 'image/jpeg' }),
    );
    await user.click(screen.getByRole('button', { name: uk.submitTask }));
    expect(await screen.findByText(uk.genericError)).toBeInTheDocument();
    await user.click(screen.getByRole('button', { name: uk.submitTask }));
    expect(await screen.findByText(uk.taskStates.SUBMITTED)).toBeInTheDocument();
    expect(state.balance).toBe(0);
    const calls = fetchMock.mock.calls.filter(([url]) => String(url).endsWith('/submit'));
    expect(calls).toHaveLength(2);
    const first = calls[0]![1]!.body as FormData;
    const second = calls[1]![1]!.body as FormData;
    expect(first.get('operationId')).toBe(second.get('operationId'));
    expect(first.getAll('photos')).toHaveLength(1);
  });

  it('loads multiple private photos with authorization and approves a submitted quest', async () => {
    const { state, fetchMock } = mockWorkflows({ role: 'PARENT', pendingCompletion: true });
    const user = userEvent.setup();
    renderWorkflow('/parent');
    const heading = await screen.findByRole('heading', { name: uk.taskReview });
    const panel = heading.closest('section')!;
    await user.click(await within(panel).findByRole('button', { name: /Переглянути фото/ }));
    expect(await within(panel).findAllByRole('img')).toHaveLength(2);
    const photoCall = fetchMock.mock.calls.find(([url]) => String(url).includes('/task-photos/'))!;
    expect(new Headers(photoCall[1]?.headers).get('Authorization')).toBe('Bearer workflow-access');
    await user.click(within(panel).getByRole('button', { name: uk.approve }));
    expect(await screen.findByText(uk.approvedPoints(20))).toBeInTheDocument();
    expect(state.balance).toBe(20);
    expect(state.completions[0]!.status).toBe('APPROVED');
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
    const { state } = mockWorkflows({ role: 'PARENT', balance: 100, initialRewardRequest: true });
    const user = userEvent.setup();
    renderWorkflow('/parent/rewards');
    await user.click(await screen.findByRole('button', { name: uk.approve }));
    expect(await screen.findByText(uk.rewardApproved)).toBeInTheDocument();
    expect(state.balance).toBe(50);
    await user.click(screen.getByRole('button', { name: uk.issueReward }));
    expect(await screen.findByText(uk.rewardIssued)).toBeInTheDocument();
    expect(state.requests[0]!.status).toBe('ISSUED');
    expect(state.balance).toBe(50);
  });
});
