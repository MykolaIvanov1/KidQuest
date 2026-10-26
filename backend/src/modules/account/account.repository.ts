import { Prisma, type PrismaClient, type Role } from '@prisma/client';
import type { AccountMutationData, AccountProfileData, LoginJournalData } from '@kidquest/types';
import { withTransaction } from '../../database/transaction.js';
import { AppError } from '../../errors/app-error.js';
import { publicUser, type UserRecord } from '../auth/auth.types.js';
import type { AccountActor } from './account.types.js';
import type { LoginJournalFilters } from './account.validation.js';

const unauthenticated = () =>
  new AppError(401, 'UNAUTHENTICATED', 'Увійдіть до свого облікового запису.');
const missingMember = () => new AppError(404, 'MEMBER_NOT_FOUND', 'Обліковий запис не знайдено.');
const missingEntry = () => new AppError(404, 'LOGIN_LOG_NOT_FOUND', 'Запис журналу не знайдено.');
const visibleUser = { isActive: true, deletedAt: null, family: { deletedAt: null } };
const journalUserSelect = {
  id: true,
  email: true,
  firstName: true,
  lastName: true,
  role: true,
  familyId: true,
} satisfies Prisma.UserSelect;

export class AccountRepository {
  constructor(private db: PrismaClient) {}

  async profile(user: UserRecord): Promise<AccountProfileData> {
    const row = await this.db.user.findFirst({
      where: { id: user.id, familyId: user.familyId, ...visibleUser },
      include: { family: true, child: true },
    });
    if (!row || row.authVersion !== user.authVersion) throw unauthenticated();
    return {
      user: publicUser(row),
      family: { id: row.family.id, name: row.family.name, timeZone: row.family.timeZone },
      childId: row.role === 'CHILD' && row.child && !row.child.deletedAt ? row.child.id : null,
      createdAt: row.createdAt.toISOString(),
    };
  }

  async actor(user: UserRecord): Promise<AccountActor> {
    const actor = await this.db.user.findFirst({
      where: { id: user.id, familyId: user.familyId, role: 'PARENT', ...visibleUser },
    });
    if (!actor || actor.authVersion !== user.authVersion) throw unauthenticated();
    return {
      id: actor.id,
      familyId: actor.familyId,
      authVersion: actor.authVersion,
      passwordHash: actor.passwordHash,
    };
  }

  async changeEmail(actor: AccountActor, id: string, email: string): Promise<AccountMutationData> {
    try {
      return await this.mutate(actor, async (tx) => {
        const target = await this.target(tx, actor.familyId, id);
        if (target.email === email) return { updated: false, reauthenticate: false };
        await tx.user.update({ where: { id: target.id }, data: { email } });
        await this.revokeSecurity(tx, target.id);
        await this.audit(tx, actor, target.id, 'ACCOUNT_EMAIL_CHANGED');
        return { updated: true, reauthenticate: actor.id === target.id };
      });
    } catch (error) {
      if (error instanceof Prisma.PrismaClientKnownRequestError && error.code === 'P2002') {
        throw new AppError(409, 'EMAIL_IN_USE', 'Ця електронна адреса вже використовується.');
      }
      throw error;
    }
  }

  resetPassword(
    actor: AccountActor,
    id: string,
    passwordHash: string,
  ): Promise<AccountMutationData> {
    return this.mutate(actor, async (tx) => {
      const target = await this.target(tx, actor.familyId, id);
      if (target.role !== 'CHILD') {
        throw new AppError(
          409,
          'CHILD_REQUIRED',
          'Скинути пароль можна лише дитячому обліковому запису.',
        );
      }
      const child = await tx.child.findFirst({
        where: { userId: target.id, familyId: actor.familyId, deletedAt: null },
      });
      if (!child) throw missingMember();
      await tx.user.update({ where: { id: target.id }, data: { passwordHash } });
      await this.revokeSecurity(tx, target.id);
      await this.audit(tx, actor, target.id, 'CHILD_PASSWORD_RESET');
      return { updated: true, reauthenticate: false };
    });
  }

  changeRole(actor: AccountActor, id: string, role: Role): Promise<AccountMutationData> {
    return this.mutate(actor, async (tx) => {
      const target = await this.target(tx, actor.familyId, id);
      if (target.role === role) return { updated: false, reauthenticate: false };
      const parents = await tx.user.count({
        where: { familyId: actor.familyId, role: 'PARENT', isActive: true, deletedAt: null },
      });
      if (role === 'PARENT' && parents >= 2) {
        throw new AppError(
          409,
          'PARENT_LIMIT',
          'У сім’ї може бути два батьківські облікові записи.',
        );
      }
      if (role === 'CHILD' && parents <= 1) {
        throw new AppError(
          409,
          'LAST_PARENT',
          'У сім’ї має залишитися хоча б один батьківський обліковий запис.',
        );
      }
      if (role === 'CHILD') {
        // Keep the same child identity and its complete points/quest history across role changes.
        await tx.child.upsert({
          where: { userId: target.id },
          create: {
            userId: target.id,
            familyId: actor.familyId,
            firstName: target.firstName,
            lastName: target.lastName,
            avatarUrl: target.avatarUrl,
          },
          update: { deletedAt: null },
        });
      }
      await tx.user.update({ where: { id: target.id }, data: { role } });
      await this.revokeSecurity(tx, target.id);
      await this.audit(tx, actor, target.id, 'ACCOUNT_ROLE_CHANGED', {
        previousRole: target.role,
        role,
      });
      return { updated: true, reauthenticate: actor.id === target.id };
    });
  }

