import { Prisma, type PrismaClient } from '@prisma/client';
import type { MemberInput, RegisterInput } from '@kidquest/validation';
import type { DashboardData } from '@kidquest/types';
import { AppError } from '../../errors/app-error.js';
import { dateColumn, familyClock, taskForDayWhere } from '../tasks/task-time.js';
import {
  publicUser,
  type AuthRepository,
  type LoginMetadata,
  type RefreshRecord,
  type UserRecord,
} from './auth.types.js';

const includeUser = { family: true, child: true } satisfies Prisma.UserInclude;
type DatabaseUser = Prisma.UserGetPayload<{ include: typeof includeUser }>;

function mapUser(user: DatabaseUser): UserRecord {
  return {
    ...publicUser(user),
    passwordHash: user.passwordHash,
    isActive: user.isActive,
    deletedAt: user.deletedAt,
    familyDeletedAt: user.family.deletedAt,
    childId: user.child && !user.child.deletedAt ? user.child.id : null,
  };
}

function conflict(error: unknown): never {
  if (error instanceof Prisma.PrismaClientKnownRequestError && error.code === 'P2002') {
    throw new AppError(409, 'EMAIL_IN_USE', 'Ця електронна адреса вже використовується.');
  }
  throw error;
}

export class PrismaAuthRepository implements AuthRepository {
  constructor(private db: PrismaClient) {}

  async findByEmail(email: string) {
    const user = await this.db.user.findUnique({ where: { email }, include: includeUser });
    return user ? mapUser(user) : null;
  }

  async findById(id: string) {
    const user = await this.db.user.findUnique({ where: { id }, include: includeUser });
    return user ? mapUser(user) : null;
  }

  async createFamilyWithParent(input: RegisterInput, passwordHash: string) {
    try {
      return await this.db.$transaction(async (tx) => {
        const family = await tx.family.create({ data: { name: input.familyName } });
        const user = await tx.user.create({
          data: {
            familyId: family.id,
            email: input.email,
            passwordHash,
            firstName: input.firstName,
            lastName: input.lastName ?? '',
            role: 'PARENT',
          },
          include: includeUser,
        });
        return mapUser(user);
      });
    } catch (error) {
      return conflict(error);
    }
  }

  async createMember(familyId: string, input: MemberInput, passwordHash: string) {
    // Serializable isolation prevents two parents simultaneously adding a third parent.
    for (let attempt = 0; attempt < 3; attempt += 1) {
      try {
        return await this.db.$transaction(
          async (tx) => {
            const family = await tx.family.findFirst({ where: { id: familyId, deletedAt: null } });
            if (!family) throw new AppError(403, 'FORBIDDEN', 'Сім’я недоступна.');
            if (input.role === 'PARENT') {
              const count = await tx.user.count({
                where: { familyId, role: 'PARENT', deletedAt: null, isActive: true },
              });
              if (count >= 2)
                throw new AppError(
                  409,
                  'PARENT_LIMIT',
                  'У сім’ї може бути два батьківські облікові записи.',
                );
            }
            const user = await tx.user.create({
              data: {
                familyId,
                email: input.email,
                passwordHash,
                firstName: input.firstName,
                lastName: input.lastName ?? '',
                role: input.role,
              },
            });
            if (input.role === 'CHILD') {
              await tx.child.create({
                data: {
                  userId: user.id,
                  familyId,
                  firstName: input.firstName,
                  lastName: input.lastName ?? '',
                },
              });
            }
            await tx.auditLog.create({
              data: {
                familyId,
                action: 'FAMILY_MEMBER_CREATED',
                entityType: 'User',
                entityId: user.id,
              },
            });
            return publicUser(user);
          },
          { isolationLevel: Prisma.TransactionIsolationLevel.Serializable },
        );
      } catch (error) {
        if (
          error instanceof Prisma.PrismaClientKnownRequestError &&
          error.code === 'P2034' &&
          attempt < 2
        )
          continue;
        return conflict(error);
      }
    }
    throw new AppError(409, 'CONCURRENT_UPDATE', 'Повторіть запит.');
  }

  async listMembers(familyId: string) {
    const users = await this.db.user.findMany({
      where: { familyId, deletedAt: null, isActive: true },
      orderBy: { createdAt: 'asc' },
    });
    return users.map(publicUser);
  }

  async addLoginLog(userId: string | null, metadata: LoginMetadata, success: boolean) {
    await this.db.loginLog.create({
      data: {
        userId,
        ipAddress: metadata.ipAddress.slice(0, 64),
        userAgent: metadata.userAgent.slice(0, 512),
        device: metadata.userAgent.slice(0, 120),
        success,
      },
    });
  }

