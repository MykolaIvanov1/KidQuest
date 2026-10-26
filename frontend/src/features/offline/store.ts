import Dexie, { type Table } from 'dexie';
import type { PublicUser, TaskDto } from '@kidquest/types';
import { cacheable } from './cache';

export interface OfflineOwner {
  user: PublicUser;
  authVersion: number;
  sessionId: string;
  timeZone: string;
  verifiedAt: string;
}
export interface SavedQuery {
  key: string;
  queryKey: readonly unknown[];
  data: unknown;
  dataUpdatedAt: number;
}
export interface QueuedTask {
  operationId: string;
  taskId: string;
  taskTitle: string;
  completedAt: string;
  completionDate: string;
  status: 'PENDING' | 'SENDING' | 'FAILED';
  attempts: number;
  nextAttemptAt: number;
  errorCode: string | null;
  errorMessage: string | null;
}
// Existing Blob rows remain readable; new rows use portable binary storage.
export type StoredPhoto = { name: string; type: string } & (
  { bytes: ArrayBuffer; blob?: never } | { blob: Blob; bytes?: never }
);
export interface StoredTask extends QueuedTask {
  ownerSessionId: string;
  taskVersion: string;
  photos: StoredPhoto[];
  leaseToken: string | null;
  leaseUntil: number | null;
}
type MetadataRow = { key: 'owner'; value: OfflineOwner } | { key: 'signedOut'; value: boolean };
interface CacheRow extends SavedQuery {
  ownerSessionId: string;
}
type OfflineDatabase = Dexie & {
  metadata: Table<MetadataRow, string>;
  cache: Table<CacheRow, string>;
  queue: Table<StoredTask, string>;
};

export class OfflineStorageError extends Error {
  constructor(
    public code: string,
    message: string,
  ) {
    super(message);
    this.name = 'OfflineStorageError';
  }
}

const PHOTO_LIMIT = 5 * 1024 * 1024;
const PHOTO_TYPES = new Set(['image/jpeg', 'image/png', 'image/webp']);
const LEASE_DURATION = 120_000;
function queuedTask(row: StoredTask): QueuedTask {
  return {
    operationId: row.operationId,
    taskId: row.taskId,
    taskTitle: row.taskTitle,
    completedAt: row.completedAt,
    completionDate: row.completionDate,
    status: row.status,
    attempts: row.attempts,
    nextAttemptAt: row.nextAttemptAt,
    errorCode: row.errorCode,
    errorMessage: row.errorMessage,
  };
}
function byCompletion(left: StoredTask, right: StoredTask) {
  return (
    left.completedAt.localeCompare(right.completedAt) ||
    left.operationId.localeCompare(right.operationId)
  );
}
function familyDate(timeZone: string, completedAt: string) {
  const parts = new Intl.DateTimeFormat('en-GB', {
    timeZone,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  }).formatToParts(new Date(completedAt));
  const part = (kind: Intl.DateTimeFormatPartTypes) =>
    parts.find((value) => value.type === kind)!.value;
  return `${part('year')}-${part('month')}-${part('day')}`;
}
function photoBytes(file: File): Promise<ArrayBuffer> {
  if (typeof file.arrayBuffer === 'function') return file.arrayBuffer();
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(reader.result as ArrayBuffer);
    reader.onerror = () => reject(reader.error || new Error('PHOTO_READ_FAILED'));
    reader.onabort = () => reject(new Error('PHOTO_READ_CANCELLED'));
    reader.readAsArrayBuffer(file);
  });
}
function validateTimeZone(timeZone: string) {
  try {
    new Intl.DateTimeFormat('en-GB', { timeZone }).format();
  } catch {
    throw new OfflineStorageError('STORAGE_UNAVAILABLE', 'Не вдалося визначити часову зону сім’ї.');
  }
}

/** Only one verified child account is retained on a shared device. No credentials are stored. */
export class OfflineStore {
  readonly db: OfflineDatabase;

  constructor(
    name = 'kidquest-offline-v1',
    private now: () => number = Date.now,
  ) {
    this.db = new Dexie(name) as OfflineDatabase;
    this.db.version(1).stores({
      metadata: 'key',
      cache: 'key, ownerSessionId',
      queue:
        'operationId, ownerSessionId, [ownerSessionId+taskId+completionDate], completedAt, status, nextAttemptAt, leaseUntil',
    });
  }

