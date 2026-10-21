import type { PublicUser, DashboardData } from '@kidquest/types';
import type { MemberInput, RegisterInput } from '@kidquest/validation';

export interface UserRecord extends PublicUser {
  passwordHash: string;
  isActive: boolean;
  deletedAt: Date | null;
  familyDeletedAt: Date | null;
  childId: string | null;
}

export interface RefreshRecord {
  id: string;
  userId: string;
  tokenHash: string;
  sessionId: string;
  expiresAt: Date;
  revokedAt: Date | null;
}

export interface LoginMetadata {
  ipAddress: string;
  userAgent: string;
}

export interface AuthRepository {
  findByEmail(email: string): Promise<UserRecord | null>;
  findById(id: string): Promise<UserRecord | null>;
  createFamilyWithParent(input: RegisterInput, passwordHash: string): Promise<UserRecord>;
  createMember(familyId: string, input: MemberInput, passwordHash: string): Promise<PublicUser>;
  listMembers(familyId: string): Promise<PublicUser[]>;
  addLoginLog(userId: string | null, metadata: LoginMetadata, success: boolean): Promise<void>;
  createRefresh(input: Omit<RefreshRecord, 'id' | 'revokedAt'>): Promise<RefreshRecord>;
  findRefresh(tokenHash: string): Promise<RefreshRecord | null>;
  rotateRefresh(oldId: string, input: Omit<RefreshRecord, 'id' | 'revokedAt'>): Promise<boolean>;
  revokeSession(sessionId: string): Promise<void>;
  dashboard(user: UserRecord): Promise<DashboardData>;
}

export interface AuthConfig {
  jwtSecret: string;
  frontendUrl: string;
  accessSeconds: number;
  refreshDays: number;
  production: boolean;
}

export function publicUser(user: PublicUser): PublicUser {
  return {
    id: user.id,
    email: user.email,
    firstName: user.firstName,
    lastName: user.lastName,
    role: user.role,
    familyId: user.familyId,
  };
}
