import { randomUUID } from 'node:crypto';
import { PrismaClient } from '@prisma/client';
import dotenv from 'dotenv';
import request from 'supertest';
import { afterAll, describe, expect, it } from 'vitest';
import jwt from 'jsonwebtoken';
import { createApp } from '../src/app.js';
import { PrismaAuthRepository } from '../src/modules/auth/auth.repository.js';
import type { AuthConfig, AuthRepository } from '../src/modules/auth/auth.types.js';
import { MemoryRepository } from './memory-repository.js';

dotenv.config({ path: '../.local/test-db.env', quiet: true });
const config: AuthConfig = {
  jwtSecret: 'test-only-generated-secret-with-more-than-32-characters',
  frontendUrl: 'http://localhost:5173',
  accessSeconds: 900,
  refreshDays: 30,
  production: false,
};
const password = 'OnlyForIntegrationTests!';
const newEmail = () => `${randomUUID()}@kidquest.test`;
const prisma = process.env.DATABASE_TEST_URL
  ? new PrismaClient({ datasourceUrl: process.env.DATABASE_TEST_URL })
  : null;
const drivers: { name: string; repository: () => AuthRepository }[] = [
  { name: 'memory adapter', repository: () => new MemoryRepository() },
];
if (prisma)
  drivers.push({
    name: 'PostgreSQL Prisma adapter',
    repository: () => new PrismaAuthRepository(prisma),
  });
afterAll(async () => {
  await prisma?.$disconnect();
});

