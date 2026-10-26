import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { MemoryRouter } from 'react-router-dom';
import { afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import type { AuthSession, DashboardData, PublicUser } from '@kidquest/types';
import { AuthProvider } from '../app/providers/AuthProvider';
import { ThemeProvider } from '../app/providers/ThemeProvider';
import { Router } from '../app/router/Router';
import { resetApiSession } from '../services/api';
import { uk } from '../lib/i18n';

const parent: PublicUser = {
  id: 'parent-1',
  familyId: 'family-1',
  email: 'olena@example.test',
  firstName: 'Олена',
  lastName: null,
  role: 'PARENT',
};
const child: PublicUser = {
  ...parent,
  id: 'child-user-1',
  email: 'bohdan@example.test',
  firstName: 'Богдан',
  role: 'CHILD',
};
const dashboard: DashboardData = {
  family: { id: 'family-1', name: 'Родина Петренків', timeZone: 'Europe/Kyiv' },
  child: { id: 'child-1', firstName: 'Богдан' },
  counts: {
    children: 1,
    activeTasks: 4,
    activeRewards: 1,
    pendingCompletions: 2,
    pendingRewards: 1,
  },
  balance: 235,
  tasks: [
    {
      id: 'task-1',
      title: 'Застелити постіль',
      description: 'Після пробудження',
      points: 10,
      photoRequired: true,
      category: 'Дім',
    },
  ],
  rewards: [
    { id: 'reward-1', title: 'Похід у парк', description: null, cost: 50, type: 'ACTIVITY' },
  ],
  today: { approved: 1, total: 4 },
  streak: null,
};

function response(data: unknown, status = 200) {
  return new Response(
    JSON.stringify(
      status >= 400
        ? { success: false, error: { code: 'TEST_ERROR', message: data } }
        : { success: true, data },
    ),
    { status, headers: { 'Content-Type': 'application/json' } },
  );
}

function mockServer({
  sessionUser = null,
  failLogin = false,
  failStatisticsOnce = false,
}: { sessionUser?: PublicUser | null; failLogin?: boolean; failStatisticsOnce?: boolean } = {}) {
  let statisticsAttempts = 0;
  const members = [parent, child];
  const fetchMock = vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
    const url = String(input).split('?')[0]!;
    if (url.endsWith('/auth/refresh'))
      return sessionUser
        ? response({ user: sessionUser, accessToken: 'restored-access' } satisfies AuthSession)
        : response('Немає сесії', 401);
    if (url.endsWith('/auth/login') || url.endsWith('/auth/register')) {
      if (failLogin) return response('Неправильна електронна пошта або пароль.', 401);
      return response({ user: parent, accessToken: 'signed-in-access' } satisfies AuthSession);
    }
    if (url.endsWith('/auth/logout')) return response(null);
    if (
      url.endsWith('/task-completions') ||
      url.endsWith('/reward-requests') ||
      url.endsWith('/points/history')
    )
      return response([]);
    if (url.endsWith('/tasks'))
      return response(
        dashboard.tasks.map((task) => ({
          ...task,
          description: task.description || '',
          categoryId: 'category-1',
          category: {
            id: 'category-1',
            name: task.category || '',
            icon: 'ListChecks',
            color: 'primary',
          },
          icon: 'ListChecks',
          color: 'primary',
          isRequired: true,
          repeatDaily: true,
          isActive: true,
          startTime: null,
          endTime: null,
          startDate: null,
          endDate: null,
          updatedAt: '2026-10-21T09:00:00Z',
          todayCompletion: null,
        })),
      );
    if (url.endsWith('/statistics')) {
      statisticsAttempts += 1;
      if (failStatisticsOnce && statisticsAttempts === 1)
        return response('Сервер тимчасово недоступний', 503);
      return response(dashboard);
    }
    if (url.endsWith('/family/members')) {
      if (init?.method === 'POST') {
        const body = JSON.parse(String(init.body)) as {
          email: string;
          firstName: string;
          role: 'CHILD' | 'PARENT';
        };
        const member: PublicUser = { ...parent, ...body, id: 'new-member' };
        members.push(member);
        return response(member, 201);
      }
      return response(members);
    }
    throw new Error(`Unexpected request: ${url}`);
  });
  vi.stubGlobal('fetch', fetchMock);
  return fetchMock;
}

