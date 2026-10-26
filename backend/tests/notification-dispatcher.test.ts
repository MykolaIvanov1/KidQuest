import type { PrismaClient } from '@prisma/client';
import { afterEach, describe, expect, it, vi } from 'vitest';
import {
  NotificationDispatcher,
  startNotificationDispatcher,
} from '../src/modules/notifications/notification.dispatcher.js';
import { logger } from '../src/utils/logger.js';

vi.mock('../src/utils/logger.js', () => ({ logger: { warn: vi.fn(), error: vi.fn() } }));

afterEach(() => {
  vi.useRealTimers();
  vi.restoreAllMocks();
});

describe('push worker lifecycle and lease fencing', () => {
  it('awaits the active send on shutdown even after several scheduled ticks', async () => {
    vi.useFakeTimers();
    let finish!: (count: number) => void;
    const active = new Promise<number>((resolve) => {
      finish = resolve;
    });
    const dispatch = vi
      .spyOn(NotificationDispatcher.prototype, 'dispatchOnce')
      .mockReturnValue(active);
    const stop = startNotificationDispatcher({} as PrismaClient, { send: vi.fn() });
    expect(dispatch).toHaveBeenCalledTimes(1);
    await vi.advanceTimersByTimeAsync(15_000);
    expect(dispatch).toHaveBeenCalledTimes(1);
    let stopped = false;
    const shutdown = stop().then(() => {
      stopped = true;
    });
    await Promise.resolve();
    expect(stopped).toBe(false);
    finish(1);
    await shutdown;
    expect(stopped).toBe(true);
    await vi.advanceTimersByTimeAsync(30_000);
    expect(dispatch).toHaveBeenCalledTimes(1);
  });

  it('never revokes a rebound device after a stale invalid-token result', async () => {
    const updateMany = vi.fn().mockResolvedValue({ count: 0 });
    const revoke = vi.fn();
    const transaction = { pushDelivery: { updateMany }, device: { updateMany: revoke } };
    const db = {
      $queryRaw: vi.fn().mockResolvedValue([{ id: 'delivery-id' }]),
      $transaction: vi.fn(async (work) => work(transaction)),
      pushDelivery: {
        updateMany,
        findFirst: vi.fn().mockResolvedValue({
          id: 'delivery-id',
          deviceId: 'device-id',
          deviceVersion: 1,
          attempts: 1,
          device: {
            deletedAt: null,
            userId: 'recipient',
            bindingVersion: 1,
            token: 'private-device-token',
          },
          notification: {
            id: 'notification-id',
            deletedAt: null,
            title: 'Private title',
            body: 'Private body',
            data: { path: '/parent' },
            user: {
              id: 'recipient',
              role: 'PARENT',
              isActive: true,
              deletedAt: null,
              family: { deletedAt: null },
            },
          },
        }),
      },
    } as unknown as PrismaClient;
    const send = vi.fn().mockRejectedValue({
      code: 'messaging/invalid-registration-token',
      message: 'private-device-token',
    });
    const dispatcher = new NotificationDispatcher(db, { send });
    await expect(dispatcher.dispatchOnce()).resolves.toBe(1);
    expect(send).toHaveBeenCalledOnce();
    expect(revoke).not.toHaveBeenCalled();
    expect(updateMany).toHaveBeenLastCalledWith({
      where: { id: 'delivery-id', status: 'PROCESSING', leaseToken: expect.any(String) },
      data: {
        status: 'FAILED',
        leaseToken: null,
        leaseUntil: null,
        lastErrorCode: 'messaging/invalid-registration-token',
      },
    });
    expect(logger.warn).toHaveBeenCalledWith('notifications.delivery.failed', {
      deliveryId: 'delivery-id',
      code: 'messaging/invalid-registration-token',
    });
    expect(JSON.stringify(vi.mocked(logger.warn).mock.calls)).not.toContain('private-device-token');
  });

  it('keeps the worker busy until every parallel send settles after a persistence failure', async () => {
    let finish!: () => void;
    const pending = new Promise<void>((resolve) => {
      finish = resolve;
    });
    const findFirst = vi
      .fn()
      .mockRejectedValueOnce(new Error('private-database-message'))
      .mockImplementationOnce(async () => {
        await pending;
        return null;
      });
    const db = {
      pushDelivery: { updateMany: vi.fn().mockResolvedValue({ count: 0 }), findFirst },
      $queryRaw: vi.fn().mockResolvedValue([{ id: 'first' }, { id: 'second' }]),
    } as unknown as PrismaClient;
    const dispatcher = new NotificationDispatcher(db, { send: vi.fn() });
    const first = dispatcher.dispatchOnce();
    await vi.waitFor(() => expect(findFirst).toHaveBeenCalledTimes(2));
    expect(await dispatcher.dispatchOnce()).toBe(0);
    finish();
    await expect(first).resolves.toBe(2);
    expect(logger.error).toHaveBeenCalledWith('notifications.delivery.persistence.failed');
  });
});
