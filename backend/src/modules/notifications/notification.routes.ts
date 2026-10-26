import { Router } from 'express';
import type { PrismaClient } from '@prisma/client';
import { requireAuth } from '../../middleware/auth.js';
import type { AuthService } from '../auth/auth.service.js';
import { NotificationController } from './notification.controller.js';
import { NotificationService } from './notification.service.js';

export function notificationRoutes(db: PrismaClient, auth: AuthService, pushConfigured = false) {
  const routes = Router();
  const controller = new NotificationController(new NotificationService(db), pushConfigured);
  routes.use(requireAuth(auth));
  routes.get('/notifications', controller.list);
  routes.get('/notifications/status', controller.status);
  routes.patch('/notifications/:id/read', controller.read);
  routes.post('/notifications/read-all', controller.readAll);
  routes.post('/devices', controller.registerDevice);
  routes.delete('/devices/:id', controller.revokeDevice);
  return routes;
}
