import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { MemoryRouter } from 'react-router-dom';
import { afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import type {
  AchievementsData,
  CalendarDayDto,
  DashboardData,
  ProgressData,
  PublicUser,
} from '@kidquest/types';
import { AuthProvider } from '../app/providers/AuthProvider';
import { ThemeProvider } from '../app/providers/ThemeProvider';
import { Router } from '../app/router/Router';
import { useRefreshFamilyData } from '../features/workflows/common';
import { ProgressCalendar } from '../features/gamification/ProgressCalendar';
import { resetApiSession } from '../services/api';
import { uk } from '../lib/i18n';

const parent: PublicUser = {
  id: 'parent-user',
  familyId: 'family-1',
  firstName: 'Олена',
  lastName: null,
  email: 'parent@example.test',
  role: 'PARENT',
};
const child: PublicUser = { ...parent, id: 'child-user', firstName: 'Богдан', role: 'CHILD' };
const achievements: AchievementsData = {
  child: { id: 'child-1', firstName: 'Богдан' },
  summary: {
    childId: 'child-1',
    timeZone: 'Europe/Kyiv',
    today: '2026-10-22',
    trackingFrom: '2026-10-01',
    streak: 3,
    bestStreak: 5,
    approvedTasks: 12,
    earnedPoints: 125,
    nextAchievement: {
      id: 'tasks-30',
      code: 'TASKS_30',
      title: '30 корисних справ',
      description: 'Виконай 30 квестів із підтвердженням батьків.',
      icon: 'ListChecks',
      type: 'APPROVED_TASKS',
      target: 30,
      progress: 12,
      earnedAt: null,
    },
  },
  achievements: [
    {
      id: 'points-100',
      code: 'POINTS_100',
      title: 'Перші 100 балів',
      description: 'Зароби 100 балів за квести.',
      icon: 'Star',
      type: 'EARNED_POINTS',
      target: 100,
      progress: 125,
      earnedAt: '2026-10-21T21:30:00Z',
    },
    {
      id: 'tasks-30',
      code: 'TASKS_30',
      title: '30 корисних справ',
      description: 'Виконай 30 квестів із підтвердженням батьків.',
      icon: 'ListChecks',
      type: 'APPROVED_TASKS',
      target: 30,
      progress: 12,
      earnedAt: null,
    },
  ],
};
const dashboard: DashboardData = {
  family: { id: 'family-1', name: 'Родина', timeZone: 'Europe/Kyiv' },
  child: achievements.child,
  counts: {
    children: 1,
    activeTasks: 0,
    activeRewards: 0,
    pendingCompletions: 0,
    pendingRewards: 0,
  },
  balance: 25,
  tasks: [],
  rewards: [],
  today: { approved: 0, total: 0 },
  streak: 3,
  gamification: achievements.summary,
};

function progress(month = '2026-10'): ProgressData {
  const daysInMonth = new Date(`${month}-01T12:00:00Z`);
  daysInMonth.setUTCMonth(daysInMonth.getUTCMonth() + 1, 0);
  const days: CalendarDayDto[] = Array.from({ length: daysInMonth.getUTCDate() }, (_, index) => {
    const date = `${month}-${String(index + 1).padStart(2, '0')}`;
    return {
      date,
      status: date > '2026-10-22' ? 'FUTURE' : 'EMPTY',
      expected: 0,
      required: 0,
      approved: 0,
      submitted: 0,
      rejected: 0,
      missed: 0,
      earnedPoints: 0,
      successful: false,
      tasks: [],
    };
  });
  if (month === '2026-10') {
    Object.assign(days[20]!, {
      status: 'PARTIAL',
      expected: 2,
      required: 2,
      approved: 1,
      rejected: 1,
      earnedPoints: 10,
      tasks: [
        {
          taskId: 'task-1',
          completionId: 'completion-1',
          title: 'Застелити постіль',
          isRequired: true,
          status: 'APPROVED',
          points: 10,
        },
        {
          taskId: 'task-2',
          completionId: 'completion-2',
          title: 'Прибрати кімнату',
          isRequired: true,
          status: 'REJECTED',
          points: 15,
        },
      ],
    });
    Object.assign(days[21]!, {
      status: 'PENDING',
      expected: 1,
      required: 1,
      submitted: 1,
      tasks: [
        {
          taskId: 'task-3',
          completionId: 'completion-3',
          title: 'Винести сміття',
          isRequired: true,
          status: 'SUBMITTED',
          points: 10,
        },
      ],
    });
  }
  return {
    child: achievements.child,
    timeZone: 'Europe/Kyiv',
    today: '2026-10-22',
    month,
    trackingFrom: '2026-10-01',
    days,
    summary: {
      approved: month === '2026-10' ? 1 : 0,
      submitted: month === '2026-10' ? 1 : 0,
      rejected: month === '2026-10' ? 1 : 0,
      missed: 0,
      earnedPoints: month === '2026-10' ? 10 : 0,
      successfulDays: 0,
    },
    streak: 3,
    bestStreak: 5,
    lifetimeApprovedTasks: 12,
    lifetimeEarnedPoints: 125,
  };
}

function response(data: unknown, status = 200) {
  return new Response(
    JSON.stringify(
      status >= 400
        ? { success: false, error: { code: 'UNAVAILABLE', message: data } }
        : { success: true, data },
    ),
    {
      status,
      headers: { 'Content-Type': 'application/json' },
    },
  );
}

function mockServer({
  user = child,
  noChild = false,
  failAchievementsOnce = false,
}: { user?: PublicUser; noChild?: boolean; failAchievementsOnce?: boolean } = {}) {
  let achievementAttempts = 0;
  const mock = vi.fn(async (input: RequestInfo | URL) => {
    const url = new URL(String(input), 'http://localhost');
    const path = url.pathname.replace('/api/v1', '');
    if (path === '/auth/refresh') return response({ user, accessToken: 'gamification-access' });
    if (path === '/statistics') return response(dashboard);
    if (path === '/statistics/progress') {
      const data = progress(url.searchParams.get('month') || undefined);
      return response({ ...data, child: noChild ? null : data.child });
    }
    if (path === '/achievements') {
      achievementAttempts += 1;
      if (failAchievementsOnce && achievementAttempts === 1)
        return response('Історія тимчасово недоступна', 503);
      return response({ ...achievements, child: noChild ? null : achievements.child });
    }
    if (path === '/family/members') return response([parent, child]);
    if (['/tasks', '/task-completions', '/reward-requests', '/points/history'].includes(path))
      return response([]);
    throw new Error(`Unexpected request: ${path}`);
  });
  vi.stubGlobal('fetch', mock);
  return mock;
}

function mount(path: string) {
  const client = new QueryClient({
    defaultOptions: { queries: { retry: false, refetchOnWindowFocus: false } },
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
    import('../pages/AchievementsPage'),
    import('../pages/ProgressPage'),
    import('../pages/DashboardPage'),
  ]);
});
beforeEach(() => {
  resetApiSession();
  localStorage.clear();
  localStorage.clear();
});
afterEach(() => {
  vi.unstubAllGlobals();
});

