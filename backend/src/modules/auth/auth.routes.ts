import { Router } from 'express';
import { rateLimit } from 'express-rate-limit';
import { requireAuth } from '../../middleware/auth.js';
import { AuthController } from './auth.controller.js';
import type { AuthConfig } from './auth.types.js';
import type { AuthService } from './auth.service.js';

export function createRoutes(service: AuthService, config: AuthConfig) {
  const routes = Router();
  const controller = new AuthController(service, config);
  const authentication = requireAuth(service);
  const authLimiter = rateLimit({
    windowMs: 15 * 60 * 1000,
    limit: 30,
    standardHeaders: 'draft-8',
    legacyHeaders: false,
    message: {
      success: false,
      error: { code: 'RATE_LIMITED', message: 'Забагато спроб. Спробуйте за кілька хвилин.' },
    },
  });
  routes.post('/auth/register', authLimiter, controller.register);
  routes.post('/auth/login', authLimiter, controller.login);
  routes.post('/auth/refresh', authLimiter, controller.refresh);
  routes.post('/auth/logout', controller.logout);
  routes.get('/me', authentication, controller.me);
  return routes;
}
