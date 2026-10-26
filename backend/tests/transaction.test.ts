import { Prisma, type PrismaClient } from '@prisma/client';
import { describe, expect, it, vi } from 'vitest';
import { isRetryableTransactionError, withTransaction } from '../src/database/transaction.js';
import { PrismaAuthRepository } from '../src/modules/auth/auth.repository.js';

function failure(code: string, databaseCode?: string) {
  return new Prisma.PrismaClientKnownRequestError('Simulated transaction failure', {
    code,
    clientVersion: 'test',
    ...(databaseCode ? { meta: { code: databaseCode } } : {}),
  });
}

describe('transaction retry handling', () => {
  it.each([
    ['P2034', undefined, true],
    ['P2010', '40001', true],
    ['P2010', '40P01', true],
    ['P2010', '23505', false],
    ['P2010', '42601', false],
    ['P2010', undefined, false],
    ['P2002', '40001', false],
  ])('classifies %s / %s as retryable=%s', (code, databaseCode, retryable) => {
    expect(
      isRetryableTransactionError(failure(code as string, databaseCode as string | undefined)),
    ).toBe(retryable);
  });

  it('does not retry arbitrary objects that resemble a database error', () => {
    expect(isRetryableTransactionError({ code: 'P2010', meta: { code: '40001' } })).toBe(false);
    expect(isRetryableTransactionError(new Error('40001'))).toBe(false);
  });

  it.each([failure('P2034'), failure('P2010', '40001'), failure('P2010', '40P01')])(
    'retries a known transient failure',
    async (error) => {
      const transact = vi.fn().mockRejectedValueOnce(error).mockResolvedValue('committed');
      const database = { $transaction: transact } as unknown as PrismaClient;
      await expect(withTransaction(database, async () => 'result')).resolves.toBe('committed');
      expect(transact).toHaveBeenCalledTimes(2);
      expect(transact).toHaveBeenLastCalledWith(
        expect.any(Function),
        expect.objectContaining({ isolationLevel: 'Serializable' }),
      );
    },
  );

  it('returns a standard conflict after exhausting retries', async () => {
    const transact = vi.fn().mockRejectedValue(failure('P2010', '40001'));
    await expect(
      withTransaction({ $transaction: transact } as unknown as PrismaClient, async () => null),
    ).rejects.toMatchObject({ status: 409, code: 'CONCURRENT_UPDATE' });
    expect(transact).toHaveBeenCalledTimes(3);
  });

  it('preserves a nonretryable failure without replaying work', async () => {
    const error = failure('P2010', '23505');
    const transact = vi.fn().mockRejectedValue(error);
    await expect(
      withTransaction({ $transaction: transact } as unknown as PrismaClient, async () => null),
    ).rejects.toBe(error);
    expect(transact).toHaveBeenCalledTimes(1);
  });

  it.each([failure('P2034'), failure('P2010', '40001')])(
    'returns a standard membership conflict after exhausting retries',
    async (error) => {
      const transact = vi.fn().mockRejectedValue(error);
      const repository = new PrismaAuthRepository({
        $transaction: transact,
      } as unknown as PrismaClient);
      await expect(
        repository.createMember(
          'family',
          {
            email: 'test@example.test',
            password: 'TestPassword123!',
            firstName: 'Тест',
            role: 'PARENT',
          },
          'hash',
        ),
      ).rejects.toMatchObject({ status: 409, code: 'CONCURRENT_UPDATE' });
      expect(transact).toHaveBeenCalledTimes(3);
    },
  );
});