describe('Achievement screens', () => {
  it('shows earned dates in the family timezone and real progress toward locked achievements', async () => {
    mockServer();
    mount('/child/achievements');
    const earned = (await screen.findByRole('heading', { name: 'Перші 100 балів' })).closest(
      'article',
    )!;
    expect(within(earned).getByText(uk.achievementEarned)).toBeInTheDocument();
    expect(within(earned).getByText('100 / 100')).toBeInTheDocument();
    expect(within(earned).getByText(/Отримано 22 жовтня 2026/)).toBeInTheDocument();
    const locked = screen.getByRole('heading', { name: '30 корисних справ' }).closest('article')!;
    expect(within(locked).getByText(uk.achievementLocked)).toBeInTheDocument();
    expect(within(locked).getByRole('progressbar', { name: '30 корисних справ' })).toHaveAttribute(
      'value',
      '12',
    );
    expect(within(locked).getByText('12 / 30')).toBeInTheDocument();
    expect(screen.getByText(uk.achievementsRules)).toBeInTheDocument();
  });

  it('shows a useful parent empty state before a child is added', async () => {
    mockServer({ user: parent, noChild: true });
    mount('/parent/achievements');
    expect(await screen.findByText(uk.noChildProgress)).toBeInTheDocument();
    expect(screen.queryByRole('progressbar')).not.toBeInTheDocument();
    expect(
      within(screen.getByRole('main')).getByRole('link', { name: uk.statistics }),
    ).toHaveAttribute('href', '/parent/statistics');
  });

  it('retries a failed request and replaces the error with achievements', async () => {
    const fetchMock = mockServer({ failAchievementsOnce: true });
    const user = userEvent.setup();
    mount('/child/achievements');
    expect(await screen.findByRole('alert')).toHaveTextContent('Історія тимчасово недоступна');
    await user.click(screen.getByRole('button', { name: uk.retry }));
    expect(await screen.findByRole('heading', { name: 'Перші 100 балів' })).toBeInTheDocument();
    expect(
      fetchMock.mock.calls.filter(([url]) => String(url).endsWith('/achievements')),
    ).toHaveLength(2);
  });

  it('renders the actual streak and nearest achievement on the dashboard', async () => {
    mockServer();
    mount('/child');
    const achievement = (await screen.findByText(uk.nextAchievement)).closest('section')!;
    expect(
      within(achievement).getByRole('heading', { name: '30 корисних справ' }),
    ).toBeInTheDocument();
    expect(within(achievement).getByText('12 / 30')).toBeInTheDocument();
    const streak = screen.getByText(uk.streak).closest('.stat-card')!;
    expect(within(streak as HTMLElement).getByText('3')).toBeInTheDocument();
  });
});