function renderApplication(path = '/login') {
  const queryClient = new QueryClient({
    defaultOptions: {
      queries: { retry: false, refetchOnWindowFocus: false },
      mutations: { retry: false },
    },
  });
  return render(
    <QueryClientProvider client={queryClient}>
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
  // Preload production lazy routes so assertions measure UI behavior, not Vite's
  // first transform of the auth/dashboard chunks on a cold test process.
  await Promise.all([import('../pages/auth/AuthPage'), import('../pages/DashboardPage')]);
});

beforeEach(() => {
  resetApiSession();
  localStorage.clear();
  localStorage.clear();
});
afterEach(() => {
  vi.unstubAllGlobals();
});

describe('Ukrainian authentication flow', () => {
  it('validates login locally before contacting the API', async () => {
    const fetchMock = mockServer();
    const user = userEvent.setup();
    renderApplication();
    await user.type(await screen.findByLabelText(uk.email), 'invalid-email');
    await user.click(screen.getByRole('button', { name: uk.login }));
    expect(await screen.findByText('Введіть коректну електронну адресу')).toBeInTheDocument();
    expect(screen.getByText('Введіть пароль')).toBeInTheDocument();
    expect(fetchMock.mock.calls.some(([url]) => String(url).endsWith('/auth/login'))).toBe(false);
  });

  it('establishes the session, sends authenticated API requests and redirects to the parent dashboard', async () => {
    const fetchMock = mockServer();
    const user = userEvent.setup();
    renderApplication();
    await user.type(await screen.findByLabelText(uk.email), parent.email);
    await user.type(screen.getByLabelText(uk.password), 'test-password-only');
    await user.click(screen.getByRole('button', { name: uk.login }));
    expect(await screen.findByRole('heading', { name: /Привіт, Олена!/ })).toBeInTheDocument();
    expect(await screen.findByText(dashboard.tasks[0]!.title)).toBeInTheDocument();
    const login = fetchMock.mock.calls.find(([url]) => String(url).endsWith('/auth/login'))!;
    expect(JSON.parse(String(login[1]?.body))).toEqual({
      email: parent.email,
      password: 'test-password-only',
    });
    const statistics = fetchMock.mock.calls.find(([url]) => String(url).endsWith('/statistics'))!;
    expect(new Headers(statistics[1]?.headers).get('Authorization')).toBe(
      'Bearer signed-in-access',
    );
    expect(localStorage.getItem('accessToken')).toBeNull();
  });

  it('shows a failed login without creating an authenticated session', async () => {
    const fetchMock = mockServer({ failLogin: true });
    const user = userEvent.setup();
    renderApplication();
    await user.type(await screen.findByLabelText(uk.email), parent.email);
    await user.type(screen.getByLabelText(uk.password), 'wrong-password');
    await user.click(screen.getByRole('button', { name: uk.login }));
    expect(await screen.findByRole('alert')).toHaveTextContent(
      'Неправильна електронна пошта або пароль.',
    );
    expect(screen.getByRole('button', { name: uk.login })).toBeEnabled();
    expect(fetchMock.mock.calls.some(([url]) => String(url).endsWith('/statistics'))).toBe(false);
  });

  it('registers the family with validated values and opens the parent dashboard', async () => {
    const fetchMock = mockServer();
    const user = userEvent.setup();
    renderApplication('/register');
    await user.type(await screen.findByLabelText(uk.firstName), 'Олена');
    await user.type(screen.getByLabelText(uk.familyName), 'Петренки');
    await user.type(screen.getByLabelText(uk.email), parent.email);
    await user.type(screen.getByLabelText(/^Пароль/), 'unique-password-for-test');
    await user.click(screen.getByRole('button', { name: uk.register }));
    expect(await screen.findByRole('heading', { name: /Привіт, Олена!/ })).toBeInTheDocument();
    const registration = fetchMock.mock.calls.find(([url]) =>
      String(url).endsWith('/auth/register'),
    )!;
    expect(JSON.parse(String(registration[1]?.body))).toEqual({
      firstName: 'Олена',
      familyName: 'Петренки',
      email: parent.email,
      password: 'unique-password-for-test',
    });
  });
});

