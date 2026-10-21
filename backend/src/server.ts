import { PrismaClient } from '@prisma/client';
import { createApp } from './app.js';
import { readEnvironment } from './config/env.js';
import { PrismaAuthRepository } from './modules/auth/auth.repository.js';
import { logger } from './utils/logger.js';
import { resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const env = readEnvironment();
const database = new PrismaClient();
await database.$connect();
const app = createApp(
  new PrismaAuthRepository(database),
  {
    jwtSecret: env.JWT_SECRET,
    frontendUrl: new URL(env.FRONTEND_URL).origin,
    accessSeconds: Number.parseInt(env.JWT_EXPIRATION, 10) * 60,
    refreshDays: Number.parseInt(env.REFRESH_TOKEN_EXPIRATION, 10),
    production: env.NODE_ENV === 'production',
  },
  {
    database,
    storagePath: resolve(fileURLToPath(new URL('../..', import.meta.url)), env.STORAGE_PATH),
  },
);
const server = app.listen(env.PORT, () => {
  logger.info('server.started', { port: env.PORT });
});

function shutdown() {
  server.close(() => {
    void database.$disconnect().then(() => process.exit(0));
  });
}

process.on('SIGINT', shutdown);
process.on('SIGTERM', shutdown);
