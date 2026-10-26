import { randomUUID } from 'node:crypto';
import { PrismaClient } from '@prisma/client';
import type {
  AchievementsData,
  CalendarData,
  CompletionDto,
  ProgressData,
  TaskDto,
} from '@kidquest/types';
import type { TaskInput } from '@kidquest/validation';
import dotenv from 'dotenv';
import jwt from 'jsonwebtoken';
import request from 'supertest';
import { afterAll, afterEach, describe, expect, it, vi } from 'vitest';
import { createApp } from '../src/app.js';
import { PrismaAuthRepository } from '../src/modules/auth/auth.repository.js';
import * as taskTime from '../src/modules/tasks/task-time.js';

dotenv.config({ path: '../.local/test-db.env', quiet: true });
const db = process.env.DATABASE_TEST_URL
  ? new PrismaClient({ datasourceUrl: process.env.DATABASE_TEST_URL })
  : null;
const config = {
  jwtSecret: 'gamification-tests-only-secret-do-not-deploy',
  frontendUrl: 'http://localhost:5173',
  accessSeconds: 900,
  refreshDays: 30,
  production: false,
};
const sign = (id: string) =>
  jwt.sign({}, config.jwtSecret, {
    subject: id,
    issuer: 'kidquest-api',
    audience: 'kidquest-web',
    // Calendar tests advance Date across DST without faking database/network timers.
    expiresIn: '365d',
  });
const dayDate = (day: string) => new Date(`${day}T00:00:00.000Z`);
const dateAfter = (start: string, days: number) =>
  new Date(dayDate(start).getTime() + days * 86_400_000).toISOString().slice(0, 10);
const realFamilyClock = taskTime.familyClock;

afterEach(() => {
  vi.useRealTimers();
  vi.restoreAllMocks();
});
afterAll(async () => {
  await db?.$disconnect();
});

