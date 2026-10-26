import { z } from 'zod';

export const notificationFilters = z.strictObject({
  cursor: z.uuid().optional(),
  limit: z.coerce.number().int().min(1).max(50).default(20),
});
export const notificationId = z.uuid();
export const emptyNotificationBody = z.strictObject({});
export const deviceInput = z.strictObject({
  token: z.string().trim().min(20).max(4096).regex(/^\S+$/),
  name: z.string().trim().min(1).max(120).optional(),
});
export type DeviceInput = z.infer<typeof deviceInput>;
export type NotificationFilters = z.infer<typeof notificationFilters>;

// Push links and historical inbox data may only navigate within KidQuest.
const internalPaths = new Set([
  '/child',
  '/child/adventure',
  '/child/rewards',
  '/child/achievements',
  '/child/calendar',
  '/child/notifications',
  '/parent',
  '/parent/quests',
  '/parent/rewards',
  '/parent/statistics',
  '/parent/notifications',
]);

export function safeNotificationPath(value: unknown, fallback = '/child'): string {
  return typeof value === 'string' && internalPaths.has(value) ? value : fallback;
}

export function validNotificationPath(value: string): boolean {
  return internalPaths.has(value);
}
