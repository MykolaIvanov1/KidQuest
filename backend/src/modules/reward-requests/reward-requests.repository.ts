import type { Prisma, PrismaClient, RewardRequestStatus } from '@prisma/client';
import { requestInclude } from './reward-requests.types.js';

const visibleRelations = {
  deletedAt: null,
  reward: { deletedAt: null },
  child: { deletedAt: null, user: { deletedAt: null, isActive: true, role: 'CHILD' as const } },
};

export class RewardRequestRepository {
  constructor(private db: PrismaClient | Prisma.TransactionClient) {}

  find(familyId: string, id: string, childId?: string) {
    return this.db.rewardRequest.findFirst({
      where: { ...visibleRelations, id, familyId, ...(childId ? { childId } : {}) },
      include: requestInclude,
    });
  }

  operation(operationId: string) {
    return this.db.rewardRequest.findUnique({ where: { operationId }, include: requestInclude });
  }

  list(familyId: string, childId?: string, statuses?: RewardRequestStatus[]) {
    return this.db.rewardRequest.findMany({
      where: {
        ...visibleRelations,
        familyId,
        ...(childId ? { childId } : {}),
        ...(statuses ? { status: { in: statuses } } : {}),
      },
      include: requestInclude,
      orderBy: [{ createdAt: 'desc' }, { id: 'desc' }],
      take: 100,
    });
  }

  create(data: Prisma.RewardRequestUncheckedCreateInput) {
    return this.db.rewardRequest.create({ data, include: requestInclude });
  }

  update(id: string, data: Prisma.RewardRequestUncheckedUpdateInput) {
    return this.db.rewardRequest.update({ where: { id }, data, include: requestInclude });
  }

  createPoint(data: Prisma.PointTransactionUncheckedCreateInput) {
    return this.db.pointTransaction.create({ data });
  }

  audit(familyId: string, userId: string, action: string, entityId: string) {
    return this.db.auditLog.create({
      data: { familyId, userId, action, entityId, entityType: 'RewardRequest' },
    });
  }
}
