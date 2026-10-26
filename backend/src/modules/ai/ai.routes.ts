import { Router } from 'express';
import { rateLimit } from 'express-rate-limit';
import type { PrismaClient } from '@prisma/client';
import { requireAuth } from '../../middleware/auth.js';
import type { AuthService } from '../auth/auth.service.js';
import { AiController } from './ai.controller.js';
import { AiRepository } from './ai.repository.js';
import { AiService } from './ai.service.js';
import type { AiOptions } from './ai.types.js';

/** Mount at /api/v1/ai. Only authenticated users consume the per-account allowance. */
export function aiRoutes(db: PrismaClient, auth: AuthService, options: AiOptions = {}) {
  const routes = Router();
  const controller = new AiController(new AiService(new AiRepository(db, options.now), options));
  routes.use(requireAuth(auth));
  routes.post(
    '/advice',
    rateLimit({
      windowMs: 60_000,
      limit: 20,
      keyGenerator: (req) => req.authUser!.id,
      standardHeaders: 'draft-8',
      legacyHeaders: false,
      message: {
        success: false,
        error: {
          code: 'RATE_LIMITED',
          message: 'Квестик потребує невеликої перерви. Спробуйте за хвилину.',
        },
      },
    }),
    controller.advice,
  );
  return routes;
}
export type { AiOptions, AiProvider, AiContext, ProviderAdvice } from './ai.types.js';
