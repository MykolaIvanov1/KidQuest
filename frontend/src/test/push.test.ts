import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({
  api: vi.fn(),
  register: vi.fn(),
  getToken: vi.fn(),
  deleteToken: vi.fn(),
  onMessage: vi.fn(),
  supported: vi.fn(),
  initialize: vi.fn(),
}));
vi.mock('../services/api', () => ({ api: mocks.api }));
vi.mock('../services/service-worker', () => ({ registerServiceWorker: mocks.register }));
vi.mock('firebase/app', () => ({
  getApps: () => [],
  initializeApp: mocks.initialize,
}));
vi.mock('firebase/messaging', () => ({
  getMessaging: () => ({}),
  getToken: mocks.getToken,
  deleteToken: mocks.deleteToken,
  onMessage: mocks.onMessage,
  isSupported: mocks.supported,
}));

const enabledKey = 'kidquest.push.enabled';
const deviceKey = 'kidquest.push.device';
const registration = { active: {}, getNotifications: vi.fn() };
const permission = { permission: 'default', requestPermission: vi.fn() };
const close = vi.fn();

async function loadPush() {
  return import('../features/notifications/push');
}

beforeEach(() => {
  vi.resetModules();
  vi.resetAllMocks();
  localStorage.clear();
  for (const name of ['API_KEY', 'PROJECT_ID', 'MESSAGING_SENDER_ID', 'APP_ID', 'VAPID_KEY'])
    vi.stubEnv(`VITE_FIREBASE_${name}`, `public-test-${name}`);
  vi.stubGlobal('isSecureContext', true);
  vi.stubGlobal('Notification', permission);
  vi.stubGlobal('PushManager', function PushManager() {});
  vi.stubGlobal('navigator', {
    serviceWorker: {
      ready: Promise.resolve(registration),
      getRegistration: vi.fn().mockResolvedValue(registration),
    },
  });
  permission.permission = 'default';
  permission.requestPermission.mockImplementation(async () => {
    permission.permission = 'granted';
    return 'granted';
  });
  registration.getNotifications.mockResolvedValue([{ close }]);
  mocks.api.mockResolvedValue({ id: 'device-uuid' });
  mocks.register.mockResolvedValue(registration);
  mocks.getToken.mockResolvedValue('private-fcm-token');
  mocks.deleteToken.mockResolvedValue(true);
  mocks.supported.mockResolvedValue(true);
  mocks.onMessage.mockReturnValue(vi.fn());
});
afterEach(() => {
  vi.useRealTimers();
  vi.unstubAllEnvs();
  vi.unstubAllGlobals();
});

