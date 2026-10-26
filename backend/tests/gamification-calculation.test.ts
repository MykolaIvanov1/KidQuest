import { describe, expect, it } from 'vitest';
import {
  buildDay,
  calculateStreak,
  monthDates,
  type CompletionSnapshot,
  type HistorySnapshot,
  type ScheduleSnapshot,
} from '../src/modules/gamification/gamification.calculation.js';
import { calendarFilters } from '../src/modules/gamification/gamification.validation.js';

function schedule(overrides: Partial<ScheduleSnapshot> = {}): ScheduleSnapshot {
  return {
    taskId: 'task',
    effectiveFrom: '2026-10-01',
    title: 'Прибрати кімнату',
    isRequired: true,
    repeatDaily: true,
    isActive: true,
    startDate: null,
    endDate: null,
    ...overrides,
  };
}

function completion(date: string, overrides: Partial<CompletionSnapshot> = {}): CompletionSnapshot {
  return {
    id: `completion-${date}`,
    taskId: 'task',
    date,
    status: 'APPROVED',
    title: 'Поточна назва',
    points: 10,
    ...overrides,
  };
}

function history(overrides: Partial<HistorySnapshot> = {}): HistorySnapshot {
  return {
    today: '2026-10-08',
    childCreatedDate: '2026-10-01',
    trackingFrom: '2026-10-01',
    schedules: [schedule()],
    completions: [],
    rejections: [],
    earnedByDate: new Map(),
    ...overrides,
  };
}

