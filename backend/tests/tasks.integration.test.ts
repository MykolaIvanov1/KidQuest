import { randomUUID } from 'node:crypto';
import { readdir, rm, unlink } from 'node:fs/promises';
import path from 'node:path';
import { PrismaClient } from '@prisma/client';
import dotenv from 'dotenv';
import jwt from 'jsonwebtoken';
import request from 'supertest';
import sharp from 'sharp';
import { afterAll, describe, expect, it } from 'vitest';
import type { TaskInput } from '@kidquest/validation';
import { createApp } from '../src/app.js';
import { PrismaAuthRepository } from '../src/modules/auth/auth.repository.js';
import type { AuthConfig } from '../src/modules/auth/auth.types.js';
import { familyClock } from '../src/modules/tasks/task-time.js';

dotenv.config({ path: '../.local/test-db.env', quiet: true });
const database = process.env.DATABASE_TEST_URL
  ? new PrismaClient({ datasourceUrl: process.env.DATABASE_TEST_URL })
  : null;
const localRoot = path.resolve('../.local');
const storagePath = path.resolve(localRoot, `task-test-uploads-${randomUUID()}`);
const config: AuthConfig = {
  jwtSecret: 'task-integration-only-secret-32characters',
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
    expiresIn: '15m',
  });

afterAll(async () => {
  await database?.$disconnect();
  if (!storagePath.startsWith(`${localRoot}${path.sep}`))
    throw new Error('Unsafe test cleanup path');
  await rm(storagePath, { recursive: true, force: true });
});

