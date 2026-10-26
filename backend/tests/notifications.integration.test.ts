import { randomUUID } from 'node:crypto';
import { PrismaClient } from '@prisma/client';
import type { CompletionDto, NotificationDto, NotificationsData, TaskDto } from '@kidquest/types';
import type { TaskInput } from '@kidquest/validation';
import dotenv from 'dotenv';
import jwt from 'jsonwebtoken';
import request from 'supertest';
import { afterAll, describe, expect, it } from 'vitest';
import { createApp } from '../src/app.js';
import { PrismaAuthRepository } from '../src/modules/auth/auth.repository.js';
import { NotificationDispatcher } from '../src/modules/notifications/notification.dispatcher.js';
import { enqueueNotification } from '../src/modules/notifications/notification.repository.js';
import type { PushMessage } from '../src/modules/notifications/notification.types.js';

dotenv.config({ path: '../.local/test-db.env', quiet: true });
const db = process.env.DATABASE_TEST_URL
  ? new PrismaClient({ datasourceUrl: process.env.DATABASE_TEST_URL })
  : null;
const config = {
  jwtSecret: 'notification-integration-tests-only-do-not-deploy',
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
afterAll(async () => {
  await db?.$disconnect();
});

async function fixture(balance = 0) {
  const family = await db!.family.create({ data: { name: 'Сповіщення тестової сім’ї' } });
  const member = async (role: 'PARENT' | 'CHILD', active = true, deleted = false) => {
    const user = await db!.user.create({
      data: {
        familyId: family.id,
        email: `${randomUUID()}@notifications.test`,
        passwordHash: 'unused-token-only-test-hash',
        firstName: role === 'CHILD' ? 'Богдан' : 'Батьки',
        role,
        isActive: active,
        deletedAt: deleted ? new Date() : null,
      },
    });
    const child =
      role === 'CHILD'
        ? await db!.child.create({
            data: { familyId: family.id, userId: user.id, firstName: user.firstName },
          })
        : null;
    return { ...user, childId: child?.id ?? null, token: sign(user.id) };
  };
  const parent = await member('PARENT');
  const secondParent = await member('PARENT');
  const child = await member('CHILD');
  if (balance)
    await db!.pointTransaction.create({
      data: { familyId: family.id, childId: child.childId!, type: 'BONUS', amount: balance },
    });
  const appFor = (client: PrismaClient) =>
    createApp(new PrismaAuthRepository(client), config, {
      database: client,
      storagePath: '.local/test-notifications-storage',
    });
  const app = appFor(db!);
  const post = (path: string, actor = parent.token) =>
    request(app)
      .post(`/api/v1${path}`)
      .auth(actor, { type: 'bearer' })
      .set('Origin', config.frontendUrl);
  const patch = (path: string, actor = parent.token) =>
    request(app)
      .patch(`/api/v1${path}`)
      .auth(actor, { type: 'bearer' })
      .set('Origin', config.frontendUrl);
  const remove = (path: string, actor = parent.token) =>
    request(app)
      .delete(`/api/v1${path}`)
      .auth(actor, { type: 'bearer' })
      .set('Origin', config.frontendUrl);
  const get = (path: string, actor = child.token) =>
    request(app).get(`/api/v1${path}`).auth(actor, { type: 'bearer' });
  const inbox = async (actor = child.token, query = '') =>
    (await get(`/notifications${query}`, actor).expect(200)).body.data as NotificationsData;
  const category = await db!.taskCategory.create({
    data: { familyId: family.id, name: 'Домашні справи' },
  });
  const input: TaskInput = {
    title: 'Застелити постіль',
    description: '',
    categoryId: category.id,
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
  const task = async (changes: Partial<TaskInput> = {}) =>
    (
      await post('/tasks')
        .send({ ...input, ...changes })
        .expect(201)
    ).body.data as TaskDto;
  const submit = async (taskId: string, operationId = randomUUID()) =>
    (await post(`/tasks/${taskId}/submit`, child.token).send({ operationId }).expect(200)).body
      .data as CompletionDto;
  const review = (completion: CompletionDto, action: 'approve' | 'reject' = 'approve') =>
    post(`/task-completions/${completion.id}/${action}`).send({
      operationId: completion.operationId,
      ...(action === 'reject' ? { reason: 'Дороби, будь ласка' } : {}),
    });
  const seedNotice = (userId = child.id, changes: { createdAt?: Date; deletedAt?: Date } = {}) =>
    db!.notification.create({
      data: {
        userId,
        type: 'SYSTEM',
        title: 'Тестове повідомлення',
        body: 'Без приватних ключів і токенів.',
        data: { path: '/child' },
        ...changes,
      },
    });
  const reward = async (cost = 30) =>
    (
      await post('/rewards')
        .send({
          title: 'Прогулянка',
          description: '',
          icon: 'Gift',
          imageUrl: null,
          type: 'ACTIVITY',
          cost,
          isActive: true,
        })
        .expect(201)
    ).body.data as { id: string };
  const ask = async (rewardId: string, operationId = randomUUID()) =>
    (await post(`/rewards/${rewardId}/request`, child.token).send({ operationId }).expect(201)).body
      .data as { id: string; operationId: string };
  return {
    family,
    parent,
    secondParent,
    child,
    member,
    app,
    appFor,
    post,
    patch,
    remove,
    get,
    inbox,
    task,
    submit,
    review,
    seedNotice,
    reward,
    ask,
  };
}

describe.skipIf(!db)('Notifications and device bindings through PostgreSQL HTTP', () => {
  it('requires authentication and the configured browser origin for mutations', async () => {
    const f = await fixture();
    for (const path of ['/notifications', '/notifications/status'])
      await request(f.app).get(`/api/v1${path}`).expect(401);
    await request(f.app)
      .post('/api/v1/devices')
      .set('Origin', config.frontendUrl)
      .send({})
      .expect(401);
    await request(f.app)
      .patch(`/api/v1/notifications/${randomUUID()}/read`)
      .set('Origin', config.frontendUrl)
      .send({})
      .expect(401);
    await request(f.app)
      .post('/api/v1/notifications/read-all')
      .set('Origin', config.frontendUrl)
      .send({})
      .expect(401);
    await request(f.app)
      .delete(`/api/v1/devices/${randomUUID()}`)
      .set('Origin', config.frontendUrl)
      .expect(401);
    await request(f.app)
      .post('/api/v1/devices')
      .auth(f.child.token, { type: 'bearer' })
      .send({ token: `test-device-${randomUUID()}` })
      .expect(403);
    expect((await f.get('/notifications/status').expect(200)).body.data).toEqual({
      pushConfigured: false,
    });
  });

  it('returns only the signed-in user’s inbox and hides deleted notices and transport fields', async () => {
    const f = await fixture();
    const other = await fixture();
    const own = await f.seedNotice();
    await f.seedNotice(f.parent.id);
    await f.seedNotice(f.secondParent.id);
    await f.seedNotice(other.child.id);
    await f.seedNotice(f.child.id, { deletedAt: new Date() });
    const data = await f.inbox();
    expect(data.unreadCount).toBe(1);
    expect(data.items).toHaveLength(1);
    expect(data.items[0]).toEqual({
      id: own.id,
      type: own.type,
      title: own.title,
      body: own.body,
      path: '/child',
      readAt: null,
      createdAt: own.createdAt.toISOString(),
    });
    expect(data.nextCursor).toBeNull();
    expect((await f.inbox(f.parent.token)).items).toHaveLength(1);
  });

  it('marks individual notices and all unread notices once without changing another inbox', async () => {
    const f = await fixture();
    const first = await f.seedNotice();
    const second = await f.seedNotice();
    await f.seedNotice(f.parent.id);
    const read = (
      await f.patch(`/notifications/${first.id}/read`, f.child.token).send({}).expect(200)
    ).body.data as NotificationDto;
    expect(read.readAt).toEqual(expect.any(String));
    const replay = await f
      .patch(`/notifications/${first.id}/read`, f.child.token)
      .send({})
      .expect(200);
    expect(replay.body.data.readAt).toBe(read.readAt);
    expect((await f.inbox()).unreadCount).toBe(1);
    expect(
      (await f.post('/notifications/read-all', f.child.token).send({}).expect(200)).body.data,
    ).toEqual({ updated: 1 });
    expect(
      (await f.post('/notifications/read-all', f.child.token).send({}).expect(200)).body.data,
    ).toEqual({ updated: 0 });
    expect((await f.inbox()).unreadCount).toBe(0);
    expect((await f.inbox(f.parent.token)).unreadCount).toBe(1);
    expect(
      (await db!.notification.findUniqueOrThrow({ where: { id: second.id } })).readAt,
    ).not.toBeNull();
  });

  it('rejects foreign, deleted and missing notice IDs even within the same family', async () => {
    const f = await fixture();
    const other = await fixture();
    const sibling = await f.member('CHILD');
    const hidden = await f.seedNotice(f.child.id, { deletedAt: new Date() });
    const foreign = await Promise.all([
      f.seedNotice(f.parent.id),
      f.seedNotice(sibling.id),
      other.seedNotice(),
    ]);
    for (const id of [...foreign.map((row) => row.id), hidden.id, randomUUID()]) {
      await f.patch(`/notifications/${id}/read`, f.child.token).send({}).expect(404);
      await f.get(`/notifications?cursor=${id}`).expect(404);
    }
    await f.patch('/notifications/not-a-uuid/read', f.child.token).send({}).expect(400);
  });

  it('paginates a stable order including identical timestamps and counts unread beyond the current page', async () => {
    const f = await fixture();
    const sameTime = new Date('2026-10-01T10:00:00Z');
    const notices = [];
    for (let index = 0; index < 5; index += 1)
      notices.push(await f.seedNotice(f.child.id, { createdAt: sameTime }));
    await f.seedNotice(f.child.id, { createdAt: sameTime, deletedAt: new Date() });
    const expected = notices
      .map((row) => row.id)
      .sort()
      .reverse();
    const ids: string[] = [];
    let cursor: string | null = null;
    do {
      const data = await f.inbox(f.child.token, `?limit=2${cursor ? `&cursor=${cursor}` : ''}`);
      expect(data.unreadCount).toBe(5);
      ids.push(...data.items.map((item) => item.id));
      cursor = data.nextCursor;
    } while (cursor);
    expect(ids).toEqual(expected);
    expect(new Set(ids).size).toBe(5);
  });

  it('validates list parameters, read bodies and device registration payloads', async () => {
    const f = await fixture();
    for (const query of [
      'limit=0',
      'limit=51',
      'limit=1.5',
      'limit=no',
      'cursor=no',
      'userId=other',
    ])
      await f.get(`/notifications?${query}`).expect(400);
    await f.post('/notifications/read-all').send({ userId: f.child.id }).expect(400);
    for (const body of [
      { token: '' },
      { token: 'short' },
      { token: 'a'.repeat(4097) },
      { token: 'x'.repeat(25), name: '' },
      { token: 'x'.repeat(25), userId: f.child.id },
    ])
      await f.post('/devices').send(body).expect(400);
    await f.remove('/devices/not-a-uuid').expect(400);
  });

  it('falls back to the current role’s home for unsafe links in historical inbox records', async () => {
    const f = await fixture();
    for (const [userId, actor, home] of [
      [f.child.id, f.child.token, '/child'],
      [f.parent.id, f.parent.token, '/parent'],
    ]) {
      for (const path of ['https://outside.example', '//outside.example', '/child/../parent']) {
        const notice = await f.seedNotice(userId!);
        await db!.notification.update({ where: { id: notice.id }, data: { data: { path } } });
      }
      expect((await f.inbox(actor!)).items.map((notice) => notice.path)).toEqual([
        home,
        home,
        home,
      ]);
    }
  });

  it('registers either role’s web device idempotently and keeps the token out of responses', async () => {
    const f = await fixture();
    const token = `local-device-${randomUUID()}`;
    const first = await f
      .post('/devices', f.child.token)
      .send({ token, name: 'Телефон' })
      .expect(200);
    expect(first.body.data).toMatchObject({
      id: expect.any(String),
      name: 'Телефон',
      platform: 'web',
    });
    expect(first.body.data).not.toHaveProperty('token');
    expect(first.body.data).not.toHaveProperty('userId');
    const replay = await f
      .post('/devices', f.child.token)
      .send({ token, name: 'Мій телефон' })
      .expect(200);
    expect(replay.body.data.id).toBe(first.body.data.id);
    expect(replay.body.data.name).toBe('Мій телефон');
    expect(await db!.device.count({ where: { token } })).toBe(1);
    await f
      .post('/devices')
      .send({ token: `parent-device-${randomUUID()}` })
      .expect(200);
  });

  it('restricts revocation to the current binding owner and safely rebinds a browser after an account switch', async () => {
    const f = await fixture();
    const other = await fixture();
    const token = `shared-browser-${randomUUID()}`;
    const first = await f.post('/devices', f.child.token).send({ token }).expect(200);
    const id = first.body.data.id as string;
    await f.remove(`/devices/${id}`).expect(404);
    await other.remove(`/devices/${id}`).expect(404);
    const rebound = await f.post('/devices').send({ token, name: 'Комп’ютер' }).expect(200);
    expect(rebound.body.data.id).toBe(id);
    await f.remove(`/devices/${id}`, f.child.token).expect(404);
    expect((await db!.device.findUniqueOrThrow({ where: { id } })).userId).toBe(f.parent.id);
    await f.remove(`/devices/${id}`).expect(200);
    await f.remove(`/devices/${id}`).expect(200);
    expect((await db!.device.findUniqueOrThrow({ where: { id } })).deletedAt).not.toBeNull();
    await f.post('/devices', f.child.token).send({ token }).expect(200);
    expect((await db!.device.findUniqueOrThrow({ where: { id } })).deletedAt).toBeNull();
    await f.remove(`/devices/${randomUUID()}`).expect(404);
  });

  it('serializes concurrent initial registration of the same token across accounts', async () => {
    const f = await fixture();
    const token = `concurrent-browser-${randomUUID()}`;
    const responses = await Promise.all([
      f.post('/devices', f.child.token).send({ token }),
      f.post('/devices').send({ token }),
    ]);
    expect(responses.map((response) => response.status)).toEqual([200, 200]);
    expect(responses[0]!.body.data.id).toBe(responses[1]!.body.data.id);
    const devices = await db!.device.findMany({ where: { token } });
    expect(devices).toHaveLength(1);
    expect(devices[0]!.bindingVersion).toBe(2);
    expect([f.child.id, f.parent.id]).toContain(devices[0]!.userId);
  });

  it('does not enqueue an old event again for a device registered after that event', async () => {
    const f = await fixture();
    const event = {
      userId: f.child.id,
      eventKey: `late-device:${randomUUID()}`,
      type: 'SYSTEM',
      title: 'Сповіщення до реєстрації',
      body: 'Зберігається у скриньці.',
      path: '/child',
    };
    await enqueueNotification(db!, event);
    const registered = await f
      .post('/devices', f.child.token)
      .send({ token: `late-browser-${randomUUID()}` })
      .expect(200);
    await enqueueNotification(db!, event);
    expect(
      await db!.notification.count({ where: { userId: f.child.id, eventKey: event.eventKey } }),
    ).toBe(1);
    expect(
      await db!.pushDelivery.count({ where: { deviceId: registered.body.data.id as string } }),
    ).toBe(0);
    expect((await f.inbox()).items).toHaveLength(1);
  });

  it('notifies all active family children about a new active quest and excludes inactive or deleted profiles', async () => {
    const f = await fixture();
    const sibling = await f.member('CHILD');
    const inactive = await f.member('CHILD', false);
    const deletedUser = await f.member('CHILD', true, true);
    const deletedProfile = await f.member('CHILD');
    await db!.child.update({
      where: { id: deletedProfile.childId! },
      data: { deletedAt: new Date() },
    });
    const other = await fixture();
    const active = await f.task();
    await f.task({ title: 'Чернетка', isActive: false });
    const rows = await db!.notification.findMany({
      where: { eventKey: `task:${active.id}:created` },
    });
    expect(rows.map((row) => row.userId).sort()).toEqual([f.child.id, sibling.id].sort());
    expect(rows.every((row) => row.type === 'TASK_CREATED')).toBe(true);
    for (const userId of [
      f.parent.id,
      inactive.id,
      deletedUser.id,
      deletedProfile.id,
      other.child.id,
    ])
      expect(await db!.notification.count({ where: { userId } })).toBe(0);
    expect((await f.inbox()).items).toHaveLength(1);
  });

  it('cancels queued deliveries when a device moves to another account or is revoked', async () => {
    const f = await fixture();
    const other = await fixture();
    const token = `queued-browser-${randomUUID()}`;
    const registered = await f.post('/devices', f.child.token).send({ token }).expect(200);
    const deviceId = registered.body.data.id as string;
    await f.task();
    const before = await db!.pushDelivery.findMany({ where: { deviceId } });
    expect(before).toHaveLength(1);
    expect(before[0]!.status).toBe('PENDING');
    await other.post('/devices', other.child.token).send({ token }).expect(200);
    await f.remove(`/devices/${deviceId}`, f.child.token).expect(404);
    const rebound = await db!.device.findUniqueOrThrow({ where: { id: deviceId } });
    expect(rebound.userId).toBe(other.child.id);
    expect(rebound.bindingVersion).toBe(2);
    expect(
      (await db!.pushDelivery.findUniqueOrThrow({ where: { id: before[0]!.id } })).status,
    ).toBe('CANCELLED');
    await other.task();
    const pending = await db!.pushDelivery.findMany({ where: { deviceId, status: 'PENDING' } });
    expect(pending).toHaveLength(1);
    expect(pending[0]!.deviceVersion).toBe(2);
    await other.remove(`/devices/${deviceId}`, other.child.token).expect(200);
    expect(await db!.pushDelivery.count({ where: { deviceId, status: 'PENDING' } })).toBe(0);
    expect(
      (await db!.pushDelivery.findUniqueOrThrow({ where: { id: pending[0]!.id } })).status,
    ).toBe('CANCELLED');
  });

  it('notifies both active parents once for submission replays and keeps messages out of the child inbox', async () => {
    const f = await fixture();
    await f.member('PARENT', false);
    await f.member('PARENT', true, true);
    const task = await f.task();
    const operationId = randomUUID();
    await f.submit(task.id, operationId);
    await f.submit(task.id, operationId);
    const rows = await db!.notification.findMany({
      where: { eventKey: `task-submission:${operationId}` },
    });
    expect(rows.map((row) => row.userId).sort()).toEqual([f.parent.id, f.secondParent.id].sort());
    expect(rows.every((row) => row.type === 'TASK_SUBMITTED')).toBe(true);
    expect((await f.inbox()).items.map((notice) => notice.type)).toEqual(['TASK_CREATED']);
  });

  it('creates approval, earned points and achievement notices atomically without replay duplicates', async () => {
    const f = await fixture();
    const completion = await f.submit((await f.task({ points: 100 })).id);
    const responses = await Promise.all([f.review(completion), f.review(completion)]);
    expect(responses.some((response) => response.status === 200)).toBe(true);
    for (const response of responses) {
      if (response.status === 200) continue;
      expect({ status: response.status, code: response.body.error?.code }).toEqual({
        status: 409,
        code: 'CONCURRENT_UPDATE',
      });
      // The bounded transaction retry contract allows a caller retry after the winner commits.
      await f.review(completion).expect(200);
    }
    const inbox = await f.inbox();
    const approved = inbox.items.filter((notice) => notice.type === 'TASK_APPROVED');
    const awards = inbox.items.filter((notice) => notice.type === 'ACHIEVEMENT_EARNED');
    expect(approved).toHaveLength(1);
    expect(approved[0]!.body).toContain('100');
    expect(awards).toHaveLength(1);
    expect((await f.get('/points').expect(200)).body.data.balance).toBe(100);
    await f.get('/achievements').expect(200);
    await f.review(completion).expect(200);
    expect((await f.inbox()).items).toHaveLength(inbox.items.length);
    expect((await f.inbox(f.parent.token)).items.map((notice) => notice.type)).toEqual([
      'TASK_SUBMITTED',
    ]);
    await f.review(completion, 'reject').expect(409);
    expect((await f.inbox()).items).toHaveLength(inbox.items.length);
  });

  it('notifies rejection once and distinguishes a new submission from an old review replay', async () => {
    const f = await fixture();
    const task = await f.task();
    const rejected = await f.submit(task.id);
    await f.review(rejected, 'reject').expect(200);
    await f.review(rejected, 'reject').expect(200);
    const resubmitted = await f.submit(task.id);
    await f.review(rejected).expect(409);
    await f.review(resubmitted).expect(200);
    const types = (await f.inbox()).items.map((notice) => notice.type).sort();
    expect(types).toEqual(['TASK_APPROVED', 'TASK_CREATED', 'TASK_REJECTED']);
    expect((await f.inbox(f.parent.token)).items.map((notice) => notice.type)).toEqual([
      'TASK_SUBMITTED',
      'TASK_SUBMITTED',
    ]);
  });

  it('notifies parents about reward requests and the child about approval and issue exactly once', async () => {
    const f = await fixture(100);
    const reward = await f.reward();
    const operationId = randomUUID();
    const pending = await f.ask(reward.id, operationId);
    await f.post(`/rewards/${reward.id}/request`, f.child.token).send({ operationId }).expect(200);
    for (const actor of [f.parent.token, f.secondParent.token])
      expect((await f.inbox(actor)).items.map((notice) => notice.type)).toEqual([
        'REWARD_REQUESTED',
      ]);
    for (const action of ['approve', 'approve', 'issue', 'issue', 'approve'])
      await f.post(`/reward-requests/${pending.id}/${action}`).send({}).expect(200);
    expect((await f.inbox()).items.map((notice) => notice.type).sort()).toEqual([
      'REWARD_APPROVED',
      'REWARD_ISSUED',
    ]);
    expect((await f.get('/points').expect(200)).body.data.balance).toBe(70);
  });

  it('notifies reward rejection once and creates no approval notice for insufficient points', async () => {
    const f = await fixture();
    const reward = await f.reward();
    const pending = await f.ask(reward.id);
    await f.post(`/reward-requests/${pending.id}/approve`).send({}).expect(409);
    expect((await f.inbox()).items).toHaveLength(0);
    expect((await db!.rewardRequest.findUniqueOrThrow({ where: { id: pending.id } })).status).toBe(
      'PENDING',
    );
    expect(await db!.pointTransaction.count({ where: { rewardRequestId: pending.id } })).toBe(0);
    await f
      .post(`/reward-requests/${pending.id}/reject`)
      .send({ reason: 'Наступного разу' })
      .expect(200);
    await f.post(`/reward-requests/${pending.id}/reject`).send({ reason: 'Повтор' }).expect(200);
    expect((await f.inbox()).items.map((notice) => notice.type)).toEqual(['REWARD_REJECTED']);
  });

  it('rolls back points, achievement and notification records when approval fails before commit', async () => {
    const f = await fixture();
    const completion = await f.submit((await f.task({ points: 100 })).id);
    const registered = await f
      .post('/devices', f.child.token)
      .send({ token: `rollback-browser-${randomUUID()}` })
      .expect(200);
    const deviceId = registered.body.data.id as string;
    const before = await f.inbox();
    const failing = db!.$extends({
      query: {
        pushDelivery: {
          async createMany({ args, query }) {
            await query(args);
            throw new Error('Intentional failure after the outbox write');
          },
        },
      },
    }) as unknown as PrismaClient;
    await request(f.appFor(failing))
      .post(`/api/v1/task-completions/${completion.id}/approve`)
      .auth(f.parent.token, { type: 'bearer' })
      .set('Origin', config.frontendUrl)
      .send({ operationId: completion.operationId })
      .expect(500);
    expect(
      (await db!.taskCompletion.findUniqueOrThrow({ where: { id: completion.id } })).status,
    ).toBe('SUBMITTED');
    expect(await db!.pointTransaction.count({ where: { taskCompletionId: completion.id } })).toBe(
      0,
    );
    expect(await db!.userAchievement.count({ where: { userId: f.child.id } })).toBe(0);
    expect(await db!.pushDelivery.count({ where: { deviceId } })).toBe(0);
    expect((await f.inbox()).items).toEqual(before.items);
    await f.review(completion).expect(200);
    expect(
      (await f.inbox()).items.filter((notice) => notice.type === 'TASK_APPROVED'),
    ).toHaveLength(1);
  });

  it('rolls back a reward approval, spending and notice together if the outbox write fails', async () => {
    const f = await fixture(100);
    const pending = await f.ask((await f.reward()).id);
    const registered = await f
      .post('/devices', f.child.token)
      .send({ token: `reward-rollback-${randomUUID()}` })
      .expect(200);
    const deviceId = registered.body.data.id as string;
    const failing = db!.$extends({
      query: {
        pushDelivery: {
          async createMany({ args, query }) {
            await query(args);
            throw new Error('Intentional failure after the reward outbox write');
          },
        },
      },
    }) as unknown as PrismaClient;
    await request(f.appFor(failing))
      .post(`/api/v1/reward-requests/${pending.id}/approve`)
      .auth(f.parent.token, { type: 'bearer' })
      .set('Origin', config.frontendUrl)
      .send({})
      .expect(500);
    expect((await db!.rewardRequest.findUniqueOrThrow({ where: { id: pending.id } })).status).toBe(
      'PENDING',
    );
    expect((await f.get('/points').expect(200)).body.data.balance).toBe(100);
    expect(await db!.pointTransaction.count({ where: { rewardRequestId: pending.id } })).toBe(0);
    expect((await f.inbox()).items).toHaveLength(0);
    expect(await db!.pushDelivery.count({ where: { deviceId } })).toBe(0);
    await f.post(`/reward-requests/${pending.id}/approve`).send({}).expect(200);
    expect((await f.inbox()).items.map((notice) => notice.type)).toEqual(['REWARD_APPROVED']);
    expect((await f.get('/points').expect(200)).body.data.balance).toBe(70);
  });
});

describe.skipIf(!db)('Durable push delivery leases through PostgreSQL', () => {
  // An old due date isolates these workers from other tests' current-time outbox jobs.
  const dueAt = new Date('2000-01-01T00:00:00Z');
  const clockAt = new Date('2001-01-01T00:00:00Z');

  async function queued(f: Awaited<ReturnType<typeof fixture>>, existingDeviceId?: string) {
    const token = `dispatcher-device-${randomUUID()}`;
    const deviceId =
      existingDeviceId ??
      ((await f.post('/devices', f.child.token).send({ token }).expect(200)).body.data
        .id as string);
    const notice = await f.seedNotice();
    const delivery = await db!.pushDelivery.create({
      data: { notificationId: notice.id, deviceId, deviceVersion: 1, nextAttemptAt: dueAt },
    });
    return { token, deviceId, notice, delivery };
  }

  it('lets independent workers claim different deliveries without sending a delivery twice', async () => {
    const f = await fixture();
    const first = await queued(f);
    const second = await queued(f);
    const sent: PushMessage[] = [];
    let release: (() => void) | undefined;
    const bothEntered = new Promise<void>((resolve) => {
      release = resolve;
    });
    const sender = {
      async send(message: PushMessage) {
        sent.push(message);
        if (sent.length === 2) release!();
        await bothEntered;
      },
    };
    const firstWorker = new NotificationDispatcher(db!, sender, { now: () => clockAt });
    const secondWorker = new NotificationDispatcher(db!, sender, { now: () => clockAt });
    expect(await Promise.all([firstWorker.dispatchOnce(1), secondWorker.dispatchOnce(1)])).toEqual([
      1, 1,
    ]);
    expect(sent.map((message) => message.notificationId).sort()).toEqual(
      [first.notice.id, second.notice.id].sort(),
    );
    const rows = await db!.pushDelivery.findMany({
      where: { id: { in: [first.delivery.id, second.delivery.id] } },
    });
    expect(
      rows.every(
        (row) =>
          row.status === 'SENT' &&
          row.attempts === 1 &&
          row.leaseToken === null &&
          row.leaseUntil === null,
      ),
    ).toBe(true);
    expect(await firstWorker.dispatchOnce(1)).toBe(0);
  });

  it('persists transient retry deadlines and sends only after the deadline on a new worker', async () => {
    const f = await fixture();
    const target = await queued(f);
    let now = clockAt;
    let calls = 0;
    const sender = {
      async send() {
        calls += 1;
        if (calls === 1) throw { code: 'messaging/server-unavailable' };
      },
    };
    expect(await new NotificationDispatcher(db!, sender, { now: () => now }).dispatchOnce(1)).toBe(
      1,
    );
    const waiting = await db!.pushDelivery.findUniqueOrThrow({ where: { id: target.delivery.id } });
    expect(waiting).toMatchObject({
      status: 'PENDING',
      attempts: 1,
      leaseToken: null,
      lastErrorCode: 'messaging/server-unavailable',
    });
    expect(waiting.nextAttemptAt.getTime()).toBe(now.getTime() + 60_000);
    const restarted = new NotificationDispatcher(db!, sender, { now: () => now });
    expect(await restarted.dispatchOnce(1)).toBe(0);
    expect(calls).toBe(1);
    now = new Date(now.getTime() + 60_000);
    expect(await restarted.dispatchOnce(1)).toBe(1);
    expect(
      await db!.pushDelivery.findUniqueOrThrow({ where: { id: target.delivery.id } }),
    ).toMatchObject({ status: 'SENT', attempts: 2, sentAt: now, lastErrorCode: null });
  });

  it('revokes an invalid token and cancels its other queued messages while preserving the inbox', async () => {
    const f = await fixture();
    const first = await queued(f);
    const second = await queued(f, first.deviceId);
    let calls = 0;
    const worker = new NotificationDispatcher(
      db!,
      {
        async send() {
          calls += 1;
          throw { code: 'messaging/registration-token-not-registered' };
        },
      },
      { now: () => clockAt },
    );
    expect(await worker.dispatchOnce(1)).toBe(1);
    expect(calls).toBe(1);
    const statuses = (await db!.pushDelivery.findMany({ where: { deviceId: first.deviceId } }))
      .map((row) => row.status)
      .sort();
    expect(statuses).toEqual(['CANCELLED', 'FAILED']);
    expect(await db!.device.findUniqueOrThrow({ where: { id: first.deviceId } })).toMatchObject({
      deletedAt: clockAt,
      bindingVersion: 2,
    });
    expect((await f.inbox()).items.map((notice) => notice.id).sort()).toEqual(
      [first.notice.id, second.notice.id].sort(),
    );
    expect(await worker.dispatchOnce(1)).toBe(0);
  });

  it('fences an in-flight worker after a token changes accounts without revoking the new owner', async () => {
    const f = await fixture();
    const target = await queued(f);
    let entered: (() => void) | undefined;
    let release: (() => void) | undefined;
    const sending = new Promise<void>((resolve) => {
      entered = resolve;
    });
    const releaseSend = new Promise<void>((resolve) => {
      release = resolve;
    });
    const worker = new NotificationDispatcher(
      db!,
      {
        async send() {
          entered!();
          await releaseSend;
          throw { code: 'messaging/registration-token-not-registered' };
        },
      },
      { now: () => clockAt },
    );
    const running = worker.dispatchOnce(1);
    await sending;
    try {
      await f.post('/devices').send({ token: target.token }).expect(200);
    } finally {
      release!();
    }
    expect(await running).toBe(1);
    expect(await db!.device.findUniqueOrThrow({ where: { id: target.deviceId } })).toMatchObject({
      userId: f.parent.id,
      bindingVersion: 2,
      deletedAt: null,
    });
    expect(
      await db!.pushDelivery.findUniqueOrThrow({ where: { id: target.delivery.id } }),
    ).toMatchObject({ status: 'CANCELLED', leaseToken: null });
  });

  it('recovers a delivery whose previous worker lease expired', async () => {
    const f = await fixture();
    const target = await queued(f);
    await db!.pushDelivery.update({
      where: { id: target.delivery.id },
      data: { status: 'PROCESSING', attempts: 1, leaseToken: randomUUID(), leaseUntil: dueAt },
    });
    const sent: PushMessage[] = [];
    const worker = new NotificationDispatcher(
      db!,
      {
        async send(message) {
          sent.push(message);
        },
      },
      { now: () => clockAt },
    );
    expect(await worker.dispatchOnce(1)).toBe(1);
    expect(sent.map((message) => message.notificationId)).toEqual([target.notice.id]);
    expect(
      await db!.pushDelivery.findUniqueOrThrow({ where: { id: target.delivery.id } }),
    ).toMatchObject({ status: 'SENT', attempts: 2, leaseToken: null });
  });

  it('stops after five attempts and finalizes an exhausted expired lease without sending it', async () => {
    const f = await fixture();
    const lastAttempt = await queued(f);
    const expired = await queued(f);
    await db!.pushDelivery.update({
      where: { id: lastAttempt.delivery.id },
      data: { attempts: 4 },
    });
    await db!.pushDelivery.update({
      where: { id: expired.delivery.id },
      data: { status: 'PROCESSING', attempts: 5, leaseToken: randomUUID(), leaseUntil: dueAt },
    });
    let calls = 0;
    const worker = new NotificationDispatcher(
      db!,
      {
        async send() {
          calls += 1;
          throw { code: 'messaging/server-unavailable' };
        },
      },
      { now: () => clockAt },
    );
    expect(await worker.dispatchOnce(1)).toBe(1);
    expect(calls).toBe(1);
    expect(
      await db!.pushDelivery.findUniqueOrThrow({ where: { id: lastAttempt.delivery.id } }),
    ).toMatchObject({
      status: 'FAILED',
      attempts: 5,
      leaseToken: null,
      lastErrorCode: 'messaging/server-unavailable',
    });
    expect(
      await db!.pushDelivery.findUniqueOrThrow({ where: { id: expired.delivery.id } }),
    ).toMatchObject({
      status: 'FAILED',
      attempts: 5,
      leaseToken: null,
      lastErrorCode: 'delivery-attempts-exhausted',
    });
    expect(await worker.dispatchOnce(1)).toBe(0);
    expect(calls).toBe(1);
  });
});