describe.each(drivers)('Authentication through HTTP: $name', ({ repository }) => {
  function setup() {
    const repo = repository();
    return { repo, app: createApp(repo, config) };
  }

  async function register(app: ReturnType<typeof createApp>, email = newEmail()) {
    const response = await request(app)
      .post('/api/v1/auth/register')
      .set('Origin', config.frontendUrl)
      .send({ email, password, firstName: 'Олена', familyName: 'Родина тестів' })
      .expect(201);
    return {
      token: response.body.data.accessToken as string,
      user: response.body.data.user as {
        id: string;
        email: string;
        role: string;
        familyId: string;
      },
      cookie: (response.headers['set-cookie'] as unknown as string[])[0]!.split(';')[0]!,
      response,
    };
  }

  it('registers a parent, hashes the password, exposes public fields and records login', async () => {
    const { app, repo } = setup();
    const session = await register(app);
    expect(session.user.role).toBe('PARENT');
    expect(session.response.body.data.user).not.toHaveProperty('passwordHash');
    expect(session.response.headers['set-cookie'][0]).toContain('HttpOnly');
    expect(session.response.headers['set-cookie'][0]).toContain('SameSite=Strict');
    expect((await repo.findById(session.user.id))!.passwordHash).toMatch(/^\$2[aby]\$/);
    const me = await request(app)
      .get('/api/v1/me')
      .auth(session.token, { type: 'bearer' })
      .expect(200);
    expect(me.body.data.email).toBe(session.user.email);
  });

  it('validates credentials without revealing whether the email exists', async () => {
    const { app } = setup();
    const parent = await register(app);
    const known = await request(app)
      .post('/api/v1/auth/login')
      .set('Origin', config.frontendUrl)
      .send({ email: parent.user.email, password: 'incorrect' })
      .expect(401);
    const unknown = await request(app)
      .post('/api/v1/auth/login')
      .set('Origin', config.frontendUrl)
      .send({ email: newEmail(), password: 'incorrect' })
      .expect(401);
    expect(known.body).toEqual(unknown.body);
    await request(app)
      .post('/api/v1/auth/login')
      .set('Origin', config.frontendUrl)
      .send({ email: parent.user.email, password })
      .expect(200);
  });

  it('rotates refresh tokens and revokes the whole session on reuse', async () => {
    const { app } = setup();
    const parent = await register(app);
    const renewed = await request(app)
      .post('/api/v1/auth/refresh')
      .set('Origin', config.frontendUrl)
      .set('Cookie', parent.cookie)
      .expect(200);
    const nextCookie = (renewed.headers['set-cookie'] as unknown as string[])[0]!.split(';')[0]!;
    expect(nextCookie).not.toBe(parent.cookie);
    await request(app)
      .post('/api/v1/auth/refresh')
      .set('Origin', config.frontendUrl)
      .set('Cookie', parent.cookie)
      .expect(401);
    await request(app)
      .post('/api/v1/auth/refresh')
      .set('Origin', config.frontendUrl)
      .set('Cookie', nextCookie)
      .expect(401);
  });

  it('revokes refresh tokens on logout', async () => {
    const { app } = setup();
    const parent = await register(app);
    await request(app)
      .post('/api/v1/auth/logout')
      .set('Origin', config.frontendUrl)
      .set('Cookie', parent.cookie)
      .expect(200);
    await request(app)
      .post('/api/v1/auth/refresh')
      .set('Origin', config.frontendUrl)
      .set('Cookie', parent.cookie)
      .expect(401);
  });

  it('requires trusted origin and blocks cookie CSRF', async () => {
    const { app } = setup();
    await request(app)
      .post('/api/v1/auth/login')
      .set('Origin', 'https://untrusted.example')
      .send({})
      .expect(403);
    await request(app).post('/api/v1/auth/logout').expect(403);
  });

  it('validates input and refuses public role/family injection', async () => {
    const { app } = setup();
    await request(app)
      .post('/api/v1/auth/register')
      .set('Origin', config.frontendUrl)
      .send({
        email: newEmail(),
        password,
        firstName: 'Тест',
        familyName: 'Тест',
        role: 'CHILD',
        familyId: randomUUID(),
      })
      .expect(400);
    await request(app)
      .post('/api/v1/auth/register')
      .set('Origin', config.frontendUrl)
      .send({ email: 'invalid', password: 'short', firstName: '', familyName: '' })
      .expect(400);
  });

  it('rejects missing, invalid and wrong-audience access tokens', async () => {
    const { app } = setup();
    const parent = await register(app);
    await request(app).get('/api/v1/me').expect(401);
    await request(app).get('/api/v1/me').auth('invalid', { type: 'bearer' }).expect(401);
    const forged = jwt.sign({}, config.jwtSecret, {
      subject: parent.user.id,
      audience: 'other-app',
      issuer: 'kidquest-api',
    });
    await request(app).get('/api/v1/me').auth(forged, { type: 'bearer' }).expect(401);
  });

  it('creates a child in the authenticated family and denies child administration', async () => {
    const { app } = setup();
    const parent = await register(app);
    const email = newEmail();
    const child = await request(app)
      .post('/api/v1/family/members')
      .set('Origin', config.frontendUrl)
      .auth(parent.token, { type: 'bearer' })
      .send({ email, password, firstName: 'Богдан', role: 'CHILD' })
      .expect(201);
    expect(child.body.data.familyId).toBe(parent.user.familyId);
    const login = await request(app)
      .post('/api/v1/auth/login')
      .set('Origin', config.frontendUrl)
      .send({ email, password })
      .expect(200);
    const childToken = login.body.data.accessToken as string;
    await request(app)
      .get('/api/v1/family/members')
      .auth(childToken, { type: 'bearer' })
      .expect(403);
    await request(app)
      .post('/api/v1/family/members')
      .set('Origin', config.frontendUrl)
      .auth(childToken, { type: 'bearer' })
      .send({ email: newEmail(), password, firstName: 'Тест', role: 'PARENT' })
      .expect(403);
    const statistics = await request(app)
      .get('/api/v1/statistics')
      .auth(childToken, { type: 'bearer' })
      .expect(200);
    expect(statistics.body.data.child.firstName).toBe('Богдан');
    expect(statistics.body.data.balance).toBe(0);
  });

  it('keeps family members isolated and limits the family to two parents', async () => {
    const { app } = setup();
    const first = await register(app);
    const second = await register(app);
    const members = await request(app)
      .get('/api/v1/family/members')
      .auth(first.token, { type: 'bearer' })
      .expect(200);
    expect(members.body.data).toHaveLength(1);
    expect(members.body.data[0].id).not.toBe(second.user.id);
    await request(app)
      .post('/api/v1/family/members')
      .set('Origin', config.frontendUrl)
      .auth(first.token, { type: 'bearer' })
      .send({ email: newEmail(), password, firstName: 'Тато', role: 'PARENT' })
      .expect(201);
    const third = await request(app)
      .post('/api/v1/family/members')
      .set('Origin', config.frontendUrl)
      .auth(first.token, { type: 'bearer' })
      .send({ email: newEmail(), password, firstName: 'Третій', role: 'PARENT' })
      .expect(409);
    expect(third.body.error.code).toBe('PARENT_LIMIT');
  });

  it('enforces the two-parent limit when membership requests race', async () => {
    const { app } = setup();
    const parent = await register(app);
    const responses = await Promise.all(
      ['Мама', 'Тато'].map((firstName) =>
        request(app)
          .post('/api/v1/family/members')
          .set('Origin', config.frontendUrl)
          .auth(parent.token, { type: 'bearer' })
          .send({ email: newEmail(), password, firstName, role: 'PARENT' }),
      ),
    );
    expect(responses.map((response) => response.status).sort()).toEqual([201, 409]);
    const members = await request(app)
      .get('/api/v1/family/members')
      .auth(parent.token, { type: 'bearer' })
      .expect(200);
    expect(members.body.data).toHaveLength(2);
  });

  it('rejects soft-deleted users even with an existing valid access token', async () => {
    const { app, repo } = setup();
    const parent = await register(app);
    if (repo instanceof MemoryRepository)
      repo.users.find((user) => user.id === parent.user.id)!.deletedAt = new Date();
    else
      await prisma!.user.update({ where: { id: parent.user.id }, data: { deletedAt: new Date() } });
    await request(app).get('/api/v1/me').auth(parent.token, { type: 'bearer' }).expect(401);
    await request(app)
      .post('/api/v1/auth/refresh')
      .set('Origin', config.frontendUrl)
      .set('Cookie', parent.cookie)
      .expect(401);
  });

  it('returns standardized not-found errors and security headers', async () => {
    const { app } = setup();
    const response = await request(app).get('/api/v1/unknown').expect(404);
    expect(response.body).toEqual({
      success: false,
      error: { code: 'NOT_FOUND', message: 'Сторінку не знайдено.' },
    });
    expect(response.headers['x-content-type-options']).toBe('nosniff');
    expect(response.headers['x-powered-by']).toBeUndefined();
  });
});

