import { createHash, randomBytes, randomUUID } from 'node:crypto';
import bcrypt from 'bcrypt';
import jwt from 'jsonwebtoken';
import type { AuthSession } from '@kidquest/types';
import type { LoginInput, RegisterInput } from '@kidquest/validation';
import { AppError } from '../../errors/app-error.js';
import { logger } from '../../utils/logger.js';
import {
  publicUser,
  type AuthConfig,
  type AuthRepository,
  type LoginMetadata,
  type UserRecord,
} from './auth.types.js';

const ISSUER = 'kidquest-api';
const AUDIENCE = 'kidquest-web';
const invalidSession = () =>
  new AppError(401, 'UNAUTHENTICATED', 'Увійдіть до свого облікового запису.');
const digest = (token: string) => createHash('sha256').update(token).digest('hex');

export class AuthService {
  // Always run bcrypt, including for unknown addresses, to reduce account enumeration through timing.
  private dummyHash = bcrypt.hash('unused-comparison-value', 12);

  constructor(
    public repository: AuthRepository,
    private config: AuthConfig,
  ) {}

  private active(user: UserRecord | null): asserts user is UserRecord {
    if (
      !user ||
      !user.isActive ||
      user.deletedAt ||
      user.familyDeletedAt ||
      (user.role === 'CHILD' && !user.childId)
    ) {
      throw invalidSession();
    }
  }

  private access(user: UserRecord): AuthSession {
    return {
      accessToken: jwt.sign({ ver: user.authVersion }, this.config.jwtSecret, {
        algorithm: 'HS256',
        subject: user.id,
        issuer: ISSUER,
        audience: AUDIENCE,
        expiresIn: this.config.accessSeconds,
      }),
      user: publicUser(user),
    };
  }

  private newRefresh(userId: string, authVersion: number, sessionId: string = randomUUID()) {
    const raw = randomBytes(48).toString('base64url');
    return {
      raw,
      record: {
        userId,
        sessionId,
        authVersion,
        tokenHash: digest(raw),
        expiresAt: new Date(Date.now() + this.config.refreshDays * 86_400_000),
      },
    };
  }

  private async session(user: UserRecord) {
    // Keep the password-verified snapshot's version even if a security change races this login.
    const refresh = this.newRefresh(user.id, user.authVersion);
    await this.repository.createRefresh(refresh.record);
    return { session: this.access(user), refreshToken: refresh.raw };
  }

  async register(input: RegisterInput, metadata: LoginMetadata) {
    const passwordHash = await bcrypt.hash(input.password, 12);
    const user = await this.repository.createFamilyWithParent(input, passwordHash);
    await this.repository.addLoginLog(user.id, metadata, true);
    logger.info('auth.register', { userId: user.id, familyId: user.familyId });
    return this.session(user);
  }

  async login(input: LoginInput, metadata: LoginMetadata) {
    const user = await this.repository.findByEmail(input.email);
    const matches = await bcrypt.compare(
      input.password,
      user?.passwordHash ?? (await this.dummyHash),
    );
    const valid = Boolean(
      matches &&
      user?.isActive &&
      !user.deletedAt &&
      !user.familyDeletedAt &&
      (user.role !== 'CHILD' || user.childId),
    );
    await this.repository.addLoginLog(user?.id ?? null, metadata, valid);
    if (!valid || !user) {
      logger.info('auth.login_failed');
      throw new AppError(401, 'INVALID_CREDENTIALS', 'Неправильна електронна пошта або пароль.');
    }
    logger.info('auth.login', { userId: user.id });
    return this.session(user);
  }

  async authenticate(accessToken: string): Promise<UserRecord> {
    let subject: string;
    let version: number;
    try {
      const payload = jwt.verify(accessToken, this.config.jwtSecret, {
        algorithms: ['HS256'],
        issuer: ISSUER,
        audience: AUDIENCE,
      });
      if (typeof payload === 'string' || typeof payload.sub !== 'string') throw invalidSession();
      subject = payload.sub;
      // Existing access tokens predate versioning and belong to version zero only.
      const claim: unknown = payload.ver === undefined ? 0 : payload.ver;
      if (typeof claim !== 'number' || !Number.isSafeInteger(claim) || claim < 0)
        throw invalidSession();
      version = claim;
    } catch {
      throw invalidSession();
    }
    const user = await this.repository.findById(subject);
    this.active(user);
    if (user.authVersion !== version) throw invalidSession();
    return user;
  }

  async refresh(raw: unknown) {
    if (typeof raw !== 'string' || raw.length < 32 || raw.length > 256) throw invalidSession();
    const old = await this.repository.findRefresh(digest(raw));
    if (!old) throw invalidSession();
    if (old.revokedAt) {
      await this.repository.revokeSession(old.sessionId);
      logger.warn('auth.refresh_reuse', { userId: old.userId });
      throw invalidSession();
    }
    if (old.expiresAt <= new Date()) throw invalidSession();
    const user = await this.repository.findById(old.userId);
    this.active(user);
    if (old.authVersion !== user.authVersion) {
      await this.repository.revokeSession(old.sessionId);
      throw invalidSession();
    }
    const next = this.newRefresh(user.id, old.authVersion, old.sessionId);
    if (!(await this.repository.rotateRefresh(old.id, next.record))) {
      await this.repository.revokeSession(old.sessionId);
      throw invalidSession();
    }
    return { session: this.access(user), refreshToken: next.raw };
  }

  async logout(raw: unknown) {
    if (typeof raw === 'string' && raw.length <= 256) {
      const token = await this.repository.findRefresh(digest(raw));
      if (token) await this.repository.revokeSession(token.sessionId);
    }
  }
}
