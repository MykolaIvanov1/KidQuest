import { randomUUID } from 'node:crypto';
import type { DashboardData, PublicUser } from '@kidquest/types';
import type { MemberInput, RegisterInput } from '@kidquest/validation';
import { AppError } from '../src/errors/app-error.js';
import {
  publicUser,
  type AuthRepository,
  type LoginMetadata,
  type RefreshRecord,
  type UserRecord,
} from '../src/modules/auth/auth.types.js';

export class MemoryRepository implements AuthRepository {
  users: UserRecord[] = [];
  refreshTokens: RefreshRecord[] = [];
  loginLogs: { userId: string | null; success: boolean }[] = [];
  families = new Map<string, string>();

  async findByEmail(email: string) {
    return this.users.find((user) => user.email === email) ?? null;
  }
  async findById(id: string) {
    return this.users.find((user) => user.id === id) ?? null;
  }

  async createFamilyWithParent(input: RegisterInput, passwordHash: string) {
    if (await this.findByEmail(input.email))
      throw new AppError(409, 'EMAIL_IN_USE', 'Адреса зайнята.');
    const familyId = randomUUID();
    this.families.set(familyId, input.familyName);
    const user: UserRecord = {
      id: randomUUID(),
      familyId,
      email: input.email,
      firstName: input.firstName,
      lastName: input.lastName ?? '',
      role: 'PARENT',
      passwordHash,
      authVersion: 0,
      isActive: true,
      deletedAt: null,
      familyDeletedAt: null,
      childId: null,
    };
    this.users.push(user);
    return user;
  }

  async createMember(
    familyId: string,
    input: MemberInput,
    passwordHash: string,
    actor?: { id: string; authVersion: number },
  ) {
    if (
      actor &&
      !this.users.some(
        (user) =>
          user.id === actor.id &&
          user.familyId === familyId &&
          user.authVersion === actor.authVersion &&
          user.role === 'PARENT' &&
          user.isActive &&
          !user.deletedAt,
      )
    )
      throw new AppError(401, 'UNAUTHENTICATED', 'Увійдіть до свого облікового запису.');
    if (await this.findByEmail(input.email))
      throw new AppError(409, 'EMAIL_IN_USE', 'Адреса зайнята.');
    if (
      input.role === 'PARENT' &&
      this.users.filter(
        (user) => user.familyId === familyId && user.role === 'PARENT' && !user.deletedAt,
      ).length >= 2
    )
      throw new AppError(409, 'PARENT_LIMIT', 'Ліміт батьків.');
    const user: UserRecord = {
      id: randomUUID(),
      familyId,
      email: input.email,
      firstName: input.firstName,
      lastName: input.lastName ?? '',
      role: input.role,
      passwordHash,
      authVersion: 0,
      isActive: true,
      deletedAt: null,
      familyDeletedAt: null,
      childId: input.role === 'CHILD' ? randomUUID() : null,
    };
    this.users.push(user);
    return publicUser(user);
  }

  async listMembers(familyId: string): Promise<PublicUser[]> {
    return this.users
      .filter((user) => user.familyId === familyId && !user.deletedAt && user.isActive)
      .map(publicUser);
  }
  async addLoginLog(userId: string | null, _metadata: LoginMetadata, success: boolean) {
    this.loginLogs.push({ userId, success });
  }
  async createRefresh(input: Omit<RefreshRecord, 'id' | 'revokedAt'>) {
    const token = { ...input, id: randomUUID(), revokedAt: null };
    this.refreshTokens.push(token);
    return token;
  }
  async findRefresh(tokenHash: string) {
    return this.refreshTokens.find((token) => token.tokenHash === tokenHash) ?? null;
  }
  async rotateRefresh(oldId: string, input: Omit<RefreshRecord, 'id' | 'revokedAt'>) {
    const old = this.refreshTokens.find((token) => token.id === oldId && !token.revokedAt);
    if (!old) return false;
    old.revokedAt = new Date();
    await this.createRefresh(input);
    return true;
  }
  async revokeSession(sessionId: string) {
    this.refreshTokens
      .filter((token) => token.sessionId === sessionId)
      .forEach((token) => {
        token.revokedAt = new Date();
      });
  }
  async dashboard(user: UserRecord): Promise<DashboardData> {
    const children = this.users.filter(
      (member) => member.familyId === user.familyId && member.role === 'CHILD' && !member.deletedAt,
    );
    const child = user.role === 'CHILD' ? user : children[0];
    return {
      family: {
        id: user.familyId,
        name: this.families.get(user.familyId)!,
        timeZone: 'Europe/Kyiv',
      },
      child: child ? { id: child.childId!, firstName: child.firstName } : null,
      counts: {
        children: children.length,
        activeTasks: 0,
        activeRewards: 0,
        pendingCompletions: 0,
        pendingRewards: 0,
      },
      balance: 0,
      tasks: [],
      rewards: [],
      today: { approved: 0, total: 0 },
      streak: null,
    };
  }
}
