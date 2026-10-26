import 'fake-indexeddb/auto';
import { Blob as NativeBlob, File as NativeFile } from 'node:buffer';
import { OfflineStore, type OfflineOwner } from '../features/offline/store';
import { OfflineSync } from '../features/offline/sync';
import { ApiError } from '../services/api';
import type { TaskDto, CompletionDto } from '@kidquest/types';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { AuthSession } from '@kidquest/types';

const session: AuthSession = {
  accessToken: 'offline-sync-access',
  user: {
    id: 'child-1',
    email: 'child@example.test',
    firstName: 'Богдан',
    lastName: null,
    role: 'CHILD',
    familyId: 'family-1',
  },
};

function response(status: number, data?: unknown) {
  return new Response(
    JSON.stringify(
      status < 400
        ? { success: true, data }
        : {
            success: false,
            error: {
              code: status === 401 ? 'UNAUTHENTICATED' : 'INTERNAL_ERROR',
              message: 'Помилка запиту.',
            },
          },
    ),
    { status, headers: { 'Content-Type': 'application/json' } },
  );
}

describe('Offline authentication gates', () => {
  beforeEach(() => {
    vi.resetModules();
    vi.stubEnv('VITE_API_URL', '/api/v1');
  });
  afterEach(() => {
    vi.unstubAllGlobals();
    vi.unstubAllEnvs();
  });

  it('retains the local session when token renewal loses the network', async () => {
    const fetchMock = vi
      .fn()
      .mockResolvedValueOnce(response(401))
      .mockRejectedValueOnce(new TypeError('Failed to fetch'));
    vi.stubGlobal('fetch', fetchMock);
    const client = await import('../services/api');
    const lost = vi.fn();
    client.onAuthLost(lost);
    client.setAccessToken(session.accessToken);

    await expect(client.api('/tasks')).rejects.toMatchObject({ status: 0, code: 'NETWORK_ERROR' });
    expect(lost).not.toHaveBeenCalled();
  });

  it('retains the local session when token renewal has a temporary server failure', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn().mockResolvedValueOnce(response(401)).mockResolvedValueOnce(response(503)),
    );
    const client = await import('../services/api');
    const lost = vi.fn();
    client.onAuthLost(lost);
    client.setAccessToken(session.accessToken);

    await expect(client.api('/tasks')).rejects.toMatchObject({ status: 503 });
    expect(lost).not.toHaveBeenCalled();
  });

  it('does clear access after a definitive rejection of the refresh session', async () => {
    const fetchMock = vi
      .fn()
      .mockResolvedValueOnce(response(401))
      .mockResolvedValueOnce(response(401))
      .mockResolvedValueOnce(response(200, session));
    vi.stubGlobal('fetch', fetchMock);
    const client = await import('../services/api');
    const lost = vi.fn();
    client.onAuthLost(lost);
    client.setAccessToken(session.accessToken);

    await expect(client.api('/tasks')).rejects.toMatchObject({
      status: 401,
      code: 'SESSION_EXPIRED',
    });
    expect(lost).toHaveBeenCalledOnce();
    await client.api('/auth/login', { method: 'POST', body: '{}' });
    expect(new Headers(fetchMock.mock.calls[2]![1].headers).has('Authorization')).toBe(false);
  });

  it('does not discard local access when a private photo refresh loses the network', async () => {
    vi.stubGlobal(
      'fetch',
      vi
        .fn()
        .mockResolvedValueOnce(response(401))
        .mockRejectedValueOnce(new TypeError('Failed to fetch')),
    );
    const client = await import('../services/api');
    const lost = vi.fn();
    client.onAuthLost(lost);
    client.setAccessToken(session.accessToken);

    await expect(client.apiBlob('/task-photos/photo-1')).rejects.toMatchObject({
      status: 0,
      code: 'NETWORK_ERROR',
    });
    expect(lost).not.toHaveBeenCalled();
  });
});

function jwt(version: number) {
  return `header.${btoa(JSON.stringify({ ver: version }))}.signature`;
}

async function pendingRefresh() {
  let finish!: (value: Response) => void;
  const promise = new Promise<Response>((resolve) => {
    finish = resolve;
  });
  return { promise, finish };
}