  private async storage<T>(operation: () => Promise<T>): Promise<T> {
    try {
      return await operation();
    } catch (cause) {
      if (cause instanceof OfflineStorageError) throw cause;
      throw new OfflineStorageError(
        'STORAGE_UNAVAILABLE',
        'Не вдалося зберегти дані на пристрої. Перевірте доступне місце та дозвіл браузера на локальне сховище.',
      );
    }
  }

  private async readOwner(): Promise<OfflineOwner | null> {
    const row = await this.db.metadata.get('owner');
    return row?.key === 'owner' ? row.value : null;
  }

  private async requireOwner(sessionId: string): Promise<OfflineOwner> {
    const current = await this.readOwner();
    if (!current || current.sessionId !== sessionId || current.user.role !== 'CHILD')
      throw new OfflineStorageError(
        'OWNER_CHANGED',
        'Акаунт змінився. Оновіть сторінку та увійдіть ще раз.',
      );
    return current;
  }

  async activate(
    user: PublicUser,
    authVersion: number,
    timeZone = 'Europe/Kyiv',
  ): Promise<OfflineOwner | null> {
    validateTimeZone(timeZone);
    if (!Number.isSafeInteger(authVersion) || authVersion < 0)
      throw new OfflineStorageError(
        'STORAGE_UNAVAILABLE',
        'Не вдалося перевірити версію сесії. Увійдіть ще раз.',
      );
    const verifiedAt = new Date(this.now()).toISOString();
    // Random IDs and timestamps are prepared before entering the IndexedDB transaction.
    const sessionId = crypto.randomUUID();
    return this.storage(() =>
      this.db.transaction('rw', this.db.metadata, this.db.cache, this.db.queue, async () => {
        const previous = await this.readOwner();
        await this.db.metadata.delete('signedOut');
        const sameOwner =
          previous &&
          previous.user.id === user.id &&
          previous.user.familyId === user.familyId &&
          previous.user.role === user.role &&
          previous.authVersion === authVersion;
        if (!sameOwner || user.role !== 'CHILD') {
          await this.db.cache.clear();
          await this.db.queue.clear();
          await this.db.metadata.clear();
        }
        if (user.role !== 'CHILD') return null;
        const owner: OfflineOwner = {
          user: {
            id: user.id,
            email: user.email,
            firstName: user.firstName,
            lastName: user.lastName,
            role: user.role,
            familyId: user.familyId,
          },
          authVersion,
          sessionId: sameOwner ? previous.sessionId : sessionId,
          timeZone,
          verifiedAt,
        };
        await this.db.metadata.put({ key: 'owner', value: owner });
        return owner;
      }),
    );
  }

  async restore(): Promise<{
    owner: OfflineOwner | null;
    cache: SavedQuery[];
    pending: QueuedTask[];
    signedOut: boolean;
  }> {
    return this.storage(() =>
      this.db.transaction('r', this.db.metadata, this.db.cache, this.db.queue, async () => {
        const owner = await this.readOwner();
        const marker = await this.db.metadata.get('signedOut');
        const signedOut = marker?.key === 'signedOut' && marker.value;
        if (!owner || owner.user.role !== 'CHILD')
          return { owner: null, cache: [], pending: [], signedOut };
        const cache = await this.db.cache.where('ownerSessionId').equals(owner.sessionId).toArray();
        const pending = await this.db.queue
          .where('ownerSessionId')
          .equals(owner.sessionId)
          .toArray();
        return {
          owner,
          signedOut,
          cache: cache.map(({ key, queryKey, data, dataUpdatedAt }) => ({
            key,
            queryKey,
            data,
            dataUpdatedAt,
          })),
          pending: pending.sort(byCompletion).map(queuedTask),
        };
      }),
    );
  }

  async owner(): Promise<OfflineOwner | null> {
    return this.storage(async () => (await this.readOwner()) ?? null);
  }

