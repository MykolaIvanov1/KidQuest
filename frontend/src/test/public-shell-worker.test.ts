import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { runInNewContext } from 'node:vm';
import { describe, expect, it, vi } from 'vitest';

const origin = 'https://kidquest.example';
const currentCache = 'kidquest-shell-v1';
const bundle = ['/assets/app.123.js', '/assets/app.123.css'];
type ShellRequest = { url: string; method: string; mode: string };
function request(path: string, mode = 'cors', method = 'GET'): ShellRequest {
  return { url: new URL(path, origin).href, method, mode };
}
function worker() {
  const events: Record<string, (event: unknown) => void> = {};
  const storage = new Map<string, Map<string, Response>>();
  const fetch = vi.fn(
    async (input: string | ShellRequest) =>
      new Response(`Public asset ${typeof input === 'string' ? input : input.url}`),
  );
  const key = (input: string | ShellRequest) =>
    new URL(typeof input === 'string' ? input : input.url, origin).href;
  const read = (cacheName: string, input: string | ShellRequest) =>
    storage.get(cacheName)?.get(key(input))?.clone();
  const addAll = vi.fn(async (cacheName: string, urls: string[]) => {
    const responses = await Promise.all(urls.map((url) => fetch(url)));
    if (responses.some((response) => !response.ok)) throw new TypeError('Precache failed');
    responses.forEach((response, index) =>
      storage.get(cacheName)!.set(key(urls[index]!), response.clone()),
    );
  });
  const open = vi.fn(async (cacheName: string) => {
    if (!storage.has(cacheName)) storage.set(cacheName, new Map());
    return {
      addAll: (urls: string[]) => addAll(cacheName, urls),
      match: async (input: string | ShellRequest) => read(cacheName, input),
      put: async (input: string | ShellRequest, response: Response) => {
        storage.get(cacheName)!.set(key(input), response.clone());
      },
    };
  });
  const match = vi.fn(async (input: string | ShellRequest) => {
    for (const name of storage.keys()) {
      const response = read(name, input);
      if (response) return response;
    }
    return undefined;
  });
  const claim = vi.fn().mockResolvedValue(undefined);
  const source = readFileSync(resolve(process.cwd(), 'public/sw.js'), 'utf8').replace(
    '/*__PRECACHE__*/ []',
    JSON.stringify(bundle),
  );
  runInNewContext(source, {
    self: {
      location: { origin },
      addEventListener: (name: string, callback: (event: unknown) => void) => {
        events[name] = callback;
      },
      clients: { claim },
    },
    caches: {
      open,
      match,
      keys: async () => [...storage.keys()],
      delete: async (name: string) => storage.delete(name),
    },
    fetch,
    URL,
  });
  async function install() {
    const jobs: Promise<unknown>[] = [];
    events.install!({
      waitUntil: (job: Promise<unknown>) => {
        jobs.push(job);
      },
    });
    await Promise.all(jobs);
  }
  function handle(input: ShellRequest) {
    const jobs: Promise<unknown>[] = [];
    let result: Promise<Response | undefined> | undefined;
    const respondWith = vi.fn((value: Promise<Response | undefined>) => {
      result = value;
    });
    events.fetch!({
      request: input,
      respondWith,
      waitUntil: (job: Promise<unknown>) => {
        jobs.push(job);
      },
    });
    return {
      respondWith,
      response: async () => {
        const response = await result;
        await Promise.all(jobs);
        return response;
      },
    };
  }
  return { install, handle, fetch, open, match, read, addAll };
}

