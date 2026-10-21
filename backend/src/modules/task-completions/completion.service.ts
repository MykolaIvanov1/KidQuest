import { Prisma, type PrismaClient } from '@prisma/client';
import type { CompletionDto } from '@kidquest/types';
import type { UserRecord } from '../auth/auth.types.js';
import { AppError } from '../../errors/app-error.js';
import { lockChild, withTransaction } from '../../database/transaction.js';
import { logger } from '../../utils/logger.js';
import { dateColumn, familyClock } from '../tasks/task-time.js';
import { PhotoStorage } from '../task-photos/photo.service.js';
import { completionDto, completionInclude } from './completion.repository.js';

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
    operationId: string,
    files: Express.Multer.File[],
  ): Promise<CompletionDto> {
    const stored = await this.storage.save(files);
    let usedFiles = false;
    try {
      const result = await withTransaction(this.db, async (tx) => {
        await lockChild(tx, user.familyId, user.childId!);
        const task = await tx.task.findFirst({
          where: {
            id: taskId,
            familyId: user.familyId,
            deletedAt: null,
            category: { deletedAt: null },
          },
        });
        if (!task) throw new AppError(404, 'TASK_NOT_FOUND', 'Квест не знайдено.');
        const replay = await tx.auditLog.findFirst({
          where: {
            action: 'TASK_SUBMITTED',
            metadata: { path: ['operationId'], equals: operationId },
          },
        });
        if (replay) {
          if (replay.familyId !== user.familyId || replay.userId !== user.id)
            throw new AppError(
              409,
              'OPERATION_CONFLICT',
              'Ідентифікатор операції вже використано.',
            );
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
          if (!previous)
            throw new AppError(
              409,
              'OPERATION_CONFLICT',
              'Ідентифікатор операції вже використано.',
            );
          return { completion: completionDto(previous), attached: false };
        }
        if (!task.isActive) throw new AppError(409, 'TASK_INACTIVE', 'Цей квест зараз неактивний.');
        const family = await tx.family.findUniqueOrThrow({ where: { id: user.familyId } });
        const clock = familyClock(family.timeZone);
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
        const existing = await tx.taskCompletion.findUnique({
          where: {
            taskId_childId_completionDate: { taskId, childId: user.childId!, completionDate },
          },
        });
        if (existing && (existing.deletedAt || !['PENDING', 'REJECTED'].includes(existing.status)))
          throw new AppError(409, 'ALREADY_SUBMITTED', 'Цей квест уже надіслано сьогодні.');
        const data = {
          status: 'SUBMITTED' as const,
          operationId,
          submittedAt: new Date(),
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
                completionDate,
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
              previousStatus: existing?.status ?? 'PENDING',
              previousRejectionReason: existing?.rejectionReason ?? null,
            },
          },
        });
        const complete = await tx.taskCompletion.findUniqueOrThrow({
          where: { id: completion.id },
          include: completionInclude,
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
        const replay = await this.db.auditLog.findFirst({
          where: {
            familyId: user.familyId,
            userId: user.id,
            action: 'TASK_SUBMITTED',
            metadata: { path: ['operationId'], equals: operationId },
          },
        });
        const previous = replay?.entityId
          ? await this.db.taskCompletion.findFirst({
              where: {
                id: replay.entityId,
                familyId: user.familyId,
                childId: user.childId!,
                taskId,
                deletedAt: null,
              },
              include: completionInclude,
            })
          : null;
        if (previous) return completionDto(previous);
        throw new AppError(
          409,
          'OPERATION_CONFLICT',
          'Операцію вже використано. Оновіть список квестів.',
        );
      }
      throw error;
    } finally {
      if (!usedFiles) await this.storage.remove(stored);
    }
  }

  async review(
    user: UserRecord,
    completionId: string,
    decision: 'APPROVED' | 'REJECTED',
    reason?: string,
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
          rejectionReason: decision === 'REJECTED' ? (reason ?? null) : null,
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
      }
      await tx.auditLog.create({
        data: {
          familyId: user.familyId,
          userId: user.id,
          action: decision === 'APPROVED' ? 'TASK_APPROVED' : 'TASK_REJECTED',
          entityType: 'TaskCompletion',
          entityId: completionId,
          metadata: {
            reason: decision === 'REJECTED' ? (reason ?? null) : null,
            points: decision === 'APPROVED' ? completion.pointsSnapshot : 0,
          },
        },
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
