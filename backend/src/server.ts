import { PrismaClient } from '@prisma/client';
import { createApp } from './app.js';
import { readEnvironment } from './config/env.js';
import { PrismaAuthRepository } from './modules/auth/auth.repository.js';
import { logger } from './utils/logger.js';
import { resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { FirebasePushSender } from './modules/notifications/notification.sender.js';
import { startNotificationDispatcher } from './modules/notifications/notification.dispatcher.js';

const env = readEnvironment();
const database = new PrismaClient();
await database.$connect();
const pushSender =
  env.FIREBASE_PROJECT_ID && env.FIREBASE_CLIENT_EMAIL && env.FIREBASE_PRIVATE_KEY
    ? new FirebasePushSender({
        projectId: env.FIREBASE_PROJECT_ID,
        clientEmail: env.FIREBASE_CLIENT_EMAIL,
        privateKey: env.FIREBASE_PRIVATE_KEY,
      })
    : null;
const app = createApp(
  new PrismaAuthRepository(database),
  {
    jwtSecret: env.JWT_SECRET,
    frontendUrl: new URL(env.FRONTEND_URL).origin,
    accessSeconds: Number.parseInt(env.JWT_EXPIRATION, 10) * 60,
    refreshDays: Number.parseInt(env.REFRESH_TOKEN_EXPIRATION, 10),
    production: env.NODE_ENV === 'production',
    trustProxy: env.TRUST_PROXY,
  },
  {
    database,
    storagePath: resolve(fileURLToPath(new URL('../..', import.meta.url)), env.STORAGE_PATH),
    pushConfigured: pushSender !== null,
  },
);
const server = app.listen(env.PORT, () => {
  logger.info('server.started', { port: env.PORT });
});
const stopDispatcher = pushSender ? startNotificationDispatcher(database, pushSender) : null;

let stopping = false;
async function shutdown() {
  if (stopping) return;
  stopping = true;
  try {
    await new Promise<void>((resolve) => server.close(() => resolve()));
    await stopDispatcher?.();
    await pushSender?.close();
  } catch {
    logger.error('server.shutdown.failed');
    process.exitCode = 1;
  } finally {
    await database.$disconnect();
  }
}

process.on('SIGINT', () => {
  void shutdown();
});
process.on('SIGTERM', () => {
  void shutdown();
});
