import type { PrismaClient } from '@prisma/client';
import type { UserRecord } from '../auth/auth.types.js';

export class PhotoRepository {
  constructor(private db: PrismaClient) {}
  find(user: UserRecord, id: string) {
    return this.db.taskPhoto.findFirst({
      where: {
        id,
        deletedAt: null,
        completion: {
          familyId: user.familyId,
          deletedAt: null,
          ...(user.role === 'CHILD' ? { childId: user.childId! } : {}),
          task: { deletedAt: null },
          child: { deletedAt: null, user: { deletedAt: null, isActive: true } },
        },
      },
    });
  }
}
