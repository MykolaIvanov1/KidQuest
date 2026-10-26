import type { Prisma, PrismaClient } from '@prisma/client';
import { enqueueNotification } from './notification.repository.js';

type NotificationDatabase = PrismaClient | Prisma.TransactionClient;
interface Event {
  eventKey: string;
  type: string;
  title: string;
  body: string;
  path: string;
}

// Recipients come from the family relations, never from a caller-supplied user ID.
async function notifyFamily(
  db: NotificationDatabase,
  familyId: string,
  role: 'CHILD' | 'PARENT',
  event: Event,
) {
  const recipients = await db.user.findMany({
    where: {
      familyId,
      role,
      isActive: true,
      deletedAt: null,
      family: { deletedAt: null },
      ...(role === 'CHILD' ? { child: { deletedAt: null, familyId } } : {}),
    },
    select: { id: true },
  });
  for (const recipient of recipients) {
    await enqueueNotification(db, { ...event, userId: recipient.id });
  }
}

export function notifyFamilyChildren(db: NotificationDatabase, familyId: string, event: Event) {
  return notifyFamily(db, familyId, 'CHILD', event);
}

export function notifyFamilyParents(db: NotificationDatabase, familyId: string, event: Event) {
  return notifyFamily(db, familyId, 'PARENT', event);
}

export async function notifyChild(
  db: NotificationDatabase,
  familyId: string,
  childId: string,
  event: Event,
) {
  const child = await db.child.findFirst({
    where: {
      id: childId,
      familyId,
      deletedAt: null,
      family: { deletedAt: null },
      user: { familyId, role: 'CHILD', isActive: true, deletedAt: null },
    },
    select: { userId: true },
  });
  if (child) await enqueueNotification(db, { ...event, userId: child.userId });
}