describe('API session fences for offline operations', () => {
  beforeEach(() => {
    vi.resetModules();
    vi.stubEnv('VITE_API_URL', '/api/v1');
  });
  afterEach(() => {
    vi.unstubAllGlobals();
    vi.unstubAllEnvs();
  });

  it('ignores a refresh response that arrives after local sign-out', async () => {
    const pending = await pendingRefresh();
    const fetchMock = vi
      .fn()
      .mockReturnValueOnce(pending.promise)
      .mockResolvedValueOnce(response(200, session.user));
    vi.stubGlobal('fetch', fetchMock);
    const client = await import('../services/api');
    const refreshing = client.refreshSession();
    client.resetApiSession();
    pending.finish(response(200, { ...session, accessToken: jwt(7) }));
    await expect(refreshing).rejects.toMatchObject({ code: 'SESSION_CHANGED' });
    expect(client.currentAuthVersion()).toBeNull();
    await client.api('/auth/login', { method: 'POST', body: '{}' });
    expect(new Headers(fetchMock.mock.calls[1]![1].headers).has('Authorization')).toBe(false);
  });

  it('does not retry an old multipart body after a different child refreshes the cookie', async () => {
    const fetchMock = vi
      .fn()
      .mockResolvedValueOnce(response(401))
      .mockResolvedValueOnce(
        response(200, {
          ...session,
          user: { ...session.user, id: 'another-child', familyId: 'another-family' },
          accessToken: jwt(0),
        }),
      );
    vi.stubGlobal('fetch', fetchMock);
    const client = await import('../services/api');
    const lost = vi.fn();
    client.onAuthLost(lost);
    client.setApiIdentity(session.user.id);
    client.setAccessToken(jwt(0));
    const body = new FormData();
    body.set('operationId', 'original-operation');
    await expect(
      client.api('/tasks/task-1/submit', { method: 'POST', body }),
    ).rejects.toMatchObject({ code: 'SESSION_EXPIRED' });
    expect(fetchMock).toHaveBeenCalledTimes(2);
    expect(lost).toHaveBeenCalledOnce();
  });

  it('does not retry queued work under a newer security version of the same child', async () => {
    const fetchMock = vi
      .fn()
      .mockResolvedValueOnce(response(401))
      .mockResolvedValueOnce(response(200, { ...session, accessToken: jwt(1) }));
    vi.stubGlobal('fetch', fetchMock);
    const client = await import('../services/api');
    const lost = vi.fn();
    client.onAuthLost(lost);
    client.setApiIdentity(session.user.id);
    client.setAccessToken(jwt(0));
    const body = new FormData();
    body.set('operationId', 'original-operation');
    await expect(
      client.api('/tasks/task-1/submit', { method: 'POST', body }),
    ).rejects.toMatchObject({ code: 'SESSION_EXPIRED' });
    expect(fetchMock).toHaveBeenCalledTimes(2);
    expect(lost).toHaveBeenCalledOnce();
  });
});

