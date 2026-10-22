import { randomUUID } from 'node:crypto';
import { PrismaClient } from '@prisma/client';
import type { TaskDto } from '@kidquest/types';
import type { TaskInput } from '@kidquest/validation';
import dotenv from 'dotenv';
import jwt from 'jsonwebtoken';
import request from 'supertest';
import { afterAll, describe, expect, it } from 'vitest';
import { createApp } from '../src/app.js';
import { PrismaAuthRepository } from '../src/modules/auth/auth.repository.js';
import {
  dateColumn,
  dateOnly,
  familyClock,
  taskWithinDates,
} from '../src/modules/tasks/task-time.js';

dotenv.config({ path: '../.local/test-db.env', quiet: true });
const db = process.env.DATABASE_TEST_URL
  ? new PrismaClient({ datasourceUrl: process.env.DATABASE_TEST_URL })
  : null;
const config = {
  jwtSecret: 'task-date-tests-only-secret-do-not-deploy',
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
    expiresIn: 900,
  });
const nextDate = (date: string, days: number) =>
  new Date(dateColumn(date).getTime() + days * 86_400_000).toISOString().slice(0, 10);

afterAll(async () => {
  await db?.$disconnect();
});

async function fixture() {
  const repository = new PrismaAuthRepository(db!);
  const parent = await repository.createFamilyWithParent(
    {
      email: `${randomUUID()}@task-dates.test`,
      password: 'not-used-in-token-tests',
      firstName: 'Мама',
      familyName: 'Календар квестів',
    },
    'unused-test-hash',
  );
  const child = await repository.createMember(
    parent.familyId,
    {
      email: `${randomUUID()}@task-dates.test`,
      password: 'not-used-in-token-tests',
      firstName: 'Богдан',
      role: 'CHILD',
    },
    'unused-test-hash',
  );
  // Pick a zone whose current calendar day differs from UTC, without freezing DB timers.
  const timeZone = new Date().getUTCHours() < 10 ? 'Pacific/Honolulu' : 'Pacific/Kiritimati';
  await db!.family.update({ where: { id: parent.familyId }, data: { timeZone } });
  const today = familyClock(timeZone).date;
  const app = createApp(repository, config, {
    database: db!,
    storagePath: '.local/test-task-date-storage',
  });
  const parentToken = sign(parent.id);
  const childToken = sign(child.id);
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
  const get = (url: string, actor = childToken) =>
    request(app).get(`/api/v1${url}`).auth(actor, { type: 'bearer' });
  const category = await post('/task-categories').send({ name: 'Дім' }).expect(201);
  const input: TaskInput = {
    title: 'Щоденний квест',
    description: '',
    categoryId: category.body.data.id as string,
    icon: 'ListChecks',
    color: 'primary',
    points: 10,
    isRequired: true,
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
  return {
    app,
    parent,
    child,
    parentToken,
    childToken,
    today,
    timeZone,
    input,
    post,
    patch,
    get,
    task,
  };
}

describe('Date-only task boundaries', () => {
  it('keeps date values stable through DST changes and includes both boundaries', () => {
    const start = dateColumn('2026-03-29');
    expect(start.toISOString()).toBe('2026-03-29T00:00:00.000Z');
    expect(dateOnly(start)).toBe('2026-03-29');
    expect(dateOnly(null)).toBeNull();
    expect(taskWithinDates({ startDate: start, endDate: start }, '2026-03-29')).toBe(true);
    expect(taskWithinDates({ startDate: start, endDate: start }, '2026-03-28')).toBe(false);
    expect(taskWithinDates({ startDate: start, endDate: start }, '2026-03-30')).toBe(false);
    expect(taskWithinDates({ startDate: null, endDate: null }, '2026-03-29')).toBe(true);
  });
});

describe.skipIf(!db)('Family-local task date ranges through PostgreSQL HTTP', () => {
  it('shows all dates to parents, filters children inclusively and keeps dashboard totals consistent', async () => {
    const f = await fixture();
    expect(f.today).not.toBe(new Date().toISOString().slice(0, 10));
    const unrestricted = await f.task();
    const startsToday = await f.task({ title: 'Початок сьогодні', startDate: f.today });
    const endsToday = await f.task({ title: 'Кінець сьогодні', endDate: f.today });
    const oneDay = await f.task({ title: 'Один день', startDate: f.today, endDate: f.today });
    await f.task({ title: 'Ще не почався', startDate: nextDate(f.today, 1) });
    await f.task({ title: 'Уже завершився', endDate: nextDate(f.today, -1) });
    await f.task({ title: 'Вимкнений', startDate: f.today, endDate: f.today, isActive: false });
    expect(unrestricted.startDate).toBeNull();
    expect(unrestricted.endDate).toBeNull();
    expect(oneDay.startDate).toBe(f.today);
    expect(oneDay.endDate).toBe(f.today);
    const stored = await db!.task.findUniqueOrThrow({ where: { id: oneDay.id } });
    expect(stored.startDate?.toISOString()).toBe(`${f.today}T00:00:00.000Z`);
    const childTasks = await f.get('/tasks').expect(200);
    const activeIds = [unrestricted.id, startsToday.id, endsToday.id, oneDay.id].sort();
    expect(childTasks.body.data.map((task: TaskDto) => task.id).sort()).toEqual(activeIds);
    expect((await f.get('/tasks', f.parentToken).expect(200)).body.data).toHaveLength(7);
    for (const actor of [f.childToken, f.parentToken]) {
      const dashboard = await f.get('/statistics', actor).expect(200);
      expect(dashboard.body.data.counts.activeTasks).toBe(4);
      expect(dashboard.body.data.today).toEqual({ approved: 0, total: 4 });
      expect(dashboard.body.data.tasks.map((task: { id: string }) => task.id).sort()).toEqual(
        activeIds,
      );
    }
  });

  it('rejects submissions before and after the date range without creating completions', async () => {
    const f = await fixture();
    const future = await f.task({ startDate: nextDate(f.today, 1) });
    const expired = await f.task({ endDate: nextDate(f.today, -1) });
    for (const task of [future, expired]) {
      const result = await f
        .post(`/tasks/${task.id}/submit`, f.childToken)
        .send({ operationId: randomUUID() })
        .expect(409);
      expect(result.body.error.code).toBe('TASK_OUTSIDE_DATES');
      expect(await db!.taskCompletion.count({ where: { taskId: task.id } })).toBe(0);
    }
    expect((await f.get('/points').expect(200)).body.data.balance).toBe(0);
  });

  it('keeps old submissions reviewable after the task ends and replays their original operation safely', async () => {
    const f = await fixture();
    const task = await f.task({ startDate: f.today, endDate: f.today });
    const operationId = randomUUID();
    const submitted = await f
      .post(`/tasks/${task.id}/submit`, f.childToken)
      .send({ operationId })
      .expect(200);
    expect(submitted.body.data.completionDate).toBe(f.today);
    const completionId = submitted.body.data.id as string;
    await f
      .patch(task.id)
      .send({ startDate: null, endDate: nextDate(f.today, -1) })
      .expect(200);
    expect((await f.get('/tasks').expect(200)).body.data).toHaveLength(0);
    const pending = await f.get('/task-completions?status=SUBMITTED', f.parentToken).expect(200);
    expect(pending.body.data[0].id).toBe(completionId);
    const before = await f.get('/statistics', f.parentToken).expect(200);
    expect(before.body.data.counts.pendingCompletions).toBe(1);
    expect(before.body.data.today).toEqual({ approved: 0, total: 0 });
    await f.post(`/task-completions/${completionId}/approve`).send({ operationId }).expect(200);
    const replay = await f
      .post(`/tasks/${task.id}/submit`, f.childToken)
      .send({ operationId })
      .expect(200);
    expect(replay.body.data.id).toBe(completionId);
    expect(replay.body.data.status).toBe('APPROVED');
    await f
      .post(`/tasks/${task.id}/submit`, f.childToken)
      .send({ operationId: randomUUID() })
      .expect(409);
    const after = await f.get('/statistics').expect(200);
    expect(after.body.data.balance).toBe(10);
    expect(after.body.data.today).toEqual({ approved: 0, total: 0 });
  });

  it('validates merged PATCH bounds, preserves omitted dates and supports clearing either bound', async () => {
    const f = await fixture();
    const task = await f.task({ startDate: '2026-11-10', endDate: '2026-11-20' });
    for (const changes of [{ endDate: '2026-11-09' }, { startDate: '2026-11-21' }]) {
      const invalid = await f.patch(task.id).send(changes).expect(400);
      expect(invalid.body.error.code).toBe('INVALID_DATE_RANGE');
    }
    const preserved = await f.patch(task.id).send({ title: 'Нова назва' }).expect(200);
    expect(preserved.body.data.startDate).toBe('2026-11-10');
    expect(preserved.body.data.endDate).toBe('2026-11-20');
    const clearStart = await f.patch(task.id).send({ startDate: null }).expect(200);
    expect(clearStart.body.data.startDate).toBeNull();
    expect(clearStart.body.data.endDate).toBe('2026-11-20');
    const clearEnd = await f.patch(task.id).send({ endDate: null }).expect(200);
    expect(clearEnd.body.data.startDate).toBeNull();
    expect(clearEnd.body.data.endDate).toBeNull();
    await f
      .post('/tasks')
      .send({ ...f.input, startDate: '2026-11-21', endDate: '2026-11-20' })
      .expect(400);
    await f
      .post('/tasks')
      .send({ ...f.input, startDate: '2026-02-30' })
      .expect(400);
    await f
      .post('/tasks')
      .send({ ...f.input, endDate: '2026-10-22T00:00:00.000Z' })
      .expect(400);
  });

  it('preserves the daily time restriction within an otherwise valid date range', async () => {
    const f = await fixture();
    const clock = familyClock(f.timeZone);
    const outsideTime =
      clock.time === '00:00'
        ? { startTime: '23:59', endTime: null }
        : { startTime: null, endTime: '00:00' };
    const task = await f.task({ startDate: f.today, endDate: f.today, ...outsideTime });
    const result = await f
      .post(`/tasks/${task.id}/submit`, f.childToken)
      .send({ operationId: randomUUID() })
      .expect(409);
    expect(result.body.error.code).toBe('TASK_OUTSIDE_TIME');
  });
});
