import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { MemoryRouter } from 'react-router-dom';
import { afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import type { AccountProfileData, LoginLogDto, PublicUser } from '@kidquest/types';
import { AuthProvider } from '../app/providers/AuthProvider';
import { ThemeProvider } from '../app/providers/ThemeProvider';
import { Router } from '../app/router/Router';
import { resetApiSession } from '../services/api';
import { uk } from '../lib/i18n';

const parent: PublicUser = {
  id: 'parent-1',
  familyId: 'family-1',
  firstName: 'Олена',
  lastName: 'Петренко',
  email: 'olena@example.test',
  role: 'PARENT',
};
const child: PublicUser = {
  ...parent,
  id: 'child-1',
  firstName: 'Богдан',
  email: 'bohdan@example.test',
  role: 'CHILD',
};
const profile = (user: PublicUser): AccountProfileData => ({
  user,
  family: { id: 'family-1', name: 'Родина Петренків', timeZone: 'Europe/Kyiv' },
  childId: user.role === 'CHILD' ? 'child-profile-1' : null,
  createdAt: '2026-10-21T21:30:00Z',
});
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
function entry(id: string, success = true): LoginLogDto {
  return {
    id,
    user: child,
    loginAt: '2026-10-21T21:30:00Z',
    ipAddress: '127.0.0.1',
    userAgent: 'Browser test agent',
    device: 'Windows / Chrome',
    success,
  };
}
function mockServer({
  user = parent,
  profileFailure = false,
  mutationError = false,
}: { user?: PublicUser; profileFailure?: boolean; mutationError?: boolean } = {}) {
  let profileAttempts = 0;
  let members = [parent, child];
  const mock = vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
    const url = new URL(String(input), 'http://localhost');
    const path = url.pathname.replace('/api/v1', '');
    if (path === '/auth/refresh') return response({ user, accessToken: 'account-access' });
    if (path === '/account/profile') {
      profileAttempts++;
      if (profileFailure && profileAttempts === 1)
        return response('Профіль тимчасово недоступний', 503);
      return response(profile(user));
    }
    if (path === '/family/members') return response(members);
    if (path === '/notifications/status') return response({ pushConfigured: false });
    if (path === '/notifications') return response({ items: [], nextCursor: null, unreadCount: 0 });
    if (path === '/account/login-journal') {
      if (url.searchParams.has('userId') || url.searchParams.has('success'))
        return response({ items: [], nextCursor: null });
      return response(
        url.searchParams.has('cursor')
          ? { items: [entry('log-2', false)], nextCursor: null }
          : { items: [entry('log-1')], nextCursor: 'next-page' },
      );
    }
    if (/^\/account\/members\/[^/]+\/(email|reset-password|role)$/.test(path)) {
      if (mutationError) return response('Поточний пароль неправильний.', 403);
      const targetId = path.split('/')[3];
      const body = JSON.parse(String(init?.body)) as { email?: string; role?: PublicUser['role'] };
      members = members.map((member) =>
        member.id === targetId
          ? {
              ...member,
              ...(body.email ? { email: body.email } : {}),
              ...(body.role ? { role: body.role } : {}),
            }
          : member,
      );
      return response({ updated: true, reauthenticate: targetId === user.id });
    }
    if (path === '/statistics')
      return response({
        family: profile(user).family,
        child: null,
        counts: {
          children: 1,
          activeTasks: 0,
          activeRewards: 0,
          pendingCompletions: 0,
          pendingRewards: 0,
        },
        tasks: [],
        rewards: [],
        today: { approved: 0, total: 0 },
        balance: 0,
        streak: 0,
      });
    if (['/tasks', '/task-completions', '/reward-requests', '/points/history'].includes(path))
      return response([]);
    throw new Error(`Unexpected request: ${path}`);
  });
  vi.stubGlobal('fetch', mock);
  return mock;
}
function mount(path: string) {
  const client = new QueryClient({
    defaultOptions: {
      queries: { retry: false, refetchOnWindowFocus: false },
      mutations: { retry: false },
    },
  });
  render(
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
  return client;
}
function mutations(mock: ReturnType<typeof mockServer>) {
  return mock.mock.calls.filter(
    ([url, init]) =>
      String(url).includes('/account/members/') && ['POST', 'PATCH'].includes(init?.method || ''),
  );
}
async function selectChild() {
  const picker = await screen.findByLabelText(uk.selectedMember);
  await userEvent.setup().selectOptions(picker, child.id);
}

beforeAll(async () => {
  await Promise.all([
    import('../pages/AccountPage'),
    import('../pages/auth/AuthPage'),
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

describe('Profile and family account settings', () => {
  it('shows a child readonly profile with calendar access and the five specified navigation items', async () => {
    const mock = mockServer({ user: child });
    mount('/child/profile');
    expect(await screen.findByRole('heading', { name: uk.profileDetails })).toBeInTheDocument();
    expect(screen.getByText(child.email)).toBeInTheDocument();
    expect(screen.getByText('22 жовтня 2026 р.')).toBeInTheDocument();
    expect(screen.getByRole('link', { name: uk.viewProgress })).toHaveAttribute(
      'href',
      '/child/calendar',
    );
    expect(screen.getByRole('heading', { name: uk.pushHeading })).toBeInTheDocument();
    expect(screen.queryByRole('form')).not.toBeInTheDocument();
    expect(
      mock.mock.calls.some(
        ([url]) =>
          String(url).includes('/family/members') || String(url).includes('/login-journal'),
      ),
    ).toBe(false);
    const mobileNav = screen.getAllByRole('navigation', { name: uk.home })[1]!;
    expect(within(mobileNav).getAllByRole('link')).toHaveLength(5);
    expect(within(mobileNav).getByRole('link', { name: uk.profile })).toHaveAttribute(
      'aria-current',
      'page',
    );
  });

  it('retries profile loading before displaying account information', async () => {
    mockServer({ user: child, profileFailure: true });
    mount('/child/profile');
    expect(await screen.findByRole('alert')).toHaveTextContent('Профіль тимчасово недоступний');
    await userEvent.setup().click(screen.getByRole('button', { name: uk.retry }));
    expect(await screen.findByRole('heading', { name: uk.profileDetails })).toBeInTheDocument();
  });

  it('reveals child password reset only for a selected child and clears typed credentials when switching accounts', async () => {
    mockServer();
    mount('/parent/settings');
    expect(await screen.findByRole('form', { name: uk.changeEmail })).toBeInTheDocument();
    expect(screen.queryByRole('form', { name: uk.resetChildPassword })).not.toBeInTheDocument();
    const emailForm = screen.getByRole('form', { name: uk.changeEmail });
    await userEvent
      .setup()
      .type(
        within(emailForm).getByLabelText(uk.currentParentPassword),
        'A-private-parent-password',
      );
    await selectChild();
    expect(screen.getByRole('form', { name: uk.resetChildPassword })).toBeInTheDocument();
    expect(
      within(screen.getByRole('form', { name: uk.changeEmail })).getByLabelText(
        uk.currentParentPassword,
      ),
    ).toHaveValue('');
    expect(screen.getByText(uk.roleChangeHint)).toBeInTheDocument();
  });

  it('checks password confirmation, sends only server fields and clears credentials after child reset', async () => {
    const mock = mockServer();
    const client = mount('/parent/settings');
    await selectChild();
    const user = userEvent.setup();
    const form = screen.getByRole('form', { name: uk.resetChildPassword });
    await user.type(within(form).getByLabelText(uk.newChildPassword), 'Child-private-2026');
    await user.type(within(form).getByLabelText(uk.confirmNewPassword), 'Different-2026');
    await user.type(within(form).getByLabelText(uk.currentParentPassword), 'Parent-private-2026');
    await user.click(within(form).getByRole('button', { name: uk.resetChildPassword }));
    expect(await within(form).findByText(uk.passwordConfirmationError)).toBeInTheDocument();
    expect(mutations(mock)).toHaveLength(0);
    await user.clear(within(form).getByLabelText(uk.confirmNewPassword));
    await user.type(within(form).getByLabelText(uk.confirmNewPassword), 'Child-private-2026');
    await user.click(within(form).getByRole('button', { name: uk.resetChildPassword }));
    expect(await within(form).findByText(uk.childPasswordChanged)).toBeInTheDocument();
    expect(JSON.parse(String(mutations(mock)[0]![1]?.body))).toEqual({
      currentPassword: 'Parent-private-2026',
      newPassword: 'Child-private-2026',
    });
    expect(within(form).getByLabelText(uk.newChildPassword)).toHaveValue('');
    expect(within(form).getByLabelText(uk.confirmNewPassword)).toHaveValue('');
    expect(within(form).getByLabelText(uk.currentParentPassword)).toHaveValue('');
    expect(client.getMutationCache().getAll()).toHaveLength(0);
    expect(document.body.textContent).not.toContain('Child-private-2026');
  });

  it('validates email and current password before sending changes', async () => {
    const mock = mockServer();
    mount('/parent/settings');
    await selectChild();
    const user = userEvent.setup();
    const form = screen.getByRole('form', { name: uk.changeEmail });
    await user.clear(within(form).getByLabelText(uk.newEmail));
    await user.type(within(form).getByLabelText(uk.newEmail), 'invalid');
    await user.click(within(form).getByRole('button', { name: uk.changeEmail }));
    expect(await within(form).findByText('Введіть коректну електронну адресу')).toBeInTheDocument();
    expect(within(form).getByText('Введіть поточний пароль')).toBeInTheDocument();
    expect(mutations(mock)).toHaveLength(0);
  });

  it('shows server errors and clears submitted parent credentials without logging out', async () => {
    const mock = mockServer({ mutationError: true });
    mount('/parent/settings');
    await selectChild();
    const user = userEvent.setup();
    const form = screen.getByRole('form', { name: uk.changeEmail });
    await user.clear(within(form).getByLabelText(uk.newEmail));
    await user.type(within(form).getByLabelText(uk.newEmail), 'new@example.test');
    await user.type(within(form).getByLabelText(uk.currentParentPassword), 'wrong-password');
    await user.click(within(form).getByRole('button', { name: uk.changeEmail }));
    expect(await within(form).findByRole('alert')).toHaveTextContent(
      'Поточний пароль неправильний.',
    );
    expect(within(form).getByLabelText(uk.currentParentPassword)).toHaveValue('');
    expect(screen.getByRole('heading', { name: uk.settings })).toBeInTheDocument();
    expect(mock.mock.calls.filter(([url]) => String(url).endsWith('/auth/refresh'))).toHaveLength(
      1,
    );
  });

  it('clears the private session after own email change and requests a fresh login without another auth API call', async () => {
    const mock = mockServer();
    const client = mount('/parent/settings');
    const form = await screen.findByRole('form', { name: uk.changeEmail });
    const user = userEvent.setup();
    await user.clear(within(form).getByLabelText(uk.newEmail));
    await user.type(within(form).getByLabelText(uk.newEmail), 'changed@example.test');
    await user.type(within(form).getByLabelText(uk.currentParentPassword), 'Parent-private-2026');
    await user.click(within(form).getByRole('button', { name: uk.changeEmail }));
    expect(await screen.findByText(uk.accountSignInAgain)).toBeInTheDocument();
    expect(screen.getByRole('button', { name: uk.login })).toBeInTheDocument();
    expect(screen.queryByRole('heading', { name: uk.profileDetails })).not.toBeInTheDocument();
    expect(client.getQueryData(['account-profile', parent.id])).toBeUndefined();
    expect(
      client
        .getQueryCache()
        .getAll()
        .every((query) => query.state.data === undefined),
    ).toBe(true);
    expect(mock.mock.calls.filter(([url]) => String(url).endsWith('/auth/refresh'))).toHaveLength(
      1,
    );
    expect(mock.mock.calls.some(([url]) => String(url).endsWith('/auth/logout'))).toBe(false);
    expect(JSON.parse(String(mutations(mock)[0]![1]?.body))).toEqual({
      email: 'changed@example.test',
      currentPassword: 'Parent-private-2026',
    });
  });

  it('changes a family member role and refreshes the available controls', async () => {
    const mock = mockServer();
    mount('/parent/settings');
    await selectChild();
    const user = userEvent.setup();
    const form = screen.getByRole('form', { name: uk.changeRole });
    expect(within(form).getByRole('button', { name: uk.changeRole })).toBeDisabled();
    await user.selectOptions(within(form).getByLabelText(uk.newRole), 'PARENT');
    await user.type(within(form).getByLabelText(uk.currentParentPassword), 'Parent-private-2026');
    await user.click(within(form).getByRole('button', { name: uk.changeRole }));
    await waitFor(() =>
      expect(screen.queryByRole('form', { name: uk.resetChildPassword })).not.toBeInTheDocument(),
    );
    expect(JSON.parse(String(mutations(mock)[0]![1]?.body))).toEqual({
      role: 'PARENT',
      currentPassword: 'Parent-private-2026',
    });
    expect(screen.getByText(uk.saved)).toBeInTheDocument();
  });

  it('paginates the login journal and resets results when account or status filters change', async () => {
    const mock = mockServer();
    mount('/parent/settings');
    const journal = (await screen.findByRole('heading', { name: uk.loginJournal })).closest(
      'section',
    )!;
    expect(await within(journal).findByText('22 жовт. 2026 р., 00:30')).toBeInTheDocument();
    expect(
      within(journal).getByText(uk.journalSuccess, { selector: 'strong' }),
    ).toBeInTheDocument();
    await userEvent.setup().click(within(journal).getByRole('button', { name: uk.journalMore }));
    expect(
      await within(journal).findByText(uk.journalFailure, { selector: 'strong' }),
    ).toBeInTheDocument();
    expect(within(journal).getAllByRole('listitem')).toHaveLength(2);
    expect(mock.mock.calls.some(([url]) => String(url).includes('cursor=next-page'))).toBe(true);
    fireEvent.change(within(journal).getByLabelText(uk.journalAccount), {
      target: { value: child.id },
    });
    expect(await within(journal).findByText(uk.journalEmpty)).toBeInTheDocument();
    expect(mock.mock.calls.some(([url]) => String(url).endsWith('limit=20&userId=child-1'))).toBe(
      true,
    );
    fireEvent.change(within(journal).getByLabelText(uk.journalResult), {
      target: { value: 'false' },
    });
    await waitFor(() =>
      expect(
        mock.mock.calls.some(([url]) =>
          String(url).endsWith('limit=20&userId=child-1&success=false'),
        ),
      ).toBe(true),
    );
    expect(within(journal).queryByRole('button', { name: uk.journalMore })).not.toBeInTheDocument();
  });

  it('protects parent account settings from a child session', async () => {
    const mock = mockServer({ user: child });
    mount('/parent/settings');
    expect(await screen.findByRole('heading', { name: /Привіт, Богдан!/ })).toBeInTheDocument();
    expect(mock.mock.calls.some(([url]) => String(url).includes('/account/'))).toBe(false);
  });
});