const syncTask: TaskDto = {
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
const completion: CompletionDto = {
  id: 'completion-1',
  taskId: 'task-1',
  childId: 'child-1',
  childName: 'Богдан',
  taskTitle: 'Прибрати',
  status: 'SUBMITTED',
  completionDate: '2026-10-23',
  pointsSnapshot: 10,
  operationId: 'operation',
  submittedAt: '2026-10-23T10:00:00.000Z',
  reviewedAt: null,
  rejectionReason: null,
  photos: [],
};
let syncStore: OfflineStore;
let owner: OfflineOwner;
let syncTime: number;

function runner(
  send = vi.fn().mockResolvedValue(completion),
  verify = vi.fn().mockResolvedValue(session.user),
) {
  const onSuccess = vi.fn().mockResolvedValue(undefined);
  return {
    send,
    verify,
    onSuccess,
    sync: new OfflineSync(owner, {
      store: syncStore,
      send,
      verify,
      now: () => syncTime,
      onSuccess,
    }),
  };
}

describe('Offline queue synchronization', () => {
  beforeEach(async () => {
    syncTime = Date.parse('2026-10-23T10:00:00.000Z');
    syncStore = new OfflineStore(`offline-sync-test-${crypto.randomUUID()}`, () => syncTime);
    owner = (await syncStore.activate(session.user, 0))!;
    // Node's structuredClone recognizes native Blob/File. Native FormData then accepts the reopened blobs.
    const native = await new Response('key=value', {
      headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    }).formData();
    vi.stubGlobal('FormData', native.constructor);
    vi.stubGlobal('Blob', NativeBlob);
  });
  afterEach(async () => {
    vi.unstubAllGlobals();
    vi.useRealTimers();
    await syncStore.db.delete();
  });

  it('verifies identity, preserves multipart metadata and deletes an operation only after success', async () => {
    const photo = new NativeFile(['photo-bytes'], 'proof.jpg', {
      type: 'image/jpeg',
    }) as unknown as File;
    const queued = await syncStore.enqueue(owner.sessionId, syncTask, [photo]);
    const worker = runner();
    await worker.sync.run();
    expect(worker.verify).toHaveBeenCalledOnce();
    expect(worker.send).toHaveBeenCalledOnce();
    const [taskId, form, signal] = worker.send.mock.calls[0]! as [string, FormData, AbortSignal];
    expect(taskId).toBe(syncTask.id);
    expect(form.get('operationId')).toBe(queued.operationId);
    expect(form.get('completedAt')).toBe(queued.completedAt);
    expect(form.get('taskVersion')).toBe(syncTask.updatedAt);
    const uploaded = form.get('photos') as File;
    expect(uploaded.name).toBe('proof.jpg');
    expect(await uploaded.text()).toBe('photo-bytes');
    expect(signal.aborted).toBe(false);
    expect(await syncStore.list(owner.sessionId)).toEqual([]);
    expect(worker.onSuccess).toHaveBeenCalledWith(completion);
  });

  it('sends a legacy Blob photo from an earlier storage version with the same bytes', async () => {
    const operation = await syncStore.enqueue(owner.sessionId, syncTask, []);
    const row = (await syncStore.db.queue.get(operation.operationId))!;
    row.photos = [
      {
        blob: new NativeBlob(['legacy-photo-bytes'], { type: 'image/jpeg' }) as unknown as Blob,
        name: 'legacy.jpg',
        type: 'image/jpeg',
      },
    ];
    await syncStore.db.queue.put(row);
    const worker = runner();
    await worker.sync.run();
    expect(worker.send).toHaveBeenCalledOnce();
    const [, form] = worker.send.mock.calls[0]! as [string, FormData];
    const uploaded = form.get('photos') as File;
    expect(uploaded.name).toBe('legacy.jpg');
    expect(uploaded.type).toBe('image/jpeg');
    expect(await uploaded.text()).toBe('legacy-photo-bytes');
    expect(await syncStore.list(owner.sessionId)).toEqual([]);
  });

  it('keeps the exact operation and photos after a lost response and retries them after restart', async () => {
    const queued = await syncStore.enqueue(owner.sessionId, syncTask, [
      new NativeFile(['photo-bytes'], 'proof.jpg', { type: 'image/jpeg' }) as unknown as File,
    ]);
    const lost = runner(vi.fn().mockRejectedValue(new ApiError(0, 'NETWORK_ERROR', 'Мережа')));
    await lost.sync.run();
    expect((await syncStore.list(owner.sessionId))[0]).toMatchObject({
      operationId: queued.operationId,
      status: 'PENDING',
      attempts: 1,
      nextAttemptAt: syncTime + 2_000,
    });
    syncStore.db.close();
    await syncStore.db.open();
    syncTime += 2_000;
    const next = runner();
    await next.sync.run();
    const [, form] = next.send.mock.calls[0]! as [string, FormData];
    expect(form.get('operationId')).toBe(queued.operationId);
    expect(form.get('completedAt')).toBe(queued.completedAt);
    expect(await (form.get('photos') as File).text()).toBe('photo-bytes');
    expect(await syncStore.db.queue.count()).toBe(0);
  });

  it.each([
    [429, 'RATE_LIMITED'],
    [503, 'INTERNAL_ERROR'],
    [409, 'CONCURRENT_UPDATE'],
  ] as const)('retries transient %i/%s without losing the operation', async (status, code) => {
    await syncStore.enqueue(owner.sessionId, syncTask, []);
    const worker = runner(
      vi.fn().mockRejectedValue(new ApiError(status, code, 'Повторіть пізніше.')),
    );
    await worker.sync.run();
    expect((await syncStore.list(owner.sessionId))[0]).toMatchObject({
      status: 'PENDING',
      errorCode: code,
      nextAttemptAt: syncTime + 2_000,
    });
    expect(worker.onSuccess).not.toHaveBeenCalled();
  });

  it('retains terminal conflicts and lets unrelated operations continue', async () => {
    await syncStore.enqueue(owner.sessionId, syncTask, []);
    await syncStore.enqueue(owner.sessionId, { ...syncTask, id: 'task-2' }, []);
    const send = vi
      .fn()
      .mockRejectedValueOnce(new ApiError(409, 'TASK_CHANGED', 'Батьки змінили квест.'))
      .mockResolvedValueOnce(completion);
    const worker = runner(send);
    await worker.sync.run();
    expect(send).toHaveBeenCalledTimes(2);
    expect((await syncStore.list(owner.sessionId))[0]).toMatchObject({
      status: 'FAILED',
      errorCode: 'TASK_CHANGED',
    });
    expect(worker.onSuccess).toHaveBeenCalledOnce();
  });

  it('does not claim or send a queue after cookie identity belongs to another family', async () => {
    await syncStore.enqueue(owner.sessionId, syncTask, []);
    const worker = runner(
      vi.fn(),
      vi.fn().mockResolvedValue({ ...session.user, id: 'child-other', familyId: 'family-other' }),
    );
    await worker.sync.run();
    expect(worker.send).not.toHaveBeenCalled();
    expect((await syncStore.list(owner.sessionId))[0]).toMatchObject({
      status: 'PENDING',
      attempts: 0,
    });
  });

  it('coalesces concurrent runs and fences a late response after stop/sign-out', async () => {
    const queued = await syncStore.enqueue(owner.sessionId, syncTask, []);
    let finish!: (value: CompletionDto) => void;
    const send = vi.fn().mockImplementation(
      () =>
        new Promise<CompletionDto>((resolve) => {
          finish = resolve;
        }),
    );
    const worker = runner(send);
    const running = worker.sync.run();
    expect(worker.sync.run()).toBe(running);
    await vi.waitFor(() => expect(send).toHaveBeenCalledOnce());
    worker.sync.stop();
    expect((send.mock.calls[0]![2] as AbortSignal).aborted).toBe(true);
    await syncStore.markSignedOut(owner.sessionId);
    finish(completion);
    await running;
    expect(worker.onSuccess).not.toHaveBeenCalled();
    expect((await syncStore.restore()).signedOut).toBe(true);
    expect(await syncStore.db.queue.get(queued.operationId)).toBeUndefined();
  });

  it('does not send work after stop while a database claim is still pending', async () => {
    await syncStore.enqueue(owner.sessionId, syncTask, []);
    const originalClaim = syncStore.claim.bind(syncStore);
    let release!: () => void;
    const paused = new Promise<void>((resolve) => {
      release = resolve;
    });
    const claim = vi.spyOn(syncStore, 'claim').mockImplementation(async (...args) => {
      const claimed = await originalClaim(...args);
      await paused;
      return claimed;
    });
    const worker = runner();
    const running = worker.sync.run();
    await vi.waitFor(() => expect(claim).toHaveBeenCalledOnce());
    worker.sync.stop();
    release();
    await running;
    expect(worker.send).not.toHaveBeenCalled();
    expect(worker.onSuccess).not.toHaveBeenCalled();
    claim.mockRestore();
  });
});

describe('Private photo session fences', () => {
  beforeEach(() => {
    vi.resetModules();
    vi.stubEnv('VITE_API_URL', '/api/v1');
  });
  afterEach(() => {
    vi.unstubAllGlobals();
    vi.unstubAllEnvs();
  });
  it('does not refresh or expire the new account after a stale photo error body arrives', async () => {
    let resolveBody!: (value: unknown) => void;
    const body = new Promise((resolve) => {
      resolveBody = resolve;
    });
    const json = vi.fn().mockReturnValue(body);
    const fetchMock = vi.fn().mockResolvedValue({ ok: false, status: 401, json });
    vi.stubGlobal('fetch', fetchMock);
    const client = await import('../services/api');
    const lost = vi.fn();
    client.onAuthLost(lost);
    client.setApiIdentity('old-child');
    client.setAccessToken(jwt(0));
    const reading = client.apiBlob('/task-photos/photo-1');
    await vi.waitFor(() => expect(json).toHaveBeenCalledOnce());
    client.resetApiSession();
    client.setApiIdentity('new-child');
    client.setAccessToken(jwt(2));
    resolveBody({
      success: false,
      error: { code: 'UNAUTHENTICATED', message: 'Сесію завершено.' },
    });
    await expect(reading).rejects.toMatchObject({ code: 'SESSION_CHANGED' });
    expect(fetchMock).toHaveBeenCalledOnce();
    expect(lost).not.toHaveBeenCalled();
    expect(client.currentAuthVersion()).toBe(2);
  });
});
