import 'fake-indexeddb/auto';
import { QueryClient, QueryClientProvider, onlineManager } from '@tanstack/react-query';
import { act, cleanup, render, screen, waitFor } from '@testing-library/react';
import type { PublicUser } from '@kidquest/types';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { AuthProvider, useAuth } from '../app/providers/AuthProvider';
import { offlineStore } from '../features/offline/store';
import { expireApiSession, resetApiSession } from '../services/api';

vi.mock('../features/notifications/push', () => ({
  attachPushSession: () => () => undefined,
  cleanupPushSession: async () => undefined,
}));
const child: PublicUser = {
  id: 'race-child',
  email: 'race-child@example.test',
  firstName: 'Богдан',
  lastName: null,
  role: 'CHILD',
  familyId: 'race-family',
};
const token = `e30.${btoa(JSON.stringify({ ver: 0, sub: child.id }))}.test-signature`;
function response(data: unknown) {
  return new Response(JSON.stringify({ success: true, data }), {
    headers: { 'Content-Type': 'application/json' },
  });
}
let auth: ReturnType<typeof useAuth>;
let client: QueryClient;
function Probe() {
  auth = useAuth();
  return (
    <output aria-label="auth-state">
      {auth.loading ? 'loading' : auth.user?.id || 'signed-out'}
    </output>
  );
}
async function mount() {
  client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  render(
    <QueryClientProvider client={client}>
      <AuthProvider>
        <Probe />
      </AuthProvider>
    </QueryClientProvider>,
  );
  await waitFor(() => expect(screen.getByLabelText('auth-state')).toHaveTextContent(child.id));
  await waitFor(() => expect(auth.loading).toBe(false));
}
beforeEach(async () => {
  resetApiSession();
  localStorage.clear();
  await offlineStore.clear();
  Object.defineProperty(navigator, 'onLine', { configurable: true, value: true });
  onlineManager.setOnline(true);
});
afterEach(async () => {
  cleanup();
  client?.clear();
  resetApiSession();
  await offlineStore.clear();
  localStorage.clear();
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
});

function mockServer(logout: () => Promise<Response>) {
  const fetchMock = vi.fn(async (url: RequestInfo | URL) => {
    const path = String(url);
    if (path.endsWith('/auth/refresh')) return response({ user: child, accessToken: token });
    if (path.endsWith('/auth/logout')) return logout();
    if (path.endsWith('/statistics'))
      return response({
        family: { id: child.familyId, name: 'Тестова сім’я', timeZone: 'Europe/Kyiv' },
      });
    throw new Error(`Unexpected request ${path}`);
  });
  vi.stubGlobal('fetch', fetchMock);
  return fetchMock;
}

describe('Offline auth invalidation during logout', () => {
  it.each(['storage', 'auth-lost'] as const)(
    'leaves the loading screen when %s invalidates a pending logout generation',
    async (source) => {
      let release!: (value: Response) => void;
      const delayed = new Promise<Response>((resolve) => {
        release = resolve;
      });
      const fetchMock = mockServer(() => delayed);
      await mount();
      let completed!: Promise<unknown>;
      act(() => {
        completed = auth.logout().catch((error: unknown) => error);
      });
      try {
        await waitFor(() =>
          expect(fetchMock.mock.calls.some(([url]) => String(url).endsWith('/auth/logout'))).toBe(
            true,
          ),
        );
        expect(screen.getByLabelText('auth-state')).toHaveTextContent('loading');
        act(() => {
          if (source === 'storage') {
            window.dispatchEvent(
              new StorageEvent('storage', {
                key: 'kidquest:auth-state',
                newValue: JSON.stringify({ userId: 'another-child', nonce: 'other-tab' }),
              }),
            );
          } else {
            expireApiSession();
          }
        });
        // The old logout's finally is intentionally fenced by generation. The
        // invalidation itself must therefore release its loading screen.
        await waitFor(() =>
          expect(screen.getByLabelText('auth-state')).toHaveTextContent('signed-out'),
        );
        expect(auth.loading).toBe(false);
        expect(auth.user).toBeNull();
      } finally {
        await act(async () => {
          release(response(null));
          await completed;
        });
      }
      expect(await completed).toBeUndefined();
      expect(auth.loading).toBe(false);
      expect(screen.getByLabelText('auth-state')).toHaveTextContent('signed-out');
    },
  );

  it('leaves a usable signed-out state when another tab removes the stored owner', async () => {
    mockServer(async () => response(null));
    await mount();
    await act(async () => {
      await offlineStore.markSignedOut();
    });
    await waitFor(() =>
      expect(screen.getByLabelText('auth-state')).toHaveTextContent('signed-out'),
    );
    expect(auth.user).toBeNull();
    expect(auth.loading).toBe(false);
  });
});
