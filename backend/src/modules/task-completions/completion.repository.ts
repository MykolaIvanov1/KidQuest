import { Prisma, type PrismaClient } from '@prisma/client';
import type { CompletionDto } from '@kidquest/types';
import type { UserRecord } from '../auth/auth.types.js';

export const completionInclude = {
  child: { select: { firstName: true } },
  task: { select: { title: true } },
  photos: { where: { deletedAt: null }, orderBy: { createdAt: 'asc' as const } },
} satisfies Prisma.TaskCompletionInclude;

export type CompletionRecord = Prisma.TaskCompletionGetPayload<{
  include: typeof completionInclude;
}>;

export function completionDto(completion: CompletionRecord): CompletionDto {
  return {
    id: completion.id,
    taskId: completion.taskId,
    childId: completion.childId,
    childName: completion.child.firstName,
    taskTitle: completion.task.title,
    status: completion.status,
    completionDate: completion.completionDate.toISOString().slice(0, 10),
    pointsSnapshot: completion.pointsSnapshot,
    submittedAt: completion.submittedAt?.toISOString() ?? null,
    reviewedAt: completion.reviewedAt?.toISOString() ?? null,
    rejectionReason: completion.rejectionReason,
    photos: completion.photos.map((photo) => ({
      id: photo.id,
      url: `/api/v1/task-photos/${photo.id}`,
      mimeType: photo.mimeType,
      size: photo.size,
    })),
  };
}

export class CompletionRepository {
  constructor(private db: PrismaClient) {}

  async list(
    user: UserRecord,
    filters: { status?: Prisma.EnumTaskCompletionStatusFilter['equals']; date?: string },
  ) {
    const rows = await this.db.taskCompletion.findMany({
      where: {
        familyId: user.familyId,
        ...(user.role === 'CHILD' ? { childId: user.childId! } : {}),
        ...(filters.status ? { status: filters.status } : {}),
        ...(filters.date ? { completionDate: new Date(`${filters.date}T00:00:00.000Z`) } : {}),
        deletedAt: null,
        task: { deletedAt: null },
        child: { deletedAt: null, user: { isActive: true, deletedAt: null } },
      },
      include: completionInclude,
      orderBy: [{ completionDate: 'desc' }, { createdAt: 'desc' }],
      take: 100,
    });
    return rows.map(completionDto);
  }
}
