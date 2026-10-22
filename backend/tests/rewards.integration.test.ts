import { randomBytes, randomUUID } from 'node:crypto';
import { PrismaClient } from '@prisma/client';
import bcrypt from 'bcrypt';
import dotenv from 'dotenv';
import jwt from 'jsonwebtoken';
import request from 'supertest';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { createApp } from '../src/app.js';
import { PrismaAuthRepository } from '../src/modules/auth/auth.repository.js';
import type { AuthConfig } from '../src/modules/auth/auth.types.js';

dotenv.config({ path: '../.local/test-db.env', quiet: true });
const db = process.env.DATABASE_TEST_URL
  ? new PrismaClient({ datasourceUrl: process.env.DATABASE_TEST_URL })
  : null;
const config: AuthConfig = {
  jwtSecret: randomBytes(32).toString('hex'),
  frontendUrl: 'http://localhost:5173',
  accessSeconds: 900,
  refreshDays: 30,
  production: false,
};
let passwordHash: string;
beforeAll(async () => {
  passwordHash = await bcrypt.hash(randomBytes(24).toString('hex'), 4);
});
afterAll(async () => {
  await db?.$disconnect();
});

const rewardInput = (cost = 30) => ({
  title: 'Сімейна прогулянка',
  description: 'Обери маршрут прогулянки.',
  icon: 'Gift',
  imageUrl: null,
  cost,
  type: 'ACTIVITY',
  isActive: true,
});
const token = (id: string) =>
  jwt.sign({}, config.jwtSecret, {
    subject: id,
    issuer: 'kidquest-api',
    audience: 'kidquest-web',
    expiresIn: 900,
  });

async function fixture(balance = 0) {
  const family = await db!.family.create({ data: { name: `Reward tests ${randomUUID()}` } });
  const parent = await db!.user.create({
    data: {
      familyId: family.id,
      email: `${randomUUID()}@rewards.invalid`,
      passwordHash,
      firstName: 'Батьки',
      role: 'PARENT',
    },
  });
  const childUser = await db!.user.create({
    data: {
      familyId: family.id,
      email: `${randomUUID()}@rewards.invalid`,
      passwordHash,
      firstName: 'Дитина',
      role: 'CHILD',
    },
  });
  const child = await db!.child.create({
    data: {
      familyId: family.id,
      userId: childUser.id,
      firstName: childUser.firstName,
    },
  });
  if (balance)
    await db!.pointTransaction.create({
      data: {
        familyId: family.id,
        childId: child.id,
        amount: balance,
        type: 'BONUS',
      },
    });
  const app = createApp(new PrismaAuthRepository(db!), config, {
    database: db!,
    storagePath: '.local/test-reward-storage',
  });
  const parentToken = token(parent.id);
  const childToken = token(childUser.id);
  const post = (path: string, actor = parentToken) =>
    request(app)
      .post(`/api/v1${path}`)
      .set('Origin', config.frontendUrl)
      .auth(actor, { type: 'bearer' });
  const patch = (path: string, actor = parentToken) =>
    request(app)
      .patch(`/api/v1${path}`)
      .set('Origin', config.frontendUrl)
      .auth(actor, { type: 'bearer' });
  const get = (path: string, actor = parentToken) =>
    request(app).get(`/api/v1${path}`).auth(actor, { type: 'bearer' });
  async function reward(cost = 30) {
    const response = await post('/rewards').send(rewardInput(cost)).expect(201);
    return response.body.data as { id: string; cost: number };
  }
  async function ask(rewardId: string, operationId = randomUUID()) {
    const response = await post(`/rewards/${rewardId}/request`, childToken)
      .send({ operationId })
      .expect(201);
    return response.body.data as { id: string; costSnapshot: number; operationId: string };
  }
  return {
    family,
    parent,
    child,
    childUser,
    app,
    parentToken,
    childToken,
    post,
    patch,
    get,
    reward,
    ask,
  };
}

