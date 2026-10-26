let registration: Promise<ServiceWorkerRegistration> | undefined;

function activated(result: ServiceWorkerRegistration): Promise<ServiceWorkerRegistration> {
  // An older shell worker can still be active while the new FCM worker installs.
  const worker = result.installing ?? result.waiting ?? result.active;
  if (!worker) return Promise.reject(new Error('SW_UNAVAILABLE'));
  if (worker.state === 'activated') return Promise.resolve(result);
  return new Promise((resolve, reject) => {
    const finish = (error?: Error) => {
      clearTimeout(timeout);
      worker.removeEventListener('statechange', changed);
      if (error) reject(error);
      else resolve(result);
    };
    const changed = () => {
      if (worker.state === 'activated') finish();
      else if (worker.state === 'redundant') finish(new Error('SW_REDUNDANT'));
    };
    const timeout = setTimeout(() => finish(new Error('SW_ACTIVATION_TIMEOUT')), 15_000);
    worker.addEventListener('statechange', changed);
    changed();
  });
}

/** The shell cache and FCM deliberately share one service worker and scope. */
export function registerServiceWorker(): Promise<ServiceWorkerRegistration> {
  if (!('serviceWorker' in navigator)) return Promise.reject(new Error('SW_UNSUPPORTED'));
  registration ??= navigator.serviceWorker
    .register('/sw.js', { scope: '/' })
    .then(activated)
    .catch((error) => {
      registration = undefined;
      throw error;
    });
  return registration;
}
