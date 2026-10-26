import 'fake-indexeddb/auto';
import { Blob as NativeBlob, File as NativeFile } from 'node:buffer';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { QueryClient } from '@tanstack/react-query';
import type { PublicUser, TaskDto, TaskCompletionDto } from '@kidquest/types';
import { OfflineStore } from '../features/offline/store';
import { projectTasks, restoreQueries } from '../features/offline/cache';

const child: PublicUser = {
  id: 'child-1',
  email: 'child@example.test',
  firstName: 'Богдан',
  lastName: null,
  role: 'CHILD',
  familyId: 'family-1',
};
const task: TaskDto = {
  id: 'task-1',
  updatedAt: '2026-10-23T08:00:00.000Z',
  title: 'Прибрати',
  description: '',
  categoryId: 'category-1',
  category: { id: 'category-1', name: 'Дім', icon: 'ListChecks', color: 'primary' },
  icon: 'ListChecks',
  color: 'primary',
  points: 10,
  isRequired: true,
  repeatDaily: true,
  photoRequired: false,
  startDate: null,
  endDate: null,
  startTime: null,
  endTime: null,
  isActive: true,
  todayCompletion: null,
};
const now = Date.parse('2026-10-23T10:00:00.000Z');
let store: OfflineStore;
let time: number;
const photo = () =>
  new NativeFile(['private-photo-bytes'], 'room.jpg', { type: 'image/jpeg' }) as unknown as File;

beforeEach(() => {
  time = now;
  store = new OfflineStore(`offline-test-${crypto.randomUUID()}`, () => time);
});
afterEach(async () => {
  vi.restoreAllMocks();
  await store.db.delete();
});

