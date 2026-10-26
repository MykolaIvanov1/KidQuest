import type { Prisma, PrismaClient } from '@prisma/client';
import { AppError } from '../../errors/app-error.js';
import type { UserRecord } from '../auth/auth.types.js';
import { selectedChild } from '../points/points.repository.js';
import { dateColumn, dateOnly, familyClock } from '../tasks/task-time.js';
import type { HistoricalRejection, HistorySnapshot } from './gamification.calculation.js';
import { withTransaction } from '../../database/transaction.js';
import { enqueueNotification } from '../notifications/notification.repository.js';

export type GamificationDatabase = PrismaClient | Prisma.TransactionClient;

export class GamificationRepository {
  constructor(private db: GamificationDatabase) {}

  async context(user: UserRecord, childId?: string) {
    const child = await selectedChild(this.db, user, childId);
    return this.history(user.familyId, child?.id);
  }

  async history(familyId: string, childId?: string) {
    const family = await this.db.family.findFirst({
      where: { id: familyId, deletedAt: null },
      select: { timeZone: true },
    });
    if (!family) throw new AppError(404, 'FAMILY_NOT_FOUND', 'Сім’ю не знайдено.');
    const today = familyClock(family.timeZone).date;
    const child = childId
      ? await this.db.child.findFirst({
          where: {
            id: childId,
            familyId,
            deletedAt: null,
            user: { deletedAt: null, isActive: true, role: 'CHILD' },
          },
          select: { id: true, firstName: true, userId: true, createdAt: true },
        })
      : null;
    if (childId && !child)
      throw new AppError(404, 'CHILD_NOT_FOUND', 'Профіль дитини недоступний.');
    const history: HistorySnapshot = {
      today,
      childCreatedDate: today,
      trackingFrom: null,
      schedules: [],
      completions: [],
      rejections: [],
      earnedByDate: new Map(),
    };
    if (!child) return { family, child, history, approvedTasks: 0, earnedPoints: 0 };
    history.childCreatedDate = familyClock(family.timeZone, child.createdAt).date;
    const day = dateColumn(today);
    const [schedules, completions, transactions, audits] = await Promise.all([
      this.db.taskScheduleVersion.findMany({
        where: { familyId, effectiveFrom: { lte: day } },
        orderBy: [{ effectiveFrom: 'asc' }, { taskId: 'asc' }],
      }),
      this.db.taskCompletion.findMany({
        where: { familyId, childId: child.id, deletedAt: null, completionDate: { lte: day } },
        include: { task: { select: { title: true } } },
      }),
      this.db.pointTransaction.findMany({
        where: {
          familyId,
          childId: child.id,
          type: 'TASK_REWARD',
          amount: { gt: 0 },
          taskCompletion: { deletedAt: null, status: 'APPROVED', completionDate: { lte: day } },
        },
        select: { amount: true, taskCompletion: { select: { completionDate: true } } },
      }),
      this.db.auditLog.findMany({
        where: {
          familyId,
          userId: child.userId,
          action: 'TASK_SUBMITTED',
        },
        select: { entityId: true, metadata: true },
      }),
    ]);
    history.schedules = schedules.map((row) => ({
      ...row,
      effectiveFrom: dateOnly(row.effectiveFrom)!,
      startDate: dateOnly(row.startDate),
      endDate: dateOnly(row.endDate),
    }));
    const first = history.schedules[0]?.effectiveFrom;
    history.trackingFrom = first
      ? first < history.childCreatedDate
        ? history.childCreatedDate
        : first
      : null;
    history.completions = completions.map((row) => ({
      id: row.id,
      taskId: row.taskId,
      date: dateOnly(row.completionDate)!,
      status: row.status,
      points: row.pointsSnapshot,
      title: row.task.title,
    }));
    const byId = new Map(completions.map((row) => [row.id, row]));
    const rejections = new Map<string, HistoricalRejection>();
    for (const audit of audits) {
      const completion = audit.entityId ? byId.get(audit.entityId) : undefined;
      const metadata = audit.metadata;
      if (!completion || !metadata || typeof metadata !== 'object' || Array.isArray(metadata))
        continue;
      const previous = metadata.previousCompletionDate;
      if (
        metadata.previousStatus !== 'REJECTED' ||
        typeof previous !== 'string' ||
        !/^\d{4}-\d{2}-\d{2}$/.test(previous) ||
        previous >= dateOnly(completion.completionDate)! ||
        previous > today
      )
        continue;
      rejections.set(`${completion.taskId}:${previous}`, {
        taskId: completion.taskId,
        date: previous,
        title: completion.task.title,
      });
    }
    history.rejections = [...rejections.values()];
    const earnedByDate = new Map<string, number>();
    let earnedPoints = 0;
    for (const transaction of transactions) {
      if (!transaction.taskCompletion) continue;
      const date = dateOnly(transaction.taskCompletion.completionDate)!;
      earnedPoints += transaction.amount;
      earnedByDate.set(date, (earnedByDate.get(date) ?? 0) + transaction.amount);
    }
    history.earnedByDate = earnedByDate;
    return {
      family,
      child,
      history,
      approvedTasks: completions.filter((row) => row.status === 'APPROVED').length,
      earnedPoints,
    };
  }

  definitions() {
    return this.db.achievement.findMany({
      where: { isActive: true, deletedAt: null },
      orderBy: [{ createdAt: 'asc' }, { code: 'asc' }],
    });
  }

  earned(userId: string) {
    return this.db.userAchievement.findMany({
      where: { userId },
      select: { achievementId: true, earnedAt: true },
    });
  }

  async award(userId: string, achievementIds: string[]): Promise<void> {
    // Reconciliation also runs from reads: an award and its notification must commit together.
    if ('$transaction' in this.db) {
      return withTransaction(this.db, (tx) =>
        new GamificationRepository(tx).award(userId, achievementIds),
      );
    }
    const awarded = await this.db.userAchievement.createManyAndReturn({
      data: achievementIds.map((achievementId) => ({ userId, achievementId })),
      skipDuplicates: true,
      select: { achievementId: true },
    });
    const definitions = await this.db.achievement.findMany({
      where: { id: { in: awarded.map((row) => row.achievementId) } },
      select: { id: true, title: true },
    });
    for (const definition of definitions) {
      await enqueueNotification(this.db, {
        userId,
        eventKey: `achievement:${definition.id}`,
        type: 'ACHIEVEMENT_EARNED',
        title: 'Нове досягнення!',
        body: `Ти отримав відзнаку «${definition.title}». Продовжуй свої пригоди!`,
        path: '/child/achievements',
      });
    }
  }
}

export type GamificationContext = Awaited<ReturnType<GamificationRepository['history']>>;