  createRefresh(input: Omit<RefreshRecord, 'id' | 'revokedAt'>) {
    return this.db.refreshToken.create({ data: input });
  }

  findRefresh(tokenHash: string) {
    return this.db.refreshToken.findUnique({ where: { tokenHash } });
  }

  async rotateRefresh(oldId: string, input: Omit<RefreshRecord, 'id' | 'revokedAt'>) {
    return this.db.$transaction(async (tx) => {
      const result = await tx.refreshToken.updateMany({
        where: { id: oldId, revokedAt: null, expiresAt: { gt: new Date() } },
        data: { revokedAt: new Date() },
      });
      if (result.count !== 1) return false;
      const next = await tx.refreshToken.create({ data: input });
      await tx.refreshToken.update({ where: { id: oldId }, data: { replacedById: next.id } });
      return true;
    });
  }

  async revokeSession(sessionId: string) {
    await this.db.refreshToken.updateMany({
      where: { sessionId, revokedAt: null },
      data: { revokedAt: new Date() },
    });
  }

  async dashboard(user: UserRecord): Promise<DashboardData> {
    const familyId = user.familyId;
    const family = await this.db.family.findFirstOrThrow({
      where: { id: familyId, deletedAt: null },
      select: { id: true, name: true, timeZone: true },
    });
    const children = await this.db.child.findMany({
      where: { familyId, deletedAt: null, user: { deletedAt: null, isActive: true } },
      orderBy: { createdAt: 'asc' },
      select: { id: true, firstName: true, userId: true },
    });
    const selected =
      user.role === 'CHILD' ? children.find((child) => child.userId === user.id) : children[0];
    const child = selected ? { id: selected.id, firstName: selected.firstName } : null;
    const dateString = familyClock(family.timeZone).date;
    const today = dateColumn(dateString);
    const todayTaskWhere: Prisma.TaskWhereInput = {
      familyId,
      isActive: true,
      deletedAt: null,
      category: { deletedAt: null },
      ...taskForDayWhere(dateString, child?.id),
    };
    const scoped = { familyId, ...(user.role === 'CHILD' ? { childId: user.childId! } : {}) };
    const [
      tasks,
      rewards,
      taskCount,
      rewardCount,
      pendingCompletions,
      pendingRewards,
      sum,
      approved,
    ] = await Promise.all([
      this.db.task.findMany({
        where: todayTaskWhere,
        orderBy: { createdAt: 'asc' },
        take: 12,
        include: { category: true },
      }),
      this.db.reward.findMany({
        where: { familyId, isActive: true, deletedAt: null },
        orderBy: { cost: 'asc' },
        take: 8,
      }),
      this.db.task.count({ where: todayTaskWhere }),
      this.db.reward.count({ where: { familyId, isActive: true, deletedAt: null } }),
      this.db.taskCompletion.count({
        where: {
          ...scoped,
          status: 'SUBMITTED',
          deletedAt: null,
          child: { deletedAt: null },
          task: { deletedAt: null },
        },
      }),
      this.db.rewardRequest.count({
        where: {
          ...scoped,
          status: 'PENDING',
          deletedAt: null,
          child: { deletedAt: null },
          reward: { deletedAt: null },
        },
      }),
      child
        ? this.db.pointTransaction.aggregate({
            where: { familyId, childId: child.id },
            _sum: { amount: true },
          })
        : Promise.resolve({ _sum: { amount: 0 } }),
      child
        ? this.db.taskCompletion.count({
            where: {
              familyId,
              childId: child.id,
              completionDate: today,
              status: 'APPROVED',
              deletedAt: null,
              task: todayTaskWhere,
            },
          })
        : Promise.resolve(0),
    ]);
    return {
      family,
      child,
      counts: {
        children: user.role === 'CHILD' ? 1 : children.length,
        activeTasks: taskCount,
        activeRewards: rewardCount,
        pendingCompletions,
        pendingRewards,
      },
      balance: sum._sum.amount ?? 0,
      tasks: tasks.map((task) => ({
        id: task.id,
        title: task.title,
        description: task.description,
        points: task.points,
        photoRequired: task.photoRequired,
        category: task.category.deletedAt ? null : task.category.name,
      })),
      rewards: rewards.map((reward) => ({
        id: reward.id,
        title: reward.title,
        description: reward.description,
        cost: reward.cost,
        type: reward.type,
      })),
      today: { approved, total: child ? taskCount : 0 },
      streak: null,
    };
  }
}
