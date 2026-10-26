import type { Prisma, Task } from '@prisma/client';
import { dateColumn, familyClock } from './task-time.js';

export async function saveTaskSchedule(tx: Prisma.TransactionClient, task: Task) {
  const family = await tx.family.findUniqueOrThrow({ where: { id: task.familyId } });
  const effectiveFrom = dateColumn(familyClock(family.timeZone).date);
  const snapshot = {
    title: task.title,
    isRequired: task.isRequired,
    repeatDaily: task.repeatDaily,
    isActive: task.isActive && !task.deletedAt,
    startDate: task.startDate,
    endDate: task.endDate,
  };
  await tx.taskScheduleVersion.upsert({
    where: { taskId_effectiveFrom: { taskId: task.id, effectiveFrom } },
    create: { taskId: task.id, familyId: task.familyId, effectiveFrom, ...snapshot },
    update: snapshot,
  });
}