describe('Public PWA shell offline fetch behavior', () => {
  it('precaches the public entry document, icon and generated application bundles during installation', async () => {
    const runtime = worker();
    await runtime.install();
    expect(runtime.addAll).toHaveBeenCalledExactlyOnceWith(currentCache, [
      '/',
      '/icons/icon-192.png',
      ...bundle,
    ]);
    for (const url of ['/', '/icons/icon-192.png', ...bundle]) {
      expect(await runtime.read(currentCache, url)?.text()).toBe(`Public asset ${url}`);
    }
    expect(runtime.fetch.mock.calls.every(([url]) => !String(url).includes('/api/'))).toBe(true);
  });

  it('rejects shell installation when a required public bundle could not be downloaded', async () => {
    const runtime = worker();
    runtime.fetch.mockRejectedValueOnce(new TypeError('Offline during installation'));
    await expect(runtime.install()).rejects.toThrow('Offline during installation');
    expect(runtime.read(currentCache, '/')).toBeUndefined();
  });

  it('serves the cached root document when an application navigation cannot reach the network', async () => {
    const runtime = worker();
    await runtime.install();
    runtime.fetch.mockReset().mockRejectedValue(new TypeError('Offline'));
    const navigation = request('/child/adventure', 'navigate');
    const event = runtime.handle(navigation);
    expect(event.respondWith).toHaveBeenCalledOnce();
    expect(await (await event.response())!.text()).toBe('Public asset /');
    expect(runtime.fetch).toHaveBeenCalledExactlyOnceWith(navigation);
    expect(runtime.open).toHaveBeenLastCalledWith(currentCache);
  });

  it('uses the network document when navigation succeeds without caching private page HTML', async () => {
    const runtime = worker();
    const navigation = request('/child/profile', 'navigate');
    runtime.fetch.mockResolvedValueOnce(new Response('Fresh public application document'));
    expect(await (await runtime.handle(navigation).response())!.text()).toBe(
      'Fresh public application document',
    );
    expect(runtime.open).not.toHaveBeenCalled();
    expect(runtime.read(currentCache, '/child/profile')).toBeUndefined();
  });

  it('leaves authenticated API, private photos, cross-origin requests and non-GET requests to the browser', () => {
    const runtime = worker();
    for (const input of [
      request('/api/v1/tasks'),
      request('/api/v1/task-photos/private-photo?access=private'),
      request('/api/v1/task-photos/private-photo', 'navigate'),
      request('/api/v1/tasks/task-1/submit', 'cors', 'POST'),
      request('https://other.example/assets/private.js'),
      request('/assets/update.js', 'cors', 'POST'),
    ]) {
      expect(runtime.handle(input).respondWith).not.toHaveBeenCalled();
    }
    expect(runtime.fetch).not.toHaveBeenCalled();
    expect(runtime.match).not.toHaveBeenCalled();
    expect(runtime.open).not.toHaveBeenCalled();
  });

  it('serves installed scripts and icons directly from cache when the network is unavailable', async () => {
    const runtime = worker();
    await runtime.install();
    runtime.fetch.mockReset().mockRejectedValue(new TypeError('Offline'));
    for (const path of ['/assets/app.123.js', '/icons/icon-192.png']) {
      const event = runtime.handle(request(path));
      expect(await (await event.response())!.text()).toBe(`Public asset ${path}`);
    }
    expect(runtime.fetch).not.toHaveBeenCalled();
  });

  it('can still load a retained previous bundle needed by an already-open page', async () => {
    const runtime = worker();
    const previous = await runtime.open('kidquest-shell-previous');
    await previous.put('/assets/previous.lazy.js', new Response('Previous lazy bundle'));
    runtime.fetch.mockRejectedValue(new TypeError('Offline'));
    expect(
      await (await runtime.handle(request('/assets/previous.lazy.js')).response())!.text(),
    ).toBe('Previous lazy bundle');
    expect(runtime.fetch).not.toHaveBeenCalled();
  });

  it('adds a successful static cache miss to the shell cache and serves it on a later offline request', async () => {
    const runtime = worker();
    const input = request('/assets/new.lazy.js');
    runtime.fetch.mockResolvedValueOnce(new Response('Downloaded lazy bundle'));
    expect(await (await runtime.handle(input).response())!.text()).toBe('Downloaded lazy bundle');
    expect(await runtime.read(currentCache, input)?.text()).toBe('Downloaded lazy bundle');
    runtime.fetch.mockRejectedValue(new TypeError('Offline'));
    expect(await (await runtime.handle(input).response())!.text()).toBe('Downloaded lazy bundle');
    expect(runtime.fetch).toHaveBeenCalledExactlyOnceWith(input);
  });

  it('does not cache an unsuccessful static response or replace a missing script with an HTML document', async () => {
    const runtime = worker();
    const input = request('/assets/missing.js');
    runtime.fetch.mockResolvedValueOnce(new Response('Missing', { status: 404 }));
    expect((await runtime.handle(input).response())!.status).toBe(404);
    expect(runtime.read(currentCache, input)).toBeUndefined();
    runtime.fetch.mockRejectedValue(new TypeError('Offline'));
    await expect(runtime.handle(input).response()).rejects.toThrow('Offline');
  });
});
