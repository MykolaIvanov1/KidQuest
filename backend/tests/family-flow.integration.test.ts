import { randomUUID } from 'node:crypto';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { PrismaClient } from '@prisma/client';
import dotenv from 'dotenv';
import request from 'supertest';
import sharp from 'sharp';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { createApp } from '../src/app.js';
import { PrismaAuthRepository } from '../src/modules/auth/auth.repository.js';

dotenv.config({ path: '../.local/test-db.env', quiet: true });
const database = process.env.DATABASE_TEST_URL
  ? new PrismaClient({ datasourceUrl: process.env.DATABASE_TEST_URL })
  : null;
const config = {
  jwtSecret: 'family-flow-test-secret-is-not-a-deployment-key',
  frontendUrl: 'http://localhost:5173',
  accessSeconds: 900,
  refreshDays: 30,
  production: false,
};
let storagePath = '';
beforeAll(async () => {
  storagePath = await mkdtemp(join(tmpdir(), 'kidquest-family-flow-'));
});
afterAll(async () => {
  await database?.$disconnect();
  if (storagePath) await rm(storagePath, { recursive: true, force: true });
});

describe.skipIf(!database)('Повний сімейний HTTP-сценарій', () => {
  it('зараховує бали після перевірки фото і списує їх лише один раз за видану нагороду', async () => {
    const app = createApp(new PrismaAuthRepository(database!), config, {
      database: database!,
      storagePath,
    });
    const password = 'OnlyForFamilyFlowTests!';
    const parent = await request(app)
      .post('/api/v1/auth/register')
      .set('Origin', config.frontendUrl)
      .send({
        email: `${randomUUID()}@kidquest.test`,
        password,
        firstName: 'Мама',
        familyName: 'Повний сценарій',
      })
      .expect(201);
    const parentToken = parent.body.data.accessToken as string;
    const childEmail = `${randomUUID()}@kidquest.test`;
    await request(app)
      .post('/api/v1/family/members')
      .set('Origin', config.frontendUrl)
      .auth(parentToken, { type: 'bearer' })
      .send({ email: childEmail, password, firstName: 'Богдан', role: 'CHILD' })
      .expect(201);
    const login = await request(app)
      .post('/api/v1/auth/login')
      .set('Origin', config.frontendUrl)
      .send({ email: childEmail, password })
      .expect(200);
    const childToken = login.body.data.accessToken as string;
    const category = await request(app)
      .post('/api/v1/task-categories')
      .set('Origin', config.frontendUrl)
      .auth(parentToken, { type: 'bearer' })
      .send({ name: 'Дім' })
      .expect(201);
    const task = await request(app)
      .post('/api/v1/tasks')
      .set('Origin', config.frontendUrl)
      .auth(parentToken, { type: 'bearer' })
      .send({
        title: 'Застелити постіль',
        description: 'Розправ ковдру',
        categoryId: category.body.data.id,
        icon: 'Bed',
        color: 'primary',
        points: 25,
        isRequired: true,
        photoRequired: true,
        startTime: null,
        endTime: null,
        isActive: true,
      })
      .expect(201);
    const reward = await request(app)
      .post('/api/v1/rewards')
      .set('Origin', config.frontendUrl)
      .auth(parentToken, { type: 'bearer' })
      .send({
        title: 'Час на планшеті',
        description: '15 хвилин',
        icon: 'Gift',
        imageUrl: null,
        cost: 20,
        type: 'SCREEN_TIME',
        isActive: true,
      })
      .expect(201);
    const image = await sharp({
      create: { width: 100, height: 80, channels: 3, background: '#7ab77a' },
    })
      .png()
      .toBuffer();
    const operationId = randomUUID();
    const submitted = await request(app)
      .post(`/api/v1/tasks/${task.body.data.id}/submit`)
      .set('Origin', config.frontendUrl)
      .auth(childToken, { type: 'bearer' })
      .field('operationId', operationId)
      .attach('photos', image, { filename: 'bed.png', contentType: 'image/png' })
      .expect(200);
    expect(submitted.body.data.status).toBe('SUBMITTED');
    const completionId = submitted.body.data.id as string;
    const beforeApproval = await request(app)
      .get('/api/v1/points')
      .auth(childToken, { type: 'bearer' })
      .expect(200);
    expect(beforeApproval.body.data.balance).toBe(0);
    await request(app)
      .get(`/api/v1/task-photos/${submitted.body.data.photos[0].id}`)
      .auth(parentToken, { type: 'bearer' })
      .expect('Content-Type', /image\/webp/)
      .expect(200);
    await request(app)
      .post(`/api/v1/task-completions/${completionId}/approve`)
      .set('Origin', config.frontendUrl)
      .auth(parentToken, { type: 'bearer' })
      .send({ operationId })
      .expect(200);
    await request(app)
      .post(`/api/v1/task-completions/${completionId}/approve`)
      .set('Origin', config.frontendUrl)
      .auth(parentToken, { type: 'bearer' })
      .send({ operationId })
      .expect(200);
    const earned = await request(app)
      .get('/api/v1/points')
      .auth(childToken, { type: 'bearer' })
      .expect(200);
    expect(earned.body.data.balance).toBe(25);
    const rewardOperation = randomUUID();
    const requested = await request(app)
      .post(`/api/v1/rewards/${reward.body.data.id}/request`)
      .set('Origin', config.frontendUrl)
      .auth(childToken, { type: 'bearer' })
      .send({ operationId: rewardOperation })
      .expect(201);
    expect(
      (await request(app).get('/api/v1/points').auth(childToken, { type: 'bearer' })).body.data
        .balance,
    ).toBe(25);
    const requestId = requested.body.data.id as string;
    await request(app)
      .post(`/api/v1/reward-requests/${requestId}/approve`)
      .set('Origin', config.frontendUrl)
      .auth(parentToken, { type: 'bearer' })
      .send({})
      .expect(200);
    await request(app)
      .post(`/api/v1/reward-requests/${requestId}/issue`)
      .set('Origin', config.frontendUrl)
      .auth(parentToken, { type: 'bearer' })
      .send({})
      .expect(200);
    await request(app)
      .post(`/api/v1/reward-requests/${requestId}/issue`)
      .set('Origin', config.frontendUrl)
      .auth(parentToken, { type: 'bearer' })
      .send({})
      .expect(200);
    const final = await request(app)
      .get('/api/v1/points')
      .auth(childToken, { type: 'bearer' })
      .expect(200);
    expect(final.body.data.balance).toBe(5);
    const history = await request(app)
      .get('/api/v1/points/history')
      .auth(childToken, { type: 'bearer' })
      .expect(200);
    expect(
      history.body.data
        .map((entry: { amount: number }) => entry.amount)
        .sort((a: number, b: number) => a - b),
    ).toEqual([-20, 25]);
    const dashboard = await request(app)
      .get('/api/v1/statistics')
      .auth(childToken, { type: 'bearer' })
      .expect(200);
    expect(dashboard.body.data.balance).toBe(5);
    expect(dashboard.body.data.today).toEqual({ approved: 1, total: 1 });
  }, 20_000);
});
