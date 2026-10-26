import request from 'supertest';
import { afterEach, describe, expect, it, vi } from 'vitest';
import type { PrismaClient } from '@prisma/client';
import { createApp } from '../src/app.js';
import { readEnvironment } from '../src/config/env.js';
import { MemoryRepository } from './memory-repository.js';
const environment = {
  DATABASE_URL: 'postgresql://local:local@localhost/kidquest',
  JWT_SECRET: 'production-configuration-test-secret-only',
};
const config = {
  jwtSecret: environment.JWT_SECRET,
  frontendUrl: 'https://kidquest.example.test',
  accessSeconds: 900,
  refreshDays: 30,
  production: false,
};
afterEach(() => vi.restoreAllMocks());
describe('Production deployment boundary', () => {
  it('requires HTTPS in production and reports only the configuration field', () => {
    expect(() =>
      readEnvironment({
        ...environment,
        NODE_ENV: 'production',
        FRONTEND_URL: 'http://kidquest.example.test',
      }),
    ).toThrow('FRONTEND_URL');
    expect(
      readEnvironment({ ...environment, NODE_ENV: 'production', FRONTEND_URL: config.frontendUrl })
        .FRONTEND_URL,
    ).toBe(config.frontendUrl);
  });
  it('trusts no proxy by default and accepts only an explicit single-hop configuration', () => {
    expect(readEnvironment(environment).TRUST_PROXY).toBe(false);
    expect(readEnvironment({ ...environment, TRUST_PROXY: '1' }).TRUST_PROXY).toBe(true);
    expect(() => readEnvironment({ ...environment, TRUST_PROXY: 'true' })).toThrow('TRUST_PROXY');
  });
  it.each([false, true])(
    'uses the nearest trusted hop only when trustProxy=%s',
    async (trustProxy) => {
      const warnings = vi.spyOn(console, 'error').mockImplementation(() => undefined);
      const repository = new MemoryRepository();
      const log = vi.spyOn(repository, 'addLoginLog');
      const app = createApp(repository, { ...config, trustProxy });
      const response = await request(app)
        .post('/api/v1/auth/register')
        .set('Origin', config.frontendUrl)
        .set('X-Forwarded-For', '198.51.100.23, 203.0.113.8')
        .send({
          email: 'proxy@example.test',
          password: 'Only-a-test-password!',
          firstName: 'Мама',
          familyName: 'Родина',
        });
      expect(response.status).toBe(201);
      expect(
        warnings.mock.calls.every(
          ([error]) => error?.code === 'ERR_ERL_UNEXPECTED_X_FORWARDED_FOR',
        ),
      ).toBe(true);
      const metadata = log.mock.calls[0]![1];
      if (trustProxy) expect(metadata.ipAddress).toBe('203.0.113.8');
      else expect(metadata.ipAddress).not.toMatch(/198\.51\.100\.23|203\.0\.113\.8/);
    },
  );
  it('checks database readiness separately from liveness without leaking connection errors', async () => {
    const query = vi.fn().mockResolvedValue([{ '?column?': 1 }]);
    const database = { $queryRaw: query } as unknown as PrismaClient;
    const app = createApp(new MemoryRepository(), config, {
      database,
      storagePath: '.local/readiness',
    });
    expect((await request(app).get('/api/v1/ready')).body).toEqual({
      success: true,
      data: { status: 'ready' },
    });
    query.mockRejectedValueOnce(new Error('postgresql://sensitive-password@private-server'));
    const unavailable = await request(app).get('/api/v1/ready');
    expect(unavailable.status).toBe(503);
    expect(unavailable.body.error.code).toBe('NOT_READY');
    expect(JSON.stringify(unavailable.body)).not.toContain('sensitive-password');
    expect((await request(app).get('/api/v1/health')).status).toBe(200);
  });
});
