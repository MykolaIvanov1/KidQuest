import type { PrismaClient } from '@prisma/client';
import type { RewardInput, RewardUpdateInput } from '@kidquest/validation';
import type { UserRecord } from '../auth/auth.types.js';
import { withTransaction } from '../../database/transaction.js';
import { AppError } from '../../errors/app-error.js';
import { RewardsRepository } from './rewards.repository.js';
import { rewardDto } from './rewards.types.js';
import { logger } from '../../utils/logger.js';

export class RewardsService {
  constructor(private db: PrismaClient) {}

  async list(user: UserRecord) {
    const rows = await new RewardsRepository(this.db).list(user.familyId, user.role === 'CHILD');
    return rows.map(rewardDto);
  }

  async create(user: UserRecord, input: RewardInput) {
    const result = await withTransaction(this.db, async (transaction) => {
      const repository = new RewardsRepository(transaction);
      const reward = await repository.create(user.familyId, input);
      await repository.audit(user.familyId, user.id, 'REWARD_CREATED', reward.id);
      return rewardDto(reward);
    });
    logger.info('reward.created', {
      familyId: user.familyId,
      userId: user.id,
      rewardId: result.id,
    });
    return result;
  }

  async update(user: UserRecord, id: string, input: RewardUpdateInput) {
    const result = await withTransaction(this.db, async (transaction) => {
      const repository = new RewardsRepository(transaction);
      if (!(await repository.find(user.familyId, id))) {
        throw new AppError(404, 'REWARD_NOT_FOUND', 'Нагороду не знайдено.');
      }
      const reward = await repository.update(id, input);
      await repository.audit(user.familyId, user.id, 'REWARD_UPDATED', id);
      return rewardDto(reward);
    });
    logger.info('reward.updated', { familyId: user.familyId, userId: user.id, rewardId: id });
    return result;
  }

  async remove(user: UserRecord, id: string) {
    const result = await withTransaction(this.db, async (transaction) => {
      const repository = new RewardsRepository(transaction);
      if (!(await repository.find(user.familyId, id))) {
        throw new AppError(404, 'REWARD_NOT_FOUND', 'Нагороду не знайдено.');
      }
      await repository.softDelete(id);
      await repository.audit(user.familyId, user.id, 'REWARD_DELETED', id);
      return { id };
    });
    logger.info('reward.deleted', { familyId: user.familyId, userId: user.id, rewardId: id });
    return result;
  }
}
