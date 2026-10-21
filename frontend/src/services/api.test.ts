import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { AuthSession } from '@kidquest/types';
import { uk } from '../lib/i18n';

const session: AuthSession = {
  accessToken: 'access-token-for-service-tests',
  user: {
    id: 'parent-id',
    email: 'parent@example.test',
    firstName: 'Олена',
    lastName: '',
    role: 'PARENT',
    familyId: 'family-id',
  },
};

function success(data: unknown) {
  return new Response(JSON.stringify({ success: true, data }), {
    status: 200,
    headers: { 'Content-Type': 'application/json' },
  });
}

function unauthorized(code = 'UNAUTHENTICATED', message: string = uk.authLost) {
  return new Response(JSON.stringify({ success: false, error: { code, message } }), {
    status: 401,
    headers: { 'Content-Type': 'application/json' },
  });
}

describe('API session handling', () => {
  beforeEach(() => {
    vi.resetModules();
    vi.stubEnv('VITE_API_URL', '/api/v1');
  });

  afterEach(() => {
    vi.unstubAllGlobals();
    vi.unstubAllEnvs();
  });

  it('shares a refresh request between concurrent callers and uses its access token', async () => {
    let completeRefresh!: (response: Response) => void;
    const pending = new Promise<Response>((resolve) => {
      completeRefresh = resolve;
    });
    const fetchMock = vi
      .fn()
      .mockReturnValueOnce(pending)
      .mockResolvedValueOnce(success(session.user));
    vi.stubGlobal('fetch', fetchMock);
    const client = await import('./api');

    const first = client.refreshSession();
    const second = client.refreshSession();
    expect(fetchMock).toHaveBeenCalledTimes(1);
    completeRefresh(success(session));
    await expect(first).resolves.toEqual(session);
    await expect(second).resolves.toEqual(session);

    await client.api('/me');
    expect(fetchMock.mock.calls[1]![0]).toBe('/api/v1/me');
    const options = fetchMock.mock.calls[1]![1] as RequestInit;
    expect(new Headers(options.headers).get('Authorization')).toBe(`Bearer ${session.accessToken}`);
    expect(options.credentials).toBe('include');
  });

  it('renews an expired protected request once and retries with the new access token', async () => {
    const fetchMock = vi
      .fn()
      .mockResolvedValueOnce(unauthorized())
      .mockResolvedValueOnce(success(session))
      .mockResolvedValueOnce(success({ balance: 12 }));
    vi.stubGlobal('fetch', fetchMock);
    const client = await import('./api');
    client.setAccessToken('expired-access-token');

    await expect(client.api('/statistics')).resolves.toEqual({ balance: 12 });
    expect(fetchMock.mock.calls.map((call) => call[0])).toEqual([
      '/api/v1/statistics',
      '/api/v1/auth/refresh',
      '/api/v1/statistics',
    ]);
    const retry = fetchMock.mock.calls[2]![1] as RequestInit;
    expect(new Headers(retry.headers).get('Authorization')).toBe(`Bearer ${session.accessToken}`);
  });

  it('clears the access token and reports auth loss when refresh is rejected', async () => {
    const fetchMock = vi
      .fn()
      .mockResolvedValueOnce(unauthorized())
      .mockResolvedValueOnce(unauthorized())
      .mockResolvedValueOnce(success(session));
    vi.stubGlobal('fetch', fetchMock);
    const client = await import('./api');
    const authLost = vi.fn();
    client.setAccessToken('expired-access-token');
    client.onAuthLost(authLost);

    await expect(client.api('/me')).rejects.toMatchObject({
      status: 401,
      code: 'SESSION_EXPIRED',
      message: uk.authLost,
    });
    expect(authLost).toHaveBeenCalledOnce();
    await client.api('/auth/login', { method: 'POST', body: '{}' });
    const next = fetchMock.mock.calls[2]![1] as RequestInit;
    expect(new Headers(next.headers).has('Authorization')).toBe(false);
  });

  it('does not refresh after rejected login credentials', async () => {
    const fetchMock = vi
      .fn()
      .mockResolvedValueOnce(
        unauthorized('INVALID_CREDENTIALS', 'Неправильна електронна пошта або пароль.'),
      );
    vi.stubGlobal('fetch', fetchMock);
    const client = await import('./api');

    await expect(client.api('/auth/login', { method: 'POST', body: '{}' })).rejects.toMatchObject({
      status: 401,
      code: 'INVALID_CREDENTIALS',
    });
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });

  it('converts browser network errors into a Ukrainian API error', async () => {
    vi.stubGlobal('fetch', vi.fn().mockRejectedValue(new TypeError('Failed to fetch')));
    const client = await import('./api');

    await expect(client.api('/me')).rejects.toMatchObject({
      status: 0,
      code: 'NETWORK_ERROR',
      message: uk.genericError,
    });
  });

  it('allows a new refresh attempt after a failed refresh request', async () => {
    const fetchMock = vi
      .fn()
      .mockRejectedValueOnce(new TypeError('Failed to fetch'))
      .mockResolvedValueOnce(success(session));
    vi.stubGlobal('fetch', fetchMock);
    const client = await import('./api');

    await expect(client.refreshSession()).rejects.toMatchObject({ code: 'NETWORK_ERROR' });
    await expect(client.refreshSession()).resolves.toEqual(session);
    expect(fetchMock).toHaveBeenCalledTimes(2);
  });

  it('lets the browser set the multipart boundary while keeping authenticated photo uploads', async () => {
    const fetchMock = vi.fn().mockResolvedValueOnce(success({ id: 'completion-id' }));
    vi.stubGlobal('fetch', fetchMock);
    const client = await import('./api');
    client.setAccessToken(session.accessToken);
    const form = new FormData();
    form.append('operationId', 'operation-id');
    await client.api('/tasks/task-id/submit', { method: 'POST', body: form });
    const options = fetchMock.mock.calls[0]![1] as RequestInit;
    expect(new Headers(options.headers).has('Content-Type')).toBe(false);
    expect(new Headers(options.headers).get('Authorization')).toBe(`Bearer ${session.accessToken}`);
    expect(options.body).toBe(form);
  });

  it('renews authentication before reading a private photo without putting tokens into its URL', async () => {
    const image = new Blob(['webp-bytes'], { type: 'image/webp' });
    const fetchMock = vi
      .fn()
      .mockResolvedValueOnce(unauthorized())
      .mockResolvedValueOnce(success(session))
      .mockResolvedValueOnce({ ok: true, blob: async () => image });
    vi.stubGlobal('fetch', fetchMock);
    const client = await import('./api');
    client.setAccessToken('expired');
    await expect(client.apiBlob('/task-photos/photo-id')).resolves.toBe(image);
    expect(fetchMock.mock.calls.map((call) => call[0])).toEqual([
      '/api/v1/task-photos/photo-id',
      '/api/v1/auth/refresh',
      '/api/v1/task-photos/photo-id',
    ]);
    const options = fetchMock.mock.calls[2]![1] as RequestInit;
    expect(new Headers(options.headers).get('Authorization')).toBe(`Bearer ${session.accessToken}`);
  });
});
