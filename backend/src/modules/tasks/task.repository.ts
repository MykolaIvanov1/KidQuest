import { Prisma, type PrismaClient } from '@prisma/client';
import type { TaskDto } from '@kidquest/types';
import type { CategoryInput, TaskInput, TaskUpdateInput } from '@kidquest/validation';
import type { UserRecord } from '../auth/auth.types.js';
import { AppError } from '../../errors/app-error.js';
import { withTransaction } from '../../database/transaction.js';
import { completionDto, completionInclude } from '../task-completions/completion.repository.js';
import { dateColumn, familyClock } from './task-time.js';

type TaskRecord = Prisma.TaskGetPayload<{ include: { category: true } }>;
const missingTask = () => new AppError(404, 'TASK_NOT_FOUND', 'Квест не знайдено.');

function taskDto(task: TaskRecord): TaskDto {
  return {
    id: task.id,
    title: task.title,
    description: task.description,
    categoryId: task.categoryId,
    category: {
      id: task.category.id,
      name: task.category.name,
      icon: task.category.icon,
      color: task.category.color,
    },
    icon: task.icon,
    color: task.color,
    points: task.points,
    isRequired: task.isRequired,
    photoRequired: task.photoRequired,
    startTime: task.startTime,
    endTime: task.endTime,
    isActive: task.isActive,
    todayCompletion: null,
  };
}

export class TaskRepository {
  constructor(private db: PrismaClient) {}

  async categories(user: UserRecord) {
    return this.db.taskCategory.findMany({
      where: { familyId: user.familyId, deletedAt: null },
      select: { id: true, name: true, icon: true, color: true },
      orderBy: { createdAt: 'asc' },
    });
  }

  async createCategory(user: UserRecord, input: CategoryInput) {
    return withTransaction(this.db, async (tx) => {
      const category = await tx.taskCategory.create({
        data: { ...input, familyId: user.familyId },
        select: { id: true, name: true, icon: true, color: true },
      });
      await tx.auditLog.create({
        data: {
          familyId: user.familyId,
          userId: user.id,
          action: 'CATEGORY_CREATED',
          entityType: 'TaskCategory',
          entityId: category.id,
        },
      });
      return category;
    });
  }

  async list(user: UserRecord) {
    const tasks = await this.db.task.findMany({
      where: {
        familyId: user.familyId,
        deletedAt: null,
        ...(user.role === 'CHILD' ? { isActive: true } : {}),
        category: { deletedAt: null },
      },
      include: { category: true },
      orderBy: { createdAt: 'asc' },
    });
    const data = tasks.map(taskDto);
    if (user.role === 'CHILD') {
      const family = await this.db.family.findUniqueOrThrow({ where: { id: user.familyId } });
      const completions = await this.db.taskCompletion.findMany({
        where: {
          familyId: user.familyId,
          childId: user.childId!,
          completionDate: dateColumn(familyClock(family.timeZone).date),
          deletedAt: null,
        },
        include: completionInclude,
      });
      for (const task of data) {
        const completion = completions.find((entry) => entry.taskId === task.id);
        if (completion) task.todayCompletion = completionDto(completion);
      }
    }
    return data;
  }

  async create(user: UserRecord, input: TaskInput) {
    return withTransaction(this.db, async (tx) => {
      await this.category(tx, user.familyId, input.categoryId);
      const task = await tx.task.create({
        data: { ...input, familyId: user.familyId },
        include: { category: true },
      });
      await tx.auditLog.create({
        data: {
          familyId: user.familyId,
          userId: user.id,
          action: 'TASK_CREATED',
          entityType: 'Task',
          entityId: task.id,
        },
      });
      return taskDto(task);
    });
  }

  async update(user: UserRecord, id: string, input: TaskUpdateInput) {
    return withTransaction(this.db, async (tx) => {
      const current = await tx.task.findFirst({
        where: { id, familyId: user.familyId, deletedAt: null },
      });
      if (!current) throw missingTask();
      await this.category(tx, user.familyId, input.categoryId ?? current.categoryId);
      const start = input.startTime === undefined ? current.startTime : input.startTime;
      const end = input.endTime === undefined ? current.endTime : input.endTime;
      if (start && end && start >= end)
        throw new AppError(
          400,
          'INVALID_TIME_RANGE',
          'Час завершення має бути пізнішим за час початку.',
        );
      const task = await tx.task.update({
        where: { id },
        data: input,
        include: { category: true },
      });
      await tx.auditLog.create({
        data: {
          familyId: user.familyId,
          userId: user.id,
          action: 'TASK_UPDATED',
          entityType: 'Task',
          entityId: id,
        },
      });
      return taskDto(task);
    });
  }

  async remove(user: UserRecord, id: string) {
    return withTransaction(this.db, async (tx) => {
      const current = await tx.task.findFirst({
        where: { id, familyId: user.familyId, deletedAt: null },
      });
      if (!current) throw missingTask();
      await tx.task.update({ where: { id }, data: { deletedAt: new Date(), isActive: false } });
      await tx.auditLog.create({
        data: {
          familyId: user.familyId,
          userId: user.id,
          action: 'TASK_DELETED',
          entityType: 'Task',
          entityId: id,
        },
      });
      return null;
    });
  }

  private async category(tx: Prisma.TransactionClient, familyId: string, id: string) {
    const category = await tx.taskCategory.findFirst({ where: { id, familyId, deletedAt: null } });
    if (!category) throw new AppError(404, 'CATEGORY_NOT_FOUND', 'Категорію не знайдено.');
  }
}
