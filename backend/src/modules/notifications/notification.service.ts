import type { PrismaClient } from '@prisma/client';
import type { UserRecord } from '../auth/auth.types.js';
import { NotificationRepository } from './notification.repository.js';
import type { DeviceInput, NotificationFilters } from './notification.validation.js';

export class NotificationService {
  private repository: NotificationRepository;

  constructor(db: PrismaClient) {
    this.repository = new NotificationRepository(db);
  }

  list(user: UserRecord, filters: NotificationFilters) {
    return this.repository.list(user, filters);
  }

  read(user: UserRecord, id: string) {
    return this.repository.read(user, id);
  }

  readAll(user: UserRecord) {
    return this.repository.readAll(user);
  }

  registerDevice(user: UserRecord, input: DeviceInput) {
    return this.repository.registerDevice(user, input);
  }

  revokeDevice(user: UserRecord, id: string) {
    return this.repository.revokeDevice(user, id);
  }
}