describe.skipIf(!prisma)('PostgreSQL dashboard data isolation', () => {
  it('excludes another family, deleted tasks and another child’s ledger', async () => {
    const repository = new PrismaAuthRepository(prisma!);
    const createFamily = async (name: string) => {
      const user = await repository.createFamilyWithParent(
        { email: newEmail(), password, firstName: name, familyName: name },
        'unused-hash',
      );
      const child = await repository.createMember(
        user.familyId,
        { email: newEmail(), password, firstName: 'Дитина', role: 'CHILD' },
        'unused-hash',
      );
      const record = await prisma!.child.findUniqueOrThrow({ where: { userId: child.id } });
      const category = await prisma!.taskCategory.create({
        data: { familyId: user.familyId, name: 'Дім' },
      });
      await prisma!.task.create({
        data: { familyId: user.familyId, categoryId: category.id, title: name, points: 10 },
      });
      return { user, childId: record.id, category };
    };
    const own = await createFamily('Своя сім’я');
    const other = await createFamily('Інша сім’я');
    await prisma!.task.create({
      data: {
        familyId: own.user.familyId,
        categoryId: own.category.id,
        title: 'Видалено',
        points: 20,
        deletedAt: new Date(),
      },
    });
    await prisma!.pointTransaction.create({
      data: { familyId: own.user.familyId, childId: own.childId, amount: 17, type: 'BONUS' },
    });
    await prisma!.pointTransaction.create({
      data: { familyId: other.user.familyId, childId: other.childId, amount: 999, type: 'BONUS' },
    });
    const data = await repository.dashboard(own.user);
    expect(data.tasks.map((task) => task.title)).toEqual(['Своя сім’я']);
    expect(data.counts.activeTasks).toBe(1);
    expect(data.balance).toBe(17);
  });
});