describe('Role-specific dashboards', () => {
  it('renders server metrics and allows a parent to add a family member', async () => {
    const fetchMock = mockServer({ sessionUser: parent });
    const user = userEvent.setup();
    renderApplication('/parent');
    expect(await screen.findByText(dashboard.tasks[0]!.title)).toBeInTheDocument();
    expect(screen.getByText(dashboard.rewards[0]!.title)).toBeInTheDocument();
    const balance = screen.getByText(uk.balance).closest('.stat-card')!;
    expect(within(balance as HTMLElement).getByText('235')).toBeInTheDocument();
    const pending = screen.getByText(uk.pending).closest('.stat-card')!;
    expect(within(pending as HTMLElement).getByText('3')).toBeInTheDocument();
    await user.click(screen.getByRole('button', { name: uk.addMember }));
    await user.type(screen.getByLabelText(uk.firstName), 'Марія');
    await user.type(screen.getByLabelText(uk.email), 'maria@example.test');
    await user.type(screen.getByLabelText(/^Пароль/), 'member-password-test');
    await user.click(screen.getByRole('button', { name: uk.memberSubmit }));
    expect(await screen.findByText(uk.memberSuccess)).toBeInTheDocument();
    expect(await screen.findByText('maria@example.test')).toBeInTheDocument();
    const creation = fetchMock.mock.calls.find(
      ([url, init]) => String(url).endsWith('/family/members') && init?.method === 'POST',
    )!;
    expect(JSON.parse(String(creation[1]?.body))).toEqual({
      firstName: 'Марія',
      email: 'maria@example.test',
      password: 'member-password-test',
      role: 'CHILD',
    });
  });

  it('redirects a child away from the parent route and never requests the family members endpoint', async () => {
    const fetchMock = mockServer({ sessionUser: child });
    renderApplication('/parent');
    expect(await screen.findByRole('heading', { name: /Привіт, Богдан!/ })).toBeInTheDocument();
    expect(await screen.findByText(dashboard.tasks[0]!.title)).toBeInTheDocument();
    expect(screen.getByText('25%')).toBeInTheDocument();
    const streak = screen.getByText(uk.streak).closest('.stat-card')!;
    expect(within(streak as HTMLElement).getByText('0')).toBeInTheDocument();
    expect(screen.getByText(uk.streakHint)).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: uk.addMember })).not.toBeInTheDocument();
    expect(screen.queryByText(uk.pending)).not.toBeInTheDocument();
    expect(fetchMock.mock.calls.some(([url]) => String(url).endsWith('/family/members'))).toBe(
      false,
    );
  });

  it('shows an API error and retries successfully on request', async () => {
    const fetchMock = mockServer({ sessionUser: child, failStatisticsOnce: true });
    const user = userEvent.setup();
    renderApplication('/child');
    expect(await screen.findByRole('alert')).toHaveTextContent('Сервер тимчасово недоступний');
    await user.click(screen.getByRole('button', { name: uk.retry }));
    expect(await screen.findByText(dashboard.tasks[0]!.title)).toBeInTheDocument();
    expect(
      fetchMock.mock.calls.filter(([url]) => String(url).endsWith('/statistics')),
    ).toHaveLength(2);
  });

  it('logs out and returns to the login page', async () => {
    const fetchMock = mockServer({ sessionUser: parent });
    const user = userEvent.setup();
    renderApplication('/parent');
    await user.click(await screen.findByRole('button', { name: uk.logout }));
    expect(await screen.findByRole('button', { name: uk.login })).toBeInTheDocument();
    expect(fetchMock.mock.calls.some(([url]) => String(url).endsWith('/auth/logout'))).toBe(true);
  });
});

describe('Theme preference', () => {
  it('persists the chosen theme across remounts', async () => {
    mockServer();
    const user = userEvent.setup();
    const first = renderApplication();
    await user.click(await screen.findByRole('button', { name: uk.dark }));
    await waitFor(() => {
      expect(document.documentElement.dataset.theme).toBe('dark');
    });
    expect(localStorage.getItem('kidquest-theme')).toBe('dark');
    first.unmount();
    renderApplication();
    expect(await screen.findByRole('button', { name: uk.light })).toBeInTheDocument();
    expect(document.documentElement.dataset.theme).toBe('dark');
  });
});
