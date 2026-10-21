import type { Prisma } from '@prisma/client';
import type { RewardRequestDto } from '@kidquest/types';

export const requestInclude = { reward: true, child: true } satisfies Prisma.RewardRequestInclude;
export type RequestRecord = Prisma.RewardRequestGetPayload<{ include: typeof requestInclude }>;

export function rewardRequestDto(request: RequestRecord): RewardRequestDto {
  return {
    id: request.id,
    rewardId: request.rewardId,
    rewardTitle: request.reward.title,
    childId: request.childId,
    childName: request.child.firstName,
    status: request.status,
    costSnapshot: request.costSnapshot,
    operationId: request.operationId,
    reviewedAt: request.reviewedAt?.toISOString() ?? null,
    issuedAt: request.issuedAt?.toISOString() ?? null,
    rejectionReason: request.rejectionReason,
    createdAt: request.createdAt.toISOString(),
  };
}
