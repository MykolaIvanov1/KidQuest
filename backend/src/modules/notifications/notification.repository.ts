import { createHash, randomUUID } from 'node:crypto';
import { Prisma, type Device, type Notification, type PrismaClient } from '@prisma/client';
import type { DeviceDto, NotificationDto, NotificationsData } from '@kidquest/types';
import { withTransaction } from '../../database/transaction.js';
import { AppError } from '../../errors/app-error.js';
import type { UserRecord } from '../auth/auth.types.js';
import type { NotificationDatabase, NotificationInput } from './notification.types.js';
import type { DeviceInput, NotificationFilters } from './notification.validation.js';
import { safeNotificationPath, validNotificationPath } from './notification.validation.js';

const missingNotification = () =>
  new AppError(404, 'NOTIFICATION_NOT_FOUND', 'Сповіщення не знайдено.');
const missingDevice = () => new AppError(404, 'DEVICE_NOT_FOUND', 'Пристрій не знайдено.');

function notificationDto(row: Notification, fallback: string): NotificationDto {
  const data = row.data;
  return {
    id: row.id,
    type: row.type,
    title: row.title,
    body: row.body,
    path: safeNotificationPath(
      data && typeof data === 'object' && !Array.isArray(data) ? data.path : undefined,
      fallback,
    ),
    readAt: row.readAt?.toISOString() ?? null,
    createdAt: row.createdAt.toISOString(),
  };
}

function deviceDto(row: Device): DeviceDto {
  return {
    id: row.id,
    name: row.name,
    platform: row.platform,
    lastSeenAt: row.lastSeenAt.toISOString(),
  };
}

/** Called in the same transaction as its domain event; no network calls happen here. */
export async function enqueueNotification(
  database: NotificationDatabase,
  input: NotificationInput,
): Promise<void> {
  if ('$transaction' in database) {
    return withTransaction(database, (tx) => enqueueNotification(tx, input));
  }
  if (!validNotificationPath(input.path)) throw new Error('Invalid notification path');
  const recipient = await database.user.findFirst({
    where: {
      id: input.userId,
      isActive: true,
      deletedAt: null,
      family: { deletedAt: null },
      OR: [{ role: 'PARENT' }, { role: 'CHILD', child: { deletedAt: null } }],
    },
    select: { id: true },
  });
  if (!recipient) return;
  const id = randomUUID();
  const inserted = await database.notification.createMany({
    data: [
      {
        id,
        userId: input.userId,
        eventKey: input.eventKey,
        type: input.type,
        title: input.title,
        body: input.body,
        data: { path: input.path },
      },
    ],
    skipDuplicates: true,
  });
  // An idempotent replay must not create deliveries for devices registered later.
  if (inserted.count === 0) return;
  const devices = await database.device.findMany({
    where: { userId: input.userId, deletedAt: null },
    select: { id: true, bindingVersion: true },
  });
  if (devices.length > 0) {
    await database.pushDelivery.createMany({
      data: devices.map((device) => ({
        notificationId: id,
        deviceId: device.id,
        deviceVersion: device.bindingVersion,
      })),
      skipDuplicates: true,
    });
  }
}

export class NotificationRepository {
  constructor(private db: PrismaClient) {}

  async list(user: UserRecord, filters: NotificationFilters): Promise<NotificationsData> {
    const where = this.owned(user);
    const cursor = filters.cursor
      ? await this.db.notification.findFirst({ where: { ...where, id: filters.cursor } })
      : null;
    if (filters.cursor && !cursor) throw missingNotification();
    const [rows, unreadCount] = await Promise.all([
      this.db.notification.findMany({
        where: {
          ...where,
          ...(cursor
            ? {
                OR: [
                  { createdAt: { lt: cursor.createdAt } },
                  { createdAt: cursor.createdAt, id: { lt: cursor.id } },
                ],
              }
            : {}),
        },
        orderBy: [{ createdAt: 'desc' }, { id: 'desc' }],
        take: filters.limit + 1,
      }),
      this.db.notification.count({ where: { ...where, readAt: null } }),
    ]);
    return {
      items: rows.slice(0, filters.limit).map((row) => notificationDto(row, this.home(user))),
      unreadCount,
      nextCursor: rows.length > filters.limit ? rows[filters.limit - 1]!.id : null,
    };
  }