  async journal(user: UserRecord, filters: LoginJournalFilters): Promise<LoginJournalData> {
    const userWhere: Prisma.UserWhereInput = {
      familyId: user.familyId,
      deletedAt: null,
      family: { deletedAt: null },
    };
    if (filters.userId) {
      const member = await this.db.user.findFirst({
        where: { ...userWhere, id: filters.userId },
        select: { id: true },
      });
      if (!member) throw missingMember();
    }
    const where: Prisma.LoginLogWhereInput = {
      user: userWhere,
      ...(filters.userId ? { userId: filters.userId } : {}),
      ...(filters.success ? { success: filters.success === 'true' } : {}),
    };
    const cursor = filters.cursor
      ? await this.db.loginLog.findFirst({
          where: { ...where, id: filters.cursor },
          select: { id: true, loginAt: true },
        })
      : null;
    if (filters.cursor && !cursor) throw missingEntry();
    const rows = await this.db.loginLog.findMany({
      where: {
        ...where,
        ...(cursor
          ? {
              OR: [
                { loginAt: { lt: cursor.loginAt } },
                { loginAt: cursor.loginAt, id: { lt: cursor.id } },
              ],
            }
          : {}),
      },
      include: { user: { select: journalUserSelect } },
      orderBy: [{ loginAt: 'desc' }, { id: 'desc' }],
      take: filters.limit + 1,
    });
    return {
      items: rows.slice(0, filters.limit).map((row) => ({
        id: row.id,
        user: publicUser(row.user!),
        loginAt: row.loginAt.toISOString(),
        ipAddress: row.ipAddress,
        userAgent: row.userAgent,
        device: row.device,
        success: row.success,
      })),
      nextCursor: rows.length > filters.limit ? rows[filters.limit - 1]!.id : null,
    };
  }

  private async mutate<T>(
    actor: AccountActor,
    work: (tx: Prisma.TransactionClient) => Promise<T>,
  ): Promise<T> {
    return withTransaction(this.db, async (tx) => {
      // Every membership/security mutation uses this family lock, including concurrent member creation.
      const family = await tx.$queryRaw<{ id: string }[]>(Prisma.sql`
        SELECT "id" FROM "Family" WHERE "id" = ${actor.familyId}::uuid AND "deletedAt" IS NULL FOR UPDATE
      `);
      if (family.length !== 1) throw unauthenticated();
      // A family lock may wait without refreshing a Serializable snapshot. Locking the actor
      // forces a retry if another account change updated this user after that snapshot began.
      const lockedActor = await tx.$queryRaw<{ id: string }[]>(Prisma.sql`
        SELECT "id" FROM "User"
        WHERE "id" = ${actor.id}::uuid AND "familyId" = ${actor.familyId}::uuid
          AND "deletedAt" IS NULL AND "isActive" = true AND "role" = 'PARENT'
        FOR UPDATE
      `);
      if (lockedActor.length !== 1) throw unauthenticated();
      const current = await tx.user.findFirst({
        where: { id: actor.id, familyId: actor.familyId, role: 'PARENT', ...visibleUser },
      });
      if (
        !current ||
        current.authVersion !== actor.authVersion ||
        current.passwordHash !== actor.passwordHash
      )
        throw unauthenticated();
      return work(tx);
    });
  }

  private async target(tx: Prisma.TransactionClient, familyId: string, id: string) {
    const target = await tx.user.findFirst({ where: { id, familyId, ...visibleUser } });
    if (!target) throw missingMember();
    return target;
  }

  private async revokeSecurity(tx: Prisma.TransactionClient, userId: string) {
    const now = new Date();
    await tx.user.update({ where: { id: userId }, data: { authVersion: { increment: 1 } } });
    await tx.refreshToken.updateMany({
      where: { userId, revokedAt: null },
      data: { revokedAt: now },
    });
    await tx.device.updateMany({
      where: { userId, deletedAt: null },
      data: { deletedAt: now, bindingVersion: { increment: 1 } },
    });
    await tx.pushDelivery.updateMany({
      where: { device: { userId }, status: { in: ['PENDING', 'PROCESSING'] } },
      data: {
        status: 'CANCELLED',
        leaseToken: null,
        leaseUntil: null,
        lastErrorCode: 'account-security-changed',
      },
    });
  }

  private audit(
    tx: Prisma.TransactionClient,
    actor: AccountActor,
    id: string,
    action: string,
    metadata?: Prisma.InputJsonObject,
  ) {
    return tx.auditLog.create({
      data: {
        familyId: actor.familyId,
        userId: actor.id,
        action,
        entityType: 'User',
        entityId: id,
        ...(metadata ? { metadata } : {}),
      },
    });
  }
}
