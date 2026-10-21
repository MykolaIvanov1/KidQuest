import { Router } from 'express';
import type { PrismaClient } from '@prisma/client';
import type { AuthService } from '../auth/auth.service.js';
import { requireAuth, requireRole } from '../../middleware/auth.js';
import { PhotoStorage } from '../task-photos/photo.service.js';
import { CompletionService } from './completion.service.js';
import { CompletionRepository } from './completion.repository.js';
import { CompletionController } from './completion.controller.js';

export function completionRoutes(db: PrismaClient, auth: AuthService, storagePath: string) {
  const routes = Router();
  const controller = new CompletionController(
    new CompletionRepository(db),
    new CompletionService(db, new PhotoStorage(storagePath)),
  );
  routes.use('/task-completions', requireAuth(auth));
  routes.get('/task-completions', controller.list);
  routes.post('/task-completions/:id/approve', requireRole('PARENT'), controller.approve);
  routes.post('/task-completions/:id/reject', requireRole('PARENT'), controller.reject);
  return routes;
}
