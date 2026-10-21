import { Prisma, PrismaClient } from '@prisma/client';
import bcrypt from 'bcrypt';
import { config } from 'dotenv';
import { randomBytes, randomUUID } from 'node:crypto';

config();
config({ path: '.local/test-db.env' });

type TransactionAction = (transaction: Prisma.TransactionClient) => Promise<unknown>;

async function main(): Promise<void> {
  const databaseUrl = process.env.DATABASE_TEST_URL;
  if (!databaseUrl) {
    throw new Error('DATABASE_TEST_URL_REQUIRED');
  }
  // Intentionally never fall back to DATABASE_URL or a database with family data.
  const prisma = new PrismaClient({ datasources: { db: { url: databaseUrl } } });
  const passwordHash = await bcrypt.hash(randomBytes(32).toString('hex'), 4);

  async function profile(transaction: Prisma.TransactionClient) {
    const family = await transaction.family.create({ data: { name: 'Schema verification' } });
    const user = await transaction.user.create({
      data: {
        familyId: family.id,
        email: `${randomUUID()}@schema.invalid`,
        passwordHash,
        firstName: 'Test',
        role: 'CHILD',
      },
    });
    const child = await transaction.child.create({
      data: { familyId: family.id, userId: user.id, firstName: user.firstName },
    });
    return { family, user, child };
  }

  async function rejects(name: string, expectedCode: string, action: TransactionAction) {
    try {
      // Invalid writes abort and roll back each transaction, including all fixtures.
      await prisma.$transaction(async (transaction) => {
        await action(transaction);
        throw new Error('INVARIANT_NOT_ENFORCED');
      });
      throw new Error('INVARIANT_NOT_ENFORCED');
    } catch (error: unknown) {
      const prismaCode =
        error instanceof Prisma.PrismaClientKnownRequestError ? error.code : undefined;
      // PostgreSQL CHECK/trigger errors are surfaced as connector errors in Prisma 6.
      const databaseCodeMatches =
        error instanceof Error && error.message.includes(`code: "${expectedCode}"`);
      if (prismaCode !== expectedCode && !databaseCodeMatches) {
        throw new Error(`INVARIANT_FAILED: ${name}`);
      }
      console.info(`PASS ${name}`);
    }
  }

  try {
    await rejects('Child cannot reference another family user', 'P2003', async (transaction) => {
      const { family: firstFamily } = await profile(transaction);
      const user = await transaction.user.create({
        data: {
          familyId: firstFamily.id,
          email: `${randomUUID()}@schema.invalid`,
          passwordHash,
          firstName: 'Test',
          role: 'CHILD',
        },
      });
      const family = await transaction.family.create({ data: { name: 'Other family' } });
      await transaction.child.create({
        data: { familyId: family.id, userId: user.id, firstName: 'Other child' },
      });
    });
    await rejects('Point ledger rejects direct mutation', '23514', async (transaction) => {
      const { family, child } = await profile(transaction);
      const entry = await transaction.pointTransaction.create({
        data: { familyId: family.id, childId: child.id, amount: 10, type: 'BONUS' },
      });
      await transaction.pointTransaction.update({
        where: { id: entry.id },
        data: { amount: 100 },
      });
    });
    await rejects('Point ledger rejects duplicate operation', 'P2002', async (transaction) => {
      const { family, child } = await profile(transaction);
      const data: Prisma.PointTransactionUncheckedCreateInput = {
        familyId: family.id,
        childId: child.id,
        amount: 10,
        type: 'BONUS',
        operationId: randomUUID(),
      };
      await transaction.pointTransaction.create({ data });
      await transaction.pointTransaction.create({ data });
    });
    await rejects('Point ledger rejects positive purchase amount', '23514', async (transaction) => {
      const { family, child } = await profile(transaction);
      await transaction.pointTransaction.create({
        data: { familyId: family.id, childId: child.id, amount: 10, type: 'REWARD_PURCHASE' },
      });
    });
    await rejects('Daily completion cannot be duplicated', 'P2002', async (transaction) => {
      const { family, child } = await profile(transaction);
      const category = await transaction.taskCategory.create({
        data: { familyId: family.id, name: 'Tests' },
      });
      const task = await transaction.task.create({
        data: { familyId: family.id, categoryId: category.id, title: 'Test task', points: 10 },
      });
      const data = {
        familyId: family.id,
        childId: child.id,
        taskId: task.id,
        completionDate: new Date('2026-10-21T00:00:00.000Z'),
        pointsSnapshot: 10,
      };
      await transaction.taskCompletion.create({ data });
      await transaction.taskCompletion.create({ data });
    });
    console.info('5 database invariant checks passed; all fixtures rolled back.');
  } finally {
    await prisma.$disconnect();
  }
}

main().catch((error: unknown) => {
  // Do not print raw connection/Prisma errors that could contain private configuration.
  const knownMessage = error instanceof Error ? error.message : '';
  console.error(
    knownMessage === 'DATABASE_TEST_URL_REQUIRED'
      ? 'Set DATABASE_TEST_URL to a dedicated PostgreSQL test database and apply migrations first.'
      : knownMessage.startsWith('INVARIANT_FAILED:')
        ? knownMessage
        : 'Database verification failed. Check the test database connection and migrations.',
  );
  process.exitCode = 1;
});
