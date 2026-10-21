import { z } from 'zod';

export { idSchema, reviewSchema } from '@kidquest/validation';
export const rewardRequestQuerySchema = z.object({ childId: z.uuid().optional() }).strict();
