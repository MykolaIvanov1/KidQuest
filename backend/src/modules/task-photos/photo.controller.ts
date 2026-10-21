import type { NextFunction, Request, Response } from 'express';
import { z } from 'zod';
import type { PhotoRepository } from './photo.repository.js';
import type { PhotoStorage } from './photo.service.js';
import { AppError } from '../../errors/app-error.js';

export class PhotoController {
  constructor(
    private repository: PhotoRepository,
    private storage: PhotoStorage,
  ) {}
  get = async (req: Request, res: Response, next: NextFunction) => {
    const id = z.uuid().parse(req.params.id);
    const photo = await this.repository.find(req.authUser!, id);
    if (!photo) throw new AppError(404, 'PHOTO_NOT_FOUND', 'Фото не знайдено.');
    res.setHeader('Cache-Control', 'private, no-store');
    res.setHeader('Content-Type', photo.mimeType);
    res.setHeader('Content-Disposition', 'inline; filename="task-photo.webp"');
    // The private storage root may live inside an ignored .local directory.
    // Only this validated UUID filename is served, after family/child authorization.
    res.sendFile(
      this.storage.pathFor(photo.storagePath),
      { dotfiles: 'allow', cacheControl: false },
      (error) => {
        if (!error) return;
        if ('status' in error && error.status === 404)
          next(new AppError(404, 'PHOTO_NOT_FOUND', 'Фото не знайдено.'));
        else next(error);
      },
    );
  };
}
