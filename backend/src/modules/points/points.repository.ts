import type { PrismaClient, Prisma } from '@prisma/client';
import type { UserRecord } from '../auth/auth.types.js';
import { AppError } from '../../errors/app-error.js';

export type PointsDatabase = PrismaClient | Prisma.TransactionClient;

export async function selectedChild(
  db: PointsDatabase,
  user: UserRecord,
  requestedChildId?: string,
) {
  if (user.role === 'CHILD' && requestedChildId && requestedChildId !== user.childId) {
    throw new AppError(403, 'FORBIDDEN', 'Доступні лише власні бали.');
  }
  const childId = user.role === 'CHILD' ? user.childId : requestedChildId;
  const child = await db.child.findFirst({
    where: {
      familyId: user.familyId,
      deletedAt: null,
      ...(childId ? { id: childId } : {}),
      ...(user.role === 'CHILD' ? { userId: user.id } : {}),
      user: { isActive: true, deletedAt: null, role: 'CHILD' },
    },
    orderBy: [{ createdAt: 'asc' }, { id: 'asc' }],
  });
  if (!child && (childId || user.role === 'CHILD')) {
    throw new AppError(404, 'CHILD_NOT_FOUND', 'Профіль дитини недоступний.');
  }
  return child;
}

export async function pointBalance(db: PointsDatabase, familyId: string, childId: string) {
  const result = await db.pointTransaction.aggregate({
    where: { familyId, childId },
    _sum: { amount: true },
  });
  return result._sum.amount ?? 0;
}

export class PointsRepository {
  constructor(private db: PrismaClient) {}

  selectChild(user: UserRecord, requestedChildId?: string) {
    return selectedChild(this.db, user, requestedChildId);
  }

  balance(familyId: string, childId: string) {
    return pointBalance(this.db, familyId, childId);
  }

  history(familyId: string, childId: string) {
    return this.db.pointTransaction.findMany({
      where: { familyId, childId },
      orderBy: [{ createdAt: 'desc' }, { id: 'desc' }],
      take: 100,
    });
  }
}
