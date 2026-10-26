import { Router } from 'express';
import { rateLimit } from 'express-rate-limit';
import type { PrismaClient } from '@prisma/client';
import { requireAuth, requireRole } from '../../middleware/auth.js';
import type { AuthService } from '../auth/auth.service.js';
import type { AuthConfig } from '../auth/auth.types.js';
import { AccountController } from './account.controller.js';
import { AccountService } from './account.service.js';

export function accountRoutes(db: PrismaClient, auth: AuthService, config: AuthConfig) {
  const routes = Router();
  const controller = new AccountController(new AccountService(db), config);
  // Authentication runs before the limiter, so attempts are scoped to the authenticated parent.
  routes.use(requireAuth(auth));
  routes.get('/profile', controller.profile);
  routes.use(requireRole('PARENT'));
  routes.get('/login-journal', controller.journal);
  routes.use(
    rateLimit({
      windowMs: 15 * 60_000,
      limit: 30,
      keyGenerator: (req) => req.authUser!.id,
      standardHeaders: 'draft-8',
      legacyHeaders: false,
      message: {
        success: false,
        error: {
          code: 'RATE_LIMITED',
          message: 'Забагато змін облікового запису. Спробуйте пізніше.',
        },
      },
    }),
  );
  routes.patch('/email', controller.changeEmail);
  routes.patch('/members/:id/email', controller.changeMemberEmail);
  routes.post('/members/:id/reset-password', controller.resetPassword);
  routes.patch('/members/:id/role', controller.changeRole);
  return routes;
}