async function fixture(withChild = true) {
  const clock = vi.spyOn(taskTime, 'familyClock');
  const day = (date: string) =>
    clock.mockImplementation((timeZone, now) =>
      now ? realFamilyClock(timeZone, now) : { date, time: '12:00' },
    );
  day('2026-10-01');
  const repository = new PrismaAuthRepository(db!);
  const parent = await repository.createFamilyWithParent(
    {
      email: `${randomUUID()}@gamification.test`,
      password: 'unused-token-test-password',
      firstName: 'Мама',
      familyName: 'Історія пригод',
    },
    'unused-test-hash',
  );
  await db!.family.update({
    where: { id: parent.familyId },
    data: { createdAt: dayDate('2026-10-01') },
  });
  const addChild = async (createdOn = '2026-10-01') => {
    const user = await repository.createMember(
      parent.familyId,
      {
        email: `${randomUUID()}@gamification.test`,
        password: 'unused-token-test-password',
        firstName: 'Богдан',
        role: 'CHILD',
      },
      'unused-test-hash',
    );
    const profile = await db!.child.update({
      where: { userId: user.id },
      data: { createdAt: dayDate(createdOn) },
    });
    return { ...user, childId: profile.id, token: sign(user.id) };
  };
  const child = withChild ? await addChild() : null;
  const app = createApp(repository, config, {
    database: db!,
    storagePath: '.local/test-gamification-storage',
  });
  const parentToken = sign(parent.id);
  const post = (url: string, actor = parentToken) =>
    request(app)
      .post(`/api/v1${url}`)
      .auth(actor, { type: 'bearer' })
      .set('Origin', config.frontendUrl);
  const patch = (id: string) =>
    request(app)
      .patch(`/api/v1/tasks/${id}`)
      .auth(parentToken, { type: 'bearer' })
      .set('Origin', config.frontendUrl);
  const get = (url: string, actor = child?.token ?? parentToken) =>
    request(app).get(`/api/v1${url}`).auth(actor, { type: 'bearer' });
  const category = await post('/task-categories').send({ name: 'Щоденні справи' }).expect(201);
  const input: TaskInput = {
    title: 'Застелити постіль',
    description: '',
    categoryId: category.body.data.id as string,
    icon: 'Bed',
    color: 'primary',
    points: 10,
    isRequired: true,
    repeatDaily: true,
    photoRequired: false,
    startTime: null,
    endTime: null,
    isActive: true,
  };
  const task = async (changes: Partial<TaskInput> = {}) => {
    const result = await post('/tasks')
      .send({ ...input, ...changes })
      .expect(201);
    return result.body.data as TaskDto;
  };
  const submit = async (taskId: string, actor = child!.token) => {
    const result = await post(`/tasks/${taskId}/submit`, actor)
      .send({ operationId: randomUUID() })
      .expect(200);
    return result.body.data as CompletionDto;
  };
  const approve = (completion: CompletionDto) =>
    post(`/task-completions/${completion.id}/approve`).send({
      operationId: completion.operationId,
    });
  const reject = (completion: CompletionDto) =>
    post(`/task-completions/${completion.id}/reject`).send({
      operationId: completion.operationId,
      reason: 'Дороби, будь ласка',
    });
  const achievements = async (actor = child?.token ?? parentToken) =>
    (await get('/achievements', actor).expect(200)).body.data as AchievementsData;
  const calendar = async (month = '2026-10', actor = child?.token ?? parentToken) =>
    (await get(`/calendar?month=${month}`, actor).expect(200)).body.data as CalendarData;
  const progress = async () =>
    (await get('/statistics/progress?month=2026-10').expect(200)).body.data as ProgressData;
  const storedAwards = () =>
    db!.userAchievement.findMany({
      where: { userId: child!.id },
      include: { achievement: true },
      orderBy: { earnedAt: 'asc' },
    });
  const historical = async (taskId: string, dates: string[], points = 10) => {
    const rows = dates.map((date) => ({
      id: randomUUID(),
      familyId: parent.familyId,
      childId: child!.childId,
      taskId,
      completionDate: dayDate(date),
      status: 'APPROVED' as const,
      pointsSnapshot: points,
      operationId: randomUUID(),
      submittedAt: dayDate(date),
      reviewedAt: dayDate(date),
      reviewedById: parent.id,
    }));
    // Fixtures go exclusively to DATABASE_TEST_URL; the immutable ledger stays append-only.
    await db!.$transaction(async (tx) => {
      await tx.taskCompletion.createMany({ data: rows });
      await tx.pointTransaction.createMany({
        data: rows.map((row) => ({
          familyId: parent.familyId,
          childId: child!.childId,
          taskCompletionId: row.id,
          type: 'TASK_REWARD' as const,
          amount: points,
          description: 'Історичне підтвердження',
        })),
      });
    });
    return rows;
  };
  return {
    app,
    parent,
    parentToken,
    child,
    clock,
    day,
    addChild,
    post,
    patch,
    get,
    task,
    submit,
    approve,
    reject,
    achievements,
    calendar,
    progress,
    storedAwards,
    historical,
  };
}

