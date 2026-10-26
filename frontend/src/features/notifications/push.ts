import type { DeviceDto } from '@kidquest/types';
import type { Messaging } from 'firebase/messaging';
import { api } from '../../services/api';
import { registerServiceWorker } from '../../services/service-worker';
import { uk } from '../../lib/i18n';

export type PushState = 'missing' | 'unsupported' | 'denied' | 'off' | 'active';
const enabledKey = 'kidquest.push.enabled';
const deviceKey = 'kidquest.push.device';
const config = {
  apiKey: import.meta.env.VITE_FIREBASE_API_KEY,
  projectId: import.meta.env.VITE_FIREBASE_PROJECT_ID,
  messagingSenderId: import.meta.env.VITE_FIREBASE_MESSAGING_SENDER_ID,
  appId: import.meta.env.VITE_FIREBASE_APP_ID,
};
const vapidKey = import.meta.env.VITE_FIREBASE_VAPID_KEY;
let owner: string | null = null;
let revision = 0;
let messaging: Messaging | undefined;
let unsubscribe: (() => void) | undefined;
let pending: Promise<void> | undefined;
let tokenRequest: Promise<string> | undefined;
let registrationRequest: AbortController | undefined;
// A slow SDK deletion can finish after logout, but a new subscription always waits for it.
let cleanupBarrier: Promise<unknown> = Promise.resolve();
let receive: (() => void) | undefined;

function stored(key: string) {
  try {
    return localStorage.getItem(key);
  } catch {
    return null;
  }
}
function store(key: string, value?: string) {
  try {
    if (value) localStorage.setItem(key, value);
    else localStorage.removeItem(key);
  } catch {
    /* Push remains optional when local storage is disabled. */
  }
}
export function pushState(): PushState {
  if (!Object.values(config).every(Boolean) || !vapidKey) return 'missing';
  if (
    !window.isSecureContext ||
    !('Notification' in window) ||
    !('serviceWorker' in navigator) ||
    !('PushManager' in window)
  )
    return 'unsupported';
  if (Notification.permission === 'denied') return 'denied';
  return Notification.permission === 'granted' && stored(enabledKey) ? 'active' : 'off';
}
async function sdk() {
  const [appSdk, messageSdk] = await Promise.all([
    import('firebase/app'),
    import('firebase/messaging'),
  ]);
  if (!(await messageSdk.isSupported())) throw new Error('PUSH_UNSUPPORTED');
  messaging ??= messageSdk.getMessaging(
    appSdk.getApps().find((app) => app.name === 'kidquest-push') ||
      appSdk.initializeApp(config, 'kidquest-push'),
  );
  return { messaging, ...messageSdk };
}

async function connect(userId: string, expected: number) {
  await cleanupBarrier.catch(() => undefined);
  if (owner !== userId || revision !== expected) return;
  const runtime = await sdk();
  const sw = await registerServiceWorker();
  // Registration can finish before its worker is activated on the first visit.
  const ready = sw.active ? sw : await navigator.serviceWorker.ready;
  if (owner !== userId || revision !== expected) return;
  const request = runtime.getToken(runtime.messaging, {
    vapidKey,
    serviceWorkerRegistration: ready,
  });
  tokenRequest = request;
  const token = await request.finally(() => {
    if (tokenRequest === request) tokenRequest = undefined;
  });
  if (owner !== userId || revision !== expected) return;
  const controller = new AbortController();
  registrationRequest = controller;
  const device = await api<DeviceDto>('/devices', {
    method: 'POST',
    body: JSON.stringify({ token, name: uk.pushDeviceName }),
    signal: AbortSignal.any([controller.signal, AbortSignal.timeout(5_000)]),
  }).finally(() => {
    if (registrationRequest === controller) registrationRequest = undefined;
  });
  if (owner !== userId || revision !== expected) return;
  store(deviceKey, device.id);
  store(enabledKey, '1');
  unsubscribe?.();
  unsubscribe = runtime.onMessage(runtime.messaging, () => {
    if (owner === userId && revision === expected) receive?.();
  });
}

export function attachPushSession(userId: string, onMessage: () => void): () => void {
  owner = userId;
  receive = onMessage;
  const expected = ++revision;
  if (pushState() === 'active') {
    // Refresh an existing subscription after sign-in/reload without another permission prompt.
    pending = (pending?.catch(() => undefined) || Promise.resolve()).then(() =>
      connect(userId, expected),
    );
    void pending.catch(() => undefined);
  }
  return () => {
    if (revision !== expected) return;
    ++revision;
    owner = null;
    receive = undefined;
    unsubscribe?.();
    unsubscribe = undefined;
  };
}

/** Call only from an explicit button click; no mount or background path requests permission. */
export async function enablePush(userId: string): Promise<PushState> {
  const state = pushState();
  if (state === 'missing' || state === 'unsupported' || state === 'denied') return state;
  const expected = revision;
  const permission =
    Notification.permission === 'granted' ? 'granted' : await Notification.requestPermission();
  if (permission !== 'granted') return permission === 'denied' ? 'denied' : 'off';
  if (owner !== userId || revision !== expected) return 'off';
  pending = (pending?.catch(() => undefined) || Promise.resolve()).then(() =>
    connect(userId, expected),
  );
  await pending;
  return owner === userId && revision === expected ? pushState() : 'off';
}

/** Detach before changing credentials so an old device cannot be carried into another account. */
export async function cleanupPushSession(detach = true): Promise<void> {
  ++revision;
  owner = null;
  receive = undefined;
  unsubscribe?.();
  unsubscribe = undefined;
  const wasEnabled = Boolean(stored(enabledKey));
  store(enabledKey);
  registrationRequest?.abort();
  const id = stored(deviceKey);
  store(deviceKey);
  const jobs: Promise<unknown>[] = [];
  // Start this request before the caller replaces its access token. On auth loss no API is used.
  if (detach && id)
    jobs.push(
      api(`/devices/${encodeURIComponent(id)}`, {
        method: 'DELETE',
        signal: AbortSignal.timeout(3_000),
      }),
    );
  const previousCleanup = cleanupBarrier;
  const previousToken = tokenRequest;
  if (messaging || wasEnabled || previousToken) {
    cleanupBarrier = previousCleanup
      .catch(() => undefined)
      .then(async () => {
        await previousToken?.catch(() => undefined);
        const runtime = await sdk();
        await runtime.deleteToken(runtime.messaging);
      });
    jobs.push(cleanupBarrier);
  }
  if ('serviceWorker' in navigator)
    jobs.push(
      navigator.serviceWorker.getRegistration('/').then(async (sw) => {
        const notifications = await sw?.getNotifications();
        notifications?.forEach((notification) => notification.close());
      }),
    );
  // Logout stays usable even if Firebase is offline. Subsequent connects still wait for
  // the actual SDK cleanup barrier so an old deletion cannot revoke a new account's token.
  await new Promise<void>((resolve) => {
    const timeout = setTimeout(resolve, 4_000);
    void Promise.allSettled(jobs).then(() => {
      clearTimeout(timeout);
      resolve();
    });
  });
}

export async function disablePush(): Promise<void> {
  const currentOwner = owner;
  const currentReceiver = receive;
  await cleanupPushSession();
  if (currentOwner && currentReceiver) attachPushSession(currentOwner, currentReceiver);
}
