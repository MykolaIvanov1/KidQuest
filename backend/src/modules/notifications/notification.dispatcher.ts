import { randomUUID } from 'node:crypto';
import { Prisma, type PrismaClient } from '@prisma/client';
import { logger } from '../../utils/logger.js';
import { pushFailure, pushRetryDelay } from './notification.sender.js';
import type { PushSender } from './notification.types.js';
import { safeNotificationPath } from './notification.validation.js';

interface DispatcherOptions {
  now?: () => Date;
  leaseMs?: number;
  maxAttempts?: number;
}

export class NotificationDispatcher {
  private running = false;
  private now: () => Date;
  private leaseMs: number;
  private maxAttempts: number;

  constructor(
    private db: PrismaClient,
    private sender: PushSender,
    options: DispatcherOptions = {},
  ) {
    this.now = options.now ?? (() => new Date());
    this.leaseMs = options.leaseMs ?? 120_000;
    this.maxAttempts = options.maxAttempts ?? 5;
  }

  async dispatchOnce(limit = 20): Promise<number> {
    if (this.running) return 0;
    this.running = true;
    try {
      const now = this.now();
      await this.db.pushDelivery.updateMany({
        where: {
          status: 'PROCESSING',
          leaseUntil: { lte: now },
          attempts: { gte: this.maxAttempts },
        },
        data: {
          status: 'FAILED',
          leaseToken: null,
          leaseUntil: null,
          lastErrorCode: 'delivery-attempts-exhausted',
        },
      });
      const leaseToken = randomUUID();
      const leaseUntil = new Date(now.getTime() + this.leaseMs);
      const claimed = await this.db.$queryRaw<{ id: string }[]>(Prisma.sql`
        WITH candidates AS (
          SELECT "id" FROM "PushDelivery"
          WHERE "attempts" < ${this.maxAttempts}
            AND (("status" = 'PENDING' AND "nextAttemptAt" <= ${now})
              OR ("status" = 'PROCESSING' AND "leaseUntil" <= ${now}))
          ORDER BY "nextAttemptAt", "createdAt", "id"
          FOR UPDATE SKIP LOCKED
          LIMIT ${Math.max(1, Math.min(100, limit))}
        )
        UPDATE "PushDelivery" delivery SET
          "status" = 'PROCESSING', "attempts" = delivery."attempts" + 1,
          "leaseToken" = ${leaseToken}::uuid, "leaseUntil" = ${leaseUntil}, "updatedAt" = ${now}
        FROM candidates WHERE delivery."id" = candidates."id"
        RETURNING delivery."id"
      `);
      // Bound concurrency to avoid a slow device delaying all other leases in a batch.
      const results = await Promise.allSettled(
        claimed.map((delivery) => this.deliver(delivery.id, leaseToken)),
      );
      // Do not release the process-local guard while other sends still use their leases.
      if (results.some((result) => result.status === 'rejected')) {
        logger.error('notifications.delivery.persistence.failed');
      }
      return claimed.length;
    } finally {
      this.running = false;
    }
  }

  private async deliver(id: string, leaseToken: string): Promise<void> {
    const row = await this.db.pushDelivery.findFirst({
      where: { id, status: 'PROCESSING', leaseToken },
      include: {
        device: true,
        notification: { include: { user: { include: { family: true, child: true } } } },
      },
    });
    if (!row) return;
    const user = row.notification.user;
    if (
      row.notification.deletedAt ||
      user.deletedAt ||
      !user.isActive ||
      user.family.deletedAt ||
      (user.role === 'CHILD' && (!user.child || user.child.deletedAt)) ||
      row.device.deletedAt ||
      row.device.userId !== user.id ||
      row.device.bindingVersion !== row.deviceVersion
    ) {
      await this.finish(id, leaseToken, {
        status: 'CANCELLED',
        lastErrorCode: 'recipient-unavailable',
      });
      return;
    }
    const heartbeat = setInterval(
      () => {
        void this.db.pushDelivery
          .updateMany({
            where: { id, status: 'PROCESSING', leaseToken },
            data: { leaseUntil: new Date(this.now().getTime() + this.leaseMs) },
          })
          .catch(() => logger.warn('notifications.lease.failed', { deliveryId: id }));
      },
      Math.max(1_000, Math.floor(this.leaseMs / 3)),
    );
    heartbeat.unref();
    try {
      const data = row.notification.data;
      const path = safeNotificationPath(
        data && typeof data === 'object' && !Array.isArray(data) ? data.path : undefined,
        user.role === 'PARENT' ? '/parent' : '/child',
      );
      await this.sender.send({
        token: row.device.token,
        notificationId: row.notification.id,
        title: row.notification.title,
        body: row.notification.body,
        path,
      });
      await this.finish(id, leaseToken, {
        status: 'SENT',
        sentAt: this.now(),
        lastErrorCode: null,
      });
    } catch (error: unknown) {
      const failure = pushFailure(error);
      if (failure.invalidToken) {
        await this.db.$transaction(async (tx) => {
          const finished = await tx.pushDelivery.updateMany({
            where: { id, status: 'PROCESSING', leaseToken },
            data: {
              status: 'FAILED',
              leaseToken: null,
              leaseUntil: null,
              lastErrorCode: failure.code,
            },
          });
          // A stale worker must never deactivate a device that has since changed owners.
          if (finished.count === 0) return;
          const revoked = await tx.device.updateMany({
            where: {
              id: row.deviceId,
              userId: user.id,
              bindingVersion: row.deviceVersion,
              deletedAt: null,
            },
            data: { deletedAt: this.now(), bindingVersion: { increment: 1 } },
          });
          if (revoked.count === 0) return;
          await tx.pushDelivery.updateMany({
            where: { deviceId: row.deviceId, status: { in: ['PENDING', 'PROCESSING'] } },
            data: {
              status: 'CANCELLED',
              leaseToken: null,
              leaseUntil: null,
              lastErrorCode: 'device-token-invalid',
            },
          });
        });
      } else {
        const retry = failure.retryable && row.attempts < this.maxAttempts;
        await this.finish(id, leaseToken, {
          status: retry ? 'PENDING' : 'FAILED',
          nextAttemptAt: new Date(this.now().getTime() + pushRetryDelay(row.attempts)),
          lastErrorCode: failure.code,
        });
      }
      logger.warn('notifications.delivery.failed', { deliveryId: id, code: failure.code });
    } finally {
      clearInterval(heartbeat);
    }
  }

  private finish(id: string, leaseToken: string, data: Prisma.PushDeliveryUpdateManyMutationInput) {
    return this.db.pushDelivery.updateMany({
      where: { id, status: 'PROCESSING', leaseToken },
      data: { ...data, leaseToken: null, leaseUntil: null },
    });
  }
}

export function startNotificationDispatcher(db: PrismaClient, sender: PushSender) {
  const dispatcher = new NotificationDispatcher(db, sender);
  let work: Promise<unknown> = Promise.resolve();
  let stopped = false;
  let inFlight = false;
  const tick = () => {
    if (stopped || inFlight) return;
    inFlight = true;
    work = dispatcher
      .dispatchOnce()
      .catch(() => logger.error('notifications.dispatch.failed'))
      .finally(() => {
        inFlight = false;
      });
  };
  const interval = setInterval(tick, 5_000);
  interval.unref();
  tick();
  return async () => {
    stopped = true;
    clearInterval(interval);
    await work;
  };
}
