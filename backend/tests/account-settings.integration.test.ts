import { randomUUID } from 'node:crypto';
import { Prisma, PrismaClient } from '@prisma/client';
import type { LoginJournalData } from '@kidquest/types';
import bcrypt from 'bcrypt';
import dotenv from 'dotenv';
import jwt from 'jsonwebtoken';
import request from 'supertest';
import { afterAll, describe, expect, it } from 'vitest';
import { createApp } from '../src/app.js';
import { PrismaAuthRepository } from '../src/modules/auth/auth.repository.js';
import { NotificationRepository } from '../src/modules/notifications/notification.repository.js';
import { AccountRepository } from '../src/modules/account/account.repository.js';

dotenv.config({ path: '../.local/test-db.env', quiet: true });
// Never fall back to DATABASE_URL: fixtures belong only to the dedicated test database.
const db = process.env.DATABASE_TEST_URL
  ? new PrismaClient({ datasourceUrl: process.env.DATABASE_TEST_URL })
  : null;
const config = {
  jwtSecret: 'account-settings-integration-only-do-not-deploy',
  frontendUrl: 'http://localhost:5173',
  accessSeconds: 900,
  refreshDays: 30,
  production: false,
};
const password = 'AccountIntegrationPassword!';
const newPassword = 'ChangedChildPassword!';
const passwordHash = bcrypt.hash(password, 4);
const address = () => `${randomUUID()}@account-settings.test`;
const sign = (id: string, version?: number) =>
  jwt.sign(version === undefined ? {} : { ver: version }, config.jwtSecret, {
    subject: id,
    issuer: 'kidquest-api',
    audience: 'kidquest-web',
    expiresIn: 900,
  });
afterAll(async () => {
  await db?.$disconnect();
});

async function fixture(secondParent = true) {
  const family = await db!.family.create({ data: { name: 'Налаштування тестової сім’ї' } });
  const member = async (
    role: 'PARENT' | 'CHILD',
    changes: { isActive?: boolean; deletedAt?: Date } = {},
  ) => {
    const user = await db!.user.create({
      data: {
        familyId: family.id,
        email: address(),
        passwordHash: await passwordHash,
        firstName: role === 'CHILD' ? 'Богдан' : 'Олена',
        lastName: 'Тест',
        role,
        ...changes,
      },
    });
    const child =
      role === 'CHILD'
        ? await db!.child.create({
            data: {
              familyId: family.id,
              userId: user.id,
              firstName: user.firstName,
              lastName: user.lastName,
            },
          })
        : null;
    return { ...user, childId: child?.id ?? null, token: sign(user.id) };
  };
  const parent = await member('PARENT');
  const otherParent = secondParent ? await member('PARENT') : null;
  const child = await member('CHILD');
  const appFor = (database: PrismaClient, repository = new PrismaAuthRepository(database)) =>
    createApp(repository, config, { database, storagePath: '.local/test-account-storage' });
  const app = appFor(db!);
  const get = (path: string, token = parent.token) =>
    request(app).get(`/api/v1${path}`).auth(token, { type: 'bearer' });
  const patch = (path: string, token = parent.token) =>
    request(app)
      .patch(`/api/v1${path}`)
      .auth(token, { type: 'bearer' })
      .set('Origin', config.frontendUrl);
  const post = (path: string, token = parent.token) =>
    request(app)
      .post(`/api/v1${path}`)
      .auth(token, { type: 'bearer' })
      .set('Origin', config.frontendUrl);
  const login = async (email = child.email, loginPassword = password) => {
    const response = await post('/auth/login').send({ email, password: loginPassword }).expect(200);
    return {
      token: response.body.data.accessToken as string,
      cookie: (response.headers['set-cookie'] as unknown as string[])[0]!.split(';')[0]!,
    };
  };
  const refresh = (cookie: string) =>
    request(app)
      .post('/api/v1/auth/refresh')
      .set('Origin', config.frontendUrl)
      .set('Cookie', cookie);
  const journal = async (query = '') =>
    (await get(`/account/login-journal${query}`).expect(200)).body.data as LoginJournalData;
  const log = (
    userId: string | null = child.id,
    changes: { loginAt?: Date; success?: boolean } = {},
  ) =>
    db!.loginLog.create({
      data: {
        userId,
        loginAt: new Date('2026-10-20T12:00:00Z'),
        ipAddress: '127.0.0.1',
        userAgent: 'KidQuest integration browser',
        device: 'Test device',
        success: true,
        ...changes,
      },
    });
  return {
    family,
    parent,
    otherParent,
    child,
    member,
    app,
    appFor,
    get,
    patch,
    post,
    login,
    refresh,
    journal,
    log,
  };
}

