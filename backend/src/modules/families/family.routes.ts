import { Router } from 'express';
import { rateLimit } from 'express-rate-limit';
import { requireAuth, requireRole } from '../../middleware/auth.js';
import type { AuthService } from '../auth/auth.service.js';
import type { AuthRepository } from '../auth/auth.types.js';
import { FamilyService } from './family.service.js';
import { FamilyController } from './family.controller.js';

export function familyRoutes(repository: AuthRepository, auth: AuthService) {
  const routes = Router();
  const controller = new FamilyController(new FamilyService(repository));
  routes.use(requireAuth(auth), requireRole('PARENT'));
  routes.get('/members', controller.listMembers);
  routes.post(
    '/members',
    rateLimit({
      windowMs: 15 * 60_000,
      limit: 30,
      standardHeaders: 'draft-8',
      legacyHeaders: false,
      message: {
        success: false,
        error: { code: 'RATE_LIMITED', message: 'Забагато запитів. Спробуйте пізніше.' },
      },
    }),
    controller.createMember,
  );
  return routes;
}
