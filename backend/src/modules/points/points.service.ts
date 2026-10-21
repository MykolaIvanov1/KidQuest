import type { UserRecord } from '../auth/auth.types.js';
import type { PointsRepository } from './points.repository.js';
import type { PointsData, PointTransactionDto } from '@kidquest/types';

export class PointsService {
  constructor(private repository: PointsRepository) {}

  async balance(user: UserRecord, requestedChildId?: string): Promise<PointsData> {
    const child = await this.repository.selectChild(user, requestedChildId);
    return {
      childId: child?.id ?? null,
      balance: child ? await this.repository.balance(user.familyId, child.id) : 0,
    };
  }

  async history(user: UserRecord, requestedChildId?: string): Promise<PointTransactionDto[]> {
    const child = await this.repository.selectChild(user, requestedChildId);
    if (!child) return [];
    const entries = await this.repository.history(user.familyId, child.id);
    return entries.map((entry) => ({
      id: entry.id,
      childId: entry.childId,
      type: entry.type,
      amount: entry.amount,
      description: entry.description,
      createdAt: entry.createdAt.toISOString(),
    }));
  }
}