describe('Durable child offline storage', () => {
  it('persists the original operation, family day and binary photos across database reopen', async () => {
    const owner = (await store.activate(child, 0, 'Europe/Kyiv'))!;
    const queued = await store.enqueue(
      owner.sessionId,
      { ...task, photoRequired: true },
      [photo()],
      '2026-10-23T22:30:00.000Z',
    );
    expect(queued.completionDate).toBe('2026-10-24');
    expect(queued).not.toHaveProperty('photos');
    store.db.close();
    await store.db.open();
    const restored = await store.restore();
    expect(restored.pending).toEqual([queued]);
    const claimed = (await store.claim(owner.sessionId, 'lease-1'))!;
    expect(claimed.operationId).toBe(queued.operationId);
    expect(claimed.taskVersion).toBe(task.updatedAt);
    expect(claimed.photos[0]!.name).toBe('room.jpg');
    expect(await new NativeBlob([claimed.photos[0]!.bytes!]).text()).toBe('private-photo-bytes');
    expect(JSON.stringify(restored)).not.toMatch(/accessToken|refreshToken|password/);
  });

  it('continues reading and leasing a Blob photo saved by an earlier version', async () => {
    const owner = (await store.activate(child, 0))!;
    const operation = await store.enqueue(owner.sessionId, task, [photo()]);
    const row = (await store.db.queue.get(operation.operationId))!;
    row.photos = [{ blob: photo(), name: 'legacy.jpg', type: 'image/jpeg' }];
    await store.db.queue.put(row);
    store.db.close();
    await store.db.open();
    const claimed = (await store.claim(owner.sessionId, 'legacy-lease'))!;
    expect(claimed.photos[0]!.name).toBe('legacy.jpg');
    expect(await claimed.photos[0]!.blob!.text()).toBe('private-photo-bytes');
  });

  it('does not create a partial operation if reading a photo fails before the transaction', async () => {
    const owner = (await store.activate(child, 0))!;
    const unreadable = photo();
    vi.spyOn(unreadable, 'arrayBuffer').mockRejectedValueOnce(new Error('Cannot read file'));
    await expect(store.enqueue(owner.sessionId, task, [unreadable])).rejects.toMatchObject({
      code: 'STORAGE_UNAVAILABLE',
    });
    expect(await store.list(owner.sessionId)).toEqual([]);
  });

  it('atomically keeps one same-day operation across two tabs and allows daily work tomorrow', async () => {
    const owner = (await store.activate(child, 0))!;
    const tab = new OfflineStore(store.db.name, () => time);
    try {
      const operations = await Promise.all([
        store.enqueue(owner.sessionId, task, []),
        tab.enqueue(owner.sessionId, task, []),
      ]);
      expect(operations[0]!.operationId).toBe(operations[1]!.operationId);
      expect(await store.list(owner.sessionId)).toHaveLength(1);
      time += 86_400_000;
      const next = await tab.enqueue(owner.sessionId, task, []);
      expect(next.operationId).not.toBe(operations[0]!.operationId);
      expect(await store.list(owner.sessionId)).toHaveLength(2);
    } finally {
      tab.db.close();
    }
  });

  it('retains a single-use quest lock across family calendar days', async () => {
    const owner = (await store.activate(child, 0))!;
    await store.enqueue(owner.sessionId, { ...task, repeatDaily: false }, []);
    time += 86_400_000;
    await expect(
      store.enqueue(owner.sessionId, { ...task, repeatDaily: false }, []),
    ).rejects.toMatchObject({ code: 'ALREADY_QUEUED' });
  });

  it('keeps same-account work after verification but clears it after security-version or identity changes', async () => {
    const first = (await store.activate(child, 0))!;
    await store.enqueue(first.sessionId, task, []);
    await store.putCache(first.sessionId, {
      key: '["tasks"]',
      queryKey: ['tasks'],
      data: [task],
      dataUpdatedAt: now,
    });
    expect((await store.activate(child, 0))!.sessionId).toBe(first.sessionId);
    expect((await store.restore()).pending).toHaveLength(1);
    const reset = (await store.activate(child, 1))!;
    expect(reset.sessionId).not.toBe(first.sessionId);
    expect((await store.restore()).pending).toEqual([]);
    expect((await store.restore()).cache).toEqual([]);
    await expect(store.enqueue(first.sessionId, task, [])).rejects.toMatchObject({
      code: 'OWNER_CHANGED',
    });
    await store.enqueue(reset.sessionId, task, []);
    const other = (await store.activate({ ...child, id: 'child-2', familyId: 'family-2' }, 0))!;
    await store.clear(reset.sessionId);
    expect((await store.owner())!.sessionId).toBe(other.sessionId);
    expect((await store.restore()).pending).toEqual([]);
  });

  it('clears all private data on logout and leaves a durable sign-out marker', async () => {
    const owner = (await store.activate(child, 0))!;
    await store.enqueue(owner.sessionId, task, [photo()]);
    await store.markSignedOut(owner.sessionId);
    store.db.close();
    await store.db.open();
    expect(await store.restore()).toEqual({ owner: null, cache: [], pending: [], signedOut: true });
    expect(await store.db.queue.count()).toBe(0);
    expect(await store.activate({ ...child, role: 'PARENT' }, 0)).toBeNull();
    expect((await store.restore()).signedOut).toBe(false);
    expect((await store.restore()).owner).toBeNull();
  });

  it('refuses to persist non-allowlisted private query data at the storage boundary', async () => {
    const owner = (await store.activate(child, 0))!;
    await store.putCache(owner.sessionId, {
      key: 'auth',
      queryKey: ['auth', 'session'],
      data: { accessToken: 'must-not-persist' },
      dataUpdatedAt: now,
    });
    await store.putCache(owner.sessionId, {
      key: 'journal',
      queryKey: ['login-journal'],
      data: ['parent-only'],
      dataUpdatedAt: now,
    });
    expect(await store.db.cache.count()).toBe(0);
    await store.putCache(owner.sessionId, {
      key: 'tasks',
      queryKey: ['tasks'],
      data: [task],
      dataUpdatedAt: now,
    });
    expect((await store.restore()).cache).toHaveLength(1);
  });
  it('does not report a save when IndexedDB quota fails', async () => {
    const owner = (await store.activate(child, 0))!;
    vi.spyOn(store.db.queue, 'add').mockRejectedValueOnce(
      new DOMException('Disk full', 'QuotaExceededError'),
    );
    await expect(store.enqueue(owner.sessionId, task, [photo()])).rejects.toMatchObject({
      code: 'STORAGE_UNAVAILABLE',
    });
    expect(await store.list(owner.sessionId)).toEqual([]);
  });

  it('leases an operation once, reclaims after a crash and fences the stale worker', async () => {
    const owner = (await store.activate(child, 0))!;
    const queued = await store.enqueue(owner.sessionId, task, [photo()]);
    const claims = await Promise.all([
      store.claim(owner.sessionId, 'first'),
      store.claim(owner.sessionId, 'competing'),
    ]);
    expect(claims.filter(Boolean)).toHaveLength(1);
    const oldToken = claims.find(Boolean)!.leaseToken!;
    expect(await store.claim(owner.sessionId, 'too-soon')).toBeNull();
    await store.discard(owner.sessionId, queued.operationId);
    expect(await store.list(owner.sessionId)).toHaveLength(1);
    time += 120_001;
    const next = (await store.claim(owner.sessionId, 'replacement'))!;
    expect(next.attempts).toBe(2);
    expect(await store.ack(owner.sessionId, queued.operationId, oldToken)).toBe(false);
    await store.fail(owner.sessionId, queued.operationId, oldToken, {
      code: 'STALE',
      message: 'stale',
      retryAt: null,
    });
    expect((await store.list(owner.sessionId))[0]!.status).toBe('SENDING');
    expect(await store.ack(owner.sessionId, queued.operationId, 'replacement')).toBe(true);
    expect(await store.db.queue.count()).toBe(0);
  });

  it('retains photos on rejection and retries with the exact operation metadata', async () => {
    const owner = (await store.activate(child, 0))!;
    const operation = await store.enqueue(owner.sessionId, task, [photo()]);
    await store.claim(owner.sessionId, 'first');
    await store.fail(owner.sessionId, operation.operationId, 'first', {
      code: 'TASK_CHANGED',
      message: 'Квест змінився.',
      retryAt: null,
    });
    expect(await store.claim(owner.sessionId, 'blocked')).toBeNull();
    await store.retry(owner.sessionId, operation.operationId);
    const retry = (await store.claim(owner.sessionId, 'retry'))!;
    expect(retry).toMatchObject({
      operationId: operation.operationId,
      completedAt: operation.completedAt,
      taskVersion: task.updatedAt,
      attempts: 2,
    });
    expect(await new NativeBlob([retry.photos[0]!.bytes!]).text()).toBe('private-photo-bytes');
    await store.fail(owner.sessionId, operation.operationId, 'retry', {
      code: 'TASK_CHANGED',
      message: 'Квест змінився.',
      retryAt: null,
    });
    await store.discard(owner.sessionId, operation.operationId);
    expect(await store.db.queue.count()).toBe(0);
  });

  it('waits until retryAt before reclaiming a transient failure', async () => {
    const owner = (await store.activate(child, 0))!;
    const operation = await store.enqueue(owner.sessionId, task, []);
    await store.claim(owner.sessionId, 'first');
    await store.fail(owner.sessionId, operation.operationId, 'first', {
      code: 'NETWORK_ERROR',
      message: 'Мережа',
      retryAt: now + 2_000,
    });
    expect(await store.claim(owner.sessionId, 'early')).toBeNull();
    time += 2_000;
    expect((await store.claim(owner.sessionId, 'due'))!.operationId).toBe(operation.operationId);
  });

  it('validates photo count, MIME, size and required photos before creating an operation', async () => {
    const owner = (await store.activate(child, 0))!;
    await expect(
      store.enqueue(owner.sessionId, { ...task, photoRequired: true }, []),
    ).rejects.toMatchObject({ code: 'PHOTO_REQUIRED' });
    await expect(
      store.enqueue(owner.sessionId, task, Array.from({ length: 6 }, photo)),
    ).rejects.toMatchObject({ code: 'TOO_MANY_PHOTOS' });
    await expect(
      store.enqueue(owner.sessionId, task, [
        new NativeFile(['html'], 'x.html', { type: 'text/html' }) as unknown as File,
      ]),
    ).rejects.toMatchObject({ code: 'UNSUPPORTED_PHOTO_TYPE' });
    await expect(
      store.enqueue(owner.sessionId, task, [
        new NativeFile([new Uint8Array(5 * 1024 * 1024 + 1)], 'x.jpg', {
          type: 'image/jpeg',
        }) as unknown as File,
      ]),
    ).rejects.toMatchObject({ code: 'PHOTO_TOO_LARGE' });
    expect(await store.list(owner.sessionId)).toEqual([]);
  });
});

