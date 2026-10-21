import { Router } from 'express';
import { requireAuth } from '../../middleware/auth.js';
import type { AuthService } from '../auth/auth.service.js';
import type { AuthRepository } from '../auth/auth.types.js';
import { StatisticsService } from './statistics.service.js';

export function statisticsRoutes(repository: AuthRepository, auth: AuthService) {
  const routes = Router();
  const service = new StatisticsService(repository);
  routes.get('/', requireAuth(auth), async (req, res) => {
    res.json({ success: true, data: await service.dashboard(req.authUser!) });
  });
  return routes;
}
