import { z } from 'zod';
export { completionReviewSchema, submitTaskSchema } from '@kidquest/validation';

export const completionFilters = z
  .object({
    status: z.enum(['PENDING', 'SUBMITTED', 'APPROVED', 'REJECTED', 'MISSED']).optional(),
    date: z.iso.date().optional(),
  })
  .strict();