  async setTimeZone(sessionId: string, timeZone: string): Promise<void> {
    validateTimeZone(timeZone);
    await this.storage(() =>
      this.db.transaction('rw', this.db.metadata, async () => {
        const owner = await this.requireOwner(sessionId);
        await this.db.metadata.put({ key: 'owner', value: { ...owner, timeZone } });
      }),
    );
  }

  async putCache(sessionId: string, query: SavedQuery): Promise<void> {
    await this.storage(() =>
      this.db.transaction('rw', this.db.metadata, this.db.cache, async () => {
        await this.requireOwner(sessionId);
        if (!cacheable(query.queryKey)) return;
        await this.db.cache.put({ ...query, ownerSessionId: sessionId });
      }),
    );
  }

  async enqueue(
    sessionId: string,
    task: TaskDto,
    files: File[],
    completedAt = new Date(this.now()).toISOString(),
  ): Promise<QueuedTask> {
    if (files.length > 5)
      throw new OfflineStorageError('TOO_MANY_PHOTOS', 'Можна додати до п’яти фотографій.');
    for (const file of files) {
      if (!PHOTO_TYPES.has(file.type))
        throw new OfflineStorageError('UNSUPPORTED_PHOTO_TYPE', 'Оберіть фото JPEG, PNG або WebP.');
      if (file.size > PHOTO_LIMIT)
        throw new OfflineStorageError('PHOTO_TOO_LARGE', 'Фото має бути не більшим за 5 МіБ.');
    }
    if (task.photoRequired && files.length === 0)
      throw new OfflineStorageError('PHOTO_REQUIRED', 'Додайте фотографію виконаного квесту.');
    const completed = new Date(completedAt);
    const version = new Date(task.updatedAt);
    if (!Number.isFinite(completed.getTime()) || !Number.isFinite(version.getTime()))
      throw new OfflineStorageError(
        'INVALID_COMPLETED_AT',
        'Не вдалося визначити час виконання або версію квесту. Оновіть список.',
      );
    const canonicalCompletedAt = completed.toISOString();
    const operationId = crypto.randomUUID();
    // Read file bytes before entering the transaction. WebKit can reject Blob/File
    // serialization in IndexedDB; ArrayBuffer uses the same atomic durable record.
    const photos: StoredPhoto[] = await this.storage(() =>
      Promise.all(
        files.map(async (file) => ({
          bytes: await photoBytes(file),
          name: file.name,
          type: file.type,
        })),
      ),
    );
    return this.storage(() =>
      this.db.transaction('rw', this.db.metadata, this.db.queue, async () => {
        const owner = await this.requireOwner(sessionId);
        const completionDate = familyDate(owner.timeZone, canonicalCompletedAt);
        const existing = await this.db.queue
          .where('ownerSessionId')
          .equals(sessionId)
          .filter((row) => row.taskId === task.id)
          .toArray();
        const sameDay = existing.find((row) => row.completionDate === completionDate);
        if (sameDay) return queuedTask(sameDay);
        if (!task.repeatDaily && existing.length)
          throw new OfflineStorageError(
            'ALREADY_QUEUED',
            'Цей квест уже збережено на пристрої. Дочекайтеся надсилання або скасуйте попереднє збереження.',
          );
        const row: StoredTask = {
          operationId,
          ownerSessionId: sessionId,
          taskId: task.id,
          taskTitle: task.title,
          completedAt: canonicalCompletedAt,
          completionDate,
          taskVersion: version.toISOString(),
          photos,
          status: 'PENDING',
          attempts: 0,
          nextAttemptAt: 0,
          errorCode: null,
          errorMessage: null,
          leaseToken: null,
          leaseUntil: null,
        };
        await this.db.queue.add(row);
        return queuedTask(row);
      }),
    );
  }

  async list(sessionId: string): Promise<QueuedTask[]> {
    return this.storage(() =>
      this.db.transaction('r', this.db.metadata, this.db.queue, async () => {
        await this.requireOwner(sessionId);
        const rows = await this.db.queue.where('ownerSessionId').equals(sessionId).toArray();
        return rows.sort(byCompletion).map(queuedTask);
      }),
    );
  }

