import type { ApiResponse, AuthSession } from '@kidquest/types';
import { uk } from '../lib/i18n';

let accessToken: string | null = null;
let refreshPromise: Promise<AuthSession> | null = null;
let authLost: (() => void) | undefined;
const base = import.meta.env.VITE_API_URL || '/api/v1';
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

async function request<T>(path: string, init: RequestInit = {}): Promise<T> {
  const headers = new Headers(init.headers);
  if (init.body && !(init.body instanceof FormData))
    headers.set('Content-Type', 'application/json');
  if (accessToken) headers.set('Authorization', `Bearer ${accessToken}`);
  let response: Response;
  try {
    response = await fetch(`${base}${path}`, { ...init, headers, credentials: 'include' });
  } catch {
    throw new ApiError(0, 'NETWORK_ERROR', uk.genericError);
  }
  const body = (await response.json().catch(() => null)) as ApiResponse<T> | null;
  if (!body || !response.ok || !body.success) {
    const failure =
      body && !body.success ? body.error : { code: 'NETWORK_ERROR', message: uk.genericError };
    throw new ApiError(response.status, failure.code, failure.message);
  }
  return body.data;
}
export async function refreshSession(): Promise<AuthSession> {
  if (!refreshPromise) {
    refreshPromise = request<AuthSession>('/auth/refresh', { method: 'POST' })
      .then((session) => {
        setAccessToken(session.accessToken);
        return session;
      })
      .finally(() => {
        refreshPromise = null;
      });
  }
  return refreshPromise;
}
export async function api<T>(path: string, init: RequestInit = {}): Promise<T> {
  try {
    return await request<T>(path, init);
  } catch (error) {
    if (!(error instanceof ApiError) || error.status !== 401 || path.startsWith('/auth/'))
      throw error;
    try {
      await refreshSession();
    } catch {
      setAccessToken(null);
      authLost?.();
      throw new ApiError(401, 'SESSION_EXPIRED', uk.authLost);
    }
    return request<T>(path, init);
  }
}

export async function apiBlob(path: string): Promise<Blob> {
  const read = async () => {
    let response: Response;
    try {
      response = await fetch(`${base}${path}`, {
        headers: accessToken ? { Authorization: `Bearer ${accessToken}` } : {},
        credentials: 'include',
      });
    } catch {
      throw new ApiError(0, 'NETWORK_ERROR', uk.genericError);
    }
    if (!response.ok) {
      const body = (await response.json().catch(() => null)) as ApiResponse<unknown> | null;
      throw new ApiError(
        response.status,
        body && !body.success ? body.error.code : 'PHOTO_ERROR',
        body && !body.success ? body.error.message : uk.genericError,
      );
    }
    return response.blob();
  };
  try {
    return await read();
  } catch (error) {
    if (!(error instanceof ApiError) || error.status !== 401) throw error;
    try {
      await refreshSession();
    } catch {
      setAccessToken(null);
      authLost?.();
      throw new ApiError(401, 'SESSION_EXPIRED', uk.authLost);
    }
    return read();
  }
}
