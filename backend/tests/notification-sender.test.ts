import { beforeEach, describe, expect, it, vi } from 'vitest';
import {
  FirebasePushSender,
  pushFailure,
  pushRetryDelay,
} from '../src/modules/notifications/notification.sender.js';
import type { PushMessage } from '../src/modules/notifications/notification.types.js';

const sdk = vi.hoisted(() => ({
  cert: vi.fn(),
  initializeApp: vi.fn(),
  deleteApp: vi.fn(),
  getMessaging: vi.fn(),
  send: vi.fn(),
}));
vi.mock('firebase-admin/app', () => sdk);
vi.mock('firebase-admin/messaging', () => ({ getMessaging: sdk.getMessaging }));

const credentials = {
  projectId: 'kidquest-test',
  clientEmail: 'push@kidquest-test.iam.gserviceaccount.com',
  privateKey: 'not-a-live-test-key',
};
const message: PushMessage = {
  token: 'private-test-device-token',
  notificationId: '87fd915a-d07a-4f08-af7e-eb908acb64a0',
  title: 'Приватна назва квесту',
  body: 'Приватний опис виконання',
  path: '/parent/quests',
};

beforeEach(() => {
  vi.clearAllMocks();
  sdk.cert.mockReturnValue({ projectId: 'kidquest-test' });
  sdk.initializeApp.mockReturnValue({ name: 'test-app' });
  sdk.getMessaging.mockReturnValue({ send: sdk.send });
  sdk.send.mockResolvedValue('provider-message-id');
  sdk.deleteApp.mockResolvedValue(undefined);
});

describe('Firebase push transport', () => {
  it('initializes lazily once for concurrent sends and only sends the safe data payload', async () => {
    const sender = new FirebasePushSender(credentials);
    expect(sdk.initializeApp).not.toHaveBeenCalled();
    await Promise.all([sender.send(message), sender.send(message)]);
    expect(sdk.cert).toHaveBeenCalledExactlyOnceWith(credentials);
    expect(sdk.initializeApp).toHaveBeenCalledTimes(1);
    expect(sdk.send).toHaveBeenCalledTimes(2);
    expect(sdk.send).toHaveBeenCalledWith({
      token: message.token,
      data: { notificationId: message.notificationId, path: message.path },
      webpush: { headers: { TTL: '86400', Urgency: 'normal' } },
    });
    const payload = JSON.stringify(sdk.send.mock.calls[0]);
    expect(payload).not.toContain(message.title);
    expect(payload).not.toContain(message.body);
    expect(payload).not.toContain(credentials.privateKey);
    await sender.close();
    expect(sdk.deleteApp).toHaveBeenCalledExactlyOnceWith({ name: 'test-app' });
  });

  it('rejects external click paths and can recover after initialization fails', async () => {
    const sender = new FirebasePushSender(credentials);
    sdk.initializeApp.mockImplementationOnce(() => {
      throw new Error('invalid test credential');
    });
    await expect(sender.send(message)).rejects.toThrow('invalid test credential');
    await sender.send({ ...message, path: '//outside.example/private' });
    expect(sdk.initializeApp).toHaveBeenCalledTimes(2);
    expect(sdk.send).toHaveBeenCalledWith(
      expect.objectContaining({
        data: { notificationId: message.notificationId, path: '/child' },
      }),
    );
    await sender.close();
  });

  it('does not initialize Firebase when closing a sender that never sent anything', async () => {
    await new FirebasePushSender(credentials).close();
    expect(sdk.initializeApp).not.toHaveBeenCalled();
    expect(sdk.deleteApp).not.toHaveBeenCalled();
  });
});

describe('push delivery failure policy', () => {
  it.each([
    ['messaging/registration-token-not-registered', true, false],
    ['messaging/invalid-registration-token', true, false],
    ['messaging/invalid-argument', false, false],
    ['messaging/mismatched-credential', false, false],
    ['app/invalid-credential', false, false],
    ['messaging/quota-exceeded', false, true],
    ['messaging/server-unavailable', false, true],
    ['app/network-timeout', false, true],
  ])('classifies %s without exposing provider messages', (code, invalidToken, retryable) => {
    expect(pushFailure({ code, message: 'provider message containing a private token' })).toEqual({
      code,
      invalidToken,
      retryable,
    });
  });

  it('replaces unknown provider codes and raw errors with a fixed safe code', () => {
    for (const error of [
      new Error('private token'),
      { code: 'private token' },
      null,
      'private token',
    ]) {
      expect(pushFailure(error)).toEqual({
        code: 'messaging/unknown-error',
        invalidToken: false,
        retryable: true,
      });
    }
  });

  it('backs off for at least a minute and caps exponential retries at one hour', () => {
    expect([0, 1, 2, 3, 100].map(pushRetryDelay)).toEqual([
      60_000, 60_000, 120_000, 240_000, 3_600_000,
    ]);
  });
});
