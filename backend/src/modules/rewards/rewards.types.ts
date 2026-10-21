import type { Reward } from '@prisma/client';
import type { RewardDto } from '@kidquest/types';

export function rewardDto(reward: Reward): RewardDto {
  return {
    id: reward.id,
    title: reward.title,
    description: reward.description,
    icon: reward.icon,
    imageUrl: reward.imageUrl,
    cost: reward.cost,
    type: reward.type,
    isActive: reward.isActive,
    createdAt: reward.createdAt.toISOString(),
  };
}
