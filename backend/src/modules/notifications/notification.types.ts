import type { Prisma, PrismaClient } from '@prisma/client';

export type NotificationDatabase = PrismaClient | Prisma.TransactionClient;

export interface NotificationInput {
  userId: string;
  eventKey: string;
  type: string;
  title: string;
  body: string;
  path: string;
}

export interface PushMessage {
  token: string;
  notificationId: string;
  title: string;
  body: string;
  path: string;
}

export interface PushSender {
  send(message: PushMessage): Promise<void>;
}

export interface FirebaseConfiguration {
  projectId: string;
  clientEmail: string;
  privateKey: string;
}