describe('Cached tasks at family midnight', () => {
  const completion = { completionDate: '2026-10-23', status: 'APPROVED' } as TaskCompletionDto;
  it('projects daily completion to pending on the new family day and preserves single-use history', () => {
    const projected = projectTasks(
      [
        { ...task, todayCompletion: completion },
        { ...task, id: 'once', repeatDaily: false, todayCompletion: completion },
        { ...task, id: 'expired', endDate: '2026-10-23' },
      ],
      'Europe/Kyiv',
      new Date('2026-10-23T22:00:00.000Z'),
    );
    expect(projected).toHaveLength(2);
    expect(projected[0]!.todayCompletion).toBeNull();
    expect(projected[1]!.todayCompletion).toBe(completion);
  });
  it('restores only allowed child queries without pretending the stale data was fetched now', () => {
    const client = new QueryClient();
    restoreQueries(
      client,
      {
        user: child,
        sessionId: 'session',
        authVersion: 0,
        timeZone: 'Europe/Kyiv',
        verifiedAt: new Date(now).toISOString(),
      },
      [
        { key: 'tasks', queryKey: ['tasks'], data: [task], dataUpdatedAt: now },
        { key: 'private', queryKey: ['login-journal'], data: ['forbidden'], dataUpdatedAt: now },
      ],
    );
    expect(client.getQueryState(['tasks'])!.dataUpdatedAt).toBe(now);
    expect(client.getQueryData(['login-journal'])).toBeUndefined();
    client.clear();
  });
});
