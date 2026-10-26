import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { MemoryRouter } from 'react-router-dom';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { NotificationDto, PublicUser } from '@kidquest/types';
import { AuthProvider, useAuth } from '../app/providers/AuthProvider';
import { ThemeProvider } from '../app/providers/ThemeProvider';
import NotificationsPage from '../pages/NotificationsPage';
import { resetApiSession } from '../services/api';
import { uk } from '../lib/i18n';

const push = vi.hoisted(() => ({
  state: 'missing',
  attach: vi.fn(),
  cleanup: vi.fn(),
  enable: vi.fn(),
  disable: vi.fn(),
}));
vi.mock('../features/notifications/push', () => ({
  pushState: () => push.state,
  attachPushSession: push.attach,
  cleanupPushSession: push.cleanup,
  enablePush: push.enable,
  disablePush: push.disable,
}));
const child: PublicUser = {
  id: 'child-user',
  familyId: 'family',
  email: 'child@example.test',
  firstName: 'Богдан',
  lastName: null,
  role: 'CHILD',
};
const first: NotificationDto = {
  id: 'notice-1',
  type: 'TASK_APPROVED',
  title: 'Квест підтверджено',
  body: 'Твоє старання принесло 10 балів.',
  path: '/child/adventure',
  readAt: null,
  createdAt: '2026-10-23T10:00:00Z',
};
const second: NotificationDto = {
  ...first,
  id: 'notice-2',
  type: 'REWARD_ISSUED',
  title: 'Нагорода вже чекає',
  body: 'Можна забирати нагороду.',
  path: '/child/rewards',
  readAt: '2026-10-23T10:00:00Z',
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
  empty = false,
  failOnce = false,
  pushConfigured = false,
  parent = false,
  unsafePath = false,
} = {}) {
  let items = empty
    ? []
    : [{ ...first, path: unsafePath ? 'https://untrusted.example/' : first.path }];
  let unread = items.length;
  let attempts = 0;
  const mock = vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
    const url = new URL(String(input), 'http://localhost');
    const path = url.pathname.replace('/api/v1', '');
    if (path === '/auth/refresh')
      return response({
        user: { ...child, role: parent ? 'PARENT' : 'CHILD' },
        accessToken: 'notification-access',
      });
    if (path === '/notifications/status') return response({ pushConfigured });
    if (path === '/notifications/read-all') {
      items = items.map((item) => ({ ...item, readAt: '2026-10-23T12:00:00Z' }));
      unread = 0;
      return response({ updated: 1 });
    }
    if (path === '/notifications/notice-1/read') {
      items = items.map((item) => ({ ...item, readAt: '2026-10-23T12:00:00Z' }));
      unread = 0;
      return response(items[0]);
    }
    if (path === '/notifications') {
      const inbox = url.searchParams.get('limit') !== '1';
      if (inbox && failOnce && attempts++ === 0)
        return response('Сповіщення тимчасово недоступні', 503);
      return response({
        items: url.searchParams.get('cursor') ? [second] : items,
        unreadCount: unread,
        nextCursor: !empty && inbox && !url.searchParams.get('cursor') ? 'next-cursor' : null,
      });
    }
    throw new Error(`Unexpected request ${path} ${init?.method || 'GET'}`);
  });
  vi.stubGlobal('fetch', mock);
  return mock;
}
function mount(parent = false) {
  const client = new QueryClient({
    defaultOptions: { queries: { retry: false }, mutations: { retry: false } },
  });
  const result = render(
    <QueryClientProvider client={client}>
      <ThemeProvider>
        <AuthProvider>
          <MemoryRouter
            initialEntries={[parent ? '/parent/notifications' : '/child/notifications']}
          >
            <AuthenticatedInbox />
          </MemoryRouter>
        </AuthProvider>
      </ThemeProvider>
    </QueryClientProvider>,
  );
  return { ...result, client };
}
function AuthenticatedInbox() {
  const { user } = useAuth();
  return user ? <NotificationsPage /> : null;
}
beforeEach(() => {
  vi.clearAllMocks();
  localStorage.clear();
  resetApiSession();
  localStorage.clear();
  push.state = 'missing';
  push.cleanup.mockResolvedValue(undefined);
  push.attach.mockReturnValue(vi.fn());
  push.enable.mockResolvedValue('active');
  push.disable.mockResolvedValue(undefined);
});
afterEach(() => vi.unstubAllGlobals());

