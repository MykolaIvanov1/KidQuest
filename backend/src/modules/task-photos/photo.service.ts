import { randomUUID } from 'node:crypto';
import { mkdir, unlink, writeFile } from 'node:fs/promises';
import path from 'node:path';
import sharp from 'sharp';
import { AppError } from '../../errors/app-error.js';
import { logger } from '../../utils/logger.js';

const formats: Record<string, string> = {
  'image/jpeg': 'jpeg',
  'image/png': 'png',
  'image/webp': 'webp',
};
export const MAX_PHOTO_SIZE = 5 * 1024 * 1024;
export interface StoredPhoto {
  storagePath: string;
  mimeType: string;
  size: number;
}

export class PhotoStorage {
  readonly root: string;
  constructor(root: string) {
    this.root = path.resolve(root);
  }

  pathFor(filename: string) {
    if (!/^[0-9a-f-]{36}\.webp$/.test(filename))
      throw new AppError(404, 'PHOTO_NOT_FOUND', 'Фото не знайдено.');
    return path.join(this.root, filename);
  }

  async save(files: Express.Multer.File[]): Promise<StoredPhoto[]> {
    if (files.length > 5)
      throw new AppError(400, 'TOO_MANY_PHOTOS', 'Можна додати до п’яти фотографій.');
    const prepared: { buffer: Buffer; filename: string }[] = [];
    for (const file of files) {
      if (!formats[file.mimetype])
        throw new AppError(400, 'UNSUPPORTED_PHOTO_TYPE', 'Оберіть фото JPEG, PNG або WebP.');
      if (file.size > MAX_PHOTO_SIZE)
        throw new AppError(413, 'PHOTO_TOO_LARGE', 'Фото має бути не більшим за 5 МіБ.');
      let buffer: Buffer;
      try {
        const image = sharp(file.buffer, { limitInputPixels: 40_000_000, failOn: 'error' });
        const metadata = await image.metadata();
        if (metadata.format !== formats[file.mimetype] || (metadata.pages ?? 1) > 1)
          throw new Error('Unsupported image data');
        buffer = await image
          .rotate()
          .resize({ width: 1600, height: 1600, fit: 'inside', withoutEnlargement: true })
          .webp({ quality: 82 })
          .toBuffer();
      } catch {
        throw new AppError(
          400,
          'INVALID_PHOTO',
          'Файл пошкоджений або не є фотографією підтримуваного типу.',
        );
      }
      prepared.push({ buffer, filename: `${randomUUID()}.webp` });
    }
    const stored: StoredPhoto[] = [];
    try {
      if (prepared.length) await mkdir(this.root, { recursive: true });
      for (const photo of prepared) {
        await writeFile(this.pathFor(photo.filename), photo.buffer, { flag: 'wx' });
        stored.push({
          storagePath: photo.filename,
          mimeType: 'image/webp',
          size: photo.buffer.length,
        });
      }
      return stored;
    } catch (error) {
      await this.remove(stored);
      throw error;
    }
  }

  async remove(photos: StoredPhoto[]) {
    await Promise.all(
      photos.map(async (photo) => {
        try {
          await unlink(this.pathFor(photo.storagePath));
        } catch (error) {
          if (!(error && typeof error === 'object' && 'code' in error && error.code === 'ENOENT'))
            logger.warn('photo.cleanup_failed');
        }
      }),
    );
  }
}
