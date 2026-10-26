import type { PrismaClient } from '@prisma/client';
import { AppError } from '../../errors/app-error.js';
import type { UserRecord } from '../auth/auth.types.js';
import { dateColumn, familyClock, taskForDayWhere } from '../tasks/task-time.js';
import type { AiContext, AiContextRepository, AiRequest } from './ai.types.js';
import { scrubTaskText } from './ai.safety.js';

export class AiRepository implements AiContextRepository {
  constructor(
    private db: PrismaClient,
    private now: () => Date = () => new Date(),
  ) {}

  async context(user: UserRecord, input: AiRequest): Promise<AiContext> {
    // Only selectors used to verify access are read; names, contacts, photos and audit data are never loaded.
    const [account, family] = await Promise.all([
      this.db.user.findFirst({
        where: {
          id: user.id,
          familyId: user.familyId,
          authVersion: user.authVersion,
          role: user.role,
          deletedAt: null,
          isActive: true,
          family: { deletedAt: null },
        },
        select: { id: true },
      }),
      this.db.family.findFirst({
        where: { id: user.familyId, deletedAt: null },
        select: { timeZone: true },
      }),
    ]);
    if (!account)
      throw new AppError(401, 'UNAUTHENTICATED', 'Увійдіть до свого облікового запису.');
    if (!family) throw new AppError(404, 'FAMILY_NOT_FOUND', 'Сім’ю не знайдено.');
    if (user.role === 'CHILD' && input.childId && input.childId !== user.childId)
      throw new AppError(403, 'FORBIDDEN', 'Доступні лише власні підказки.');
    const childId = user.role === 'CHILD' ? user.childId : input.childId;
    const child = await this.db.child.findFirst({
      where: {
        familyId: user.familyId,
        deletedAt: null,
        ...(childId ? { id: childId } : {}),
        ...(user.role === 'CHILD' ? { userId: user.id } : {}),
        user: { role: 'CHILD', isActive: true, deletedAt: null },
      },
      select: { id: true, userId: true },
      orderBy: [{ createdAt: 'asc' }, { id: 'asc' }],
    });
    if (!child && (childId || user.role === 'CHILD'))
      throw new AppError(404, 'CHILD_NOT_FOUND', 'Профіль дитини недоступний.');
    const today = familyClock(family.timeZone, this.now()).date;
    const day = dateColumn(today);
    const completionWhere = {
      familyId: user.familyId,
      childId: child?.id,
      deletedAt: null,
      completionDate: { lte: day },
    };
    const [
      availableTasks,
      availableRewards,
      approvedToday,
      awaitingReview,
      approvedTotal,
      earnedPoints,
      balance,
      earnedAchievements,
    ] = await Promise.all([
      this.db.task.count({
        where: {
          familyId: user.familyId,
          deletedAt: null,
          isActive: true,
          category: { deletedAt: null },
          ...taskForDayWhere(today, child?.id),
        },
      }),
      this.db.reward.count({ where: { familyId: user.familyId, deletedAt: null, isActive: true } }),
      child
        ? this.db.taskCompletion.count({
            where: { ...completionWhere, status: 'APPROVED', completionDate: day },
          })
        : 0,
      child
        ? this.db.taskCompletion.count({ where: { ...completionWhere, status: 'SUBMITTED' } })
        : 0,
      child
        ? this.db.taskCompletion.count({ where: { ...completionWhere, status: 'APPROVED' } })
        : 0,
      child
        ? this.db.pointTransaction
            .aggregate({
              where: {
                familyId: user.familyId,
                childId: child.id,
                type: 'TASK_REWARD',
                amount: { gt: 0 },
                taskCompletion: {
                  deletedAt: null,
                  status: 'APPROVED',
                  completionDate: { lte: day },
                },
              },
              _sum: { amount: true },
            })
            .then((value) => value._sum.amount ?? 0)
        : 0,
      child
        ? this.db.pointTransaction
            .aggregate({
              where: { familyId: user.familyId, childId: child.id },
              _sum: { amount: true },
            })
            .then((value) => value._sum.amount ?? 0)
        : 0,
      child
        ? this.db.userAchievement.count({
            where: { userId: child.userId, achievement: { deletedAt: null, isActive: true } },
          })
        : 0,
    ]);
    const context: AiContext = {
      role: user.role,
      intent: input.intent,
      locale: 'uk-UA',
      childPresent: Boolean(child),
      progress: {
        availableTasks,
        availableRewards,
        approvedToday,
        awaitingReview,
        approvedTotal,
        earnedPoints,
        balance,
        earnedAchievements,
      },
    };
    if (input.intent === 'TASK_HELP') {
      const task = await this.db.task.findFirst({
        where: {
          id: input.taskId,
          familyId: user.familyId,
          deletedAt: null,
          isActive: true,
          category: { deletedAt: null },
          ...taskForDayWhere(today, child?.id),
        },
        select: { title: true, description: true, photoRequired: true, points: true },
      });
      if (!task)
        throw new AppError(404, 'TASK_NOT_FOUND', 'Цей квест зараз недоступний. Оновіть список.');
      const privateTerms = [
        user.firstName,
        user.lastName ?? '',
        user.email,
        user.id,
        user.familyId,
        user.passwordHash,
        child?.id ?? '',
        child?.userId ?? '',
      ];
      context.task = {
        title: scrubTaskText(task.title, 120, privateTerms),
        description: scrubTaskText(task.description, 600, privateTerms),
        photoRequired: task.photoRequired,
        points: task.points,
      };
    }
    return context;
  }
}
