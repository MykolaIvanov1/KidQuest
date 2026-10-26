import type { App } from 'firebase-admin/app';
import type { FirebaseConfiguration, PushMessage, PushSender } from './notification.types.js';
import { safeNotificationPath } from './notification.validation.js';

/** The SDK is only imported/initialized when a configured worker actually sends a message. */
export class FirebasePushSender implements PushSender {
  private app: Promise<App> | undefined;

  constructor(private configuration: FirebaseConfiguration) {}

  async send(message: PushMessage): Promise<void> {
    if (!this.app) {
      this.app = this.initialize().catch((error: unknown) => {
        this.app = undefined;
        throw error;
      });
    }
    const app = await this.app;
    const { getMessaging } = await import('firebase-admin/messaging');
    await getMessaging(app).send({
      token: message.token,
      // A worker shows generic text; private titles/bodies stay in the authenticated inbox.
      // Data-only delivery also avoids duplicate OS notifications from the Firebase SDK.
      data: {
        notificationId: message.notificationId,
        path: safeNotificationPath(message.path),
      },
      webpush: { headers: { TTL: '86400', Urgency: 'normal' } },
    });
  }

  async close(): Promise<void> {
    if (this.app) {
      const app = await this.app;
      const { deleteApp } = await import('firebase-admin/app');
      await deleteApp(app);
      this.app = undefined;
    }
  }

  private async initialize(): Promise<App> {
    const { cert, initializeApp } = await import('firebase-admin/app');
    const { randomUUID } = await import('node:crypto');
    return initializeApp(
      { credential: cert(this.configuration), projectId: this.configuration.projectId },
      `kidquest-push-${randomUUID()}`,
    );
  }
}

// Never propagate provider messages, raw errors, tokens or key material to logs/the database.
const providerCodes = new Set([
  'messaging/registration-token-not-registered',
  'messaging/invalid-registration-token',
  'messaging/invalid-argument',
  'messaging/invalid-payload',
  'messaging/payload-size-limit-exceeded',
  'messaging/invalid-data-payload-key',
  'messaging/mismatched-credential',
  'messaging/authentication-error',
  'messaging/invalid-package-name',
  'messaging/too-many-topics',
  'messaging/device-message-rate-exceeded',
  'messaging/message-rate-exceeded',
  'messaging/topics-message-rate-exceeded',
  'messaging/quota-exceeded',
  'messaging/server-unavailable',
  'messaging/internal-error',
  'messaging/unknown-error',
  'app/network-error',
  'app/network-timeout',
  'app/invalid-credential',
]);
const permanentCodes = new Set([
  'messaging/invalid-argument',
  'messaging/invalid-payload',
  'messaging/payload-size-limit-exceeded',
  'messaging/invalid-data-payload-key',
  'messaging/mismatched-credential',
  'messaging/authentication-error',
  'messaging/invalid-package-name',
  'messaging/too-many-topics',
  'app/invalid-credential',
]);

export function pushFailure(error: unknown) {
  const value = error && typeof error === 'object' && 'code' in error ? error.code : undefined;
  const code =
    typeof value === 'string' && providerCodes.has(value) ? value : 'messaging/unknown-error';
  const invalidToken =
    code === 'messaging/registration-token-not-registered' ||
    code === 'messaging/invalid-registration-token';
  return { code, invalidToken, retryable: !invalidToken && !permanentCodes.has(code) };
}

export function pushRetryDelay(attempts: number): number {
  // FCM quotas require at least a minute before retrying. Bound the exponent for corrupt input.
  return Math.min(3_600_000, 60_000 * 2 ** Math.max(0, Math.min(10, attempts - 1)));
}