describe('Notification inbox', () => {
  it('shows private messages, an unread badge and cursor-based pagination', async () => {
    const requests = mockServer();
    const user = userEvent.setup();
    mount();
    expect(await screen.findByRole('heading', { name: first.title })).toBeInTheDocument();
    expect(screen.getByRole('link', { name: uk.notificationUnread(1) })).toHaveAttribute(
      'href',
      '/child/notifications',
    );
    expect(screen.getByText(first.body)).toBeInTheDocument();
    expect(screen.getByText(uk.pushMissing)).toBeInTheDocument();
    expect(push.enable).not.toHaveBeenCalled();
    await user.click(screen.getByRole('button', { name: uk.notificationsMore }));
    expect(await screen.findByRole('heading', { name: second.title })).toBeInTheDocument();
    expect(screen.getAllByRole('article')).toHaveLength(2);
    expect(requests.mock.calls.some(([url]) => String(url).includes('cursor=next-cursor'))).toBe(
      true,
    );
  });

  it('marks one message read and refreshes both the inbox and bell', async () => {
    const requests = mockServer();
    const user = userEvent.setup();
    mount();
    await user.click(await screen.findByRole('button', { name: uk.notificationRead }));
    await waitFor(() => expect(screen.queryByText(uk.notificationNew)).not.toBeInTheDocument());
    expect(screen.getByRole('link', { name: uk.notifications })).toBeInTheDocument();
    expect(
      requests.mock.calls.some(
        ([url, init]) => String(url).endsWith('/notice-1/read') && init?.method === 'PATCH',
      ),
    ).toBe(true);
    expect(screen.queryByRole('button', { name: uk.notificationReadAll })).not.toBeInTheDocument();
  });

  it('marks the inbox read using the dedicated operation', async () => {
    const requests = mockServer();
    const user = userEvent.setup();
    mount();
    await user.click(await screen.findByRole('button', { name: uk.notificationReadAll }));
    await waitFor(() => expect(screen.queryByText(uk.notificationNew)).not.toBeInTheDocument());
    expect(
      requests.mock.calls.some(
        ([url, init]) => String(url).endsWith('/notifications/read-all') && init?.method === 'POST',
      ),
    ).toBe(true);
  });

  it('keeps notification links in approved application routes', async () => {
    mockServer({ unsafePath: true });
    mount();
    const article = (await screen.findByRole('heading', { name: first.title })).closest('article')!;
    expect(within(article).getByRole('link', { name: uk.notificationOpen })).toHaveAttribute(
      'href',
      '/child/notifications',
    );
  });

  it('shows an empty state and a useful parent bell destination', async () => {
    mockServer({ empty: true, parent: true });
    mount(true);
    expect(await screen.findByRole('heading', { name: uk.notificationsEmpty })).toBeInTheDocument();
    expect(screen.getByRole('link', { name: uk.notifications })).toHaveAttribute(
      'href',
      '/parent/notifications',
    );
    expect(screen.queryByRole('button', { name: uk.notificationsMore })).not.toBeInTheDocument();
  });

  it('retries a failed inbox request without losing the rest of the application', async () => {
    mockServer({ failOnce: true });
    const user = userEvent.setup();
    mount();
    expect(await screen.findByRole('alert')).toHaveTextContent('Сповіщення тимчасово недоступні');
    await user.click(screen.getByRole('button', { name: uk.retry }));
    expect(await screen.findByRole('heading', { name: first.title })).toBeInTheDocument();
  });

  it('enables push only on an explicit click and allows disabling it', async () => {
    push.state = 'off';
    mockServer({ pushConfigured: true });
    const user = userEvent.setup();
    mount();
    const enable = await screen.findByRole('button', { name: uk.pushEnable });
    await waitFor(() => expect(enable).toBeEnabled());
    expect(push.enable).not.toHaveBeenCalled();
    await user.click(enable);
    expect(push.enable).toHaveBeenCalledWith(child.id);
    await user.click(await screen.findByRole('button', { name: uk.pushDisable }));
    expect(push.disable).toHaveBeenCalledTimes(1);
  });

  it('explains blocked permission and keeps the inbox usable', async () => {
    push.state = 'denied';
    mockServer({ pushConfigured: true });
    mount();
    expect(await screen.findByText(uk.pushStates.denied)).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: uk.pushEnable })).not.toBeInTheDocument();
    expect(await screen.findByRole('heading', { name: first.title })).toBeInTheDocument();
  });
});
