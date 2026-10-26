import { z } from 'zod';

export const achievementFilters = z
  .object({
    childId: z.uuid('Некоректний ідентифікатор дитини.').optional(),
  })
  .strict();

export const calendarFilters = achievementFilters
  .extend({
    month: z
      .string()
      .regex(/^(?!0000)\d{4}-(0[1-9]|1[0-2])$/, 'Вкажіть місяць у форматі РРРР-ММ.')
      .optional(),
  })
  .strict();

export type CalendarFilters = z.infer<typeof calendarFilters>;
