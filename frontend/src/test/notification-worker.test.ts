import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { runInNewContext } from 'node:vm';
import { describe, expect, it, vi } from 'vitest';
import { notificationPath } from '../features/notifications/paths';

type WorkerEvent = {
  notification: { data: Record<string, unknown>; close: () => void };
  stopImmediatePropagation: () => void;
  waitUntil: (promise: Promise<unknown>) => void;
};
function worker(configured = true) {
  const events: Record<string, (event: WorkerEvent) => void> = {};
  const order: string[] = [];
  let background!: (payload: Record<string, unknown>) => Promise<void>;
  const show = vi.fn().mockResolvedValue(undefined);
  const open = vi.fn().mockResolvedValue(undefined);
  const clients = vi.fn().mockResolvedValue([]);
  const skipWaiting = vi.fn().mockResolvedValue(undefined);
  const initialize = vi.fn(() => {
    order.push('firebase');
    return {};
  });
  const source = readFileSync(resolve(process.cwd(), 'src/service-worker/push.js'), 'utf8').replace(
    /^import .*;$/gm,
    '',
  );
  runInNewContext(source, {
    self: {
      location: { origin: 'https://kidquest.example' },
      addEventListener: (name: string, callback: (event: WorkerEvent) => void) => {
        order.push(name);
        events[name] = callback;
      },
      registration: { showNotification: show },
      clients: { matchAll: clients, openWindow: open },
      skipWaiting,
    },
    initializeApp: initialize,
    getMessaging: () => ({}),
    onBackgroundMessage: (_messaging: unknown, callback: typeof background) => {
      order.push('background');
      background = callback;
    },
    __KIDQUEST_FIREBASE_CONFIG__: {
      apiKey: configured ? 'public-config' : '',
      projectId: 'project',
      messagingSenderId: 'sender',
      appId: 'app',
    },
    notificationPath,
    URL,
  });
  return { events, order, background, show, open, clients, initialize, skipWaiting };
}
async function click(runtime: ReturnType<typeof worker>, path: unknown) {
  const jobs: Promise<unknown>[] = [];
  const event = {
    notification: { data: { kidquest: true, path }, close: vi.fn() },
    stopImmediatePropagation: vi.fn(),
    waitUntil: (job: Promise<unknown>) => {
      jobs.push(job);
    },
  };
  runtime.events.notificationclick!(event);
  await Promise.all(jobs);
  return event;
}

