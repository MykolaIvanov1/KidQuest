import { Router } from 'express';
import type { PrismaClient } from '@prisma/client';
import multer from 'multer';
import { rateLimit } from 'express-rate-limit';
import type { AuthService } from '../auth/auth.service.js';
import { requireAuth, requireRole } from '../../middleware/auth.js';
import { AppError } from '../../errors/app-error.js';
import { PhotoStorage, MAX_PHOTO_SIZE } from '../task-photos/photo.service.js';
import { CompletionService } from '../task-completions/completion.service.js';
import { TaskController } from './task.controller.js';
import { TaskRepository } from './task.repository.js';
import { TaskService } from './task.service.js';

export function taskRoutes(db: PrismaClient, auth: AuthService, storagePath: string) {
  const routes = Router();
  const controller = new TaskController(
    new TaskService(
      new TaskRepository(db),
      new CompletionService(db, new PhotoStorage(storagePath)),
    ),
  );
  const upload = multer({
    storage: multer.memoryStorage(),
    limits: {
      fileSize: MAX_PHOTO_SIZE,
      files: 5,
      fields: 1,
      fieldSize: 128,
      fieldNameSize: 64,
      parts: 7,
    },
    fileFilter: (_req, file, done) => {
      if (!['image/jpeg', 'image/png', 'image/webp'].includes(file.mimetype))
        return done(
          new AppError(400, 'UNSUPPORTED_PHOTO_TYPE', 'Оберіть фото JPEG, PNG або WebP.'),
        );
      done(null, true);
    },
  }).array('photos', 5);
  const uploadLimit = rateLimit({
    windowMs: 60_000,
    limit: 30,
    standardHeaders: 'draft-8',
    legacyHeaders: false,
    message: {
      success: false,
      error: { code: 'RATE_LIMITED', message: 'Забагато спроб. Спробуйте за хвилину.' },
    },
  });
  routes.use(['/tasks', '/task-categories'], requireAuth(auth));
  routes.get('/tasks', controller.list);
  routes.post('/tasks', requireRole('PARENT'), controller.create);
  routes.patch('/tasks/:id', requireRole('PARENT'), controller.update);
  routes.delete('/tasks/:id', requireRole('PARENT'), controller.remove);
  routes.post('/tasks/:id/submit', requireRole('CHILD'), uploadLimit, upload, controller.submit);
  routes.get('/task-categories', controller.categories);
  routes.post('/task-categories', requireRole('PARENT'), controller.createCategory);
  return routes;
}
