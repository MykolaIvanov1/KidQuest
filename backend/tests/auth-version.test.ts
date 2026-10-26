import bcrypt from 'bcrypt';
import jwt from 'jsonwebtoken';
import { beforeAll, describe, expect, it, vi } from 'vitest';
import { AuthService } from '../src/modules/auth/auth.service.js';
import type { AuthConfig } from '../src/modules/auth/auth.types.js';
import { MemoryRepository } from './memory-repository.js';

const config: AuthConfig = {
  jwtSecret: 'test-only-version-fencing-secret-more-than-32-characters',
  frontendUrl: 'http://localhost:5173',
  accessSeconds: 900,
  refreshDays: 30,
  production: false,
};
const metadata = { ipAddress: '127.0.0.1', userAgent: 'Version tests' };
const password = 'Local-version-test-2026!';
let hash: string;
beforeAll(async () => {
  hash = await bcrypt.hash(password, 4);
});

async function setup() {
  const repo = new MemoryRepository();
  const user = await repo.createFamilyWithParent(
    { email: 'version@example.test', password, firstName: 'Мама', familyName: 'Тести' },
    hash,
  );
  const service = new AuthService(repo, config);
  const token = (payload: object) =>
    jwt.sign(payload, config.jwtSecret, {
      subject: user.id,
      issuer: 'kidquest-api',
      audience: 'kidquest-web',
      expiresIn: 900,
    });
  return { repo, user, service, token };
}

describe('authentication version fencing', () => {
  it('accepts legacy tokens only until the first security change', async () => {
    const { user, service, token } = await setup();
    const legacy = token({});
    expect((await service.authenticate(legacy)).id).toBe(user.id);
    user.authVersion += 1;
    await expect(service.authenticate(legacy)).rejects.toMatchObject({ status: 401 });
    expect((await service.authenticate(token({ ver: 1 }))).id).toBe(user.id);
  });

  it.each([null, '0', -1, 0.5, 9007199254740992])('rejects malformed version %j', async (ver) => {
    const { service, token } = await setup();
    await expect(service.authenticate(token({ ver }))).rejects.toMatchObject({ status: 401 });
  });

  it('rejects refresh tokens even when a concurrent login inserts them after revocation', async () => {
    const { repo, user, service } = await setup();
    vi.spyOn(repo, 'findByEmail').mockResolvedValue({ ...user });
    const insert = repo.createRefresh.bind(repo);
    vi.spyOn(repo, 'createRefresh').mockImplementation(async (record) => {
      // A password reset commits after bcrypt verified the old snapshot, before token insertion.
      user.authVersion += 1;
      return insert(record);
    });
    const stale = await service.login({ email: user.email, password }, metadata);
    expect(repo.refreshTokens[0]!.authVersion).toBe(0);
    await expect(service.authenticate(stale.session.accessToken)).rejects.toMatchObject({
      status: 401,
    });
    await expect(service.refresh(stale.refreshToken)).rejects.toMatchObject({ status: 401 });
  });

  it('keeps a refresh racing a security change bound to the old version', async () => {
    const { repo, user, service } = await setup();
    const initial = await service.login({ email: user.email, password }, metadata);
    vi.spyOn(repo, 'findById').mockImplementation(async () => ({ ...user }));
    const rotate = repo.rotateRefresh.bind(repo);
    vi.spyOn(repo, 'rotateRefresh').mockImplementation(async (id, record) => {
      user.authVersion += 1;
      return rotate(id, record);
    });
    const stale = await service.refresh(initial.refreshToken);
    await expect(service.authenticate(stale.session.accessToken)).rejects.toMatchObject({
      status: 401,
    });
    await expect(service.refresh(stale.refreshToken)).rejects.toMatchObject({ status: 401 });
  });

  it('issues working sessions after the new version has been authenticated', async () => {
    const { user, service } = await setup();
    user.authVersion = 3;
    const current = await service.login({ email: user.email, password }, metadata);
    expect((await service.authenticate(current.session.accessToken)).authVersion).toBe(3);
    const rotated = await service.refresh(current.refreshToken);
    expect((await service.authenticate(rotated.session.accessToken)).authVersion).toBe(3);
  });
});