describe.skipIf(!db)('Account settings security through PostgreSQL HTTP', () => {
  it('requires authentication, parent administration and a trusted origin', async () => {
    const f = await fixture();
    for (const path of ['/account/profile', '/account/login-journal'])
      await request(f.app).get(`/api/v1${path}`).expect(401);
    const mutations = [
      ['patch', '/account/email', { email: address(), currentPassword: password }],
      [
        'patch',
        `/account/members/${f.parent.id}/email`,
        { email: address(), currentPassword: password },
      ],
      [
        'post',
        `/account/members/${f.child.id}/reset-password`,
        { newPassword, currentPassword: password },
      ],
      [
        'patch',
        `/account/members/${f.child.id}/role`,
        { role: 'PARENT', currentPassword: password },
      ],
    ] as const;
    for (const [method, path, body] of mutations) {
      await request(f.app)
        [method](`/api/v1${path}`)
        .set('Origin', config.frontendUrl)
        .send(body)
        .expect(401);
      await request(f.app)
        [method](`/api/v1${path}`)
        .auth(f.parent.token, { type: 'bearer' })
        .send(body)
        .expect(403);
      await request(f.app)
        [method](`/api/v1${path}`)
        .auth(f.child.token, { type: 'bearer' })
        .set('Origin', config.frontendUrl)
        .send(body)
        .expect(403);
    }
    await f.get('/account/login-journal', f.child.token).expect(403);
  });

  it('returns only safe own-profile fields for either role', async () => {
    const f = await fixture();
    for (const actor of [f.parent, f.child]) {
      const response = await f.get('/account/profile', actor.token).expect(200);
      expect(response.body.data).toEqual({
        user: {
          id: actor.id,
          email: actor.email,
          firstName: actor.firstName,
          lastName: actor.lastName,
          role: actor.role,
          familyId: f.family.id,
        },
        family: { id: f.family.id, name: f.family.name, timeZone: f.family.timeZone },
        childId: actor.childId,
        createdAt: actor.createdAt.toISOString(),
      });
      for (const secret of ['passwordHash', 'authVersion', 'tokenHash', 'refreshToken', password])
        expect(JSON.stringify(response.body)).not.toContain(secret);
    }
    await f.get(`/account/profile?userId=${f.parent.id}`, f.child.token).expect(400);
  });

  it('denies missing, foreign, inactive and deleted mutation targets', async () => {
    const f = await fixture();
    const other = await fixture();
    const inactive = await f.member('CHILD', { isActive: false });
    const deleted = await f.member('CHILD', { deletedAt: new Date() });
    for (const userId of [other.child.id, inactive.id, deleted.id, randomUUID()]) {
      await f
        .patch(`/account/members/${userId}/email`)
        .send({ email: address(), currentPassword: password })
        .expect(404);
      await f
        .post(`/account/members/${userId}/reset-password`)
        .send({ newPassword, currentPassword: password })
        .expect(404);
      await f
        .patch(`/account/members/${userId}/role`)
        .send({ role: 'PARENT', currentPassword: password })
        .expect(404);
    }
    expect((await db!.user.findUniqueOrThrow({ where: { id: other.child.id } })).email).toBe(
      other.child.email,
    );
    expect(await db!.auditLog.count({ where: { familyId: f.family.id } })).toBe(0);
  });

  it('strictly validates payloads, target IDs and journal filters', async () => {
    const f = await fixture();
    for (const body of [
      { email: 'invalid', currentPassword: password },
      { email: address(), currentPassword: '' },
      { email: address(), currentPassword: password, familyId: f.family.id },
      { email: address() },
    ])
      await f.patch('/account/email').send(body).expect(400);
    for (const body of [
      { newPassword: 'short', currentPassword: password },
      { newPassword: 'я'.repeat(37), currentPassword: password },
      { newPassword, currentPassword: password, userId: f.parent.id },
      { newPassword },
    ])
      await f.post(`/account/members/${f.child.id}/reset-password`).send(body).expect(400);
    for (const body of [
      { role: 'ADMIN', currentPassword: password },
      { role: 'CHILD' },
      { role: 'CHILD', currentPassword: password, isActive: false },
    ])
      await f.patch(`/account/members/${f.otherParent!.id}/role`).send(body).expect(400);
    await f
      .patch('/account/members/not-uuid/email')
      .send({ email: address(), currentPassword: password })
      .expect(400);
    await f
      .post('/account/members/not-uuid/reset-password')
      .send({ newPassword, currentPassword: password })
      .expect(400);
    await f
      .patch('/account/members/not-uuid/role')
      .send({ role: 'PARENT', currentPassword: password })
      .expect(400);
    for (const query of [
      'limit=0',
      'limit=51',
      'limit=1.5',
      'limit=no',
      'cursor=invalid',
      'userId=invalid',
      'success=1',
      'success=all',
      `familyId=${f.family.id}`,
    ])
      await f.get(`/account/login-journal?${query}`).expect(400);
  });

  it('requires the acting parent password and leaves credentials unchanged on failure', async () => {
    const f = await fixture();
    await f
      .patch(`/account/members/${f.child.id}/email`)
      .send({ email: address(), currentPassword: 'Incorrect password!' })
      .expect(403);
    await f
      .post(`/account/members/${f.child.id}/reset-password`)
      .send({ newPassword, currentPassword: newPassword })
      .expect(403);
    await f
      .patch(`/account/members/${f.otherParent!.id}/role`)
      .send({ role: 'CHILD', currentPassword: 'Incorrect password!' })
      .expect(403);
    expect(await db!.auditLog.count({ where: { familyId: f.family.id } })).toBe(0);
    expect((await db!.user.findUniqueOrThrow({ where: { id: f.child.id } })).email).toBe(
      f.child.email,
    );
    await f.login();
  });

  it('normalizes a child email and revokes every child access and refresh session', async () => {
    const f = await fixture();
    const sessions = [await f.login(), await f.login()];
    const email = address();
    const changed = await f
      .patch(`/account/members/${f.child.id}/email`)
      .send({ email: `  ${email.toUpperCase()}  `, currentPassword: password })
      .expect(200);
    expect(changed.body.data).toEqual({ updated: true, reauthenticate: false });
    expect(await db!.user.findUniqueOrThrow({ where: { id: f.child.id } })).toMatchObject({
      email,
      authVersion: 1,
    });
    for (const session of sessions) {
      await f.get('/me', session.token).expect(401);
      await f.refresh(session.cookie).expect(401);
    }
    await f.get('/me', f.child.token).expect(401);
    await f.get('/me').expect(200);
    await f.post('/auth/login').send({ email: f.child.email, password }).expect(401);
    const current = await f.login(email);
    await f.get('/me', current.token).expect(200);
    const logs = await db!.auditLog.findMany({ where: { familyId: f.family.id } });
    expect(logs).toHaveLength(1);
    expect(logs[0]).toMatchObject({ userId: f.parent.id, entityId: f.child.id });
    expect(JSON.stringify(logs)).not.toContain(password);
  });

  it('changes an own email and invalidates the acting session immediately', async () => {
    const f = await fixture();
    const session = await f.login(f.parent.email);
    const email = address();
    const response = await f
      .patch('/account/email', session.token)
      .send({ email, currentPassword: password })
      .expect(200);
    expect(response.body.data).toEqual({ updated: true, reauthenticate: true });
    expect(response.headers['set-cookie'][0]).toContain('kq_refresh=;');
    await f.get('/me', session.token).expect(401);
    await f.get('/me', f.parent.token).expect(401);
    await f.refresh(session.cookie).expect(401);
    const next = await f.login(email);
    expect((await f.get('/me', next.token).expect(200)).body.data.email).toBe(email);
    await f.get('/me', f.otherParent!.token).expect(200);
  });

  it('keeps no-op email changes idempotent and enforces global email uniqueness', async () => {
    const f = await fixture();
    const other = await fixture();
    const session = await f.login();
    const unchanged = await f
      .patch(`/account/members/${f.child.id}/email`)
      .send({ email: f.child.email.toUpperCase(), currentPassword: password })
      .expect(200);
    expect(unchanged.body.data).toEqual({ updated: false, reauthenticate: false });
    await f.get('/me', session.token).expect(200);
    for (const email of [f.parent.email, other.child.email]) {
      const conflict = await f
        .patch(`/account/members/${f.child.id}/email`)
        .send({ email, currentPassword: password })
        .expect(409);
      expect(conflict.body.error.code).toBe('EMAIL_IN_USE');
    }
    expect(await db!.auditLog.count({ where: { familyId: f.family.id } })).toBe(0);
    expect((await db!.user.findUniqueOrThrow({ where: { id: f.child.id } })).authVersion).toBe(0);
    await f.refresh(session.cookie).expect(200);
  });
  it('resets only a child password with bcrypt and revokes all existing sessions', async () => {
    const f = await fixture();
    const sessions = [await f.login(), await f.login()];
    const response = await f
      .post(`/account/members/${f.child.id}/reset-password`)
      .send({ newPassword, currentPassword: password })
      .expect(200);
    expect(response.body.data).toEqual({ updated: true, reauthenticate: false });
    expect(JSON.stringify(response.body)).not.toContain(newPassword);
    const saved = await db!.user.findUniqueOrThrow({ where: { id: f.child.id } });
    expect(saved.passwordHash).toMatch(/^\$2[aby]\$/);
    expect(await bcrypt.compare(newPassword, saved.passwordHash)).toBe(true);
    expect(await bcrypt.compare(password, saved.passwordHash)).toBe(false);
    expect(saved.authVersion).toBe(1);
    for (const session of sessions) {
      await f.get('/me', session.token).expect(401);
      await f.refresh(session.cookie).expect(401);
    }
    await f.post('/auth/login').send({ email: f.child.email, password }).expect(401);
    const next = await f.login(f.child.email, newPassword);
    await f.get('/me', next.token).expect(200);
    await f.get('/me').expect(200);
    const logs = await db!.auditLog.findMany({ where: { familyId: f.family.id } });
    expect(logs).toHaveLength(1);
    for (const secret of [password, newPassword, saved.passwordHash, sessions[0]!.token])
      expect(JSON.stringify(logs)).not.toContain(secret);
    await f
      .post(`/account/members/${f.otherParent!.id}/reset-password`)
      .send({ newPassword, currentPassword: password })
      .expect(409);
  });

  it('revokes device bindings and cancels queued or leased pushes after a security change', async () => {
    const f = await fixture();
    const registered = await f
      .post('/devices', f.child.token)
      .send({ token: `settings-device-${randomUUID()}`, name: 'Тестовий телефон' })
      .expect(200);
    const deviceId = registered.body.data.id as string;
    const deliveries = [];
    for (const processing of [false, true]) {
      const notification = await db!.notification.create({
        data: {
          userId: f.child.id,
          type: 'SYSTEM',
          title: 'Тест',
          body: 'Не доставляти після відкликання.',
        },
      });
      deliveries.push(
        await db!.pushDelivery.create({
          data: {
            notificationId: notification.id,
            deviceId,
            deviceVersion: 1,
            ...(processing
              ? {
                  status: 'PROCESSING',
                  leaseToken: randomUUID(),
                  leaseUntil: new Date(Date.now() + 60_000),
                }
              : {}),
          },
        }),
      );
    }
    await f
      .post(`/account/members/${f.child.id}/reset-password`)
      .send({ newPassword, currentPassword: password })
      .expect(200);
    const device = await db!.device.findUniqueOrThrow({ where: { id: deviceId } });
    expect(device.deletedAt).not.toBeNull();
    expect(device.bindingVersion).toBe(2);
    const rows = await db!.pushDelivery.findMany({
      where: { id: { in: deliveries.map((row) => row.id) } },
    });
    expect(rows).toHaveLength(2);
    for (const row of rows)
      expect(row).toMatchObject({ status: 'CANCELLED', leaseToken: null, leaseUntil: null });
    expect(await db!.notification.count({ where: { userId: f.child.id } })).toBe(2);
  });

  it('preserves child identity, completed quests and ledger during a role round trip', async () => {
    const f = await fixture(false);
    const session = await f.login();
    const category = await db!.taskCategory.create({
      data: { familyId: f.family.id, name: 'Історія' },
    });
    const task = await db!.task.create({
      data: {
        familyId: f.family.id,
        categoryId: category.id,
        title: 'Збережений квест',
        points: 10,
      },
    });
    const completion = await db!.taskCompletion.create({
      data: {
        familyId: f.family.id,
        childId: f.child.childId!,
        taskId: task.id,
        completionDate: new Date('2026-10-20T00:00:00Z'),
        pointsSnapshot: 10,
        status: 'APPROVED',
      },
    });
    const points = await db!.pointTransaction.create({
      data: {
        familyId: f.family.id,
        childId: f.child.childId!,
        type: 'TASK_REWARD',
        amount: 10,
        taskCompletionId: completion.id,
      },
    });
    const promote = await f
      .patch(`/account/members/${f.child.id}/role`)
      .send({ role: 'PARENT', currentPassword: password })
      .expect(200);
    expect(promote.body.data).toEqual({ updated: true, reauthenticate: false });
    await f.get('/me', session.token).expect(401);
    await f.refresh(session.cookie).expect(401);
    const asParent = await f.login();
    expect((await f.get('/me', asParent.token).expect(200)).body.data.role).toBe('PARENT');
    expect((await f.get('/statistics').expect(200)).body.data.child).toBeNull();
    await f
      .patch(`/account/members/${f.child.id}/role`)
      .send({ role: 'CHILD', currentPassword: password })
      .expect(200);
    await f.get('/me', asParent.token).expect(401);
    await f.refresh(asParent.cookie).expect(401);
    const asChild = await f.login();
    expect((await f.get('/me', asChild.token).expect(200)).body.data.role).toBe('CHILD');
    expect((await db!.child.findUniqueOrThrow({ where: { userId: f.child.id } })).id).toBe(
      f.child.childId,
    );
    expect(await db!.taskCompletion.findUnique({ where: { id: completion.id } })).not.toBeNull();
    expect(await db!.pointTransaction.findUnique({ where: { id: points.id } })).not.toBeNull();
    expect((await f.get('/points', asChild.token).expect(200)).body.data.balance).toBe(10);
  });

  it('creates a child profile for a demoted second parent and does not duplicate a no-op', async () => {
    const f = await fixture();
    const changed = await f
      .patch(`/account/members/${f.otherParent!.id}/role`)
      .send({ role: 'CHILD', currentPassword: password })
      .expect(200);
    expect(changed.body.data).toEqual({ updated: true, reauthenticate: false });
    expect(
      await db!.child.findUniqueOrThrow({ where: { userId: f.otherParent!.id } }),
    ).toMatchObject({ familyId: f.family.id, firstName: f.otherParent!.firstName });
    const unchanged = await f
      .patch(`/account/members/${f.otherParent!.id}/role`)
      .send({ role: 'CHILD', currentPassword: password })
      .expect(200);
    expect(unchanged.body.data).toEqual({ updated: false, reauthenticate: false });
    expect(await db!.child.count({ where: { userId: f.otherParent!.id } })).toBe(1);
    expect(
      (await db!.user.findUniqueOrThrow({ where: { id: f.otherParent!.id } })).authVersion,
    ).toBe(1);
  });

  it('invalidates the acting parent’s own session after self-demotion', async () => {
    const f = await fixture();
    const session = await f.login(f.parent.email);
    const changed = await f
      .patch(`/account/members/${f.parent.id}/role`, session.token)
      .send({ role: 'CHILD', currentPassword: password })
      .expect(200);
    expect(changed.body.data).toEqual({ updated: true, reauthenticate: true });
    await f.get('/me', session.token).expect(401);
    await f.refresh(session.cookie).expect(401);
    const next = await f.login(f.parent.email);
    await f.get('/account/login-journal', next.token).expect(403);
    await f.get('/account/login-journal', f.otherParent!.token).expect(200);
  });

  it('refuses to remove the last parent or exceed two active parents', async () => {
    const only = await fixture(false);
    const last = await only
      .patch(`/account/members/${only.parent.id}/role`)
      .send({ role: 'CHILD', currentPassword: password })
      .expect(409);
    expect(last.body.error.code).toBe('LAST_PARENT');
    const full = await fixture();
    const limit = await full
      .patch(`/account/members/${full.child.id}/role`)
      .send({ role: 'PARENT', currentPassword: password })
      .expect(409);
    expect(limit.body.error.code).toBe('PARENT_LIMIT');
    for (const f of [only, full]) {
      expect(await db!.auditLog.count({ where: { familyId: f.family.id } })).toBe(0);
      await f.get('/me').expect(200);
    }
  });

  it('serializes promotion and membership creation against the same parent cap', async () => {
    const f = await fixture(false);
    const responses = await Promise.all([
      f
        .patch(`/account/members/${f.child.id}/role`)
        .send({ role: 'PARENT', currentPassword: password }),
      f
        .post('/family/members')
        .send({ email: address(), password, firstName: 'Другі батьки', role: 'PARENT' }),
    ]);
    expect(responses.map((response) => response.status).sort()).toEqual(
      responses[0]!.status === 200 ? [200, 409] : [201, 409],
    );
    expect(
      await db!.user.count({
        where: { familyId: f.family.id, role: 'PARENT', isActive: true, deletedAt: null },
      }),
    ).toBe(2);
  });

  it('retains one active parent when simultaneous self-demotions compete', async () => {
    const f = await fixture();
    const responses = await Promise.all([
      f
        .patch(`/account/members/${f.parent.id}/role`)
        .send({ role: 'CHILD', currentPassword: password }),
      f
        .patch(`/account/members/${f.otherParent!.id}/role`, f.otherParent!.token)
        .send({ role: 'CHILD', currentPassword: password }),
    ]);
    expect(responses.filter((response) => response.status === 200)).toHaveLength(1);
    expect(responses.every((response) => [200, 401, 403, 409].includes(response.status))).toBe(
      true,
    );
    expect(
      await db!.user.count({
        where: { familyId: f.family.id, role: 'PARENT', isActive: true, deletedAt: null },
      }),
    ).toBe(1);
  });
  it('isolates the journal, includes known failures and inactive users, excludes deleted or unknown users', async () => {
    const f = await fixture();
    const other = await fixture();
    const own = await f.log();
    await f.log(f.parent.id);
    await f.log(other.child.id);
    await f.log(null, { success: false });
    const inactive = await f.member('CHILD', { isActive: false });
    const deleted = await f.member('CHILD', { deletedAt: new Date() });
    await f.log(inactive.id);
    await f.log(deleted.id);
    await f
      .post('/auth/login')
      .set('User-Agent', 'KidQuest known failed login')
      .send({ email: f.child.email, password: 'incorrect' })
      .expect(401);
    await f
      .post('/auth/login')
      .set('User-Agent', 'KidQuest unknown failed login')
      .send({ email: address(), password: 'incorrect' })
      .expect(401);
    const journal = await f.journal();
    expect(journal.items).toHaveLength(4);
    expect(journal.items.find((item) => item.id === own.id)).toEqual({
      id: own.id,
      user: {
        id: f.child.id,
        email: f.child.email,
        firstName: f.child.firstName,
        lastName: f.child.lastName,
        role: 'CHILD',
        familyId: f.family.id,
      },
      loginAt: own.loginAt.toISOString(),
      ipAddress: '127.0.0.1',
      userAgent: 'KidQuest integration browser',
      device: 'Test device',
      success: true,
    });
    expect(journal.items.some((item) => !item.success && item.user.id === f.child.id)).toBe(true);
    expect(
      journal.items.every((item) => [f.child.id, f.parent.id, inactive.id].includes(item.user.id)),
    ).toBe(true);
    expect(JSON.stringify(journal)).not.toContain('passwordHash');
    expect(JSON.stringify(journal)).not.toContain('KidQuest unknown failed login');
    expect((await f.journal('?success=false')).items).toHaveLength(1);
    expect((await f.journal('?success=true')).items).toHaveLength(3);
    expect((await f.journal(`?userId=${f.child.id}`)).items).toHaveLength(2);
  });

  it('paginates journal entries deterministically when login timestamps match', async () => {
    const f = await fixture();
    const rows = [];
    for (let index = 0; index < 5; index += 1) rows.push(await f.log());
    const expected = rows
      .map((row) => row.id)
      .sort()
      .reverse();
    const actual: string[] = [];
    let cursor: string | null = null;
    do {
      const page = await f.journal(`?limit=2${cursor ? '&cursor=' + cursor : ''}`);
      actual.push(...page.items.map((item) => item.id));
      cursor = page.nextCursor;
    } while (cursor);
    expect(actual).toEqual(expected);
    expect(new Set(actual).size).toBe(5);
  });

  it('rejects unknown, foreign and filter-mismatched journal cursors', async () => {
    const f = await fixture();
    const other = await fixture();
    const own = await f.log();
    const failed = await f.log(f.child.id, { success: false });
    const foreign = await other.log();
    const unknown = await f.log(null, { success: false });
    for (const cursor of [randomUUID(), foreign.id, unknown.id])
      await f.get(`/account/login-journal?cursor=${cursor}`).expect(404);
    await f.get(`/account/login-journal?userId=${other.child.id}`).expect(404);
    await f.get(`/account/login-journal?cursor=${own.id}&success=false`).expect(404);
    await f.get(`/account/login-journal?cursor=${failed.id}&userId=${f.parent.id}`).expect(404);
    expect((await f.journal(`?userId=${f.otherParent!.id}`)).items).toEqual([]);
  });

  it('does not mint a usable stale session when old-password login races a reset', async () => {
    const f = await fixture();
    const repository = new PrismaAuthRepository(db!);
    const original = repository.findByEmail.bind(repository);
    let read: (() => void) | undefined;
    let release: (() => void) | undefined;
    const readDone = new Promise<void>((resolve) => {
      read = resolve;
    });
    const continueLogin = new Promise<void>((resolve) => {
      release = resolve;
    });
    repository.findByEmail = async (email) => {
      const user = await original(email);
      if (email === f.child.email) {
        read!();
        await continueLogin;
      }
      return user;
    };
    const running = request(f.appFor(db!, repository))
      .post('/api/v1/auth/login')
      .set('Origin', config.frontendUrl)
      .send({ email: f.child.email, password })
      .then((response) => response);
    await readDone;
    try {
      await f
        .post(`/account/members/${f.child.id}/reset-password`)
        .send({ currentPassword: password, newPassword })
        .expect(200);
    } finally {
      release!();
    }
    const response = await running;
    expect([200, 401]).toContain(response.status);
    if (response.status === 200) {
      await f.get('/me', response.body.data.accessToken as string).expect(401);
      await f
        .refresh((response.headers['set-cookie'] as unknown as string[])[0]!.split(';')[0]!)
        .expect(401);
    }
    const current = await f.login(f.child.email, newPassword);
    await f.get('/me', current.token).expect(200);
  });

  it('keeps legacy version-zero JWTs valid and rejects forged or malformed versions', async () => {
    const f = await fixture();
    await f.get('/me', f.child.token).expect(200);
    await f.get('/me', sign(f.child.id, 0)).expect(200);
    for (const version of [1, -1, 0.5]) await f.get('/me', sign(f.child.id, version)).expect(401);
  });

  it('fences operations whose serializable snapshot predates a waited-on family lock', async () => {
    for (const operation of ['member', 'email'] as const) {
      const f = await fixture();
      const applicationName = `account-lock-fence-${randomUUID()}`;
      const connectionUrl = new URL(process.env.DATABASE_TEST_URL!);
      connectionUrl.searchParams.set('application_name', applicationName);
      connectionUrl.searchParams.set('connection_limit', '1');
      const racing = new PrismaClient({ datasourceUrl: connectionUrl.toString() });
      let locked: (() => void) | undefined;
      let release: (() => void) | undefined;
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
          locked!();
          await continueHolder;
          await tx.user.update({
            where: { id: f.parent.id },
            data: { authVersion: { increment: 1 } },
          });
        },
        { timeout: 10_000 },
      );
      await lockedDone;
      const email = address();
      const pending =
        operation === 'member'
          ? new PrismaAuthRepository(racing).createMember(
              f.family.id,
              { email, password, firstName: 'Не створювати', role: 'CHILD' },
              await passwordHash,
              { id: f.parent.id, authVersion: 0 },
            )
          : new AccountRepository(racing).changeEmail(
              {
                id: f.parent.id,
                familyId: f.family.id,
                authVersion: 0,
                passwordHash: await passwordHash,
              },
              f.child.id,
              email,
            );
      const outcome = pending.then(
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
        release!();
        await holder;
        expect(await outcome).toMatchObject({ status: 401 });
        expect(await db!.user.findUnique({ where: { email } })).toBeNull();
      } finally {
        release!();
        await holder;
        await outcome;
        await racing.$disconnect();
      }
    }
  }, 15_000);
  it('blocks stale parent snapshots from creating members after demotion or an email change', async () => {
    const f = await fixture();
    const repository = new PrismaAuthRepository(db!);
    for (const target of [f.parent, f.otherParent!]) {
      if (target.id === f.parent.id) {
        await f
          .patch(`/account/members/${target.id}/role`)
          .send({ role: 'CHILD', currentPassword: password })
          .expect(200);
      } else {
        await f
          .patch('/account/email', target.token)
          .send({ email: address(), currentPassword: password })
          .expect(200);
      }
      const email = address();
      await expect(
        repository.createMember(
          f.family.id,
          { email, password, firstName: 'Не створювати', role: 'CHILD' },
          await passwordHash,
          { id: target.id, authVersion: 0 },
        ),
      ).rejects.toMatchObject({ status: 401 });
      expect(await db!.user.findUnique({ where: { email } })).toBeNull();
    }
  });

  it('cannot reactivate a revoked push binding using a stale authenticated user snapshot', async () => {
    const f = await fixture();
    const authRepository = new PrismaAuthRepository(db!);
    const stale = await authRepository.findById(f.child.id);
    const repository = new NotificationRepository(db!);
    const token = `stale-settings-device-${randomUUID()}`;
    const first = await repository.registerDevice(stale!, { token });
    await f
      .post(`/account/members/${f.child.id}/reset-password`)
      .send({ currentPassword: password, newPassword })
      .expect(200);
    await expect(repository.registerDevice(stale!, { token })).rejects.toMatchObject({
      status: 401,
    });
    await expect(
      repository.registerDevice(stale!, { token: `never-register-${randomUUID()}` }),
    ).rejects.toMatchObject({ status: 401 });
    expect(await db!.device.findUniqueOrThrow({ where: { id: first.id } })).toMatchObject({
      bindingVersion: 2,
      deletedAt: expect.any(Date),
    });
    expect(await db!.device.count({ where: { userId: f.child.id } })).toBe(1);
  });
  it('rolls back password, session revocation and delivery cancellation if the audit fails', async () => {
    const f = await fixture();
    const session = await f.login();
    const registered = await f
      .post('/devices', f.child.token)
      .send({ token: `rollback-settings-device-${randomUUID()}` })
      .expect(200);
    const deviceId = registered.body.data.id as string;
    const notice = await db!.notification.create({
      data: { userId: f.child.id, type: 'SYSTEM', title: 'Тест', body: 'Відкат змін.' },
    });
    const delivery = await db!.pushDelivery.create({
      data: { notificationId: notice.id, deviceId, deviceVersion: 1 },
    });
    const failing = db!.$extends({
      query: {
        auditLog: {
          async create() {
            throw new Error('Test-only audit failure');
          },
        },
      },
    }) as unknown as PrismaClient;
    await request(f.appFor(failing))
      .post(`/api/v1/account/members/${f.child.id}/reset-password`)
      .auth(f.parent.token, { type: 'bearer' })
      .set('Origin', config.frontendUrl)
      .send({ currentPassword: password, newPassword })
      .expect(500);
    const user = await db!.user.findUniqueOrThrow({ where: { id: f.child.id } });
    expect(user.authVersion).toBe(0);
    expect(await bcrypt.compare(password, user.passwordHash)).toBe(true);
    expect(await bcrypt.compare(newPassword, user.passwordHash)).toBe(false);
    expect(await db!.device.findUniqueOrThrow({ where: { id: deviceId } })).toMatchObject({
      deletedAt: null,
      bindingVersion: 1,
    });
    expect(await db!.pushDelivery.findUniqueOrThrow({ where: { id: delivery.id } })).toMatchObject({
      status: 'PENDING',
    });
    await f.get('/me', session.token).expect(200);
    await f.refresh(session.cookie).expect(200);
    expect(await db!.auditLog.count({ where: { familyId: f.family.id } })).toBe(0);
  });
});
