import type { CalendarDayDto, CalendarTaskDto, CompletionStatus } from '@kidquest/types';
import { dateColumn } from '../tasks/task-time.js';

export interface ScheduleSnapshot {
  taskId: string;
  effectiveFrom: string;
  title: string;
  isRequired: boolean;
  repeatDaily: boolean;
  isActive: boolean;
  startDate: string | null;
  endDate: string | null;
}

export interface CompletionSnapshot {
  id: string;
  taskId: string;
  date: string;
  status: CompletionStatus;
  points: number;
  title: string;
}

export interface HistoricalRejection {
  taskId: string;
  date: string;
  title: string;
}

export interface HistorySnapshot {
  today: string;
  childCreatedDate: string;
  trackingFrom: string | null;
  schedules: ScheduleSnapshot[];
  completions: CompletionSnapshot[];
  rejections: HistoricalRejection[];
  earnedByDate: ReadonlyMap<string, number>;
}

export function shiftDate(date: string, offset: number) {
  const value = dateColumn(date);
  value.setUTCDate(value.getUTCDate() + offset);
  return value.toISOString().slice(0, 10);
}

export function monthDates(month: string) {
  const year = Number(month.slice(0, 4));
  const number = Number(month.slice(5));
  const leap = year % 4 === 0 && (year % 100 !== 0 || year % 400 === 0);
  const days = [31, leap ? 29 : 28, 31, 30, 31, 30, 31, 31, 30, 31, 30, 31][number - 1]!;
  return Array.from(
    { length: days },
    (_, index) => `${month}-${String(index + 1).padStart(2, '0')}`,
  );
}

function emptyDay(date: string, today: string): CalendarDayDto {
  return {
    date,
    status: date > today ? 'FUTURE' : 'EMPTY',
    expected: 0,
    required: 0,
    approved: 0,
    submitted: 0,
    rejected: 0,
    missed: 0,
    earnedPoints: 0,
    successful: false,
    tasks: [],
  };
}

export function buildDay(date: string, history: HistorySnapshot): CalendarDayDto {
  const result = emptyDay(date, history.today);
  if (date > history.today || date < history.childCreatedDate) return result;
  const versions = new Map<string, ScheduleSnapshot>();
  for (const schedule of history.schedules) {
    const previous = versions.get(schedule.taskId);
    if (
      schedule.effectiveFrom <= date &&
      (!previous || previous.effectiveFrom < schedule.effectiveFrom)
    )
      versions.set(schedule.taskId, schedule);
  }
  const expected = new Map<string, ScheduleSnapshot>();
  for (const [id, schedule] of versions) {
    const alreadyApproved =
      !schedule.repeatDaily &&
      history.completions.some(
        (completion) =>
          completion.taskId === id && completion.status === 'APPROVED' && completion.date < date,
      );
    if (
      schedule.isActive &&
      !alreadyApproved &&
      (!schedule.startDate || schedule.startDate <= date) &&
      (!schedule.endDate || schedule.endDate >= date)
    )
      expected.set(id, schedule);
  }
  const tasks = new Map<string, CalendarTaskDto>();
  for (const [taskId, schedule] of expected) {
    tasks.set(taskId, {
      taskId,
      title: schedule.title,
      isRequired: schedule.isRequired,
      status: date < history.today ? 'MISSED' : 'PENDING',
      completionId: null,
      points: 0,
    });
  }
  for (const entry of history.rejections) {
    if (entry.date !== date) continue;
    const schedule = versions.get(entry.taskId);
    tasks.set(entry.taskId, {
      taskId: entry.taskId,
      title: schedule?.title ?? entry.title,
      isRequired: expected.get(entry.taskId)?.isRequired ?? false,
      status: 'REJECTED',
      completionId: null,
      points: 0,
    });
  }
  for (const completion of history.completions) {
    if (completion.date !== date) continue;
    const schedule = versions.get(completion.taskId);
    tasks.set(completion.taskId, {
      taskId: completion.taskId,
      title: schedule?.title ?? completion.title,
      isRequired: expected.get(completion.taskId)?.isRequired ?? false,
      status:
        completion.status === 'PENDING' && date < history.today ? 'MISSED' : completion.status,
      completionId: completion.id,
      points: completion.points,
    });
  }
  result.tasks = [...tasks.values()].sort((left, right) =>
    left.title.localeCompare(right.title, 'uk'),
  );
  result.expected = expected.size;
  result.required = [...expected.values()].filter((entry) => entry.isRequired).length;
  result.approved = result.tasks.filter((entry) => entry.status === 'APPROVED').length;
  result.submitted = result.tasks.filter((entry) => entry.status === 'SUBMITTED').length;
  result.rejected = result.tasks.filter((entry) => entry.status === 'REJECTED').length;
  result.missed = result.tasks.filter((entry) => entry.status === 'MISSED').length;
  result.earnedPoints = history.earnedByDate.get(date) ?? 0;
  result.successful = Boolean(
    history.trackingFrom &&
    date >= history.trackingFrom &&
    result.approved > 0 &&
    [...expected.entries()].every(
      ([id, entry]) => !entry.isRequired || tasks.get(id)?.status === 'APPROVED',
    ),
  );
  if (!result.tasks.length) return result;
  if (result.approved === result.tasks.length) result.status = 'COMPLETE';
  else if (result.approved) result.status = 'PARTIAL';
  else if (result.submitted) result.status = 'PENDING';
  else if (result.missed || result.rejected) result.status = 'MISSED';
  else result.status = 'PENDING';
  return result;
}

export function calculateStreak(history: HistorySnapshot) {
  if (!history.trackingFrom || history.trackingFrom > history.today)
    return { streak: 0, bestStreak: 0 };
  let run = 0;
  let bestStreak = 0;
  let yesterdayRun = 0;
  const yesterday = shiftDate(history.today, -1);
  for (let date = history.trackingFrom; date <= history.today; date = shiftDate(date, 1)) {
    run = buildDay(date, history).successful ? run + 1 : 0;
    bestStreak = Math.max(bestStreak, run);
    if (date === yesterday) yesterdayRun = run;
  }
  return { streak: run || yesterdayRun, bestStreak };
}
