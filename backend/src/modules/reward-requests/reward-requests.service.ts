import { Prisma, type PrismaClient, type RewardRequestStatus } from '@prisma/client';
import type { RewardRequestInput, ReviewInput } from '@kidquest/validation';
import type { UserRecord } from '../auth/auth.types.js';
import { AppError } from '../../errors/app-error.js';
import { lockChild, withTransaction } from '../../database/transaction.js';
import { RewardsRepository } from '../rewards/rewards.repository.js';
import { pointBalance, selectedChild } from '../points/points.repository.js';
import { RewardRequestRepository } from './reward-requests.repository.js';
import { rewardRequestDto, type RequestRecord } from './reward-requests.types.js';
import { logger } from '../../utils/logger.js';

const notFound = () => new AppError(404, 'REWARD_REQUEST_NOT_FOUND', 'Запит нагороди не знайдено.');
const operationConflict = () =>
  new AppError(409, 'OPERATION_CONFLICT', 'Цю операцію вже використано для іншого запиту.');

export class RewardRequestService {
  constructor(private db: PrismaClient) {}

  private replay(user: UserRecord, rewardId: string, request: RequestRecord) {
    if (
      request.familyId !== user.familyId ||
      request.childId !== user.childId ||
      request.rewardId !== rewardId ||
      request.deletedAt ||
      request.child.deletedAt ||
      request.reward.deletedAt
    ) {
      throw operationConflict();
    }
    return { created: false, request: rewardRequestDto(request) };
  }

  async request(user: UserRecord, rewardId: string, input: RewardRequestInput) {
    if (user.role !== 'CHILD' || !user.childId) {
      throw new AppError(403, 'FORBIDDEN', 'Нагороду може запитати лише дитина.');
    }
    try {
      const result = await withTransaction(this.db, async (transaction) => {
        await lockChild(transaction, user.familyId, user.childId!);
        const reward = await new RewardsRepository(transaction).find(user.familyId, rewardId);
        if (!reward) throw new AppError(404, 'REWARD_NOT_FOUND', 'Нагороду не знайдено.');
        const repository = new RewardRequestRepository(transaction);
        const previous = await repository.operation(input.operationId);
        if (previous) return this.replay(user, rewardId, previous);
        if (!reward.isActive) {
          throw new AppError(409, 'REWARD_INACTIVE', 'Ця нагорода зараз недоступна.');
        }
        const request = await repository.create({
          familyId: user.familyId,
          childId: user.childId!,
          rewardId,
          operationId: input.operationId,
          costSnapshot: reward.cost,
          status: 'PENDING',
        });
        await repository.audit(user.familyId, user.id, 'REWARD_REQUESTED', request.id);
        return { created: true, request: rewardRequestDto(request) };
      });
      if (result.created) {
        logger.info('reward.requested', {
          familyId: user.familyId,
          userId: user.id,
          requestId: result.request.id,
        });
      }
      return result;
    } catch (error: unknown) {
      if (error instanceof Prisma.PrismaClientKnownRequestError && error.code === 'P2002') {
        const previous = await new RewardRequestRepository(this.db).operation(input.operationId);
        if (previous) return this.replay(user, rewardId, previous);
        throw operationConflict();
      }
      throw error;
    }
  }

  async list(user: UserRecord, requestedChildId?: string, statuses?: RewardRequestStatus[]) {
    let childId = requestedChildId;
    if (user.role === 'CHILD' || requestedChildId) {
      childId = (await selectedChild(this.db, user, requestedChildId))?.id;
    }
    const rows = await new RewardRequestRepository(this.db).list(user.familyId, childId, statuses);
    return rows.map(rewardRequestDto);
  }

  private async lockedRequest(transaction: Prisma.TransactionClient, user: UserRecord, id: string) {
    const repository = new RewardRequestRepository(transaction);
    const request = await repository.find(user.familyId, id);
    if (!request) throw notFound();
    await lockChild(transaction, user.familyId, request.childId);
    return { repository, request };
  }

  async approve(user: UserRecord, id: string) {
    const result = await withTransaction(this.db, async (transaction) => {
      const { repository, request } = await this.lockedRequest(transaction, user, id);
      if (request.status === 'APPROVED' || request.status === 'ISSUED')
        return rewardRequestDto(request);
      if (request.status !== 'PENDING') {
        throw new AppError(409, 'INVALID_REQUEST_STATUS', 'Можна підтвердити лише новий запит.');
      }
      if (!request.reward.isActive) {
        throw new AppError(409, 'REWARD_INACTIVE', 'Ця нагорода зараз недоступна.');
      }
      const balance = await pointBalance(transaction, user.familyId, request.childId);
      if (balance < request.costSnapshot) {
        throw new AppError(409, 'INSUFFICIENT_POINTS', 'Для цієї нагороди ще недостатньо балів.');
      }
      const updated = await repository.update(id, {
        status: 'APPROVED',
        reviewedAt: new Date(),
        reviewedById: user.id,
      });
      await repository.createPoint({
        familyId: user.familyId,
        childId: request.childId,
        type: 'REWARD_PURCHASE',
        amount: -request.costSnapshot,
        rewardRequestId: request.id,
        description: request.reward.title,
        createdById: user.id,
      });
      await repository.audit(user.familyId, user.id, 'REWARD_REQUEST_APPROVED', id);
      return rewardRequestDto(updated);
    });
    logger.info('reward.approve_succeeded', {
      familyId: user.familyId,
      userId: user.id,
      requestId: id,
    });
    return result;
  }

  async reject(user: UserRecord, id: string, input: ReviewInput) {
    const result = await withTransaction(this.db, async (transaction) => {
      const { repository, request } = await this.lockedRequest(transaction, user, id);
      if (request.status === 'REJECTED') return rewardRequestDto(request);
      if (request.status !== 'PENDING') {
        throw new AppError(409, 'INVALID_REQUEST_STATUS', 'Можна відхилити лише новий запит.');
      }
      const updated = await repository.update(id, {
        status: 'REJECTED',
        reviewedAt: new Date(),
        reviewedById: user.id,
        rejectionReason: input.reason?.trim() || null,
      });
      await repository.audit(user.familyId, user.id, 'REWARD_REQUEST_REJECTED', id);
      return rewardRequestDto(updated);
    });
    logger.info('reward.reject_succeeded', {
      familyId: user.familyId,
      userId: user.id,
      requestId: id,
    });
    return result;
  }

  async issue(user: UserRecord, id: string) {
    const result = await withTransaction(this.db, async (transaction) => {
      const { repository, request } = await this.lockedRequest(transaction, user, id);
      if (request.status === 'ISSUED') return rewardRequestDto(request);
      if (request.status !== 'APPROVED') {
        throw new AppError(409, 'INVALID_REQUEST_STATUS', 'Спочатку підтвердьте запит нагороди.');
      }
      const updated = await repository.update(id, {
        status: 'ISSUED',
        issuedAt: new Date(),
        issuedById: user.id,
      });
      await repository.audit(user.familyId, user.id, 'REWARD_ISSUED', id);
      return rewardRequestDto(updated);
    });
    logger.info('reward.issue_succeeded', {
      familyId: user.familyId,
      userId: user.id,
      requestId: id,
    });
    return result;
  }
}
