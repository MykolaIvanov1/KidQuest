import { Router } from 'express';
import type { PrismaClient } from '@prisma/client';
import type { AuthService } from '../auth/auth.service.js';
import { requireAuth, requireRole } from '../../middleware/auth.js';
import { RewardRequestController } from './reward-requests.controller.js';
import { RewardRequestService } from './reward-requests.service.js';

export function rewardRequestRoutes(db: PrismaClient, auth: AuthService) {
  const routes = Router();
  const controller = new RewardRequestController(new RewardRequestService(db));
  const authenticated = requireAuth(auth);
  routes.get('/reward-requests', authenticated, controller.list);
  routes.post(
    '/reward-requests/:id/approve',
    authenticated,
    requireRole('PARENT'),
    controller.approve,
  );
  routes.post(
    '/reward-requests/:id/reject',
    authenticated,
    requireRole('PARENT'),
    controller.reject,
  );
  routes.post('/reward-requests/:id/issue', authenticated, requireRole('PARENT'), controller.issue);
  return routes;
}
