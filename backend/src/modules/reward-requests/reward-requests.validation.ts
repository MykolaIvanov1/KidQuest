import { z } from 'zod';

export { idSchema, reviewSchema } from '@kidquest/validation';
const statuses = z
  .string()
  .transform((value) => value.split(','))
  .pipe(
    z
      .array(z.enum(['PENDING', 'APPROVED', 'ISSUED', 'REJECTED']))
      .min(1)
      .max(4),
  );
export const rewardRequestQuerySchema = z
  .object({ childId: z.uuid().optional(), status: statuses.optional() })
  .strict();