describe.skipIf(!db)('Reward and point workflows through HTTP on PostgreSQL', () => {
  it('supports parent CRUD, validates input and uses soft delete', async () => {
    const f = await fixture();
    const reward = await f.reward();
    expect((await f.get('/rewards', f.childToken).expect(200)).body.data).toHaveLength(1);
    await f.patch(`/rewards/${reward.id}`).send({ cost: 55, isActive: false }).expect(200);
    expect((await f.get('/rewards', f.childToken).expect(200)).body.data).toHaveLength(0);
    expect((await f.get('/rewards').expect(200)).body.data[0].cost).toBe(55);
    await request(f.app)
      .delete(`/api/v1/rewards/${reward.id}`)
      .set('Origin', config.frontendUrl)
      .auth(f.parentToken, { type: 'bearer' })
      .expect(200);
    expect(
      (await db!.reward.findUniqueOrThrow({ where: { id: reward.id } })).deletedAt,
    ).not.toBeNull();
    expect((await f.get('/rewards').expect(200)).body.data).toHaveLength(0);
    await f.patch(`/rewards/${reward.id}`).send({ title: 'Повернути' }).expect(404);
    for (const cost of [0, -1, 1.5]) await f.post('/rewards').send(rewardInput(cost)).expect(400);
    await f
      .post('/rewards')
      .send({ ...rewardInput(), familyId: randomUUID() })
      .expect(400);
    await f.patch('/rewards/not-a-uuid').send({ title: 'Тест' }).expect(400);
  });

  it('enforces roles for reward creation, requests and reviews', async () => {
    const f = await fixture(100);
    const reward = await f.reward();
    await request(f.app).get('/api/v1/rewards').expect(401);
    await f.post('/rewards', f.childToken).send(rewardInput()).expect(403);
    await f.post(`/rewards/${reward.id}/request`).send({ operationId: randomUUID() }).expect(403);
    await f
      .post(`/rewards/${reward.id}/request`, f.childToken)
      .send({ operationId: randomUUID(), childId: randomUUID() })
      .expect(400);
    const pending = await f.ask(reward.id);
    for (const action of ['approve', 'reject', 'issue']) {
      await f.post(`/reward-requests/${pending.id}/${action}`, f.childToken).send({}).expect(403);
    }
  });

  it('keeps the requested cost snapshot, charges once at approval and issues without charging again', async () => {
    const f = await fixture(100);
    const reward = await f.reward(30);
    const pending = await f.ask(reward.id);
    expect(pending.costSnapshot).toBe(30);
    expect((await f.get('/points', f.childToken)).body.data.balance).toBe(100);
    await f.patch(`/rewards/${reward.id}`).send({ cost: 80 }).expect(200);
    const approved = await f.post(`/reward-requests/${pending.id}/approve`).send({}).expect(200);
    expect(approved.body.data.status).toBe('APPROVED');
    expect((await f.get('/points', f.childToken)).body.data.balance).toBe(70);
    await f.post(`/reward-requests/${pending.id}/approve`).send({}).expect(200);
    await f.post(`/reward-requests/${pending.id}/reject`).send({ reason: 'Ні' }).expect(409);
    await f.post(`/reward-requests/${pending.id}/issue`).send({}).expect(200);
    await f.post(`/reward-requests/${pending.id}/issue`).send({}).expect(200);
    await f.post(`/reward-requests/${pending.id}/approve`).send({}).expect(200);
    const charges = await db!.pointTransaction.findMany({ where: { rewardRequestId: pending.id } });
    expect(charges).toHaveLength(1);
    expect(charges[0]).toMatchObject({
      amount: -30,
      type: 'REWARD_PURCHASE',
      createdById: f.parent.id,
    });
    const history = await f.get('/points/history', f.childToken).expect(200);
    expect(history.body.data[0].amount).toBe(-30);
    expect(
      await db!.auditLog.count({
        where: { entityId: pending.id, action: 'REWARD_REQUEST_APPROVED' },
      }),
    ).toBe(1);
    expect(
      await db!.auditLog.count({ where: { entityId: pending.id, action: 'REWARD_ISSUED' } }),
    ).toBe(1);
  });

  it('rejects insufficient balance atomically and permits approval after points arrive', async () => {
    const f = await fixture(10);
    const reward = await f.reward(30);
    const pending = await f.ask(reward.id);
    const rejected = await f.post(`/reward-requests/${pending.id}/approve`).send({}).expect(409);
    expect(rejected.body.error.code).toBe('INSUFFICIENT_POINTS');
    expect((await db!.rewardRequest.findUniqueOrThrow({ where: { id: pending.id } })).status).toBe(
      'PENDING',
    );
    expect(await db!.pointTransaction.count({ where: { rewardRequestId: pending.id } })).toBe(0);
    await db!.pointTransaction.create({
      data: { familyId: f.family.id, childId: f.child.id, amount: 20, type: 'BONUS' },
    });
    await f.post(`/reward-requests/${pending.id}/approve`).send({}).expect(200);
    expect((await f.get('/points')).body.data.balance).toBe(0);
  });

  it('keeps a charged reward available until its approved request is issued', async () => {
    const f = await fixture(100);
    const reward = await f.reward(30);
    const pending = await f.ask(reward.id);
    await f.post(`/reward-requests/${pending.id}/approve`).send({}).expect(200);
    const remove = () =>
      request(f.app)
        .delete(`/api/v1/rewards/${reward.id}`)
        .set('Origin', config.frontendUrl)
        .auth(f.parentToken, { type: 'bearer' });
    const blocked = await remove().expect(409);
    expect(blocked.body.error).toMatchObject({
      code: 'REWARD_AWAITING_ISSUE',
      message: 'Спочатку видайте вже підтверджені нагороди.',
    });
    expect((await db!.reward.findUniqueOrThrow({ where: { id: reward.id } })).deletedAt).toBeNull();
    expect((await f.get('/reward-requests').expect(200)).body.data[0].id).toBe(pending.id);
    expect((await f.get('/points').expect(200)).body.data.balance).toBe(70);
    await f.post(`/reward-requests/${pending.id}/issue`).send({}).expect(200);
    await remove().expect(200);
    expect(
      (await db!.reward.findUniqueOrThrow({ where: { id: reward.id } })).deletedAt,
    ).not.toBeNull();
    expect((await f.get('/points').expect(200)).body.data.balance).toBe(70);
  });

  it('serializes reward deletion against approval without hiding a charged request', async () => {
    const f = await fixture(100);
    const reward = await f.reward(30);
    const pending = await f.ask(reward.id);
    const [approval, deletion] = await Promise.all([
      f.post(`/reward-requests/${pending.id}/approve`).send({}),
      request(f.app)
        .delete(`/api/v1/rewards/${reward.id}`)
        .set('Origin', config.frontendUrl)
        .auth(f.parentToken, { type: 'bearer' }),
    ]);
    const finalReward = await db!.reward.findUniqueOrThrow({ where: { id: reward.id } });
    const finalRequest = await db!.rewardRequest.findUniqueOrThrow({ where: { id: pending.id } });
    const charges = await db!.pointTransaction.count({ where: { rewardRequestId: pending.id } });
    if (finalReward.deletedAt) {
      expect(deletion.status).toBe(200);
      expect(approval.status).toBe(404);
      expect(finalRequest.status).toBe('PENDING');
      expect(charges).toBe(0);
      expect((await f.get('/points').expect(200)).body.data.balance).toBe(100);
    } else {
      expect(approval.status).toBe(200);
      expect(deletion.status).toBe(409);
      expect(deletion.body.error.code).toBe('REWARD_AWAITING_ISSUE');
      expect(finalRequest.status).toBe('APPROVED');
      expect(charges).toBe(1);
      expect((await f.get('/reward-requests').expect(200)).body.data[0].id).toBe(pending.id);
      await f.post(`/reward-requests/${pending.id}/issue`).send({}).expect(200);
      expect((await f.get('/points').expect(200)).body.data.balance).toBe(70);
    }
  });

  it('serializes concurrent approvals and prevents overspending across different requests', async () => {
    const f = await fixture(100);
    const reward = await f.reward(60);
    const first = await f.ask(reward.id);
    const second = await f.ask(reward.id);
    const responses = await Promise.all(
      [first, second].map((pending) => f.post(`/reward-requests/${pending.id}/approve`).send({})),
    );
    expect(responses.map((response) => response.status).sort()).toEqual([200, 409]);
    expect(responses.find((response) => response.status === 409)!.body.error.code).toBe(
      'INSUFFICIENT_POINTS',
    );
    expect((await f.get('/points')).body.data.balance).toBe(40);
    expect(
      await db!.pointTransaction.count({ where: { childId: f.child.id, type: 'REWARD_PURCHASE' } }),
    ).toBe(1);
  });

  it('makes concurrent approval and issuance of the same request idempotent', async () => {
    const f = await fixture(100);
    const reward = await f.reward(30);
    const pending = await f.ask(reward.id);
    const approvals = await Promise.all(
      [1, 2].map(() => f.post(`/reward-requests/${pending.id}/approve`).send({})),
    );
    expect(approvals.map((response) => response.status)).toEqual([200, 200]);
    const issued = await Promise.all(
      [1, 2].map(() => f.post(`/reward-requests/${pending.id}/issue`).send({})),
    );
    expect(issued.map((response) => response.status)).toEqual([200, 200]);
    expect((await f.get('/points')).body.data.balance).toBe(70);
    expect(await db!.pointTransaction.count({ where: { rewardRequestId: pending.id } })).toBe(1);
  });

  it('resolves concurrent approval versus rejection to one atomic decision', async () => {
    const f = await fixture(100);
    const reward = await f.reward(30);
    const pending = await f.ask(reward.id);
    const responses = await Promise.all([
      f.post(`/reward-requests/${pending.id}/approve`).send({}),
      f.post(`/reward-requests/${pending.id}/reject`).send({ reason: 'Пізніше' }),
    ]);
    expect(responses.map((response) => response.status).sort()).toEqual([200, 409]);
    const final = await db!.rewardRequest.findUniqueOrThrow({ where: { id: pending.id } });
    expect(['APPROVED', 'REJECTED']).toContain(final.status);
    const charged = final.status === 'APPROVED';
    expect(await db!.pointTransaction.count({ where: { rewardRequestId: pending.id } })).toBe(
      charged ? 1 : 0,
    );
    expect((await f.get('/points')).body.data.balance).toBe(charged ? 70 : 100);
  });

  it('replays an operation safely and rejects collisions with another reward or child', async () => {
    const f = await fixture();
    const first = await f.reward();
    const second = await f.reward();
    const operationId = randomUUID();
    const responses = await Promise.all(
      [1, 2].map(() => f.post(`/rewards/${first.id}/request`, f.childToken).send({ operationId })),
    );
    expect(responses.map((response) => response.status).sort()).toEqual([200, 201]);
    expect(responses[0]!.body.data.id).toBe(responses[1]!.body.data.id);
    await f.post(`/rewards/${second.id}/request`, f.childToken).send({ operationId }).expect(409);
    const other = await fixture();
    const otherReward = await other.reward();
    const collision = await other
      .post(`/rewards/${otherReward.id}/request`, other.childToken)
      .send({ operationId })
      .expect(409);
    expect(collision.body.error.code).toBe('OPERATION_CONFLICT');
    expect(collision.body).not.toHaveProperty('data');
  });

  it('requires approval before issue and rejects pending requests without changing points', async () => {
    const f = await fixture(100);
    const reward = await f.reward(30);
    const pending = await f.ask(reward.id);
    await f.post(`/reward-requests/${pending.id}/issue`).send({}).expect(409);
    const rejected = await f
      .post(`/reward-requests/${pending.id}/reject`)
      .send({ reason: 'Спробуймо завтра' })
      .expect(200);
    expect(rejected.body.data).toMatchObject({
      status: 'REJECTED',
      rejectionReason: 'Спробуймо завтра',
    });
    await f.post(`/reward-requests/${pending.id}/reject`).send({}).expect(200);
    await f.post(`/reward-requests/${pending.id}/approve`).send({}).expect(409);
    await f.post(`/reward-requests/${pending.id}/issue`).send({}).expect(409);
    expect((await f.get('/points')).body.data.balance).toBe(100);
  });

  it('isolates families for updates, reviews, queries and request lists', async () => {
    const own = await fixture(50);
    const other = await fixture(999);
    const reward = await own.reward();
    const pending = await own.ask(reward.id);
    await other.patch(`/rewards/${reward.id}`).send({ cost: 1 }).expect(404);
    await other
      .post(`/rewards/${reward.id}/request`, other.childToken)
      .send({ operationId: randomUUID() })
      .expect(404);
    for (const action of ['approve', 'reject', 'issue'])
      await other.post(`/reward-requests/${pending.id}/${action}`).send({}).expect(404);
    expect((await other.get('/reward-requests')).body.data).toHaveLength(0);
    await own.get(`/points?childId=${other.child.id}`).expect(404);
    await own.get(`/points/history?childId=${other.child.id}`).expect(404);
    await own.get(`/reward-requests?childId=${other.child.id}`).expect(404);
    expect((await own.get('/points')).body.data.balance).toBe(50);
  });

  it('scopes children individually and lets parents select only active family children', async () => {
    const f = await fixture(10);
    const siblingUser = await db!.user.create({
      data: {
        familyId: f.family.id,
        email: `${randomUUID()}@rewards.invalid`,
        passwordHash,
        firstName: 'Друга дитина',
        role: 'CHILD',
      },
    });
    const sibling = await db!.child.create({
      data: { familyId: f.family.id, userId: siblingUser.id, firstName: siblingUser.firstName },
    });
    await db!.pointTransaction.create({
      data: { familyId: f.family.id, childId: sibling.id, amount: 999, type: 'BONUS' },
    });
    expect((await f.get(`/points?childId=${sibling.id}`)).body.data.balance).toBe(999);
    expect((await f.get(`/points/history?childId=${sibling.id}`)).body.data[0].amount).toBe(999);
    expect((await f.get('/points')).body.data.childId).toBe(f.child.id);
    await f.get(`/points?childId=${sibling.id}`, f.childToken).expect(403);
    await f.get(`/points/history?childId=${sibling.id}`, f.childToken).expect(403);
    expect((await f.get('/points/history', f.childToken)).body.data[0].amount).toBe(10);
    await f.get(`/reward-requests?childId=${sibling.id}`, f.childToken).expect(403);
    const reward = await f.reward();
    await f
      .post(`/rewards/${reward.id}/request`, token(siblingUser.id))
      .send({ operationId: randomUUID() })
      .expect(201);
    expect((await f.get('/reward-requests', f.childToken)).body.data).toHaveLength(0);
    expect((await f.get('/reward-requests')).body.data).toHaveLength(1);
    await db!.user.update({ where: { id: siblingUser.id }, data: { isActive: false } });
    await f.get(`/points?childId=${sibling.id}`).expect(404);
    expect((await f.get('/reward-requests')).body.data).toHaveLength(0);
  });

  it('hides deleted rewards and nested requests and prevents inactive reward approval', async () => {
    const f = await fixture(100);
    const reward = await f.reward();
    const pending = await f.ask(reward.id);
    await f.patch(`/rewards/${reward.id}`).send({ isActive: false }).expect(200);
    await f
      .post(`/rewards/${reward.id}/request`, f.childToken)
      .send({ operationId: randomUUID() })
      .expect(409);
    await f.post(`/reward-requests/${pending.id}/approve`).send({}).expect(409);
    await request(f.app)
      .delete(`/api/v1/rewards/${reward.id}`)
      .set('Origin', config.frontendUrl)
      .auth(f.parentToken, { type: 'bearer' })
      .expect(200);
    expect((await f.get('/reward-requests')).body.data).toHaveLength(0);
    await f.post(`/reward-requests/${pending.id}/approve`).send({}).expect(404);
    await f
      .post(`/rewards/${reward.id}/request`, f.childToken)
      .send({ operationId: randomUUID() })
      .expect(404);
  });
});
