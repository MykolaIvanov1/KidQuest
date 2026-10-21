import type { PrismaClient, Prisma } from '@prisma/client';
import type { RewardInput, RewardUpdateInput } from '@kidquest/validation';

export class RewardsRepository {
  constructor(private db: PrismaClient | Prisma.TransactionClient) {}

  list(familyId: string, activeOnly: boolean) {
    return this.db.reward.findMany({
      where: { familyId, deletedAt: null, ...(activeOnly ? { isActive: true } : {}) },
      orderBy: [{ cost: 'asc' }, { createdAt: 'asc' }, { id: 'asc' }],
    });
  }

  find(familyId: string, id: string) {
    return this.db.reward.findFirst({ where: { id, familyId, deletedAt: null } });
  }

  create(familyId: string, input: RewardInput) {
    return this.db.reward.create({ data: { familyId, ...input } });
  }

  update(id: string, input: RewardUpdateInput) {
    return this.db.reward.update({ where: { id }, data: input });
  }

  softDelete(id: string) {
    return this.db.reward.update({
      where: { id },
      data: { deletedAt: new Date(), isActive: false },
    });
  }

  audit(familyId: string, userId: string, action: string, entityId: string) {
    return this.db.auditLog.create({
      data: { familyId, userId, action, entityId, entityType: 'Reward' },
    });
  }
}
