import { Router } from 'express';
import type { PrismaClient } from '@prisma/client';
import { requireAuth } from '../../middleware/auth.js';
import type { AuthService } from '../auth/auth.service.js';
import { GamificationController } from './gamification.controller.js';
import { GamificationService } from './gamification.service.js';

export function gamificationRoutes(db: PrismaClient, auth: AuthService) {
  const routes = Router();
  const controller = new GamificationController(new GamificationService(db));
  routes.get('/achievements', requireAuth(auth), controller.achievements);
  routes.get('/calendar', requireAuth(auth), controller.calendar);
  routes.get('/statistics/progress', requireAuth(auth), controller.progress);
  return routes;
}
