import type { Prisma } from '@prisma/client';

export function familyClock(timeZone: string, now = new Date()) {
  const parts = new Intl.DateTimeFormat('en-GB', {
    timeZone,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
    hourCycle: 'h23',
  }).formatToParts(now);
  const value = (name: Intl.DateTimeFormatPartTypes) =>
    parts.find((part) => part.type === name)!.value;
  return {
    date: `${value('year')}-${value('month')}-${value('day')}`,
    time: `${value('hour')}:${value('minute')}`,
  };
}

export function dateColumn(date: string) {
  return new Date(`${date}T00:00:00.000Z`);
}
export function dateOnly(value: Date | null) {
  return value?.toISOString().slice(0, 10) ?? null;
}

export function taskDateWhere(date: string): Prisma.TaskWhereInput {
  const day = dateColumn(date);
  return {
    AND: [
      { OR: [{ startDate: null }, { startDate: { lte: day } }] },
      { OR: [{ endDate: null }, { endDate: { gte: day } }] },
    ],
  };
}

export function taskForDayWhere(date: string, childId?: string): Prisma.TaskWhereInput {
  if (!childId) return taskDateWhere(date);
  return {
    AND: [
      taskDateWhere(date),
      {
        OR: [
          { repeatDaily: true },
          {
            repeatDaily: false,
            completions: {
              none: {
                childId,
                deletedAt: null,
                status: 'APPROVED',
                completionDate: { lt: dateColumn(date) },
              },
            },
          },
        ],
      },
    ],
  };
}

export function taskWithinDates(
  task: { startDate: Date | null; endDate: Date | null },
  date: string,
) {
  const day = dateColumn(date).getTime();
  return (
    (!task.startDate || task.startDate.getTime() <= day) &&
    (!task.endDate || task.endDate.getTime() >= day)
  );
}
