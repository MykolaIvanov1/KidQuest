import { randomUUID } from 'node:crypto';
import { readdir, rm } from 'node:fs/promises';
import path from 'node:path';
import { Prisma, PrismaClient } from '@prisma/client';
import type { CompletionDto, TaskDto } from '@kidquest/types';
import type { SubmitTaskInput } from '@kidquest/validation';
import jwt from 'jsonwebtoken';
import request from 'supertest';
import sharp from 'sharp';
import { afterAll, afterEach, describe, expect, it, vi } from 'vitest';
import { createApp } from '../src/app.js';
import { PrismaAuthRepository } from '../src/modules/auth/auth.repository.js';
import { CompletionService } from '../src/modules/task-completions/completion.service.js';
import { PhotoStorage } from '../src/modules/task-photos/photo.service.js';
import { dateColumn, familyClock } from '../src/modules/tasks/task-time.js';

// setup.ts only supplies the isolated integration database; never use DATABASE_URL here.
const db = process.env.DATABASE_TEST_URL
  ? new PrismaClient({ datasourceUrl: process.env.DATABASE_TEST_URL })
  : null;
const config = {
  jwtSecret: 'offline-submissions-integration-secret-only',
  frontendUrl: 'http://localhost:5173',
  accessSeconds: 900,
  refreshDays: 30,
  production: false,
};
const localRoot = path.resolve('../.local');
const storagePath = path.join(localRoot, `offline-submit-${randomUUID()}`);
const daysAgo = (days: number) => new Date(Date.now() - days * 86_400_000);
const sign = (id: string, ver = 0) =>
  jwt.sign({ ver }, config.jwtSecret, {
    subject: id,
    issuer: 'kidquest-api',
    audience: 'kidquest-web',
    expiresIn: 900,
  });

afterEach(() => vi.useRealTimers());
afterAll(async () => {
  await db?.$disconnect();
  if (!storagePath.startsWith(`${localRoot}${path.sep}`)) throw new Error('Unsafe cleanup path');
  await rm(storagePath, { force: true, recursive: true });
});

async function fixture(timeZone = 'Europe/Kyiv') {
  const createdAt = daysAgo(40);
  const family = await db!.family.create({
    data: { name: 'Офлайн сім’я', timeZone, createdAt },
  });
  const member = async (role: 'CHILD' | 'PARENT') => {
    const account = await db!.user.create({
      data: {
        familyId: family.id,
        email: `${randomUUID()}@offline-submissions.test`,
        firstName: role === 'CHILD' ? 'Богдан' : 'Мама',
        role,
        passwordHash: 'unused-test-hash',
        createdAt,
      },
    });
    if (role === 'CHILD')
      await db!.child.create({
        data: { familyId: family.id, userId: account.id, firstName: account.firstName, createdAt },
      });
    return (await new PrismaAuthRepository(db!).findById(account.id))!;
  };
  const parent = await member('PARENT');
  const child = await member('CHILD');
  const category = await db!.taskCategory.create({
    data: { familyId: family.id, name: 'Дім', createdAt },
  });
  const appFor = (database: PrismaClient) =>
    createApp(new PrismaAuthRepository(database), config, { database, storagePath });
  const app = appFor(db!);
  const post = (url: string, actor = child) =>
    request(app)
      .post(`/api/v1${url}`)
      .auth(sign(actor.id, actor.authVersion), { type: 'bearer' })
      .set('Origin', config.frontendUrl);
  const get = (url: string, actor = child) =>
    request(app).get(`/api/v1${url}`).auth(sign(actor.id, actor.authVersion), { type: 'bearer' });
  const task = async (changes: Partial<Prisma.TaskUncheckedCreateInput> = {}) => {
    const record = await db!.task.create({
      data: {
        familyId: family.id,
        categoryId: category.id,
        title: 'Щоденна справа',
        points: 12,
        isRequired: true,
        createdAt,
        updatedAt: createdAt,
        ...changes,
      },
    });
    await db!.taskScheduleVersion.create({
      data: {
        taskId: record.id,
        familyId: family.id,
        effectiveFrom: dateColumn(familyClock(timeZone, record.createdAt).date),
        title: record.title,
        isRequired: record.isRequired,
        repeatDaily: record.repeatDaily,
        isActive: record.isActive,
        startDate: record.startDate,
        endDate: record.endDate,
      },
    });
    return record;
  };
  const input = (record: { updatedAt: Date }, completedAt = daysAgo(3)): SubmitTaskInput => ({
    operationId: randomUUID(),
    completedAt: completedAt.toISOString(),
    taskVersion: record.updatedAt.toISOString(),
  });
  const submit = (taskId: string, body: SubmitTaskInput) =>
    post(`/tasks/${taskId}/submit`).send(body);
  const approve = (completion: CompletionDto) =>
    post(`/task-completions/${completion.id}/approve`, parent).send({
      operationId: completion.operationId,
    });
  const reject = (completion: CompletionDto) =>
    post(`/task-completions/${completion.id}/reject`, parent).send({
      operationId: completion.operationId,
      reason: 'Спробуй ще раз',
    });
  return {
    app,
    appFor,
    parent,
    child,
    family,
    category,
    member,
    post,
    get,
    task,
    input,
    submit,
    approve,
    reject,
  };
}

