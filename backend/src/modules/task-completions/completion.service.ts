import { Prisma, type PrismaClient } from '@prisma/client';
import type { CompletionDto } from '@kidquest/types';
import type { CompletionReviewInput, SubmitTaskInput } from '@kidquest/validation';
import type { UserRecord } from '../auth/auth.types.js';
import { AppError } from '../../errors/app-error.js';
import { lockChild, withTransaction } from '../../database/transaction.js';
import { logger } from '../../utils/logger.js';
import { dateColumn, dateOnly, familyClock, taskWithinDates } from '../tasks/task-time.js';
import { PhotoStorage } from '../task-photos/photo.service.js';
import { completionDto, completionInclude } from './completion.repository.js';
import { evaluateAchievements } from '../gamification/gamification.service.js';
import { notifyChild, notifyFamilyParents } from '../notifications/notification.events.js';

const operationConflict = () =>
  new AppError(
    409,
    'OPERATION_CONFLICT',
    'Ідентифікатор операції вже використано для іншого виконання.',
  );

const unavailable = () =>
  new AppError(404, 'COMPLETION_NOT_FOUND', 'Виконання квесту не знайдено.');

export class CompletionService {
  constructor(
    private db: PrismaClient,
    private storage: PhotoStorage,
  ) {}

  async submit(
    user: UserRecord,
    taskId: string,
    input: SubmitTaskInput,
    files: Express.Multer.File[],
  ): Promise<CompletionDto> {
    const { operationId } = input;
    const receivedAt = new Date();
    const completedAt = input.completedAt ? new Date(input.completedAt) : receivedAt;
    const taskVersion = input.taskVersion ? new Date(input.taskVersion).toISOString() : null;
    const offlineCompletedAt = input.completedAt ? completedAt.toISOString() : null;
    const replayOf = async (tx: Prisma.TransactionClient | PrismaClient) => {
      const replay = await tx.auditLog.findFirst({
        where: {
          action: 'TASK_SUBMITTED',
          metadata: { path: ['operationId'], equals: operationId },
        },
      });
      if (!replay) return null;
      const metadata = replay.metadata as Record<string, unknown> | null;
      if (
        replay.familyId !== user.familyId ||
        replay.userId !== user.id ||
        (metadata?.completedAt ?? null) !== offlineCompletedAt ||
        (metadata?.taskVersion ?? null) !== taskVersion
      )
        throw operationConflict();
      const previous = await tx.taskCompletion.findFirst({
        where: {
          id: replay.entityId!,
          taskId,
          childId: user.childId!,
          familyId: user.familyId,
          deletedAt: null,
        },
        include: completionInclude,
      });
      if (!previous || (input.completedAt && previous.operationId !== operationId))
        throw operationConflict();
      return completionDto(previous);
    };
    const stored = await this.storage.save(files);
    let usedFiles = false;
    try {
      const result = await withTransaction(this.db, async (tx) => {
        // Account security mutations use the same family-first lock order.
        await tx.$queryRaw(Prisma.sql`
          SELECT "id" FROM "Family"
          WHERE "id" = ${user.familyId}::uuid AND "deletedAt" IS NULL FOR UPDATE
        `);
        // Lock the account too: a transaction that waited for a credential reset
        // must retry its serializable snapshot instead of seeing the previous version.
        const accounts = await tx.$queryRaw<{ id: string }[]>(Prisma.sql`
          SELECT "id" FROM "User"
          WHERE "id" = ${user.id}::uuid AND "familyId" = ${user.familyId}::uuid
            AND "role" = 'CHILD' AND "isActive" = true AND "deletedAt" IS NULL
            AND "authVersion" = ${user.authVersion}
          FOR UPDATE
        `);
        if (accounts.length !== 1)
          throw new AppError(401, 'UNAUTHORIZED', 'Увійдіть в акаунт ще раз.');
        await lockChild(tx, user.familyId, user.childId!);
        // A lost response stays replayable even after a later task edit/deactivation/deletion.
        const replay = await replayOf(tx);
        if (replay) return { completion: replay, attached: false };
        const task = await tx.task.findFirst({
          where: {
            id: taskId,
            familyId: user.familyId,
            deletedAt: null,
            category: { deletedAt: null },
          },
        });
        if (!task) throw new AppError(404, 'TASK_NOT_FOUND', 'Квест не знайдено.');
        if (taskVersion && task.updatedAt.toISOString() !== taskVersion)
          throw new AppError(
            409,
            'TASK_CHANGED',
            'Батьки змінили квест. Оновіть його перед повторним виконанням.',
          );
        // An offline attempt cannot use a version that did not yet exist.
        // Allow the same small clock skew as the future-instant check.
        if (taskVersion && task.updatedAt.getTime() > completedAt.getTime() + 60_000)
          throw new AppError(
            409,
            'TASK_CHANGED',
            'Ця версія квесту з’явилася після вказаного часу виконання.',
          );
        if (!task.isActive) throw new AppError(409, 'TASK_INACTIVE', 'Цей квест зараз неактивний.');
        const family = await tx.family.findUniqueOrThrow({ where: { id: user.familyId } });
        const clock = input.completedAt
          ? familyClock(family.timeZone, completedAt)
          : familyClock(family.timeZone);
        if (input.completedAt) {
          const child = await tx.child.findUniqueOrThrow({ where: { id: user.childId! } });
          const currentDate = familyClock(family.timeZone, receivedAt).date;
          if (
            completedAt.getTime() > receivedAt.getTime() + 60_000 ||
            clock.date > currentDate ||
            completedAt < task.createdAt ||
            completedAt < child.createdAt
          )
            throw new AppError(
              400,
              'INVALID_COMPLETED_AT',
              'Час виконання має бути після створення квесту й профілю дитини та не може бути в майбутньому.',
            );
        }
        if (!taskWithinDates(task, clock.date)) {
          throw new AppError(
            409,
            'TASK_OUTSIDE_DATES',
            'Виконання можна надіслати лише в межах дат квесту.',
          );
        }
        if (
          (task.startTime && clock.time < task.startTime) ||
          (task.endTime && clock.time > task.endTime)
        )
          throw new AppError(
            409,
            'TASK_OUTSIDE_TIME',
            'Виконання можна надіслати лише у встановлений час.',
          );
        if (task.photoRequired && !stored.length)
          throw new AppError(400, 'PHOTO_REQUIRED', 'Додайте фотографію виконаного квесту.');
        const completionDate = dateColumn(clock.date);
        let existing = await tx.taskCompletion.findUnique({
          where: {
            taskId_childId_completionDate: { taskId, childId: user.childId!, completionDate },
          },
        });
        if (!task.repeatDaily) {
          const completedOrWaiting = await tx.taskCompletion.findFirst({
            where: {
              familyId: user.familyId,
              taskId,
              childId: user.childId!,
              deletedAt: null,
              status: { in: ['SUBMITTED', 'APPROVED'] },
            },
          });
          if (completedOrWaiting)
            throw new AppError(
              409,
              'ALREADY_SUBMITTED',
              'Цей квест без повторення вже виконано або надіслано на перевірку.',
            );
          existing ??= await tx.taskCompletion.findFirst({
            where: {
              familyId: user.familyId,
              taskId,
              childId: user.childId!,
              deletedAt: null,
              status: { in: ['PENDING', 'REJECTED'] },
            },
            orderBy: { completionDate: 'desc' },
          });
        }
        if (
          input.completedAt &&
          existing &&
          (existing.completionDate > completionDate ||
            (existing.submittedAt && existing.submittedAt > completedAt))
        )
          throw new AppError(
            409,
            'NEWER_SUBMISSION_EXISTS',
            'Для цього квесту вже є пізніше виконання. Перевірте історію разом із батьками.',
          );
        if (existing && (existing.deletedAt || !['PENDING', 'REJECTED'].includes(existing.status)))
          throw new AppError(409, 'ALREADY_SUBMITTED', 'Цей квест уже надіслано сьогодні.');
        const data = {
          completionDate,
          status: 'SUBMITTED' as const,
          operationId,
          submittedAt: completedAt,
          reviewedAt: null,
          reviewedById: null,
          rejectionReason: null,
          pointsSnapshot: task.points,
        };
        const completion = existing
          ? await tx.taskCompletion.update({ where: { id: existing.id }, data })
          : await tx.taskCompletion.create({
              data: {
                ...data,
                familyId: user.familyId,
                childId: user.childId!,
                taskId,
              },
            });
        // Earlier photos remain on disk for audit but are hidden after a resubmission.
        if (existing)
          await tx.taskPhoto.updateMany({
            where: { completionId: completion.id, deletedAt: null },
            data: { deletedAt: new Date() },
          });
        if (stored.length)
          await tx.taskPhoto.createMany({
            data: stored.map((photo) => ({ ...photo, completionId: completion.id })),
          });
        await tx.auditLog.create({
          data: {
            familyId: user.familyId,
            userId: user.id,
            action: 'TASK_SUBMITTED',
            entityType: 'TaskCompletion',
            entityId: completion.id,
            metadata: {
              operationId,
              completedAt: offlineCompletedAt,
              taskVersion,
              receivedAt: receivedAt.toISOString(),
              previousStatus: existing?.status ?? 'PENDING',
              previousRejectionReason: existing?.rejectionReason ?? null,
              previousCompletionDate: existing ? dateOnly(existing.completionDate) : null,
            },
          },
        });
        const complete = await tx.taskCompletion.findUniqueOrThrow({
          where: { id: completion.id },
          include: completionInclude,
        });
        await notifyFamilyParents(tx, user.familyId, {
          eventKey: `task-submission:${operationId}`,
          type: 'TASK_SUBMITTED',
          title: 'Квест очікує перевірки',
          body: `Дитина надіслала виконання квесту «${task.title}».`,
          path: '/parent/quests',
        });
        return { completion: completionDto(complete), attached: true };
      });
      usedFiles = result.attached;
      logger.info('task.submitted', { completionId: result.completion.id, userId: user.id });
      return result.completion;
    } catch (error) {
      if (error instanceof Prisma.PrismaClientKnownRequestError && error.code === 'P2002') {
        // A concurrent identical request can win the unique daily/operation key.
        // Once that transaction commits, return its result instead of duplicating it.
        const previous = await replayOf(this.db);
        if (previous) return previous;
        throw new AppError(
          409,
          'OPERATION_CONFLICT',
          'Операцію вже використано. Оновіть список квестів.',
        );
      }
      if (input.completedAt)
        logger.warn('task.sync_failed', {
          taskId,
          userId: user.id,
          operationId,
          code: error instanceof AppError ? error.code : 'INTERNAL_ERROR',
        });
      throw error;
    } finally {
      if (!usedFiles) await this.storage.remove(stored);
    }
  }