  async read(user: UserRecord, id: string): Promise<NotificationDto> {
    return withTransaction(this.db, async (tx) => {
      const where = { ...this.owned(user), id };
      await tx.notification.updateMany({
        where: { ...where, readAt: null },
        data: { readAt: new Date() },
      });
      const notification = await tx.notification.findFirst({ where });
      if (!notification) throw missingNotification();
      return notificationDto(notification, this.home(user));
    });
  }

  async readAll(user: UserRecord) {
    const result = await this.db.notification.updateMany({
      where: { ...this.owned(user), readAt: null },
      data: { readAt: new Date() },
    });
    return { updated: result.count };
  }

  async registerDevice(user: UserRecord, input: DeviceInput): Promise<DeviceDto> {
    return withTransaction(this.db, async (tx) => {
      // Use the same lock order as account changes, then fence requests authenticated before a reset.
      const family = await tx.$queryRaw<{ id: string }[]>(Prisma.sql`
        SELECT "id" FROM "Family"
        WHERE "id" = ${user.familyId}::uuid AND "deletedAt" IS NULL FOR UPDATE
      `);
      const account =
        family.length === 1
          ? await tx.$queryRaw<{ id: string }[]>(Prisma.sql`
            SELECT account."id" FROM "User" account
            LEFT JOIN "Child" child ON child."userId" = account."id" AND child."familyId" = account."familyId"
            WHERE account."id" = ${user.id}::uuid AND account."familyId" = ${user.familyId}::uuid
              AND account."authVersion" = ${user.authVersion} AND account."role" = ${user.role}::"Role"
              AND account."isActive" = true AND account."deletedAt" IS NULL
              AND (account."role" = 'PARENT' OR (child."id" IS NOT NULL AND child."deletedAt" IS NULL))
            FOR UPDATE OF account
          `)
          : [];
      if (account.length !== 1) {
        throw new AppError(401, 'UNAUTHENTICATED', 'Увійдіть до свого облікового запису.');
      }
      // Serialize initial binding as well as rebindings without putting tokens in lock labels.
      const lock = createHash('sha256').update(input.token).digest('hex');
      // executeRaw discards the PostgreSQL void return instead of deserializing it.
      await tx.$executeRaw(Prisma.sql`SELECT pg_advisory_xact_lock(hashtextextended(${lock}, 0))`);
      const previous = await tx.device.findUnique({ where: { token: input.token } });
      const rebinding = previous && (previous.userId !== user.id || previous.deletedAt !== null);
      if (rebinding) await this.cancelDeviceDeliveries(tx, previous.id);
      const device = await tx.device.upsert({
        where: { token: input.token },
        create: {
          userId: user.id,
          token: input.token,
          name: input.name ?? null,
          platform: 'web',
        },
        update: {
          userId: user.id,
          name: input.name ?? null,
          platform: 'web',
          deletedAt: null,
          lastSeenAt: new Date(),
          ...(rebinding ? { bindingVersion: { increment: 1 } } : {}),
        },
      });
      return deviceDto(device);
    });
  }

  async revokeDevice(user: UserRecord, id: string): Promise<null> {
    return withTransaction(this.db, async (tx) => {
      const current = await tx.device.findFirst({ where: { id, userId: user.id } });
      if (!current) throw missingDevice();
      if (!current.deletedAt) {
        await tx.device.updateMany({
          where: { id, userId: user.id, bindingVersion: current.bindingVersion },
          data: { deletedAt: new Date(), bindingVersion: { increment: 1 } },
        });
      }
      await this.cancelDeviceDeliveries(tx, id);
      return null;
    });
  }

  private cancelDeviceDeliveries(tx: Prisma.TransactionClient, deviceId: string) {
    return tx.pushDelivery.updateMany({
      where: { deviceId, status: { in: ['PENDING', 'PROCESSING'] } },
      data: {
        status: 'CANCELLED',
        leaseToken: null,
        leaseUntil: null,
        lastErrorCode: 'device-binding-changed',
      },
    });
  }

  private owned(user: UserRecord): Prisma.NotificationWhereInput {
    return { userId: user.id, deletedAt: null, user: { familyId: user.familyId } };
  }

  private home(user: UserRecord) {
    return user.role === 'PARENT' ? '/parent' : '/child';
  }
}
