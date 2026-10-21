import { Router } from 'express';
import type { PrismaClient } from '@prisma/client';
import type { AuthService } from '../auth/auth.service.js';
import { requireAuth } from '../../middleware/auth.js';
import { PhotoRepository } from './photo.repository.js';
import { PhotoStorage } from './photo.service.js';
import { PhotoController } from './photo.controller.js';

export function photoRoutes(db: PrismaClient, auth: AuthService, storagePath: string) {
  const routes = Router();
  const controller = new PhotoController(new PhotoRepository(db), new PhotoStorage(storagePath));
  routes.get('/task-photos/:id', requireAuth(auth), controller.get);
  return routes;
}