  async review(
    user: UserRecord,
    completionId: string,
    decision: 'APPROVED' | 'REJECTED',
    input: CompletionReviewInput,
  ) {
    const result = await withTransaction(this.db, async (tx) => {
      const initial = await tx.taskCompletion.findFirst({
        where: {
          id: completionId,
          familyId: user.familyId,
          deletedAt: null,
          task: { deletedAt: null },
        },
        select: { childId: true },
      });
      if (!initial) throw unavailable();
      await lockChild(tx, user.familyId, initial.childId);
      const completion = await tx.taskCompletion.findFirst({
        where: {
          id: completionId,
          familyId: user.familyId,
          deletedAt: null,
          task: { deletedAt: null },
        },
        include: completionInclude,
      });
      if (!completion) throw unavailable();
      if (completion.operationId !== input.operationId) {
        throw new AppError(
          409,
          'SUBMISSION_CHANGED',
          'Дитина надіслала нове виконання. Оновіть список і перевірте його ще раз.',
        );
      }
      if (completion.status === decision) return completionDto(completion);
      if (completion.status !== 'SUBMITTED')
        throw new AppError(
          409,
          'INVALID_COMPLETION_STATE',
          'Перевірити можна лише виконання, що очікує підтвердження.',
        );
      await tx.taskCompletion.update({
        where: { id: completionId },
        data: {
          status: decision,
          reviewedById: user.id,
          reviewedAt: new Date(),
          rejectionReason: decision === 'REJECTED' ? (input.reason ?? null) : null,
        },
      });
      if (decision === 'APPROVED') {
        await tx.pointTransaction.create({
          data: {
            familyId: user.familyId,
            childId: completion.childId,
            type: 'TASK_REWARD',
            amount: completion.pointsSnapshot,
            taskCompletionId: completionId,
            createdById: user.id,
            description: completion.task.title,
          },
        });
        await evaluateAchievements(tx, user.familyId, completion.childId);
      }
      await tx.auditLog.create({
        data: {
          familyId: user.familyId,
          userId: user.id,
          action: decision === 'APPROVED' ? 'TASK_APPROVED' : 'TASK_REJECTED',
          entityType: 'TaskCompletion',
          entityId: completionId,
          metadata: {
            reason: decision === 'REJECTED' ? (input.reason ?? null) : null,
            points: decision === 'APPROVED' ? completion.pointsSnapshot : 0,
          },
        },
      });
      await notifyChild(tx, user.familyId, completion.childId, {
        eventKey: `task-review:${completion.operationId}:${decision}`,
        type: decision === 'APPROVED' ? 'TASK_APPROVED' : 'TASK_REJECTED',
        title: decision === 'APPROVED' ? 'Квест підтверджено!' : 'Спробуй ще раз',
        body:
          decision === 'APPROVED'
            ? `За квест «${completion.task.title}» тобі нараховано ${completion.pointsSnapshot} балів.`
            : `Квест «${completion.task.title}» потребує доопрацювання. Переглянь коментар батьків.`,
        path: '/child/adventure',
      });
      return completionDto(
        await tx.taskCompletion.findUniqueOrThrow({
          where: { id: completionId },
          include: completionInclude,
        }),
      );
    });
    logger.info(decision === 'APPROVED' ? 'task.approved' : 'task.rejected', {
      completionId,
      userId: user.id,
    });
    return result;
  }
}
