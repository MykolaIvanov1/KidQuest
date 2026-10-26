import type { ApiResponse, AuthSession } from '@kidquest/types';
import { uk } from '../lib/i18n';

let accessToken: string | null = null;
let identity: string | null = null;
let epoch = 0;
let refreshFlight: { epoch: number; promise: Promise<AuthSession> } | null = null;
let authLost: (() => void) | undefined;
const base = import.meta.env.VITE_API_URL || '/api/v1';
let connectionHealthy = true;
const connectionListeners = new Set<(connected: boolean) => void>();
function connection(connected: boolean) {
  if (connectionHealthy === connected) return;
  connectionHealthy = connected;
  for (const listener of connectionListeners) listener(connected);
}
export const serverConnection = () => connectionHealthy;
export function onConnectionStatus(listener: (connected: boolean) => void) {
  connectionListeners.add(listener);
  listener(connectionHealthy);
  return () => {
    connectionListeners.delete(listener);
  };
}
export class ApiError extends Error {
  constructor(
    public status: number,
    public code: string,
    message: string,
  ) {
    super(message);
  }
}
export const setAccessToken = (token: string | null) => {
  accessToken = token;
};
export const onAuthLost = (handler: () => void) => {
  authLost = handler;
};
export function resetApiSession() {
  epoch += 1;
  accessToken = null;
  identity = null;
  refreshFlight = null;
}
export function setApiIdentity(userId: string) {
  identity = userId;
}
export const isConnectionFailure = (error: unknown) =>
  error instanceof ApiError && (error.status === 0 || error.status >= 500 || error.status === 429);
const changedSession = () => new ApiError(409, 'SESSION_CHANGED', uk.authLost);
const expired = () => {
  resetApiSession();
  authLost?.();
  return new ApiError(401, 'SESSION_EXPIRED', uk.authLost);
};

async function request<T>(path: string, init: RequestInit = {}): Promise<T> {
  const started = epoch;
  const headers = new Headers(init.headers);
  if (init.body && !(init.body instanceof FormData))
    headers.set('Content-Type', 'application/json');
  if (accessToken) headers.set('Authorization', `Bearer ${accessToken}`);
  let response: Response;
  try {
    response = await fetch(`${base}${path}`, { ...init, headers, credentials: 'include' });
  } catch {
    if (started !== epoch) throw changedSession();
    // Closing a panel cancels its request without changing the connection state.
    if (!init.signal?.aborted) connection(false);
    throw new ApiError(
      0,
      init.signal?.aborted ? 'REQUEST_CANCELLED' : 'NETWORK_ERROR',
      uk.genericError,
    );
  }
  const body = (await response.json().catch(() => null)) as ApiResponse<T> | null;
  if (started !== epoch) throw changedSession();
  connection(response.status < 500 && response.status !== 429 && body !== null);
  if (!body || !response.ok || !body.success) {
    const failure =
      body && !body.success ? body.error : { code: 'NETWORK_ERROR', message: uk.genericError };
    throw new ApiError(response.status, failure.code, failure.message);
  }
  return body.data;
}
export async function refreshSession(): Promise<AuthSession> {
  const started = epoch;
  if (!refreshFlight || refreshFlight.epoch !== started) {
    const expectedIdentity = identity;
    const promise = request<AuthSession>('/auth/refresh', { method: 'POST' })
      .then((session) => {
        if (started !== epoch) throw changedSession();
        if (expectedIdentity && session.user.id !== expectedIdentity)
          throw new ApiError(401, 'SESSION_CHANGED', uk.authLost);
        setAccessToken(session.accessToken);
        return session;
      })
      .finally(() => {
        if (refreshFlight?.promise === promise) refreshFlight = null;
      });
    refreshFlight = { epoch: started, promise };
  }
  return refreshFlight.promise;
}
async function renewOrFail(error: unknown, expectedEpoch: number) {
  try {
    await refreshSession();
  } catch (failure) {
    if (expectedEpoch !== epoch) throw changedSession();
    if (failure instanceof ApiError && (failure.status === 401 || failure.status === 403))
      throw expired();
    throw failure;
  }
  if (error instanceof ApiError && error.code === 'SESSION_CHANGED') throw error;
}
export async function api<T>(path: string, init: RequestInit = {}): Promise<T> {
  const started = epoch;
  const version = currentAuthVersion();
  try {
    return await request<T>(path, init);
  } catch (error) {
    if (!(error instanceof ApiError) || error.status !== 401 || path.startsWith('/auth/'))
      throw error;
    await renewOrFail(error, started);
    if (started !== epoch) throw changedSession();
    if (version !== null && currentAuthVersion() !== version) throw expired();
    return request<T>(path, init);
  }
}
export async function apiBlob(path: string): Promise<Blob> {
  const started = epoch;
  const version = currentAuthVersion();
  const read = async () => {
    let response: Response;
    try {
      response = await fetch(`${base}${path}`, {
        headers: accessToken ? { Authorization: `Bearer ${accessToken}` } : {},
        credentials: 'include',
      });
    } catch {
      if (started !== epoch) throw changedSession();
      connection(false);
      throw new ApiError(0, 'NETWORK_ERROR', uk.genericError);
    }
    if (started !== epoch) throw changedSession();
    connection(response.status < 500 && response.status !== 429);
    if (!response.ok) {
      const body = (await response.json().catch(() => null)) as ApiResponse<unknown> | null;
      if (started !== epoch) throw changedSession();
      throw new ApiError(
        response.status,
        body && !body.success ? body.error.code : 'PHOTO_ERROR',
        body && !body.success ? body.error.message : uk.genericError,
      );
    }
    const blob = await response.blob();
    if (started !== epoch) throw changedSession();
    return blob;
  };
  try {
    return await read();
  } catch (error) {
    if (!(error instanceof ApiError) || error.status !== 401) throw error;
    await renewOrFail(error, started);
    if (started !== epoch) throw changedSession();
    if (version !== null && currentAuthVersion() !== version) throw expired();
    return read();
  }
}

export function currentAuthVersion(): number | null {
  if (!accessToken) return null;
  try {
    const payload = JSON.parse(
      atob(accessToken.split('.')[1]!.replace(/-/g, '+').replace(/_/g, '/')),
    ) as { ver?: unknown };
    if (payload.ver === undefined) return 0;
    return typeof payload.ver === 'number' && Number.isSafeInteger(payload.ver) && payload.ver >= 0
      ? payload.ver
      : null;
  } catch {
    return null;
  }
}
export const expireApiSession = expired;

export function isApiSession(userId: string, authVersion: number) {
  return identity === userId && currentAuthVersion() === authVersion;
}
