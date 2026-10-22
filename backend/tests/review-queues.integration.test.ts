import { randomUUID } from 'node:crypto';
import { PrismaClient } from '@prisma/client';
import dotenv from 'dotenv';
import jwt from 'jsonwebtoken';
import request from 'supertest';
import { afterAll, describe, expect, it } from 'vitest';
import { createApp } from '../src/app.js';
import { PrismaAuthRepository } from '../src/modules/auth/auth.repository.js';

dotenv.config({ path: '../.local/test-db.env', quiet: true });
const database = process.env.DATABASE_TEST_URL
  ? new PrismaClient({ datasourceUrl: process.env.DATABASE_TEST_URL })
  : null;
const config = {
  jwtSecret: randomUUID() + randomUUID(),
  frontendUrl: 'http://localhost:5173',
  accessSeconds: 900,
  refreshDays: 30,
  production: false,
};
afterAll(async () => {
  await database?.$disconnect();
});

describe.skipIf(!database)('Черги перевірки з великою історією', () => {
  it('відбирає невидані нагороди й неперевірені квести до застосування ліміту історії', async () => {
    const db = database!;
    const family = await db.family.create({ data: { name: 'Черга перевірки' } });
    const parent = await db.user.create({
      data: {
        familyId: family.id,
        email: `${randomUUID()}@queues.test`,
        passwordHash: 'unused-in-token-tests',
        firstName: 'Мама',
        role: 'PARENT',
      },
    });
    const account = await db.user.create({
      data: {
        familyId: family.id,
        email: `${randomUUID()}@queues.test`,
        passwordHash: 'unused-in-token-tests',
        firstName: 'Дитина',
        role: 'CHILD',
      },
    });
    const child = await db.child.create({
      data: { familyId: family.id, userId: account.id, firstName: account.firstName },
    });
    const category = await db.taskCategory.create({ data: { familyId: family.id, name: 'Дім' } });
    const task = await db.task.create({
      data: { familyId: family.id, categoryId: category.id, title: 'Старе виконання', points: 10 },
    });
    const oldCompletion = await db.taskCompletion.create({
      data: {
        familyId: family.id,
        childId: child.id,
        taskId: task.id,
        status: 'SUBMITTED',
        pointsSnapshot: 10,
        operationId: randomUUID(),
        completionDate: new Date('2024-01-01T00:00:00Z'),
      },
    });
    await db.taskCompletion.createMany({
      data: Array.from({ length: 101 }, (_, day) => ({
        familyId: family.id,
        childId: child.id,
        taskId: task.id,
        status: 'APPROVED' as const,
        pointsSnapshot: 10,
        operationId: randomUUID(),
        completionDate: new Date(Date.UTC(2025, 0, day + 1)),
      })),
    });
    const reward = await db.reward.create({
      data: { familyId: family.id, title: 'Сімейна прогулянка', cost: 10 },
    });
    const oldPending = await db.rewardRequest.create({
      data: {
        familyId: family.id,
        childId: child.id,
        rewardId: reward.id,
        costSnapshot: 10,
        operationId: randomUUID(),
        status: 'PENDING',
        createdAt: new Date('2024-01-01T00:00:00Z'),
      },
    });
    const oldApproved = await db.rewardRequest.create({
      data: {
        familyId: family.id,
        childId: child.id,
        rewardId: reward.id,
        costSnapshot: 10,
        operationId: randomUUID(),
        status: 'APPROVED',
        createdAt: new Date('2024-01-02T00:00:00Z'),
      },
    });
    await db.rewardRequest.createMany({
      data: Array.from({ length: 101 }, (_, day) => ({
        familyId: family.id,
        childId: child.id,
        rewardId: reward.id,
        costSnapshot: 10,
        operationId: randomUUID(),
        status: 'ISSUED' as const,
        createdAt: new Date(Date.UTC(2025, 0, day + 1)),
      })),
    });
    const token = jwt.sign({}, config.jwtSecret, {
      subject: parent.id,
      issuer: 'kidquest-api',
      audience: 'kidquest-web',
      expiresIn: 900,
    });
    const app = createApp(new PrismaAuthRepository(db), config, {
      database: db,
      storagePath: '.local/queue-test-photos',
    });
    const get = (path: string) =>
      request(app).get(`/api/v1${path}`).auth(token, { type: 'bearer' });
    expect((await get('/reward-requests').expect(200)).body.data).toHaveLength(100);
    const rewards = await get('/reward-requests?status=PENDING,APPROVED').expect(200);
    expect(rewards.body.data.map((entry: { id: string }) => entry.id).sort()).toEqual(
      [oldPending.id, oldApproved.id].sort(),
    );
    const completions = await get('/task-completions?status=SUBMITTED').expect(200);
    expect(completions.body.data.map((entry: { id: string }) => entry.id)).toEqual([
      oldCompletion.id,
    ]);
    await get('/reward-requests?status=UNRECOGNIZED').expect(400);
    await get('/reward-requests?status=PENDING,APPROVED&childId=not-an-id').expect(400);
  }, 15_000);
});