describe.skipIf(!db)('Gamification, calendar and progress through PostgreSQL HTTP', () => {
  it('requires every required quest to be approved and gives no points for waiting or rejected work', async () => {
    const f = await fixture();
    const first = await f.task();
    const second = await f.task({ title: 'Винести сміття' });
    await f.task({ title: 'За бажанням', isRequired: false });
    await f.approve(await f.submit(first.id)).expect(200);
    const pending = await f.submit(second.id);
    expect((await f.achievements()).summary.streak).toBe(0);
    expect((await f.get('/points').expect(200)).body.data.balance).toBe(10);
    await f.reject(pending).expect(200);
    expect((await f.achievements()).summary).toMatchObject({
      approvedTasks: 1,
      earnedPoints: 10,
      streak: 0,
    });
    await f.approve(await f.submit(second.id)).expect(200);
    const summary = (await f.achievements()).summary;
    expect(summary).toMatchObject({ approvedTasks: 2, earnedPoints: 20, streak: 1, bestStreak: 1 });
    const today = (await f.calendar()).days.find((day) => day.date === '2026-10-01')!;
    expect(today).toMatchObject({ required: 2, expected: 3, approved: 2, successful: true });
  });

  it('awards a seven-day streak during approval exactly once even with concurrent review retries', async () => {
    const f = await fixture();
    const task = await f.task();
    for (let offset = 0; offset < 6; offset += 1) {
      f.day(dateAfter('2026-10-01', offset));
      await f.approve(await f.submit(task.id)).expect(200);
    }
    expect((await f.storedAwards()).some((award) => award.achievement.code === 'STREAK_7')).toBe(
      false,
    );
    f.day('2026-10-07');
    const seventh = await f.submit(task.id);
    const reviews = await Promise.all([f.approve(seventh), f.approve(seventh)]);
    expect(reviews.map((review) => review.status)).toEqual([200, 200]);
    const awardsBeforeRead = await f.storedAwards();
    expect(awardsBeforeRead.filter((award) => award.achievement.code === 'STREAK_7')).toHaveLength(
      1,
    );
    expect((await f.achievements()).summary).toMatchObject({ streak: 7, bestStreak: 7 });
    await f.achievements();
    expect(
      (await f.storedAwards()).filter((award) => award.achievement.code === 'STREAK_7'),
    ).toHaveLength(1);
    expect(await db!.pointTransaction.count({ where: { familyId: f.parent.familyId } })).toBe(7);
  });

  it('keeps yesterday’s streak while today is pending, breaks after a missed day and preserves the best', async () => {
    const f = await fixture();
    const task = await f.task();
    await f.historical(task.id, ['2026-10-01', '2026-10-02', '2026-10-03']);
    f.day('2026-10-04');
    expect((await f.achievements()).summary).toMatchObject({ streak: 3, bestStreak: 3 });
    f.day('2026-10-05');
    expect((await f.achievements()).summary).toMatchObject({ streak: 0, bestStreak: 3 });
    await f.approve(await f.submit(task.id)).expect(200);
    expect((await f.achievements()).summary).toMatchObject({ streak: 1, bestStreak: 3 });
  });

  it('restores historical streaks after late approval and assigns earned points to the completion day', async () => {
    const f = await fixture();
    const task = await f.task();
    await f.approve(await f.submit(task.id)).expect(200);
    f.day('2026-10-02');
    const late = await f.submit(task.id);
    f.day('2026-10-03');
    await f.approve(await f.submit(task.id)).expect(200);
    expect((await f.achievements()).summary.streak).toBe(1);
    await f.approve(late).expect(200);
    expect((await f.achievements()).summary).toMatchObject({ streak: 3, bestStreak: 3 });
    const progress = await f.progress();
    expect(progress.days.find((day) => day.date === '2026-10-02')).toMatchObject({
      approved: 1,
      earnedPoints: 10,
      successful: true,
    });
    expect(progress.summary.earnedPoints).toBe(30);
  });

  it('returns approved, submitted, rejected and missed history while leaving future days empty', async () => {
    const f = await fixture();
    const approved = await f.task();
    const rejected = await f.task({ title: 'Відхилений квест' });
    const waiting = await f.task({ title: 'Очікує перевірки' });
    await f.task({ title: 'Пропущений квест' });
    await f.approve(await f.submit(approved.id)).expect(200);
    await f.reject(await f.submit(rejected.id)).expect(200);
    await f.submit(waiting.id);
    f.day('2026-10-02');
    const calendar = await f.calendar();
    expect(calendar.days).toHaveLength(31);
    expect(calendar.days[0]).toMatchObject({
      date: '2026-10-01',
      status: 'PARTIAL',
      expected: 4,
      required: 4,
      approved: 1,
      submitted: 1,
      rejected: 1,
      missed: 1,
      earnedPoints: 10,
      successful: false,
    });
    expect(calendar.days[0]!.tasks.map((task) => task.status).sort()).toEqual([
      'APPROVED',
      'MISSED',
      'REJECTED',
      'SUBMITTED',
    ]);
    expect(calendar.days[1]).toMatchObject({ status: 'PENDING', expected: 4, missed: 0 });
    expect(calendar.days[2]).toMatchObject({
      status: 'FUTURE',
      expected: 0,
      required: 0,
      approved: 0,
      earnedPoints: 0,
      tasks: [],
    });
  });

  it('preserves historical task titles and required schedules after edits and soft deletion', async () => {
    const f = await fixture();
    const task = await f.task({ title: 'Ранкова справа' });
    await f.approve(await f.submit(task.id)).expect(200);
    f.day('2026-10-03');
    await f
      .patch(task.id)
      .send({ title: 'Нова назва', isRequired: false, isActive: false })
      .expect(200);
    f.day('2026-10-04');
    await request(f.app)
      .delete(`/api/v1/tasks/${task.id}`)
      .auth(f.parentToken, { type: 'bearer' })
      .set('Origin', config.frontendUrl)
      .expect(200);
    const calendar = await f.calendar();
    expect(calendar.days[0]!.tasks).toEqual([
      expect.objectContaining({
        taskId: task.id,
        title: 'Ранкова справа',
        isRequired: true,
        status: 'APPROVED',
      }),
    ]);
    expect(calendar.days[1]!.tasks).toEqual([
      expect.objectContaining({
        taskId: task.id,
        title: 'Ранкова справа',
        isRequired: true,
        status: 'MISSED',
      }),
    ]);
    expect(calendar.days[2]!.tasks).toEqual([]);
    expect(calendar.days[3]!.tasks).toEqual([]);
    expect((await f.achievements()).summary).toMatchObject({
      approvedTasks: 1,
      earnedPoints: 10,
      bestStreak: 1,
    });
  });

  it('uses inclusive schedule dates and stops expecting a one-time quest after its approved day', async () => {
    const f = await fixture();
    await f.task({ title: 'Дводенний квест', startDate: '2026-10-02', endDate: '2026-10-03' });
    const once = await f.task({ repeatDaily: false });
    await f.approve(await f.submit(once.id)).expect(200);
    f.day('2026-10-04');
    const calendar = await f.calendar();
    expect(calendar.days.slice(0, 4).map((day) => day.expected)).toEqual([1, 1, 1, 0]);
    expect(calendar.days.slice(0, 4).map((day) => day.required)).toEqual([1, 1, 1, 0]);
    expect(calendar.days[0]).toMatchObject({ successful: true, approved: 1 });
    expect(calendar.days[1]).toMatchObject({ status: 'MISSED', missed: 1 });
    expect(calendar.days[2]).toMatchObject({ status: 'MISSED', missed: 1 });
    expect(calendar.days[3]).toMatchObject({ status: 'EMPTY', tasks: [] });
  });

  it('retains a rejected one-time attempt in its original calendar day after resubmission moves its row', async () => {
    const f = await fixture();
    const task = await f.task({ repeatDaily: false });
    const rejected = await f.submit(task.id);
    await f.reject(rejected).expect(200);
    f.day('2026-10-02');
    const accepted = await f.submit(task.id);
    expect(accepted.id).toBe(rejected.id);
    await f.approve(accepted).expect(200);
    const calendar = await f.calendar();
    expect(calendar.days[0]).toMatchObject({
      approved: 0,
      rejected: 1,
      earnedPoints: 0,
      successful: false,
    });
    expect(calendar.days[0]!.tasks[0]).toMatchObject({ taskId: task.id, status: 'REJECTED' });
    expect(calendar.days[1]).toMatchObject({
      approved: 1,
      rejected: 0,
      earnedPoints: 10,
      successful: true,
    });
    expect((await f.achievements()).summary).toMatchObject({
      approvedTasks: 1,
      earnedPoints: 10,
      streak: 1,
    });
  });

  it('awards thirty approved tasks and lifetime point thresholds atomically with the threshold approval', async () => {
    const f = await fixture();
    const task = await f.task({ points: 471 });
    await f.historical(
      task.id,
      Array.from({ length: 29 }, (_, offset) => dateAfter('2026-10-01', offset)),
      1,
    );
    f.day('2026-10-30');
    await f.approve(await f.submit(task.id)).expect(200);
    const beforeRead = await f.storedAwards();
    expect(beforeRead.map((award) => award.achievement.code).sort()).toEqual([
      'POINTS_100',
      'POINTS_500',
      'STREAK_7',
      'TASKS_30',
    ]);
    const data = await f.achievements();
    expect(data.summary).toMatchObject({
      approvedTasks: 30,
      earnedPoints: 500,
      streak: 30,
      bestStreak: 30,
    });
    expect(data.achievements.every((achievement) => achievement.earnedAt !== null)).toBe(true);
    await f.achievements();
    expect(await f.storedAwards()).toHaveLength(4);
    expect((await f.get('/points').expect(200)).body.data.balance).toBe(500);
  });

  it('keeps earned point achievements after spending and ignores bonus credits toward task point achievements', async () => {
    const f = await fixture();
    await db!.pointTransaction.create({
      data: { familyId: f.parent.familyId, childId: f.child!.childId, type: 'BONUS', amount: 500 },
    });
    const before = await f.achievements();
    expect(before.summary.earnedPoints).toBe(0);
    expect(before.achievements.every((achievement) => achievement.earnedAt === null)).toBe(true);
    const task = await f.task({ points: 100 });
    await f.approve(await f.submit(task.id)).expect(200);
    const reward = await f
      .post('/rewards')
      .send({
        title: 'Прогулянка',
        description: '',
        icon: 'Gift',
        imageUrl: null,
        cost: 600,
        type: 'ACTIVITY',
        isActive: true,
      })
      .expect(201);
    const asked = await f
      .post(`/rewards/${reward.body.data.id}/request`, f.child!.token)
      .send({ operationId: randomUUID() })
      .expect(201);
    await f.post(`/reward-requests/${asked.body.data.id}/approve`).send({}).expect(200);
    expect((await f.get('/points').expect(200)).body.data.balance).toBe(0);
    const after = await f.achievements();
    expect(after.summary.earnedPoints).toBe(100);
    expect(
      after.achievements.find((achievement) => achievement.code === 'POINTS_100')!.earnedAt,
    ).not.toBeNull();
    expect(
      after.achievements.find((achievement) => achievement.code === 'POINTS_500')!.earnedAt,
    ).toBeNull();
  });

  it('ignores future completions in streaks, lifetime totals, awards and calendar projections', async () => {
    const f = await fixture();
    const task = await f.task({ points: 600 });
    await f.historical(task.id, ['2026-10-02'], 600);
    const before = await f.achievements();
    expect(before.summary).toMatchObject({
      approvedTasks: 0,
      earnedPoints: 0,
      streak: 0,
      bestStreak: 0,
    });
    expect(before.achievements.every((achievement) => achievement.earnedAt === null)).toBe(true);
    expect((await f.calendar()).days[1]).toMatchObject({
      status: 'FUTURE',
      tasks: [],
      expected: 0,
      approved: 0,
      earnedPoints: 0,
    });
    f.day('2026-10-02');
    const after = await f.achievements();
    expect(after.summary).toMatchObject({ approvedTasks: 1, earnedPoints: 600, streak: 1 });
    expect(
      after.achievements
        .filter((achievement) => achievement.earnedAt !== null)
        .map((achievement) => achievement.code)
        .sort(),
    ).toEqual(['POINTS_100', 'POINTS_500']);
  });

  it('starts required-day tracking when the child joins rather than marking earlier days missed', async () => {
    const f = await fixture(false);
    await f.task();
    const child = await f.addChild('2026-10-05');
    f.day('2026-10-06');
    const calendar = await f.calendar('2026-10', child.token);
    expect(calendar.trackingFrom).toBe('2026-10-05');
    expect(
      calendar.days.slice(0, 4).every((day) => day.status === 'EMPTY' && day.expected === 0),
    ).toBe(true);
    expect(calendar.days[4]).toMatchObject({ status: 'MISSED', expected: 1, required: 1 });
    expect(calendar.days[5]).toMatchObject({ status: 'PENDING', expected: 1, required: 1 });
  });

  it('scopes data to the authenticated child and validates parent child selections against the family', async () => {
    const f = await fixture();
    const secondChild = await f.addChild();
    const task = await f.task();
    await f.approve(await f.submit(task.id)).expect(200);
    const own = await f.achievements();
    const sibling = await f.achievements(secondChild.token);
    expect(own.summary).toMatchObject({
      childId: f.child!.childId,
      approvedTasks: 1,
      earnedPoints: 10,
    });
    expect(sibling.summary).toMatchObject({
      childId: secondChild.childId,
      approvedTasks: 0,
      earnedPoints: 0,
    });
    const parentResult = await f
      .get(`/achievements?childId=${secondChild.childId}`, f.parentToken)
      .expect(200);
    expect(parentResult.body.data.child.id).toBe(secondChild.childId);
    for (const path of [
      '/achievements',
      '/calendar?month=2026-10',
      '/statistics/progress?month=2026-10',
    ]) {
      const separator = path.includes('?') ? '&' : '?';
      const denied = await f.get(`${path}${separator}childId=${secondChild.childId}`);
      expect([403, 404]).toContain(denied.status);
      await f.get(`${path}${separator}childId=${randomUUID()}`, f.parentToken).expect(404);
    }
    const other = await fixture();
    await other.get(`/achievements?childId=${f.child!.childId}`, other.parentToken).expect(404);
  });

  it('requires authentication, validates query parameters and returns useful empty data before adding a child', async () => {
    const f = await fixture(false);
    for (const path of ['/achievements', '/calendar', '/statistics/progress']) {
      await request(f.app).get(`/api/v1${path}`).expect(401);
      await f.get(`${path}?childId=invalid-uuid`, f.parentToken).expect(400);
    }
    for (const path of ['/calendar', '/statistics/progress']) {
      for (const month of ['2026-2', '2026-00', '2026-13', 'not-a-month']) {
        await f.get(`${path}?month=${month}`, f.parentToken).expect(400);
      }
    }
    const data = await f.achievements(f.parentToken);
    expect(data.child).toBeNull();
    expect(data.summary).toMatchObject({
      childId: null,
      trackingFrom: null,
      streak: 0,
      approvedTasks: 0,
      earnedPoints: 0,
    });
    expect(data.achievements).toHaveLength(4);
    const calendar = await f.calendar('2026-10', f.parentToken);
    expect(calendar.child).toBeNull();
    expect(calendar.days).toHaveLength(31);
    expect(calendar.summary).toMatchObject({
      approved: 0,
      missed: 0,
      earnedPoints: 0,
      successfulDays: 0,
    });
  });

  it('uses family-local dates across UTC midnight and the daylight-saving clock change', async () => {
    const f = await fixture();
    const task = await f.task();
    f.clock.mockRestore();
    vi.useFakeTimers({ toFake: ['Date'] });
    vi.setSystemTime(new Date('2026-10-24T22:30:00.000Z'));
    const completion = await f.submit(task.id);
    expect(completion.completionDate).toBe('2026-10-25');
    await f.approve(completion).expect(200);
    vi.setSystemTime(new Date('2026-10-25T01:30:00.000Z'));
    const duplicate = await f
      .post(`/tasks/${task.id}/submit`, f.child!.token)
      .send({ operationId: randomUUID() })
      .expect(409);
    expect(duplicate.body.error.code).toBe('ALREADY_SUBMITTED');
    const data = await f.achievements();
    expect(data.summary).toMatchObject({
      today: '2026-10-25',
      timeZone: 'Europe/Kyiv',
      streak: 1,
      approvedTasks: 1,
    });
    const calendar = await f.calendar();
    expect(calendar.days[24]).toMatchObject({ date: '2026-10-25', approved: 1, successful: true });
    expect(calendar.days[25]).toMatchObject({ status: 'FUTURE', tasks: [] });
  });
});
