import { Router } from 'express';
import type { PrismaClient } from '@prisma/client';
import type { AuthService } from '../auth/auth.service.js';
import { requireAuth, requireRole } from '../../middleware/auth.js';
import { RewardsController } from './rewards.controller.js';
import { RewardsService } from './rewards.service.js';
import { RewardRequestService } from '../reward-requests/reward-requests.service.js';

export function rewardsRoutes(db: PrismaClient, auth: AuthService) {
  const routes = Router();
  const controller = new RewardsController(new RewardsService(db), new RewardRequestService(db));
  const authenticated = requireAuth(auth);
  routes.get('/rewards', authenticated, controller.list);
  routes.post('/rewards', authenticated, requireRole('PARENT'), controller.create);
  routes.patch('/rewards/:id', authenticated, requireRole('PARENT'), controller.update);
  routes.delete('/rewards/:id', authenticated, requireRole('PARENT'), controller.remove);
  routes.post('/rewards/:id/request', authenticated, requireRole('CHILD'), controller.request);
  return routes;
}
