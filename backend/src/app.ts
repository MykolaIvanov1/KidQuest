import express from 'express';
import helmet from 'helmet';
import cors from 'cors';
import cookieParser from 'cookie-parser';
import { rateLimit } from 'express-rate-limit';
import type { AuthConfig, AuthRepository } from './modules/auth/auth.types.js';
import { AuthService } from './modules/auth/auth.service.js';
import { createRoutes } from './modules/auth/auth.routes.js';
import { errorHandler } from './middleware/error-handler.js';
import { AppError } from './errors/app-error.js';
import { familyRoutes } from './modules/families/family.routes.js';
import { statisticsRoutes } from './modules/statistics/statistics.routes.js';
import type { PrismaClient } from '@prisma/client';
import { taskRoutes } from './modules/tasks/task.routes.js';
import { completionRoutes } from './modules/task-completions/completion.routes.js';
import { photoRoutes } from './modules/task-photos/photo.routes.js';
import { rewardsRoutes } from './modules/rewards/rewards.routes.js';
import { rewardRequestRoutes } from './modules/reward-requests/reward-requests.routes.js';
import { pointsRoutes } from './modules/points/points.routes.js';

export interface DomainDependencies {
  database: PrismaClient;
  storagePath: string;
}

export function createApp(
  repository: AuthRepository,
  config: AuthConfig,
  domain?: DomainDependencies,
) {
  const app = express();
  app.disable('x-powered-by');
  app.use(helmet());
  app.use((_req, res, next) => {
    res.setHeader('Cache-Control', 'no-store');
    next();
  });
  app.use(
    cors({
      origin: config.frontendUrl,
      credentials: true,
      methods: ['GET', 'POST', 'PATCH', 'DELETE', 'OPTIONS'],
      allowedHeaders: ['Content-Type', 'Authorization'],
    }),
  );
  app.use(
    rateLimit({
      windowMs: 60_000,
      limit: 180,
      standardHeaders: 'draft-8',
      legacyHeaders: false,
      message: {
        success: false,
        error: { code: 'RATE_LIMITED', message: 'Забагато запитів. Зачекайте хвилину.' },
      },
    }),
  );
  app.use(express.json({ limit: '32kb' }));
  app.use(cookieParser());
  app.use((req, _res, next) => {
    // Unsafe browser requests must originate at the configured UI, including cookie refresh/logout.
    if (
      !['GET', 'HEAD', 'OPTIONS'].includes(req.method) &&
      req.header('origin') !== config.frontendUrl
    ) {
      return next(new AppError(403, 'ORIGIN_FORBIDDEN', 'Джерело запиту не дозволено.'));
    }
    next();
  });
  app.get('/api/v1/health', (_req, res) => {
    res.json({ success: true, data: { status: 'ok' } });
  });
  const auth = new AuthService(repository, config);
  app.use('/api/v1', createRoutes(auth, config));
  app.use('/api/v1/family', familyRoutes(repository, auth));
  app.use('/api/v1/statistics', statisticsRoutes(repository, auth));
  if (domain) {
    app.use('/api/v1', taskRoutes(domain.database, auth, domain.storagePath));
    app.use('/api/v1', completionRoutes(domain.database, auth, domain.storagePath));
    app.use('/api/v1', photoRoutes(domain.database, auth, domain.storagePath));
    app.use('/api/v1', rewardsRoutes(domain.database, auth));
    app.use('/api/v1', rewardRequestRoutes(domain.database, auth));
    app.use('/api/v1', pointsRoutes(domain.database, auth));
  }
  app.use((_req, _res, next) => {
    next(new AppError(404, 'NOT_FOUND', 'Сторінку не знайдено.'));
  });
  app.use(errorHandler);
  return app;
}
