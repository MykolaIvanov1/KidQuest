import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

class WorkerState extends EventTarget {
  constructor(public state: ServiceWorkerState) {
    super();
  }
  move(state: ServiceWorkerState) {
    this.state = state;
    this.dispatchEvent(new Event('statechange'));
  }
}
const register = vi.fn();
beforeEach(() => {
  vi.resetModules();
  register.mockReset();
  vi.stubGlobal('navigator', { serviceWorker: { register } });
});
afterEach(() => {
  vi.useRealTimers();
  vi.unstubAllGlobals();
});

describe('Service worker activation before push registration', () => {
  it('reuses one registration when the worker is already active', async () => {
    const result = { active: new WorkerState('activated') };
    register.mockResolvedValue(result);
    const { registerServiceWorker } = await import('../services/service-worker');
    const first = registerServiceWorker();
    expect(registerServiceWorker()).toBe(first);
    expect(await first).toBe(result);
    expect(register).toHaveBeenCalledExactlyOnceWith('/sw.js', { scope: '/' });
  });

  it('waits for an upgrade even when an older shell worker is active', async () => {
    const installing = new WorkerState('installing');
    const result = { installing, active: new WorkerState('activated') };
    const remove = vi.spyOn(installing, 'removeEventListener');
    register.mockResolvedValue(result);
    const { registerServiceWorker } = await import('../services/service-worker');
    let ready = false;
    const pending = registerServiceWorker().then((value) => {
      ready = true;
      return value;
    });
    await Promise.resolve();
    installing.move('installed');
    await Promise.resolve();
    expect(ready).toBe(false);
    installing.move('activated');
    expect(await pending).toBe(result);
    expect(remove).toHaveBeenCalledWith('statechange', expect.any(Function));
  });

  it('clears a failed registration so a later attempt can use the replacement', async () => {
    const next = { active: new WorkerState('activated') };
    register
      .mockResolvedValueOnce({ waiting: new WorkerState('redundant') })
      .mockResolvedValueOnce(next);
    const { registerServiceWorker } = await import('../services/service-worker');
    await expect(registerServiceWorker()).rejects.toThrow('SW_REDUNDANT');
    expect(await registerServiceWorker()).toBe(next);
    expect(register).toHaveBeenCalledTimes(2);
  });

  it('bounds activation waits and removes the listener when installation stalls', async () => {
    vi.useFakeTimers();
    const installing = new WorkerState('installing');
    const remove = vi.spyOn(installing, 'removeEventListener');
    register.mockResolvedValue({ installing });
    const { registerServiceWorker } = await import('../services/service-worker');
    const pending = registerServiceWorker();
    const rejection = expect(pending).rejects.toThrow('SW_ACTIVATION_TIMEOUT');
    await vi.advanceTimersByTimeAsync(15_000);
    await rejection;
    expect(remove).toHaveBeenCalledWith('statechange', expect.any(Function));
  });
});
