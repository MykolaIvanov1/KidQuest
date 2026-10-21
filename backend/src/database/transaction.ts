import { Prisma, type PrismaClient } from '@prisma/client';
import { AppError } from '../errors/app-error.js';

export async function withTransaction<T>(
  db: PrismaClient,
  work: (transaction: Prisma.TransactionClient) => Promise<T>,
): Promise<T> {
  for (let attempt = 0; attempt < 3; attempt += 1) {
    try {
      return await db.$transaction(work, {
        isolationLevel: Prisma.TransactionIsolationLevel.Serializable,
        maxWait: 5_000,
        timeout: 10_000,
      });
    } catch (error: unknown) {
      if (error instanceof Prisma.PrismaClientKnownRequestError && error.code === 'P2034') {
        if (attempt < 2) continue;
        throw new AppError(409, 'CONCURRENT_UPDATE', 'Дані змінилися. Повторіть запит.');
      }
      throw error;
    }
  }
  throw new AppError(409, 'CONCURRENT_UPDATE', 'Дані змінилися. Повторіть запит.');
}

export async function lockChild(
  transaction: Prisma.TransactionClient,
  familyId: string,
  childId: string,
): Promise<void> {
  const children = await transaction.$queryRaw<{ id: string }[]>(Prisma.sql`
    SELECT child."id"
    FROM "Child" child
    JOIN "User" account ON account."id" = child."userId" AND account."familyId" = child."familyId"
    JOIN "Family" family ON family."id" = child."familyId"
    WHERE child."id" = ${childId}::uuid AND child."familyId" = ${familyId}::uuid
      AND child."deletedAt" IS NULL AND account."deletedAt" IS NULL
      AND account."isActive" = true AND account."role" = 'CHILD' AND family."deletedAt" IS NULL
    FOR UPDATE OF child
  `);
  if (children.length !== 1) {
    throw new AppError(404, 'CHILD_NOT_FOUND', 'Профіль дитини недоступний.');
  }
}