  async claim(sessionId: string, leaseToken: string, now = this.now()): Promise<StoredTask | null> {
    return this.storage(() =>
      this.db.transaction('rw', this.db.metadata, this.db.queue, async () => {
        await this.requireOwner(sessionId);
        const candidates = await this.db.queue
          .where('ownerSessionId')
          .equals(sessionId)
          .filter(
            (row) =>
              (row.status === 'PENDING' && row.nextAttemptAt <= now) ||
              (row.status === 'SENDING' && (row.leaseUntil ?? 0) <= now),
          )
          .toArray();
        const first = candidates.sort(byCompletion)[0];
        if (!first) return null;
        const claimed: StoredTask = {
          ...first,
          status: 'SENDING',
          attempts: first.attempts + 1,
          leaseToken,
          leaseUntil: now + LEASE_DURATION,
        };
        await this.db.queue.put(claimed);
        return claimed;
      }),
    );
  }

  async ack(sessionId: string, operationId: string, leaseToken: string): Promise<boolean> {
    return this.storage(() =>
      this.db.transaction('rw', this.db.metadata, this.db.queue, async () => {
        const owner = await this.readOwner();
        if (owner?.sessionId !== sessionId) return false;
        const row = await this.db.queue.get(operationId);
        if (
          !row ||
          row.ownerSessionId !== sessionId ||
          row.status !== 'SENDING' ||
          row.leaseToken !== leaseToken
        )
          return false;
        await this.db.queue.delete(operationId);
        return true;
      }),
    );
  }

  async fail(
    sessionId: string,
    operationId: string,
    leaseToken: string,
    error: { code: string; message: string; retryAt: number | null },
  ): Promise<void> {
    await this.storage(() =>
      this.db.transaction('rw', this.db.metadata, this.db.queue, async () => {
        const owner = await this.readOwner();
        if (owner?.sessionId !== sessionId) return;
        const row = await this.db.queue.get(operationId);
        if (
          !row ||
          row.ownerSessionId !== sessionId ||
          row.status !== 'SENDING' ||
          row.leaseToken !== leaseToken
        )
          return;
        await this.db.queue.put({
          ...row,
          status: error.retryAt === null ? 'FAILED' : 'PENDING',
          nextAttemptAt: error.retryAt ?? 0,
          errorCode: error.code,
          errorMessage: error.message,
          leaseToken: null,
          leaseUntil: null,
        });
      }),
    );
  }

  async retry(sessionId: string, operationId: string): Promise<void> {
    await this.storage(() =>
      this.db.transaction('rw', this.db.metadata, this.db.queue, async () => {
        await this.requireOwner(sessionId);
        const row = await this.db.queue.get(operationId);
        if (!row || row.ownerSessionId !== sessionId || row.status !== 'FAILED') return;
        await this.db.queue.put({
          ...row,
          status: 'PENDING',
          nextAttemptAt: 0,
          errorCode: null,
          errorMessage: null,
          leaseToken: null,
          leaseUntil: null,
        });
      }),
    );
  }

  async discard(sessionId: string, operationId: string): Promise<void> {
    await this.storage(() =>
      this.db.transaction('rw', this.db.metadata, this.db.queue, async () => {
        await this.requireOwner(sessionId);
        const row = await this.db.queue.get(operationId);
        if (!row || row.ownerSessionId !== sessionId || row.status === 'SENDING') return;
        await this.db.queue.delete(operationId);
      }),
    );
  }

  async markSignedOut(sessionId?: string): Promise<void> {
    await this.storage(() =>
      this.db.transaction('rw', this.db.metadata, this.db.cache, this.db.queue, async () => {
        if (sessionId !== undefined && (await this.readOwner())?.sessionId !== sessionId) return;
        await this.db.cache.clear();
        await this.db.queue.clear();
        await this.db.metadata.clear();
        await this.db.metadata.put({ key: 'signedOut', value: true });
      }),
    );
  }

  async clear(sessionId?: string): Promise<void> {
    await this.storage(() =>
      this.db.transaction('rw', this.db.metadata, this.db.cache, this.db.queue, async () => {
        if (sessionId !== undefined && (await this.readOwner())?.sessionId !== sessionId) return;
        await this.db.cache.clear();
        await this.db.queue.clear();
        await this.db.metadata.clear();
      }),
    );
  }
}

export const offlineStore = new OfflineStore();