describe('Optional push subscription', () => {
  it('does not load Firebase, register a worker or prompt on a normal session mount', async () => {
    const push = await loadPush();
    push.attachPushSession('child-user', vi.fn());
    await Promise.resolve();
    expect(push.pushState()).toBe('off');
    expect(permission.requestPermission).not.toHaveBeenCalled();
    expect(mocks.initialize).not.toHaveBeenCalled();
    expect(mocks.register).not.toHaveBeenCalled();
    expect(mocks.api).not.toHaveBeenCalled();
  });

  it('keeps an unconfigured installation working without a permission request', async () => {
    vi.stubEnv('VITE_FIREBASE_VAPID_KEY', '');
    const push = await loadPush();
    push.attachPushSession('child-user', vi.fn());
    expect(await push.enablePush('child-user')).toBe('missing');
    expect(permission.requestPermission).not.toHaveBeenCalled();
    expect(mocks.getToken).not.toHaveBeenCalled();
  });

  it('registers the token only after a click and persists no token or user information', async () => {
    const push = await loadPush();
    const receive = vi.fn();
    push.attachPushSession('child-user', receive);
    expect(await push.enablePush('child-user')).toBe('active');
    expect(permission.requestPermission).toHaveBeenCalledTimes(1);
    expect(mocks.getToken).toHaveBeenCalledWith(expect.anything(), {
      vapidKey: 'public-test-VAPID_KEY',
      serviceWorkerRegistration: registration,
    });
    expect(mocks.api).toHaveBeenCalledWith(
      '/devices',
      expect.objectContaining({
        method: 'POST',
        body: JSON.stringify({ token: 'private-fcm-token', name: 'Веббраузер KidQuest' }),
      }),
    );
    expect({ ...localStorage }).toEqual({ [enabledKey]: '1', [deviceKey]: 'device-uuid' });
    mocks.onMessage.mock.calls[0]![1]({ data: { notificationId: 'notice' } });
    expect(receive).toHaveBeenCalledTimes(1);
  });

  it('restores explicit opt-in without another permission prompt', async () => {
    permission.permission = 'granted';
    localStorage.setItem(enabledKey, '1');
    const push = await loadPush();
    push.attachPushSession('child-user', vi.fn());
    await vi.waitFor(() => expect(mocks.api).toHaveBeenCalledTimes(1));
    expect(permission.requestPermission).not.toHaveBeenCalled();
  });

  it('does not reuse a permission dialog opened before a same-user logout and sign-in', async () => {
    let finishPermission!: (value: NotificationPermission) => void;
    permission.requestPermission.mockReturnValueOnce(
      new Promise<NotificationPermission>((resolve) => {
        finishPermission = resolve;
      }),
    );
    const push = await loadPush();
    push.attachPushSession('child-user', vi.fn());
    const enabling = push.enablePush('child-user');
    await push.cleanupPushSession();
    push.attachPushSession('child-user', vi.fn());
    permission.permission = 'granted';
    finishPermission('granted');
    expect(await enabling).toBe('off');
    expect(mocks.getToken).not.toHaveBeenCalled();
    expect(mocks.api).not.toHaveBeenCalled();
  });

  it('never registers after permission is denied or the secure context is unavailable', async () => {
    permission.permission = 'denied';
    const push = await loadPush();
    push.attachPushSession('child-user', vi.fn());
    expect(await push.enablePush('child-user')).toBe('denied');
    vi.stubGlobal('isSecureContext', false);
    expect(push.pushState()).toBe('unsupported');
    expect(mocks.api).not.toHaveBeenCalled();
    expect(permission.requestPermission).not.toHaveBeenCalled();
  });

  it('revokes the device, Firebase token and visible notices before account logout', async () => {
    const push = await loadPush();
    push.attachPushSession('child-user', vi.fn());
    await push.enablePush('child-user');
    const oldCallback = mocks.onMessage.mock.calls[0]![1];
    await push.cleanupPushSession();
    expect(mocks.api).toHaveBeenCalledWith(
      '/devices/device-uuid',
      expect.objectContaining({ method: 'DELETE' }),
    );
    expect(mocks.deleteToken).toHaveBeenCalledTimes(1);
    expect(close).toHaveBeenCalledTimes(1);
    expect(localStorage.getItem(deviceKey)).toBeNull();
    expect(localStorage.getItem(enabledKey)).toBeNull();
    const nextReceiver = vi.fn();
    push.attachPushSession('parent-user', nextReceiver);
    oldCallback({ data: { notificationId: 'old' } });
    expect(nextReceiver).not.toHaveBeenCalled();
  });

  it('does not call the authenticated API during expired-session cleanup', async () => {
    const push = await loadPush();
    push.attachPushSession('child-user', vi.fn());
    await push.enablePush('child-user');
    mocks.api.mockClear();
    await push.cleanupPushSession(false);
    expect(mocks.api).not.toHaveBeenCalled();
    expect(mocks.deleteToken).toHaveBeenCalled();
  });

  it('ignores a token that arrives after logout and keeps a new connect behind old SDK cleanup', async () => {
    let finishToken!: (value: string) => void;
    let finishDelete!: (value: boolean) => void;
    mocks.getToken.mockReturnValueOnce(
      new Promise<string>((resolve) => {
        finishToken = resolve;
      }),
    );
    mocks.deleteToken.mockReturnValueOnce(
      new Promise<boolean>((resolve) => {
        finishDelete = resolve;
      }),
    );
    const push = await loadPush();
    push.attachPushSession('child-user', vi.fn());
    const enabling = push.enablePush('child-user');
    await vi.waitFor(() => expect(mocks.getToken).toHaveBeenCalledTimes(1));
    vi.useFakeTimers();
    const cleaning = push.cleanupPushSession();
    await vi.advanceTimersByTimeAsync(4_000);
    await cleaning;
    push.attachPushSession('parent-user', vi.fn());
    const next = push.enablePush('parent-user');
    finishToken('late-old-token');
    await vi.advanceTimersByTimeAsync(0);
    expect(mocks.api).not.toHaveBeenCalled();
    expect(mocks.getToken).toHaveBeenCalledTimes(1);
    finishDelete(true);
    await next;
    await enabling;
    expect(mocks.api).toHaveBeenCalledTimes(1);
    expect(JSON.parse(mocks.api.mock.calls[0]![1].body).token).toBe('private-fcm-token');
  });
});
