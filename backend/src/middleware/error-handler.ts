import type { ErrorRequestHandler } from 'express';
import { ZodError } from 'zod';
import { AppError } from '../errors/app-error.js';
import { logger } from '../utils/logger.js';
import multer from 'multer';

export const errorHandler: ErrorRequestHandler = (error: unknown, _req, res, _next) => {
  if (error instanceof multer.MulterError) {
    res.status(error.code === 'LIMIT_FILE_SIZE' ? 413 : 400).json({
      success: false,
      error: {
        code: error.code,
        message:
          error.code === 'LIMIT_FILE_SIZE'
            ? 'Кожне фото має бути не більшим за 5 МБ.'
            : 'Додайте не більше 5 фото та перевірте формат запиту.',
      },
    });
    return;
  }
  if (error instanceof ZodError) {
    res.status(400).json({
      success: false,
      error: {
        code: 'VALIDATION_ERROR',
        message: 'Перевірте введені дані.',
        details: error.issues.map((issue) => ({
          path: issue.path.join('.'),
          message: issue.message,
        })),
      },
    });
    return;
  }
  if (error instanceof AppError) {
    res.status(error.status).json({
      success: false,
      error: {
        code: error.code,
        message: error.message,
        ...(error.details ? { details: error.details } : {}),
      },
    });
    return;
  }
  if (error instanceof SyntaxError && 'body' in error) {
    res.status(400).json({
      success: false,
      error: { code: 'INVALID_JSON', message: 'Некоректний формат запиту.' },
    });
    return;
  }
  if (error && typeof error === 'object' && 'type' in error && error.type === 'entity.too.large') {
    res
      .status(413)
      .json({ success: false, error: { code: 'PAYLOAD_TOO_LARGE', message: 'Запит завеликий.' } });
    return;
  }
  logger.error('request.failed', {
    errorType: error instanceof Error ? error.name : 'UnknownError',
  });
  res.status(500).json({
    success: false,
    error: { code: 'INTERNAL_ERROR', message: 'Не вдалося виконати запит. Спробуйте ще раз.' },
  });
};