describe('Private push worker', () => {
  it('registers the click guard before Firebase and the background handler synchronously on cold start', () => {
    const runtime = worker();
    expect(runtime.order).toEqual(['notificationclick', 'install', 'firebase', 'background']);
    expect(runtime.background).toBeTypeOf('function');
  });

  it('activates an installed update without leaving the old non-FCM worker in control', async () => {
    const runtime = worker();
    let work!: Promise<unknown>;
    runtime.events.install!({
      waitUntil: (job) => {
        work = job;
      },
    } as WorkerEvent);
    await work;
    expect(runtime.skipWaiting).toHaveBeenCalledOnce();
  });

  it('retains the current and previous public bundles while deleting older shell caches', async () => {
    let activate!: (event: { waitUntil: (job: Promise<unknown>) => void }) => void;
    const remove = vi.fn().mockResolvedValue(true);
    const claim = vi.fn().mockResolvedValue(undefined);
    runInNewContext(readFileSync(resolve(process.cwd(), 'public/sw.js'), 'utf8'), {
      self: {
        addEventListener: (name: string, handler: typeof activate) => {
          if (name === 'activate') activate = handler;
        },
        clients: { claim },
      },
      caches: {
        keys: async () => [
          'unrelated-cache',
          'kidquest-shell-oldest',
          'kidquest-shell-previous',
          'kidquest-shell-v1',
        ],
        delete: remove,
      },
    });
    let work!: Promise<unknown>;
    activate({
      waitUntil: (job) => {
        work = job;
      },
    });
    await work;
    expect(remove).toHaveBeenCalledExactlyOnceWith('kidquest-shell-oldest');
    expect(claim).toHaveBeenCalledOnce();
  });

  it('uses the current shell rather than an older retained document when navigation is offline', async () => {
    let fetchHandler!: (event: {
      request: { url: string; method: string; mode: string };
      respondWith: (job: Promise<unknown>) => void;
    }) => void;
    const currentDocument = { version: 'current' };
    const match = vi.fn().mockResolvedValue(currentDocument);
    const open = vi.fn().mockResolvedValue({ match });
    runInNewContext(readFileSync(resolve(process.cwd(), 'public/sw.js'), 'utf8'), {
      self: {
        location: { origin: 'https://kidquest.example' },
        addEventListener: (name: string, handler: typeof fetchHandler) => {
          if (name === 'fetch') fetchHandler = handler;
        },
      },
      caches: { open },
      fetch: vi.fn().mockRejectedValue(new Error('offline')),
      URL,
    });
    let work!: Promise<unknown>;
    fetchHandler({
      request: { url: 'https://kidquest.example/child', method: 'GET', mode: 'navigate' },
      respondWith: (job) => {
        work = job;
      },
    });
    expect(await work).toBe(currentDocument);
    expect(open).toHaveBeenCalledWith('kidquest-shell-v1');
    expect(match).toHaveBeenCalledWith('/');
  });

  it('shows generic lock-screen text and does not expose private payload fields', async () => {
    const runtime = worker();
    await runtime.background({
      data: {
        notificationId: 'notice-uuid',
        path: '/child/adventure',
        childName: 'Богдан',
        points: '125',
      },
      notification: { title: 'Секретний квест', body: 'Приватні дані сім’ї' },
    });
    expect(runtime.show).toHaveBeenCalledWith(
      'KidQuest',
      expect.objectContaining({
        body: 'У вас нове сповіщення. Відкрийте KidQuest, щоб переглянути.',
        tag: 'notice-uuid',
        data: { kidquest: true, path: '/child/adventure' },
      }),
    );
    expect(JSON.stringify(runtime.show.mock.calls)).not.toMatch(/Богдан|125|Секретний|Приватні/);
  });

  it('focuses an existing same-origin window and ignores other origins', async () => {
    const runtime = worker();
    const existing = {
      url: 'https://kidquest.example/child',
      navigate: vi.fn().mockResolvedValue(undefined),
      focus: vi.fn().mockResolvedValue(undefined),
    };
    runtime.clients.mockResolvedValue([{ url: 'https://untrusted.example/' }, existing]);
    const event = await click(runtime, '/child/rewards');
    expect(event.stopImmediatePropagation).toHaveBeenCalled();
    expect(event.notification.close).toHaveBeenCalled();
    expect(existing.navigate).toHaveBeenCalledWith('https://kidquest.example/child/rewards');
    expect(existing.focus).toHaveBeenCalled();
    expect(runtime.open).not.toHaveBeenCalled();
  });

  it('rejects external, unknown, encoded and traversal destinations', async () => {
    const runtime = worker();
    for (const path of [
      'https://untrusted.example',
      '//untrusted.example',
      '/child/../parent',
      '/child/%2e%2e',
      '/unknown',
      '/child?token=secret',
      '/child/adventure#private',
      null,
    ]) {
      await click(runtime, path);
      expect(runtime.open).toHaveBeenLastCalledWith('https://kidquest.example/');
    }
    await click(runtime, '/parent/notifications');
    expect(runtime.open).toHaveBeenLastCalledWith('https://kidquest.example/parent/notifications');
  });

  it('remains safe without Firebase configuration', () => {
    const runtime = worker(false);
    expect(runtime.initialize).not.toHaveBeenCalled();
    expect(runtime.events.notificationclick).toBeTypeOf('function');
  });

  it('never handles private API requests in the public shell cache', () => {
    const handlers: Record<string, (event: unknown) => void> = {};
    runInNewContext(readFileSync(resolve(process.cwd(), 'public/sw.js'), 'utf8'), {
      self: {
        location: { origin: 'https://kidquest.example' },
        addEventListener: (name: string, handler: (event: unknown) => void) => {
          handlers[name] = handler;
        },
      },
      URL,
    });
    for (const request of [
      { url: 'https://kidquest.example/api/v1/notifications', method: 'GET' },
      { url: 'https://kidquest.example/api/v1/devices', method: 'POST' },
      { url: 'https://external.example/assets/private.js', method: 'GET' },
    ]) {
      const respondWith = vi.fn();
      handlers.fetch!({ request, respondWith });
      expect(respondWith).not.toHaveBeenCalled();
    }
  });
});