describe('Progress history', () => {
  it('includes actual legacy completions in the displayed total before schedule tracking began', async () => {
    const data = progress();
    data.trackingFrom = '2026-10-22';
    const legacyDay = data.days[20]!;
    Object.assign(legacyDay, {
      status: 'COMPLETE',
      expected: 0,
      required: 0,
      rejected: 0,
      tasks: legacyDay.tasks.filter((task) => task.status === 'APPROVED'),
    });
    const user = userEvent.setup();
    render(<ProgressCalendar data={data} />);
    const day = screen.getByRole('button', {
      name: /21 жовтня 2026.*Виконано.*Підтверджено 1 із 1 квестів/,
    });
    await user.click(day);
    expect(screen.getByText('Підтверджено 1 із 1 квестів')).toBeInTheDocument();
    expect(screen.getByText('Застелити постіль')).toBeInTheDocument();
    expect(screen.queryByText('Підтверджено 1 із 0 квестів')).not.toBeInTheDocument();
  });

  it('selects the family day, shows review states and prevents future day selection', async () => {
    const fetchMock = mockServer();
    const user = userEvent.setup();
    mount('/child/calendar');
    expect(await screen.findByText('Винести сміття')).toBeInTheDocument();
    expect(screen.getByText(uk.calendarTaskStates.SUBMITTED)).toBeInTheDocument();
    const today = screen.getByRole('button', { name: /22 жовтня 2026.*Очікує/ });
    expect(today).toHaveAttribute('aria-current', 'date');
    expect(today).toHaveAttribute('aria-pressed', 'true');
    const yesterday = screen.getByRole('button', { name: /21 жовтня 2026.*Частково/ });
    await user.click(yesterday);
    expect(screen.getByText('Прибрати кімнату')).toBeInTheDocument();
    expect(screen.getByText(uk.calendarTaskStates.REJECTED)).toBeInTheDocument();
    expect(yesterday).toHaveAttribute('aria-pressed', 'true');
    expect(today).toHaveAttribute('aria-pressed', 'false');
    expect(screen.getByRole('button', { name: /23 жовтня 2026.*Майбутній день/ })).toBeDisabled();
    expect(
      screen.getByRole('img', { name: /За місяць підтверджено квестів: 1/ }),
    ).toBeInTheDocument();
    await user.click(screen.getByText(uk.chartTable));
    const table = screen.getByRole('table');
    expect(within(table).getAllByRole('row')).toHaveLength(23);
    const row = within(table).getByText('21 жовт.').closest('tr')!;
    expect(within(row).getByRole('cell', { name: '10' })).toBeInTheDocument();
    expect(fetchMock.mock.calls.some(([url]) => String(url).endsWith('/statistics/progress'))).toBe(
      true,
    );
  });

  it('loads another month from the API and shows days without quests', async () => {
    const fetchMock = mockServer({ user: parent });
    const user = userEvent.setup();
    mount('/parent/statistics');
    const month = await screen.findByLabelText(uk.progressMonth);
    expect(month).toHaveValue('2026-10');
    fireEvent.change(month, { target: { value: '2026-09' } });
    expect(await screen.findByText(uk.noDayTasks)).toBeInTheDocument();
    expect(
      fetchMock.mock.calls.some(([url]) =>
        String(url).endsWith('/statistics/progress?month=2026-09'),
      ),
    ).toBe(true);
    expect(screen.getByLabelText(uk.progressMonth)).toHaveValue('2026-09');
    await user.click(screen.getByRole('button', { name: uk.nextMonth }));
    expect(await screen.findByText('Винести сміття')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: uk.nextMonth })).toBeDisabled();
    expect(screen.getByRole('link', { name: uk.achievements })).toHaveAttribute(
      'href',
      '/parent/achievements',
    );
  });

  it('does not query a future month entered manually', async () => {
    const fetchMock = mockServer();
    mount('/child/calendar');
    const month = await screen.findByLabelText(uk.progressMonth);
    fireEvent.change(month, { target: { value: '2026-11' } });
    expect(month).toHaveValue('2026-10');
    expect(fetchMock.mock.calls.some(([url]) => String(url).includes('month=2026-11'))).toBe(false);
  });

  it('keeps parent statistics protected from a child session', async () => {
    const fetchMock = mockServer();
    mount('/parent/statistics');
    expect(await screen.findByRole('heading', { name: /Привіт, Богдан!/ })).toBeInTheDocument();
    expect(fetchMock.mock.calls.some(([url]) => String(url).includes('/statistics/progress'))).toBe(
      false,
    );
  });

  it('keeps child calendar protected from a parent session', async () => {
    const fetchMock = mockServer({ user: parent });
    mount('/child/calendar');
    expect(await screen.findByRole('heading', { name: /Привіт, Олена!/ })).toBeInTheDocument();
    expect(fetchMock.mock.calls.some(([url]) => String(url).includes('/statistics/progress'))).toBe(
      false,
    );
  });

  it('invalidates achievements and history together with the rest of family data', async () => {
    const client = new QueryClient();
    const invalidate = vi.spyOn(client, 'invalidateQueries');
    function Refresh() {
      const refresh = useRefreshFamilyData();
      return <button onClick={() => void refresh()}>Refresh</button>;
    }
    render(
      <QueryClientProvider client={client}>
        <Refresh />
      </QueryClientProvider>,
    );
    await userEvent.setup().click(screen.getByRole('button', { name: 'Refresh' }));
    await waitFor(() =>
      expect(invalidate.mock.calls.map(([filter]) => filter?.queryKey?.[0])).toEqual(
        expect.arrayContaining(['dashboard', 'tasks', 'achievements', 'calendar', 'progress']),
      ),
    );
    client.clear();
  });
});
