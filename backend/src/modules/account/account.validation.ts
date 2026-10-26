import { z } from 'zod';
export {
  changeEmailSchema,
  resetChildPasswordSchema,
  changeRoleSchema,
} from '@kidquest/validation';
export const accountId = z.uuid();
export const profileQuery = z.strictObject({});
export const loginJournalFilters = z.strictObject({
  cursor: z.uuid().optional(),
  limit: z.coerce.number().int().min(1).max(50).default(20),
  userId: z.uuid().optional(),
  success: z.enum(['true', 'false']).optional(),
});
export type LoginJournalFilters = z.infer<typeof loginJournalFilters>;
