import { randomUUID } from 'node:crypto';
import { PrismaClient } from '@prisma/client';
import type { CompletionDto, TaskDto } from '@kidquest/types';
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
  jwtSecret: 'task-repeat-tests-only-secret-do-not-deploy',
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

afterEach(() => vi.restoreAllMocks());
afterAll(async () => {
  await db?.$disconnect();
});

async function fixture() {
  const clock = vi.spyOn(taskTime, 'familyClock');
  const day = (date: string, time = '12:00') => clock.mockReturnValue({ date, time });
  day('2026-10-22');
  const repository = new PrismaAuthRepository(db!);
  const parent = await repository.createFamilyWithParent(
    {
      email: `${randomUUID()}@task-repeat.test`,
      password: 'not-used-in-token-tests',
      firstName: 'Мама',
      familyName: 'Повторення квестів',
    },
    'unused-test-hash',
  );
  const addChild = async () => {
    const user = await repository.createMember(
      parent.familyId,
      {
        email: `${randomUUID()}@task-repeat.test`,
        password: 'not-used-in-token-tests',
        firstName: 'Богдан',
        role: 'CHILD',
      },
      'unused-test-hash',
    );
    return { ...user, token: sign(user.id) };
  };
  const child = await addChild();
  const app = createApp(repository, config, {
    database: db!,
    storagePath: '.local/test-task-repeat-storage',
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
  const get = (url: string, actor = child.token) =>
    request(app).get(`/api/v1${url}`).auth(actor, { type: 'bearer' });
  const category = await post('/task-categories').send({ name: 'Дім' }).expect(201);
  const input: TaskInput = {
    title: 'Застелити постіль',
    description: '',
    categoryId: category.body.data.id as string,
    icon: 'Bed',
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
  const submit = async (id: string, actor = child.token, operationId = randomUUID()) => {
    const result = await post(`/tasks/${id}/submit`, actor).send({ operationId }).expect(200);
    return result.body.data as CompletionDto;
  };
  const approve = (completion: CompletionDto) =>
    post(`/task-completions/${completion.id}/approve`).send({
      operationId: completion.operationId,
    });
  const reject = (completion: CompletionDto) =>
    post(`/task-completions/${completion.id}/reject`).send({
      operationId: completion.operationId,
      reason: 'Спробуй ще раз',
    });
  return {
    parent,
    parentToken,
    child,
    addChild,
    day,
    input,
    post,
    patch,
    get,
    task,
    submit,
    approve,
    reject,
  };
}

describe.skipIf(!db)('Daily and one-time quests through PostgreSQL HTTP', () => {
  it('defaults omitted repetition to daily, persists explicit values and preserves false on partial edits', async () => {
    const f = await fixture();
    expect((await f.task()).repeatDaily).toBe(true);
    const once = await f.task({ repeatDaily: false });
    expect(once.repeatDaily).toBe(false);
    const renamed = await f.patch(once.id).send({ title: 'Один раз' }).expect(200);
    expect(renamed.body.data.repeatDaily).toBe(false);
    const daily = await f.patch(once.id).send({ repeatDaily: true }).expect(200);
    expect(daily.body.data.repeatDaily).toBe(true);
    const restored = await f.patch(once.id).send({ repeatDaily: false }).expect(200);
    expect(restored.body.data.repeatDaily).toBe(false);
    for (const repeatDaily of ['true', 1, null]) {
      await f
        .post('/tasks')
        .send({ ...f.input, repeatDaily })
        .expect(400);
      await f.patch(once.id).send({ repeatDaily }).expect(400);
    }
    const stored = await db!.task.findUniqueOrThrow({ where: { id: once.id } });
    expect(stored.repeatDaily).toBe(false);
  });

  it('renews the same daily quest on the next family day and credits each daily completion once', async () => {
    const f = await fixture();
    const task = await f.task({ repeatDaily: true });
    const first = await f.submit(task.id);
    await f.approve(first).expect(200);
    await f.approve(first).expect(200);
    expect((await f.get('/statistics').expect(200)).body.data.today).toEqual({
      approved: 1,
      total: 1,
    });
    f.day('2026-10-23');
    const list = await f.get('/tasks').expect(200);
    expect(list.body.data).toHaveLength(1);
    expect(list.body.data[0].id).toBe(task.id);
    expect(list.body.data[0].todayCompletion).toBeNull();
    const second = await f.submit(task.id);
    expect(second.id).not.toBe(first.id);
    expect(second.completionDate).toBe('2026-10-23');
    await f.approve(second).expect(200);
    await f.approve(second).expect(200);
    expect((await f.get('/points').expect(200)).body.data.balance).toBe(20);
    expect(await db!.task.count({ where: { familyId: f.parent.familyId } })).toBe(1);
    expect(await db!.taskCompletion.count({ where: { taskId: task.id } })).toBe(2);
    expect(await db!.pointTransaction.count({ where: { familyId: f.parent.familyId } })).toBe(2);
  });

  it('allows a new daily submission while yesterday is still awaiting review', async () => {
    const f = await fixture();
    const task = await f.task({ repeatDaily: true });
    const first = await f.submit(task.id);
    f.day('2026-10-23');
    const second = await f.submit(task.id);
    expect(second.id).not.toBe(first.id);
    const pending = await f.get('/task-completions?status=SUBMITTED', f.parentToken).expect(200);
    expect(pending.body.data.map((entry: CompletionDto) => entry.id).sort()).toEqual(
      [first.id, second.id].sort(),
    );
    expect(
      (await f.get('/statistics', f.parentToken).expect(200)).body.data.counts.pendingCompletions,
    ).toBe(2);
    expect((await f.get('/points').expect(200)).body.data.balance).toBe(0);
  });

  it('keeps a one-time submission awaiting review across days and blocks further submissions', async () => {
    const f = await fixture();
    const task = await f.task({ repeatDaily: false });
    const first = await f.submit(task.id);
    f.day('2026-10-23');
    const list = await f.get('/tasks').expect(200);
    expect(list.body.data).toHaveLength(1);
    expect(list.body.data[0].todayCompletion.id).toBe(first.id);
    expect(list.body.data[0].todayCompletion.status).toBe('SUBMITTED');
    const blocked = await f
      .post(`/tasks/${task.id}/submit`, f.child.token)
      .send({ operationId: randomUUID() })
      .expect(409);
    expect(blocked.body.error.code).toBe('ALREADY_SUBMITTED');
    expect(await db!.taskCompletion.count({ where: { taskId: task.id } })).toBe(1);
    expect((await f.get('/statistics').expect(200)).body.data.today).toEqual({
      approved: 0,
      total: 1,
    });
  });

  it('resubmits a rejected one-time quest on a later day using the same review identity and rejects stale reviews', async () => {
    const f = await fixture();
    const task = await f.task({ repeatDaily: false });
    const first = await f.submit(task.id);
    await f.reject(first).expect(200);
    f.day('2026-10-23');
    const rejected = await f.get('/tasks').expect(200);
    expect(rejected.body.data[0].todayCompletion.status).toBe('REJECTED');
    const second = await f.submit(task.id);
    expect(second.id).toBe(first.id);
    expect(second.operationId).not.toBe(first.operationId);
    expect(second.completionDate).toBe('2026-10-23');
    expect((await f.approve(first).expect(409)).body.error.code).toBe('SUBMISSION_CHANGED');
    expect((await f.reject(first).expect(409)).body.error.code).toBe('SUBMISSION_CHANGED');
    await f.approve(second).expect(200);
    expect((await f.get('/points').expect(200)).body.data.balance).toBe(10);
    expect(await db!.taskCompletion.count({ where: { taskId: task.id } })).toBe(1);
  });

  it('shows an approved one-time quest as done today, then removes it from child tasks and progress tomorrow', async () => {
    const f = await fixture();
    const once = await f.task({ repeatDaily: false });
    const daily = await f.task({ repeatDaily: true });
    await f.approve(await f.submit(once.id)).expect(200);
    const today = await f.get('/tasks').expect(200);
    expect(
      today.body.data.find((entry: TaskDto) => entry.id === once.id)?.todayCompletion?.status,
    ).toBe('APPROVED');
    expect((await f.get('/statistics').expect(200)).body.data.today).toEqual({
      approved: 1,
      total: 2,
    });
    f.day('2026-10-23');
    const tomorrow = await f.get('/tasks').expect(200);
    expect(tomorrow.body.data.map((entry: TaskDto) => entry.id)).toEqual([daily.id]);
    const dashboard = await f.get('/statistics').expect(200);
    expect(dashboard.body.data.today).toEqual({ approved: 0, total: 1 });
    expect(dashboard.body.data.counts.activeTasks).toBe(1);
    expect(dashboard.body.data.tasks.map((entry: { id: string }) => entry.id)).toEqual([daily.id]);
    expect((await f.get('/tasks', f.parentToken).expect(200)).body.data).toHaveLength(2);
    const blocked = await f
      .post(`/tasks/${once.id}/submit`, f.child.token)
      .send({ operationId: randomUUID() })
      .expect(409);
    expect(blocked.body.error.code).toBe('ALREADY_SUBMITTED');
    expect((await f.get('/points').expect(200)).body.data.balance).toBe(10);
  });

  it('applies repetition edits to existing history without resetting or duplicating earned points', async () => {
    const f = await fixture();
    const task = await f.task({ repeatDaily: true });
    await f.approve(await f.submit(task.id)).expect(200);
    f.day('2026-10-23');
    await f.patch(task.id).send({ repeatDaily: false }).expect(200);
    expect((await f.get('/tasks').expect(200)).body.data).toHaveLength(0);
    const blocked = await f
      .post(`/tasks/${task.id}/submit`, f.child.token)
      .send({ operationId: randomUUID() })
      .expect(409);
    expect(blocked.body.error.code).toBe('ALREADY_SUBMITTED');
    await f.patch(task.id).send({ repeatDaily: true }).expect(200);
    expect((await f.get('/tasks').expect(200)).body.data[0].todayCompletion).toBeNull();
    await f.approve(await f.submit(task.id)).expect(200);
    expect((await f.get('/points').expect(200)).body.data.balance).toBe(20);
    expect(await db!.pointTransaction.count({ where: { familyId: f.parent.familyId } })).toBe(2);
    expect(await db!.taskCompletion.count({ where: { taskId: task.id } })).toBe(2);
  });

  it('preserves inclusive date bounds and daily time windows while renewing a quest', async () => {
    const f = await fixture();
    const task = await f.task({
      repeatDaily: true,
      startDate: '2026-10-22',
      endDate: '2026-10-23',
      startTime: '09:00',
      endTime: '18:00',
    });
    f.day('2026-10-21');
    expect(
      (
        await f
          .post(`/tasks/${task.id}/submit`, f.child.token)
          .send({ operationId: randomUUID() })
          .expect(409)
      ).body.error.code,
    ).toBe('TASK_OUTSIDE_DATES');
    f.day('2026-10-22', '09:00');
    await f.approve(await f.submit(task.id)).expect(200);
    f.day('2026-10-23', '08:59');
    expect(
      (
        await f
          .post(`/tasks/${task.id}/submit`, f.child.token)
          .send({ operationId: randomUUID() })
          .expect(409)
      ).body.error.code,
    ).toBe('TASK_OUTSIDE_TIME');
    f.day('2026-10-23', '18:00');
    await f.approve(await f.submit(task.id)).expect(200);
    f.day('2026-10-24');
    expect((await f.get('/tasks').expect(200)).body.data).toHaveLength(0);
    expect(
      (
        await f
          .post(`/tasks/${task.id}/submit`, f.child.token)
          .send({ operationId: randomUUID() })
          .expect(409)
      ).body.error.code,
    ).toBe('TASK_OUTSIDE_DATES');
    expect((await f.get('/points').expect(200)).body.data.balance).toBe(20);
  });

  it('serializes concurrent one-time submissions while allowing each child an independent completion', async () => {
    const f = await fixture();
    const otherChild = await f.addChild();
    const task = await f.task({ repeatDaily: false });
    const results = await Promise.all([
      f.post(`/tasks/${task.id}/submit`, f.child.token).send({ operationId: randomUUID() }),
      f.post(`/tasks/${task.id}/submit`, f.child.token).send({ operationId: randomUUID() }),
    ]);
    expect(results.map((result) => result.status).sort()).toEqual([200, 409]);
    expect(results.find((result) => result.status === 409)?.body.error.code).toBe(
      'ALREADY_SUBMITTED',
    );
    const first = results.find((result) => result.status === 200)!.body.data as CompletionDto;
    await f.approve(first).expect(200);
    f.day('2026-10-23');
    expect((await f.get('/tasks').expect(200)).body.data).toHaveLength(0);
    const otherTasks = await f.get('/tasks', otherChild.token).expect(200);
    expect(otherTasks.body.data[0].id).toBe(task.id);
    expect(otherTasks.body.data[0].todayCompletion).toBeNull();
    const second = await f.submit(task.id, otherChild.token);
    expect(second.id).not.toBe(first.id);
    await f.approve(second).expect(200);
    expect((await f.get('/points').expect(200)).body.data.balance).toBe(10);
    expect((await f.get('/points', otherChild.token).expect(200)).body.data.balance).toBe(10);
    expect(await db!.taskCompletion.count({ where: { taskId: task.id } })).toBe(2);
    expect(await db!.task.count({ where: { familyId: f.parent.familyId } })).toBe(1);
  });
});
