import bcrypt from 'bcrypt';
import type { PrismaClient } from '@prisma/client';
import type {
  ChangeEmailInput,
  ResetChildPasswordInput,
  ChangeRoleInput,
} from '@kidquest/validation';
import { AppError } from '../../errors/app-error.js';
import type { UserRecord } from '../auth/auth.types.js';
import { AccountRepository } from './account.repository.js';
import type { LoginJournalFilters } from './account.validation.js';

export class AccountService {
  private repository: AccountRepository;
  constructor(db: PrismaClient) {
    this.repository = new AccountRepository(db);
  }

  profile(user: UserRecord) {
    return this.repository.profile(user);
  }

  async changeEmail(user: UserRecord, id: string, input: ChangeEmailInput) {
    const actor = await this.reauthenticate(user, input.currentPassword);
    return this.repository.changeEmail(actor, id, input.email);
  }

  async resetPassword(user: UserRecord, id: string, input: ResetChildPasswordInput) {
    const actor = await this.reauthenticate(user, input.currentPassword);
    // Bcrypt runs before the short transaction; the actor snapshot is rechecked under its lock.
    const passwordHash = await bcrypt.hash(input.newPassword, 12);
    return this.repository.resetPassword(actor, id, passwordHash);
  }

  async changeRole(user: UserRecord, id: string, input: ChangeRoleInput) {
    const actor = await this.reauthenticate(user, input.currentPassword);
    return this.repository.changeRole(actor, id, input.role);
  }

  journal(user: UserRecord, filters: LoginJournalFilters) {
    this.parent(user);
    return this.repository.journal(user, filters);
  }

  private async reauthenticate(user: UserRecord, password: string) {
    this.parent(user);
    const actor = await this.repository.actor(user);
    if (!(await bcrypt.compare(password, actor.passwordHash))) {
      throw new AppError(403, 'INVALID_CURRENT_PASSWORD', 'Поточний пароль неправильний.');
    }
    return actor;
  }

  private parent(user: UserRecord) {
    if (user.role !== 'PARENT')
      throw new AppError(403, 'FORBIDDEN', 'Недостатньо прав для цієї дії.');
  }
}
