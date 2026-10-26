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
    await rejects('Task rejects reversed calendar date bounds', '23514', async (transaction) => {
      const { family } = await profile(transaction);
      const category = await transaction.taskCategory.create({
        data: { familyId: family.id, name: 'Date range tests' },
      });
      await transaction.task.create({
        data: {
          familyId: family.id,
          categoryId: category.id,
          title: 'Reversed date range',
          points: 10,
          startDate: new Date('2026-11-01T00:00:00.000Z'),
          endDate: new Date('2026-10-31T00:00:00.000Z'),
        },
      });
    });
    await rejects(
      'Task schedule cannot reference another family task',
      'P2003',
      async (transaction) => {
        const { family } = await profile(transaction);
        const category = await transaction.taskCategory.create({
          data: { familyId: family.id, name: 'Schedule verification' },
        });
        const task = await transaction.task.create({
          data: {
            familyId: family.id,
            categoryId: category.id,
            title: 'Scheduled task',
            points: 10,
          },
        });
        const otherFamily = await transaction.family.create({ data: { name: 'Other family' } });
        await transaction.taskScheduleVersion.create({
          data: {
            taskId: task.id,
            familyId: otherFamily.id,
            effectiveFrom: new Date('2026-10-22T00:00:00.000Z'),
            title: task.title,
            isRequired: true,
            repeatDaily: true,
            isActive: true,
          },
        });
      },
    );
    await rejects(
      'Notification event cannot be duplicated for one recipient',
      'P2002',
      async (transaction) => {
        const { user } = await profile(transaction);
        const data = {
          userId: user.id,
          eventKey: 'one-domain-event',
          type: 'SYSTEM',
          title: 'Test notification',
          body: 'Invariant verification',
        };
        await transaction.notification.create({ data });
        await transaction.notification.create({ data });
      },
    );
    async function deliveryReferences(transaction: Prisma.TransactionClient) {
      const { user } = await profile(transaction);
      const notification = await transaction.notification.create({
        data: { userId: user.id, type: 'SYSTEM', title: 'Test delivery', body: 'Test' },
      });
      const device = await transaction.device.create({
        data: { userId: user.id, token: randomUUID() },
      });
      return { notificationId: notification.id, deviceId: device.id, deviceVersion: 1 };
    }
    await rejects(
      'Processing push delivery requires a fenced lease',
      '23514',
      async (transaction) => {
        await transaction.pushDelivery.create({
          data: { ...(await deliveryReferences(transaction)), status: 'PROCESSING' },
        });
      },
    );
    await rejects('Push delivery rejects negative attempt count', '23514', async (transaction) => {
      await transaction.pushDelivery.create({
        data: { ...(await deliveryReferences(transaction)), attempts: -1 },
      });
    });
    await rejects('User rejects negative authentication version', '23514', async (transaction) => {
      const { user } = await profile(transaction);
      await transaction.user.update({ where: { id: user.id }, data: { authVersion: -1 } });
    });
    await rejects(
      'Refresh token rejects negative authentication version',
      '23514',
      async (transaction) => {
        const { user } = await profile(transaction);
        await transaction.refreshToken.create({
          data: {
            userId: user.id,
            sessionId: randomUUID(),
            tokenHash: randomUUID(),
            expiresAt: new Date(Date.now() + 60_000),
            authVersion: -1,
          },
        });
      },
    );
    console.info('12 database invariant checks passed; all fixtures rolled back.');
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
