/** Only known application destinations can be opened from a notification payload. */
export function notificationPath(path: unknown, fallback = '/'): string {
  if (typeof path !== 'string' || !/^\/(parent|child)(\/[a-z-]+)?$/.test(path)) return fallback;
  const allowed = new Set([
    '/parent',
    '/parent/quests',
    '/parent/rewards',
    '/parent/statistics',
    '/parent/achievements',
    '/parent/notifications',
    '/parent/settings',
    '/child',
    '/child/adventure',
    '/child/rewards',
    '/child/achievements',
    '/child/calendar',
    '/child/notifications',
    '/child/profile',
  ]);
  return allowed.has(path) ? path : fallback;
}
