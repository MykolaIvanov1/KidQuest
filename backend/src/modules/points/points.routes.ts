import { Router } from 'express';
import type { PrismaClient } from '@prisma/client';
import type { AuthService } from '../auth/auth.service.js';
import { requireAuth } from '../../middleware/auth.js';
import { PointsRepository } from './points.repository.js';
import { PointsService } from './points.service.js';
import { PointsController } from './points.controller.js';

export function pointsRoutes(db: PrismaClient, auth: AuthService) {
  const routes = Router();
  const controller = new PointsController(new PointsService(new PointsRepository(db)));
  routes.get('/points', requireAuth(auth), controller.balance);
  routes.get('/points/history', requireAuth(auth), controller.history);
  return routes;
}