describe('gamification calendar and streak calculations', () => {
  it('keeps yesterday’s seven-day streak while today is pending', () => {
    const data = history({
      completions: Array.from({ length: 7 }, (_, index) => completion(`2026-10-0${index + 1}`)),
    });
    expect(calculateStreak(data)).toEqual({ streak: 7, bestStreak: 7 });
    expect(buildDay(data.today, data)).toMatchObject({ status: 'PENDING', successful: false });
  });

  it('counts a completed today and ignores completions from tomorrow', () => {
    const data = history({
      completions: [completion('2026-10-07'), completion('2026-10-08'), completion('2026-10-09')],
    });
    expect(calculateStreak(data)).toEqual({ streak: 2, bestStreak: 2 });
    expect(buildDay('2026-10-09', data)).toMatchObject({
      status: 'FUTURE',
      tasks: [],
      approved: 0,
      earnedPoints: 0,
    });
  });

  it('breaks the current streak at a missed yesterday while preserving the best', () => {
    const data = history({
      completions: [completion('2026-10-04'), completion('2026-10-05'), completion('2026-10-06')],
    });
    expect(calculateStreak(data)).toEqual({ streak: 0, bestStreak: 3 });
    expect(buildDay('2026-10-07', data)).toMatchObject({ status: 'MISSED', missed: 1 });
  });

  it('requires every mandatory quest but does not require optional quests', () => {
    const data = history({
      schedules: [schedule(), schedule({ taskId: 'optional', isRequired: false })],
      completions: [completion('2026-10-08')],
    });
    expect(buildDay(data.today, data)).toMatchObject({
      required: 1,
      approved: 1,
      successful: true,
      status: 'PARTIAL',
    });
    data.schedules[1]!.isRequired = true;
    expect(buildDay(data.today, data).successful).toBe(false);
  });

  it('does not create a successful day from an empty schedule', () => {
    const data = history({ schedules: [] });
    expect(buildDay(data.today, data)).toMatchObject({ status: 'EMPTY', successful: false });
    expect(calculateStreak(data)).toEqual({ streak: 0, bestStreak: 0 });
  });

  it('preserves past expectations and titles after edits and deletion', () => {
    const data = history({
      schedules: [
        schedule(),
        schedule({
          effectiveFrom: '2026-10-08',
          title: 'Змінено',
          isActive: false,
          isRequired: false,
        }),
      ],
      completions: [completion('2026-10-07')],
    });
    const yesterday = buildDay('2026-10-07', data);
    expect(yesterday).toMatchObject({ required: 1, expected: 1, successful: true });
    expect(yesterday.tasks[0]?.title).toBe('Прибрати кімнату');
    expect(buildDay(data.today, data)).toMatchObject({ status: 'EMPTY', expected: 0 });
  });

  it('shows legacy confirmations before tracking without inventing missed quests or streak', () => {
    const data = history({
      trackingFrom: '2026-10-08',
      schedules: [schedule({ effectiveFrom: '2026-10-08' })],
      completions: [completion('2026-10-06')],
    });
    expect(buildDay('2026-10-06', data)).toMatchObject({
      approved: 1,
      expected: 0,
      missed: 0,
      successful: false,
    });
    expect(buildDay('2026-10-07', data)).toMatchObject({ status: 'EMPTY', expected: 0 });
    expect(calculateStreak(data)).toEqual({ streak: 0, bestStreak: 0 });
  });

  it('starts expectations only when the child exists and inside inclusive dates', () => {
    const data = history({
      childCreatedDate: '2026-10-05',
      trackingFrom: '2026-10-05',
      schedules: [schedule({ startDate: '2026-10-04', endDate: '2026-10-07' })],
    });
    expect(buildDay('2026-10-04', data).expected).toBe(0);
    expect(buildDay('2026-10-05', data).expected).toBe(1);
    expect(buildDay('2026-10-07', data).expected).toBe(1);
    expect(buildDay('2026-10-08', data).expected).toBe(0);
  });

  it('stops expecting a one-off quest after an earlier confirmed completion', () => {
    const data = history({
      schedules: [schedule({ repeatDaily: false })],
      completions: [completion('2026-10-07')],
    });
    expect(buildDay('2026-10-07', data)).toMatchObject({
      expected: 1,
      approved: 1,
      successful: true,
    });
    expect(buildDay('2026-10-08', data)).toMatchObject({ expected: 0, status: 'EMPTY' });
  });

  it('keeps historical rejections after a one-off submission moves to another day', () => {
    const data = history({
      rejections: [{ taskId: 'task', date: '2026-10-07', title: 'Старий квест' }],
      completions: [completion('2026-10-08', { status: 'SUBMITTED' })],
    });
    expect(buildDay('2026-10-07', data).tasks[0]).toMatchObject({
      status: 'REJECTED',
      completionId: null,
    });
    expect(buildDay('2026-10-08', data).tasks[0]).toMatchObject({
      status: 'SUBMITTED',
      completionId: 'completion-2026-10-08',
    });
  });

  it('attributes earned points to the completion date and lets late approval restore a streak', () => {
    const data = history({
      completions: [completion('2026-10-07', { status: 'SUBMITTED' }), completion('2026-10-08')],
      earnedByDate: new Map([['2026-10-07', 10]]),
    });
    expect(calculateStreak(data).streak).toBe(1);
    data.completions[0]!.status = 'APPROVED';
    expect(calculateStreak(data).streak).toBe(2);
    expect(buildDay('2026-10-07', data).earnedPoints).toBe(10);
  });

  it('handles leap years including the first and last supported calendar years', () => {
    expect(monthDates('2024-02')).toHaveLength(29);
    expect(monthDates('2100-02')).toHaveLength(28);
    expect(monthDates('0001-01')[0]).toBe('0001-01-01');
    expect(monthDates('9999-12').at(-1)).toBe('9999-12-31');
  });

  it('rejects invalid, duplicate, or unknown calendar query inputs', () => {
    for (const month of ['0000-01', '2026-00', '2026-13', '2026-2', '2026-10-01']) {
      expect(calendarFilters.safeParse({ month }).success).toBe(false);
    }
    expect(calendarFilters.safeParse({ month: ['2026-10', '2026-11'] }).success).toBe(false);
    expect(calendarFilters.safeParse({ extra: 'value' }).success).toBe(false);
    expect(calendarFilters.safeParse({ month: '0001-01' }).success).toBe(true);
  });
});