async function fixture() {
  const repository = new PrismaAuthRepository(database!);
  const parent = await repository.createFamilyWithParent(
    {
      email: `${randomUUID()}@tasks.test`,
      password: 'not-used-for-login',
      firstName: 'Мама',
      familyName: 'Тестова сім’я',
    },
    'unused-test-hash',
  );
  const childUser = await repository.createMember(
    parent.familyId,
    {
      email: `${randomUUID()}@tasks.test`,
      password: 'not-used-for-login',
      firstName: 'Богдан',
      role: 'CHILD',
    },
    'unused-test-hash',
  );
  const child = (await repository.findById(childUser.id))!;
  const app = createApp(repository, config, { database: database!, storagePath });
  const parentToken = sign(parent.id);
  const childToken = sign(child.id);
  const category = await request(app)
    .post('/api/v1/task-categories')
    .auth(parentToken, { type: 'bearer' })
    .set('Origin', config.frontendUrl)
    .send({ name: 'Дім' })
    .expect(201);
  const input: TaskInput = {
    title: 'Застелити постіль',
    description: 'Охайно скласти ковдру',
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
  const makeTask = async (overrides: Partial<typeof input> = {}) => {
    const result = await request(app)
      .post('/api/v1/tasks')
      .auth(parentToken, { type: 'bearer' })
      .set('Origin', config.frontendUrl)
      .send({ ...input, ...overrides })
      .expect(201);
    return result.body.data as { id: string };
  };
  return { app, parent, child, parentToken, childToken, input, makeTask };
}

describe('Family task calendar', () => {
  it('uses the family calendar day rather than UTC and never shifts a date column', () => {
    expect(familyClock('Europe/Kyiv', new Date('2026-10-21T21:30:00.000Z'))).toEqual({
      date: '2026-10-22',
      time: '00:30',
    });
    expect(familyClock('America/Los_Angeles', new Date('2026-10-21T01:30:00.000Z'))).toEqual({
      date: '2026-10-20',
      time: '18:30',
    });
  });
});

describe.skipIf(!database)('Tasks, submissions, reviews and private photos on PostgreSQL', () => {
  it('creates, edits and soft-deletes a task; child views exclude inactive tasks', async () => {
    const { app, parentToken, childToken, makeTask } = await fixture();
    const active = await makeTask();
    await makeTask({ title: 'Неактивний квест', isActive: false });
    const parentList = await request(app)
      .get('/api/v1/tasks')
      .auth(parentToken, { type: 'bearer' })
      .expect(200);
    const childList = await request(app)
      .get('/api/v1/tasks')
      .auth(childToken, { type: 'bearer' })
      .expect(200);
    expect(parentList.body.data).toHaveLength(2);
    expect(childList.body.data).toHaveLength(1);
    await request(app)
      .patch(`/api/v1/tasks/${active.id}`)
      .auth(parentToken, { type: 'bearer' })
      .set('Origin', config.frontendUrl)
      .send({ points: 15 })
      .expect(200);
    await request(app)
      .delete(`/api/v1/tasks/${active.id}`)
      .auth(parentToken, { type: 'bearer' })
      .set('Origin', config.frontendUrl)
      .expect(200);
    expect(
      (await database!.task.findUniqueOrThrow({ where: { id: active.id } })).deletedAt,
    ).not.toBeNull();
    const final = await request(app)
      .get('/api/v1/tasks')
      .auth(childToken, { type: 'bearer' })
      .expect(200);
    expect(final.body.data).toHaveLength(0);
  });

  it('enforces role permissions, strict inputs and category ownership', async () => {
    const own = await fixture();
    const other = await fixture();
    await request(own.app)
      .post('/api/v1/tasks')
      .auth(own.childToken, { type: 'bearer' })
      .set('Origin', config.frontendUrl)
      .send(own.input)
      .expect(403);
    await request(own.app)
      .post('/api/v1/task-categories')
      .auth(own.childToken, { type: 'bearer' })
      .set('Origin', config.frontendUrl)
      .send({ name: 'Чужа' })
      .expect(403);
    await request(own.app)
      .post('/api/v1/tasks')
      .auth(own.parentToken, { type: 'bearer' })
      .set('Origin', config.frontendUrl)
      .send({ ...own.input, familyId: other.parent.familyId })
      .expect(400);
    await request(own.app)
      .post('/api/v1/tasks')
      .auth(own.parentToken, { type: 'bearer' })
      .set('Origin', config.frontendUrl)
      .send({ ...own.input, categoryId: other.input.categoryId })
      .expect(404);
    await request(own.app)
      .post('/api/v1/tasks')
      .auth(own.parentToken, { type: 'bearer' })
      .set('Origin', config.frontendUrl)
      .send({ ...own.input, points: 0 })
      .expect(400);
    await request(own.app)
      .post('/api/v1/tasks')
      .auth(own.parentToken, { type: 'bearer' })
      .set('Origin', config.frontendUrl)
      .send({ ...own.input, startTime: '19:00', endTime: '09:00' })
      .expect(400);
  });

  it('submits only once daily, replays an operation safely and awards snapshot points only after approval', async () => {
    const { app, parent, child, parentToken, childToken, makeTask } = await fixture();
    const task = await makeTask();
    const operationId = randomUUID();
    const submitted = await request(app)
      .post(`/api/v1/tasks/${task.id}/submit`)
      .auth(childToken, { type: 'bearer' })
      .set('Origin', config.frontendUrl)
      .send({ operationId })
      .expect(200);
    const id = submitted.body.data.id as string;
    expect(submitted.body.data.status).toBe('SUBMITTED');
    expect(await database!.pointTransaction.count({ where: { childId: child.childId! } })).toBe(0);
    const duplicate = await request(app)
      .post(`/api/v1/tasks/${task.id}/submit`)
      .auth(childToken, { type: 'bearer' })
      .set('Origin', config.frontendUrl)
      .send({ operationId })
      .expect(200);
    expect(duplicate.body.data.id).toBe(id);
    await request(app)
      .post(`/api/v1/tasks/${task.id}/submit`)
      .auth(childToken, { type: 'bearer' })
      .set('Origin', config.frontendUrl)
      .send({ operationId: randomUUID() })
      .expect(409);
    await request(app)
      .patch(`/api/v1/tasks/${task.id}`)
      .auth(parentToken, { type: 'bearer' })
      .set('Origin', config.frontendUrl)
      .send({ points: 90 })
      .expect(200);
    await request(app)
      .post(`/api/v1/task-completions/${id}/approve`)
      .auth(childToken, { type: 'bearer' })
      .set('Origin', config.frontendUrl)
      .send({ operationId })
      .expect(403);
    const approvals = await Promise.all(
      [1, 2].map(() =>
        request(app)
          .post(`/api/v1/task-completions/${id}/approve`)
          .auth(parentToken, { type: 'bearer' })
          .set('Origin', config.frontendUrl)
          .send({ operationId }),
      ),
    );
    expect(approvals.map((result) => result.status)).toEqual([200, 200]);
    const ledger = await database!.pointTransaction.findMany({
      where: { familyId: parent.familyId, childId: child.childId! },
    });
    expect(ledger).toHaveLength(1);
    expect(ledger[0]!.amount).toBe(10);
    expect(ledger[0]!.type).toBe('TASK_REWARD');
    expect(
      await database!.auditLog.count({
        where: { familyId: parent.familyId, entityId: id, action: 'TASK_APPROVED' },
      }),
    ).toBe(1);
    const childTasks = await request(app)
      .get('/api/v1/tasks')
      .auth(childToken, { type: 'bearer' })
      .expect(200);
    expect(childTasks.body.data[0].todayCompletion.status).toBe('APPROVED');
    const history = await request(app)
      .get(`/api/v1/task-completions?status=APPROVED&date=${submitted.body.data.completionDate}`)
      .auth(childToken, { type: 'bearer' })
      .expect(200);
    expect(history.body.data).toHaveLength(1);
    await request(app)
      .get('/api/v1/task-completions?status=UNKNOWN')
      .auth(parentToken, { type: 'bearer' })
      .expect(400);
  });

  it('handles simultaneous duplicate submissions without duplicate daily completions', async () => {
    const { app, child, childToken, makeTask } = await fixture();
    const task = await makeTask();
    const operationId = randomUUID();
    const responses = await Promise.all(
      [1, 2].map(() =>
        request(app)
          .post(`/api/v1/tasks/${task.id}/submit`)
          .auth(childToken, { type: 'bearer' })
          .set('Origin', config.frontendUrl)
          .send({ operationId }),
      ),
    );
    expect(responses.map((result) => result.status)).toEqual([200, 200]);
    expect(responses[0]!.body.data.id).toBe(responses[1]!.body.data.id);
    expect(
      await database!.taskCompletion.count({ where: { taskId: task.id, childId: child.childId! } }),
    ).toBe(1);
  });

  it('supports rejection and corrected resubmission while preserving old operation history', async () => {
    const { app, parent, child, parentToken, childToken, makeTask } = await fixture();
    const task = await makeTask();
    const operationId = randomUUID();
    const submitted = await request(app)
      .post(`/api/v1/tasks/${task.id}/submit`)
      .auth(childToken, { type: 'bearer' })
      .set('Origin', config.frontendUrl)
      .send({ operationId })
      .expect(200);
    const id = submitted.body.data.id as string;
    await request(app)
      .post(`/api/v1/task-completions/${id}/reject`)
      .auth(parentToken, { type: 'bearer' })
      .set('Origin', config.frontendUrl)
      .send({ operationId, reason: 'Склади ковдру рівніше' })
      .expect(200);
    expect(await database!.pointTransaction.count({ where: { childId: child.childId! } })).toBe(0);
    const replay = await request(app)
      .post(`/api/v1/tasks/${task.id}/submit`)
      .auth(childToken, { type: 'bearer' })
      .set('Origin', config.frontendUrl)
      .send({ operationId })
      .expect(200);
    expect(replay.body.data.status).toBe('REJECTED');
    const corrected = await request(app)
      .post(`/api/v1/tasks/${task.id}/submit`)
      .auth(childToken, { type: 'bearer' })
      .set('Origin', config.frontendUrl)
      .send({ operationId: randomUUID() })
      .expect(200);
    expect(corrected.body.data.id).toBe(id);
    expect(corrected.body.data.status).toBe('SUBMITTED');
    expect(
      await database!.auditLog.count({
        where: { familyId: parent.familyId, action: 'TASK_SUBMITTED', entityId: id },
      }),
    ).toBe(2);
    await request(app)
      .post(`/api/v1/task-completions/${id}/approve`)
      .auth(parentToken, { type: 'bearer' })
      .set('Origin', config.frontendUrl)
      .send({ operationId: corrected.body.data.operationId })
      .expect(200);
    await request(app)
      .post(`/api/v1/task-completions/${id}/reject`)
      .auth(parentToken, { type: 'bearer' })
      .set('Origin', config.frontendUrl)
      .send({ operationId: corrected.body.data.operationId, reason: 'Пізно' })
      .expect(409);
  });

  it('guards corrected submissions from stale decisions by either parent and preserves same-version idempotency', async () => {
    const { app, parent, child, parentToken, childToken, makeTask } = await fixture();
    const secondParent = await new PrismaAuthRepository(database!).createMember(
      parent.familyId,
      {
        email: `${randomUUID()}@tasks.test`,
        password: 'not-used-for-login',
        firstName: 'Тато',
        role: 'PARENT',
      },
      'unused-test-hash',
    );
    const secondParentToken = sign(secondParent.id);
    const task = await makeTask();
    const originalOperationId = randomUUID();
    const submitted = await request(app)
      .post(`/api/v1/tasks/${task.id}/submit`)
      .auth(childToken, { type: 'bearer' })
      .set('Origin', config.frontendUrl)
      .send({ operationId: originalOperationId })
      .expect(200);
    const id = submitted.body.data.id as string;
    expect(submitted.body.data.operationId).toBe(originalOperationId);
    await request(app)
      .post(`/api/v1/task-completions/${id}/approve`)
      .auth(parentToken, { type: 'bearer' })
      .set('Origin', config.frontendUrl)
      .send({})
      .expect(400);
    await request(app)
      .post(`/api/v1/task-completions/${id}/approve`)
      .auth(parentToken, { type: 'bearer' })
      .set('Origin', config.frontendUrl)
      .send({ operationId: 'invalid' })
      .expect(400);
    const rejection = await request(app)
      .post(`/api/v1/task-completions/${id}/reject`)
      .auth(secondParentToken, { type: 'bearer' })
      .set('Origin', config.frontendUrl)
      .send({ operationId: originalOperationId, reason: 'Спробуй ще раз' })
      .expect(200);
    const repeatedRejection = await request(app)
      .post(`/api/v1/task-completions/${id}/reject`)
      .auth(secondParentToken, { type: 'bearer' })
      .set('Origin', config.frontendUrl)
      .send({ operationId: originalOperationId, reason: 'Спробуй ще раз' })
      .expect(200);
    expect(repeatedRejection.body.data.reviewedAt).toBe(rejection.body.data.reviewedAt);
    const correctedOperationId = randomUUID();
    await request(app)
      .post(`/api/v1/tasks/${task.id}/submit`)
      .auth(childToken, { type: 'bearer' })
      .set('Origin', config.frontendUrl)
      .send({ operationId: correctedOperationId })
      .expect(200);
    for (const [decision, actor] of [
      ['approve', parentToken],
      ['reject', secondParentToken],
    ] as const) {
      const stale = await request(app)
        .post(`/api/v1/task-completions/${id}/${decision}`)
        .auth(actor, { type: 'bearer' })
        .set('Origin', config.frontendUrl)
        .send({ operationId: originalOperationId })
        .expect(409);
      expect(stale.body.error.code).toBe('SUBMISSION_CHANGED');
    }
    const unchanged = await database!.taskCompletion.findUniqueOrThrow({ where: { id } });
    expect(unchanged.status).toBe('SUBMITTED');
    expect(unchanged.operationId).toBe(correctedOperationId);
    expect(await database!.pointTransaction.count({ where: { childId: child.childId! } })).toBe(0);
    await request(app)
      .post(`/api/v1/task-completions/${id}/approve`)
      .auth(parentToken, { type: 'bearer' })
      .set('Origin', config.frontendUrl)
      .send({ operationId: correctedOperationId })
      .expect(200);
    await request(app)
      .post(`/api/v1/task-completions/${id}/approve`)
      .auth(secondParentToken, { type: 'bearer' })
      .set('Origin', config.frontendUrl)
      .send({ operationId: correctedOperationId })
      .expect(200);
    const oldApproval = await request(app)
      .post(`/api/v1/task-completions/${id}/approve`)
      .auth(parentToken, { type: 'bearer' })
      .set('Origin', config.frontendUrl)
      .send({ operationId: originalOperationId })
      .expect(409);
    expect(oldApproval.body.error.code).toBe('SUBMISSION_CHANGED');
    expect(await database!.pointTransaction.count({ where: { childId: child.childId! } })).toBe(1);
    expect(
      await database!.auditLog.count({
        where: { familyId: parent.familyId, entityId: id, action: 'TASK_REJECTED' },
      }),
    ).toBe(1);
    expect(
      await database!.auditLog.count({
        where: { familyId: parent.familyId, entityId: id, action: 'TASK_APPROVED' },
      }),
    ).toBe(1);
  });

  it('hides tasks, completions and edits across families', async () => {
    const own = await fixture();
    const other = await fixture();
    const task = await own.makeTask();
    const submitted = await request(own.app)
      .post(`/api/v1/tasks/${task.id}/submit`)
      .auth(own.childToken, { type: 'bearer' })
      .set('Origin', config.frontendUrl)
      .send({ operationId: randomUUID() })
      .expect(200);
    await request(other.app)
      .patch(`/api/v1/tasks/${task.id}`)
      .auth(other.parentToken, { type: 'bearer' })
      .set('Origin', config.frontendUrl)
      .send({ title: 'Чужий' })
      .expect(404);
    await request(other.app)
      .post(`/api/v1/tasks/${task.id}/submit`)
      .auth(other.childToken, { type: 'bearer' })
      .set('Origin', config.frontendUrl)
      .send({ operationId: randomUUID() })
      .expect(404);
    await request(other.app)
      .post(`/api/v1/task-completions/${submitted.body.data.id}/approve`)
      .auth(other.parentToken, { type: 'bearer' })
      .set('Origin', config.frontendUrl)
      .send({ operationId: submitted.body.data.operationId })
      .expect(404);
    const list = await request(other.app)
      .get('/api/v1/task-completions')
      .auth(other.parentToken, { type: 'bearer' })
      .expect(200);
    expect(list.body.data).toHaveLength(0);
  });

  it('rolls back approval status if the database rejects the point credit', async () => {
    const { app, parent, child, parentToken, childToken, makeTask } = await fixture();
    const task = await makeTask();
    const submitted = await request(app)
      .post(`/api/v1/tasks/${task.id}/submit`)
      .auth(childToken, { type: 'bearer' })
      .set('Origin', config.frontendUrl)
      .send({ operationId: randomUUID() })
      .expect(200);
    const id = submitted.body.data.id as string;
    // Simulate incompatible legacy data: the ledger's positive-credit constraint must reject it.
    await database!.taskCompletion.update({ where: { id }, data: { pointsSnapshot: 0 } });
    await request(app)
      .post(`/api/v1/task-completions/${id}/approve`)
      .auth(parentToken, { type: 'bearer' })
      .set('Origin', config.frontendUrl)
      .send({ operationId: submitted.body.data.operationId })
      .expect(500);
    expect((await database!.taskCompletion.findUniqueOrThrow({ where: { id } })).status).toBe(
      'SUBMITTED',
    );
    expect(await database!.pointTransaction.count({ where: { childId: child.childId! } })).toBe(0);
    expect(
      await database!.auditLog.count({
        where: { familyId: parent.familyId, entityId: id, action: 'TASK_APPROVED' },
      }),
    ).toBe(0);
  });

  it('rejects missing required photos, false MIME declarations, corrupt images and oversized files', async () => {
    const { app, childToken, makeTask } = await fixture();
    const task = await makeTask({ photoRequired: true });
    const missing = await request(app)
      .post(`/api/v1/tasks/${task.id}/submit`)
      .auth(childToken, { type: 'bearer' })
      .set('Origin', config.frontendUrl)
      .send({ operationId: randomUUID() })
      .expect(400);
    expect(missing.body.error.code).toBe('PHOTO_REQUIRED');
    await request(app)
      .post(`/api/v1/tasks/${task.id}/submit`)
      .auth(childToken, { type: 'bearer' })
      .set('Origin', config.frontendUrl)
      .field('operationId', randomUUID())
      .attach('photos', Buffer.from('<svg/>'), {
        filename: 'image.svg',
        contentType: 'image/svg+xml',
      })
      .expect(400);
    await request(app)
      .post(`/api/v1/tasks/${task.id}/submit`)
      .auth(childToken, { type: 'bearer' })
      .set('Origin', config.frontendUrl)
      .field('operationId', randomUUID())
      .attach('photos', Buffer.from('not a photo'), {
        filename: 'image.jpg',
        contentType: 'image/jpeg',
      })
      .expect(400);
    const png = await sharp({ create: { width: 2, height: 2, channels: 3, background: '#55aabb' } })
      .png()
      .toBuffer();
    await request(app)
      .post(`/api/v1/tasks/${task.id}/submit`)
      .auth(childToken, { type: 'bearer' })
      .set('Origin', config.frontendUrl)
      .field('operationId', randomUUID())
      .attach('photos', png, { filename: 'wrong.jpg', contentType: 'image/jpeg' })
      .expect(400);
    await request(app)
      .post(`/api/v1/tasks/${task.id}/submit`)
      .auth(childToken, { type: 'bearer' })
      .set('Origin', config.frontendUrl)
      .field('operationId', randomUUID())
      .attach('photos', Buffer.alloc(5 * 1024 * 1024 + 1), {
        filename: 'large.jpg',
        contentType: 'image/jpeg',
      })
      .expect(413);
    expect(await database!.taskCompletion.count({ where: { taskId: task.id } })).toBe(0);
  });

  it('optimizes photos and allows only the owner child and same-family parents to read them', async () => {
    const own = await fixture();
    const other = await fixture();
    const task = await own.makeTask({ photoRequired: true });
    const photo = await sharp({
      create: { width: 2200, height: 1200, channels: 3, background: '#44aaff' },
    })
      .jpeg()
      .withMetadata()
      .toBuffer();
    const operationId = randomUUID();
    const submitted = await request(own.app)
      .post(`/api/v1/tasks/${task.id}/submit`)
      .auth(own.childToken, { type: 'bearer' })
      .set('Origin', config.frontendUrl)
      .field('operationId', operationId)
      .attach('photos', photo, { filename: '../../unsafe.jpg', contentType: 'image/jpeg' })
      .expect(200);
    const metadata = submitted.body.data.photos[0] as { id: string; url: string; mimeType: string };
    expect(metadata).not.toHaveProperty('storagePath');
    expect(metadata.mimeType).toBe('image/webp');
    await request(own.app).get(metadata.url).expect(401);
    await request(other.app)
      .get(metadata.url)
      .auth(other.parentToken, { type: 'bearer' })
      .expect(404);
    const sibling = await new PrismaAuthRepository(database!).createMember(
      own.parent.familyId,
      {
        email: `${randomUUID()}@tasks.test`,
        password: 'not-used-for-login',
        firstName: 'Марія',
        role: 'CHILD',
      },
      'unused-test-hash',
    );
    await request(own.app).get(metadata.url).auth(sign(sibling.id), { type: 'bearer' }).expect(404);
    await request(own.app).get(metadata.url).auth(own.childToken, { type: 'bearer' }).expect(200);
    const content = await request(own.app)
      .get(metadata.url)
      .auth(own.parentToken, { type: 'bearer' })
      .expect(200);
    const decoded = await sharp(content.body as Buffer).metadata();
    expect(decoded.format).toBe('webp');
    expect(decoded.width).toBe(1600);
    expect(decoded.exif).toBeUndefined();
    const filesBefore = (await readdir(storagePath)).length;
    await request(own.app)
      .post(`/api/v1/tasks/${task.id}/submit`)
      .auth(own.childToken, { type: 'bearer' })
      .set('Origin', config.frontendUrl)
      .field('operationId', operationId)
      .attach('photos', photo, { filename: 'again.jpg', contentType: 'image/jpeg' })
      .expect(200);
    expect((await readdir(storagePath)).length).toBe(filesBefore);
    await request(own.app)
      .post(`/api/v1/tasks/${randomUUID()}/submit`)
      .auth(own.childToken, { type: 'bearer' })
      .set('Origin', config.frontendUrl)
      .field('operationId', randomUUID())
      .attach('photos', photo, { filename: 'missing.jpg', contentType: 'image/jpeg' })
      .expect(404);
    expect((await readdir(storagePath)).length).toBe(filesBefore);
    await request(own.app)
      .post(`/api/v1/task-completions/${submitted.body.data.id}/reject`)
      .auth(own.parentToken, { type: 'bearer' })
      .set('Origin', config.frontendUrl)
      .send({ operationId: submitted.body.data.operationId, reason: 'Потрібно чіткіше фото' })
      .expect(200);
    const corrected = await request(own.app)
      .post(`/api/v1/tasks/${task.id}/submit`)
      .auth(own.childToken, { type: 'bearer' })
      .set('Origin', config.frontendUrl)
      .field('operationId', randomUUID())
      .attach('photos', photo, { filename: 'corrected.jpg', contentType: 'image/jpeg' })
      .expect(200);
    await request(own.app).get(metadata.url).auth(own.parentToken, { type: 'bearer' }).expect(404);
    const currentPhoto = corrected.body.data.photos[0] as { id: string; url: string };
    const stored = await database!.taskPhoto.findUniqueOrThrow({ where: { id: currentPhoto.id } });
    const missingPath = path.resolve(storagePath, stored.storagePath);
    if (!missingPath.startsWith(`${storagePath}${path.sep}`))
      throw new Error('Unsafe test photo path');
    await unlink(missingPath);
    await request(own.app)
      .get(currentPhoto.url)
      .auth(own.parentToken, { type: 'bearer' })
      .expect(404);
  });

  it('accepts five photos and rejects a sixth', async () => {
    const { app, childToken, makeTask } = await fixture();
    const task = await makeTask({ photoRequired: true });
    const photo = await sharp({
      create: { width: 2, height: 2, channels: 3, background: '#ee9900' },
    })
      .png()
      .toBuffer();
    let five = request(app)
      .post(`/api/v1/tasks/${task.id}/submit`)
      .auth(childToken, { type: 'bearer' })
      .set('Origin', config.frontendUrl)
      .field('operationId', randomUUID());
    for (let i = 0; i < 5; i += 1)
      five = five.attach('photos', photo, { filename: `${i}.png`, contentType: 'image/png' });
    const result = await five.expect(200);
    expect(result.body.data.photos).toHaveLength(5);
    const second = await makeTask();
    let six = request(app)
      .post(`/api/v1/tasks/${second.id}/submit`)
      .auth(childToken, { type: 'bearer' })
      .set('Origin', config.frontendUrl)
      .field('operationId', randomUUID());
    for (let i = 0; i < 6; i += 1)
      six = six.attach('photos', photo, { filename: `${i}.png`, contentType: 'image/png' });
    await six.expect(400);
  });

  it('enforces the family-local task time window and validates merged partial time updates', async () => {
    const { app, parent, childToken, parentToken, makeTask } = await fixture();
    const family = await database!.family.findUniqueOrThrow({ where: { id: parent.familyId } });
    const time = familyClock(family.timeZone).time;
    const outside =
      time === '00:00'
        ? { startTime: '23:59', endTime: null }
        : { startTime: null, endTime: '00:00' };
    const task = await makeTask(outside);
    const result = await request(app)
      .post(`/api/v1/tasks/${task.id}/submit`)
      .auth(childToken, { type: 'bearer' })
      .set('Origin', config.frontendUrl)
      .send({ operationId: randomUUID() })
      .expect(409);
    expect(result.body.error.code).toBe('TASK_OUTSIDE_TIME');
    await request(app)
      .patch(`/api/v1/tasks/${task.id}`)
      .auth(parentToken, { type: 'bearer' })
      .set('Origin', config.frontendUrl)
      .send({ startTime: '08:00', endTime: '20:00' })
      .expect(200);
    await request(app)
      .patch(`/api/v1/tasks/${task.id}`)
      .auth(parentToken, { type: 'bearer' })
      .set('Origin', config.frontendUrl)
      .send({ endTime: '07:00' })
      .expect(400);
  });
});
