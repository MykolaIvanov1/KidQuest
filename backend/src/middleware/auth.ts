import type { RequestHandler } from 'express';
import type { Role } from '@kidquest/types';
import { AppError } from '../errors/app-error.js';
import type { AuthService } from '../modules/auth/auth.service.js';

export const requireAuth =
  (service: AuthService): RequestHandler =>
  async (req, _res, next) => {
    try {
      const authorization = req.header('Authorization');
      if (!authorization?.startsWith('Bearer '))
        throw new AppError(401, 'UNAUTHENTICATED', 'Увійдіть до свого облікового запису.');
      req.authUser = await service.authenticate(authorization.slice(7));
      next();
    } catch (error) {
      next(error);
    }
  };

export const requireRole =
  (...roles: Role[]): RequestHandler =>
  (req, _res, next) => {
    if (!req.authUser || !roles.includes(req.authUser.role))
      return next(new AppError(403, 'FORBIDDEN', 'Недостатньо прав для цієї дії.'));
    next();
  };