describe.skipIf(!db)('Offline completion sync on PostgreSQL HTTP', () => {
  it('strictly validates the paired timestamp/version fields and publishes a task version', async () => {
    const f = await fixture();
    const task = await f.task();
    const list = await f.get('/tasks').expect(200);
    expect((list.body.data as TaskDto[])[0]?.updatedAt).toBe(task.updatedAt.toISOString());
    const valid = f.input(task);
    for (const body of [
      { operationId: valid.operationId, completedAt: valid.completedAt },
      { operationId: valid.operationId, taskVersion: valid.taskVersion },
      { ...valid, completedAt: '2026-10-23T12:00:00' },
      { ...valid, completedAt: '2026-02-30T12:00:00Z' },
      { ...valid, taskVersion: 'invalid' },
      { ...valid, childId: f.child.childId },
    ])
      await f.post(`/tasks/${task.id}/submit`).send(body).expect(400);
    expect(await db!.taskCompletion.count({ where: { taskId: task.id } })).toBe(0);
  });

  it('accepts a late historical day without an age cutoff, then awards exactly once after review', async () => {
    const f = await fixture();
    const task = await f.task();
    const input = f.input(task, daysAgo(35));
    const response = await f.submit(task.id, input).expect(200);
    const completion = response.body.data as CompletionDto;
    expect(completion).toMatchObject({
      submittedAt: input.completedAt,
      completionDate: familyClock(f.family.timeZone, new Date(input.completedAt!)).date,
      status: 'SUBMITTED',
      pointsSnapshot: 12,
    });
    expect((await f.get('/points').expect(200)).body.data.balance).toBe(0);
    await f.submit(task.id, input).expect(200);
    await f.approve(completion).expect(200);
    await f.approve(completion).expect(200);
    const today = await f.submit(task.id, f.input(task, new Date())).expect(200);
    expect(today.body.data.id).not.toBe(completion.id);
    expect(await db!.pointTransaction.count({ where: { childId: f.child.childId! } })).toBe(1);
    expect((await f.get('/points').expect(200)).body.data.balance).toBe(12);
    const history = await f.get(`/task-completions?date=${completion.completionDate}`).expect(200);
    expect(history.body.data[0]?.id).toBe(completion.id);
    const calendar = await f
      .get(`/calendar?month=${completion.completionDate.slice(0, 7)}`)
      .expect(200);
    const day = calendar.body.data.days.find(
      (item: { date: string }) => item.date === completion.completionDate,
    );
    expect(day).toMatchObject({ approved: 1, earnedPoints: 12 });
    const audit = await db!.auditLog.findFirstOrThrow({
      where: { entityId: completion.id, action: 'TASK_SUBMITTED' },
    });
    expect(audit.metadata).toMatchObject({
      completedAt: input.completedAt,
      taskVersion: input.taskVersion,
      receivedAt: expect.any(String),
    });
  });

  it('uses the family date across UTC midnight and canonicalizes timestamp offsets', async () => {
    const f = await fixture('Pacific/Honolulu');
    const task = await f.task();
    const date = daysAgo(3).toISOString().slice(0, 10);
    const completedAt = `${date}T01:30:00.000Z`;
    const input = f.input(task, new Date(completedAt));
    const result = await f.submit(task.id, input).expect(200);
    expect(result.body.data.completionDate).toBe(
      familyClock(f.family.timeZone, new Date(completedAt)).date,
    );
    expect(result.body.data.completionDate).not.toBe(date);
    await f.submit(task.id, { ...input, completedAt: `${date}T04:30:00.000+03:00` }).expect(200);
    expect(await db!.taskCompletion.count({ where: { taskId: task.id } })).toBe(1);
  });

  it('rejects changed tasks but replays accepted operations after edit, deactivation and deletion', async () => {
    const f = await fixture();
    const task = await f.task();
    const input = f.input(task);
    const accepted = await f.submit(task.id, input).expect(200);
    await db!.task.update({ where: { id: task.id }, data: { points: 900, isActive: false } });
    const changed = await f.submit(task.id, { ...input, operationId: randomUUID() }).expect(409);
    expect(changed.body.error.code).toBe('TASK_CHANGED');
    expect((await f.submit(task.id, input).expect(200)).body.data.id).toBe(accepted.body.data.id);
    await db!.task.update({ where: { id: task.id }, data: { deletedAt: new Date() } });
    await db!.taskCategory.update({
      where: { id: f.category.id },
      data: { deletedAt: new Date() },
    });
    await f.submit(task.id, input).expect(200);
    expect(await db!.taskCompletion.count({ where: { taskId: task.id } })).toBe(1);
    expect(
      await db!.auditLog.count({
        where: { action: 'TASK_SUBMITTED', entityId: accepted.body.data.id as string },
      }),
    ).toBe(1);
  });

  it('rejects backdating a newly edited task version into an earlier day', async () => {
    const f = await fixture();
    const task = await f.task();
    const edited = await db!.task.update({ where: { id: task.id }, data: { points: 30 } });
    const result = await f.submit(task.id, f.input(edited, daysAgo(3))).expect(409);
    expect(result.body.error.code).toBe('TASK_CHANGED');
    expect(await db!.taskCompletion.count({ where: { taskId: task.id } })).toBe(0);
    await f.submit(task.id, f.input(edited, new Date())).expect(200);
  });

  it('binds replay to its task, child, timestamp and cached version', async () => {
    const f = await fixture();
    const task = await f.task();
    const another = await f.task();
    const input = f.input(task);
    await f.submit(task.id, input).expect(200);
    for (const [taskId, body] of [
      [task.id, { ...input, completedAt: daysAgo(2).toISOString() }],
      [task.id, { ...input, taskVersion: daysAgo(39).toISOString() }],
      [task.id, { operationId: input.operationId }],
      [another.id, input],
    ] as const) {
      const result = await f.submit(taskId, body).expect(409);
      expect(result.body.error.code).toBe('OPERATION_CONFLICT');
    }
    const otherChild = await f.member('CHILD');
    await f.post(`/tasks/${task.id}/submit`, otherChild).send(input).expect(409);
    const foreign = await fixture();
    const foreignTask = await foreign.task();
    await foreign.submit(foreignTask.id, input).expect(409);
    expect(await db!.taskCompletion.count({ where: { taskId: another.id } })).toBe(0);
  });

  it('rejects future instants and a next family day even within the clock-skew tolerance', async () => {
    vi.useFakeTimers({ toFake: ['Date'] });
    vi.setSystemTime(new Date('2026-10-23T20:59:50.000Z'));
    const f = await fixture();
    const task = await f.task();
    for (const completedAt of [new Date(Date.now() + 120_000), new Date(Date.now() + 20_000)]) {
      const result = await f.submit(task.id, f.input(task, completedAt)).expect(400);
      expect(result.body.error.code).toBe('INVALID_COMPLETED_AT');
    }
    vi.setSystemTime(new Date('2026-10-23T12:00:00.000Z'));
    await f.submit(task.id, f.input(task, new Date(Date.now() + 20_000))).expect(200);
  });

  it('rejects timestamps before either the task or child existed', async () => {
    const f = await fixture();
    const task = await f.task({ createdAt: daysAgo(1) });
    expect((await f.submit(task.id, f.input(task, daysAgo(2))).expect(400)).body.error.code).toBe(
      'INVALID_COMPLETED_AT',
    );
    const oldTask = await f.task();
    await db!.child.update({ where: { id: f.child.childId! }, data: { createdAt: daysAgo(1) } });
    expect(
      (await f.submit(oldTask.id, f.input(oldTask, daysAgo(2))).expect(400)).body.error.code,
    ).toBe('INVALID_COMPLETED_AT');
  });

  it('checks date and time restrictions at completion rather than receipt, and rejects inactive resources', async () => {
    const f = await fixture();
    const completedAt = daysAgo(3);
    const clock = familyClock(f.family.timeZone, completedAt);
    const task = await f.task({
      startDate: dateColumn(clock.date),
      endDate: dateColumn(clock.date),
      startTime: clock.time,
      endTime: clock.time,
    });
    await f.submit(task.id, f.input(task, completedAt)).expect(200);
    const outsideDate = await f.task({
      startDate: dateColumn(familyClock(f.family.timeZone, daysAgo(2)).date),
    });
    expect(
      (await f.submit(outsideDate.id, f.input(outsideDate, completedAt)).expect(409)).body.error
        .code,
    ).toBe('TASK_OUTSIDE_DATES');
    const outsideTime = await f.task(
      clock.time === '00:00' ? { startTime: '23:59' } : { endTime: '00:00' },
    );
    expect(
      (await f.submit(outsideTime.id, f.input(outsideTime, completedAt)).expect(409)).body.error
        .code,
    ).toBe('TASK_OUTSIDE_TIME');
    const inactive = await f.task({ isActive: false });
    expect((await f.submit(inactive.id, f.input(inactive)).expect(409)).body.error.code).toBe(
      'TASK_INACTIVE',
    );
    await db!.taskCategory.update({
      where: { id: f.category.id },
      data: { deletedAt: new Date() },
    });
    await f.submit(task.id, f.input(task)).expect(404);
  });

  it('syncs multipart photos once and cleans unused files from duplicate sync', async () => {
    const f = await fixture();
    const task = await f.task({ photoRequired: true });
    const input = f.input(task);
    await f.submit(task.id, input).expect(400);
    const photo = await sharp({
      create: { width: 3, height: 3, channels: 3, background: '#fafafa' },
    })
      .png()
      .toBuffer();
    const send = () =>
      f
        .post(`/tasks/${task.id}/submit`)
        .field('operationId', input.operationId)
        .field('completedAt', input.completedAt!)
        .field('taskVersion', input.taskVersion!)
        .attach('photos', photo, { filename: 'quest.png', contentType: 'image/png' });
    const first = await send().expect(200);
    const before = (await readdir(storagePath)).sort();
    await send().expect(200);
    expect((await readdir(storagePath)).sort()).toEqual(before);
    expect(
      await db!.taskPhoto.count({ where: { completionId: first.body.data.id as string } }),
    ).toBe(1);
    await f.get(first.body.data.photos[0].url.replace('/api/v1', '') as string).expect(200);
  });

  it('serializes concurrent duplicate sync into one completion and one notification per parent', async () => {
    const f = await fixture();
    const task = await f.task();
    const input = f.input(task);
    const results = await Promise.all([f.submit(task.id, input), f.submit(task.id, input)]);
    expect(results.map((result) => result.status)).toEqual([200, 200]);
    expect(results[0]!.body.data.id).toBe(results[1]!.body.data.id);
    expect(await db!.taskCompletion.count({ where: { taskId: task.id } })).toBe(1);
    expect(
      await db!.notification.count({
        where: { userId: f.parent.id, eventKey: `task-submission:${input.operationId}` },
      }),
    ).toBe(1);
  });

  it('does not overwrite a newer one-time rejection with an older queued attempt', async () => {
    const f = await fixture();
    const task = await f.task({ repeatDaily: false });
    const newer = await f.submit(task.id, f.input(task, daysAgo(1))).expect(200);
    await f.reject(newer.body.data as CompletionDto).expect(200);
    const result = await f.submit(task.id, f.input(task, daysAgo(3))).expect(409);
    expect(result.body.error.code).toBe('NEWER_SUBMISSION_EXISTS');
    expect(
      await db!.taskCompletion.findUniqueOrThrow({ where: { id: newer.body.data.id as string } }),
    ).toMatchObject({ status: 'REJECTED', operationId: newer.body.data.operationId });
  });

  it('does not replace a later attempt on the same day with an older queued operation', async () => {
    const f = await fixture();
    const newerAt = daysAgo(1);
    newerAt.setUTCHours(12, 0, 0, 0);
    const olderAt = new Date(newerAt.getTime() - 60_000);
    for (const repeatDaily of [false, true]) {
      const task = await f.task({ repeatDaily });
      const newer = await f.submit(task.id, f.input(task, newerAt)).expect(200);
      await f.reject(newer.body.data as CompletionDto).expect(200);
      const result = await f.submit(task.id, f.input(task, olderAt)).expect(409);
      expect(result.body.error.code).toBe('NEWER_SUBMISSION_EXISTS');
      expect(
        await db!.taskCompletion.findUniqueOrThrow({ where: { id: newer.body.data.id as string } }),
      ).toMatchObject({ status: 'REJECTED', operationId: newer.body.data.operationId });
    }
  });

  it('rejects old sessions and stale in-flight snapshots after a security change', async () => {
    const f = await fixture();
    const task = await f.task();
    await db!.user.update({ where: { id: f.child.id }, data: { authVersion: { increment: 1 } } });
    await f.submit(task.id, f.input(task)).expect(401);
    const service = new CompletionService(db!, new PhotoStorage(storagePath));
    await expect(service.submit(f.child, task.id, f.input(task), [])).rejects.toMatchObject({
      status: 401,
    });
    expect(await db!.taskCompletion.count({ where: { taskId: task.id } })).toBe(0);
  });

  it('refreshes an old transaction snapshot after waiting for an account-security lock', async () => {
    const f = await fixture();
    const task = await f.task();
    const applicationName = 'offline-submit-fence-' + randomUUID();
    const connectionUrl = new URL(process.env.DATABASE_TEST_URL!);
    connectionUrl.searchParams.set('application_name', applicationName);
    connectionUrl.searchParams.set('connection_limit', '1');
    const racing = new PrismaClient({ datasourceUrl: connectionUrl.toString() });
    let locked!: () => void;
    let release!: () => void;
    const lockedDone = new Promise<void>((resolve) => {
      locked = resolve;
    });
    const continueHolder = new Promise<void>((resolve) => {
      release = resolve;
    });
    const holder = db!.$transaction(
      async (tx) => {
        await tx.$queryRaw(
          Prisma.sql`SELECT "id" FROM "Family" WHERE "id" = ${f.family.id}::uuid FOR UPDATE`,
        );
        locked();
        await continueHolder;
        await tx.user.update({
          where: { id: f.child.id },
          data: { authVersion: { increment: 1 } },
        });
      },
      { timeout: 10_000 },
    );
    await lockedDone;
    const outcome = new CompletionService(racing, new PhotoStorage(storagePath))
      .submit(f.child, task.id, f.input(task), [])
      .then(
        () => null,
        (error: unknown) => error,
      );
    try {
      let waiting = false;
      for (let attempt = 0; attempt < 200; attempt += 1) {
        const states = await db!.$queryRaw<{ waiting: boolean }[]>(Prisma.sql`
          SELECT EXISTS(SELECT 1 FROM pg_stat_activity WHERE application_name = ${applicationName} AND wait_event_type = 'Lock') AS waiting
        `);
        if (states[0]?.waiting) {
          waiting = true;
          break;
        }
        await new Promise((resolve) => setTimeout(resolve, 10));
      }
      expect(waiting).toBe(true);
      release();
      await holder;
      expect(await outcome).toMatchObject({ status: 401 });
      expect(await db!.taskCompletion.count({ where: { taskId: task.id } })).toBe(0);
    } finally {
      release();
      await holder;
      await outcome;
      await racing.$disconnect();
    }
  });

  it('preserves atomicity when recording the offline audit fails', async () => {
    const f = await fixture();
    const task = await f.task();
    const failing = db!.$extends({
      query: {
        auditLog: {
          async create() {
            throw new Error('Test-only offline audit failure');
          },
        },
      },
    }) as unknown as PrismaClient;
    await request(f.appFor(failing))
      .post(`/api/v1/tasks/${task.id}/submit`)
      .auth(sign(f.child.id), { type: 'bearer' })
      .set('Origin', config.frontendUrl)
      .send(f.input(task))
      .expect(500);
    expect(await db!.taskCompletion.count({ where: { taskId: task.id } })).toBe(0);
    expect(await db!.notification.count({ where: { userId: f.parent.id } })).toBe(0);
  });
});
