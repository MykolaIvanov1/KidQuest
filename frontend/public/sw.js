// Only public application assets are cached. Authenticated API data never enters this cache.
const CACHE = 'kidquest-shell-v1';
const PRECACHE = /*__PRECACHE__*/ [];
self.addEventListener('install', (event) => {
  event.waitUntil(
    caches.open(CACHE).then((cache) => cache.addAll(['/', '/icons/icon-192.png', ...PRECACHE])),
  );
});
self.addEventListener('activate', (event) => {
  event.waitUntil(
    caches
      .keys()
      .then((keys) => {
        // Keep the previous public bundle for lazy chunks used by already-open tabs.
        const previous = keys.filter((key) => key.startsWith('kidquest-shell-') && key !== CACHE);
        return Promise.all(previous.slice(0, -1).map((key) => caches.delete(key)));
      })
      .then(() => self.clients.claim()),
  );
});
self.addEventListener('fetch', (event) => {
  const url = new URL(event.request.url);
  if (
    event.request.method !== 'GET' ||
    url.origin !== self.location.origin ||
    url.pathname.startsWith('/api/')
  )
    return;
  if (event.request.mode === 'navigate') {
    event.respondWith(
      fetch(event.request).catch(() => caches.open(CACHE).then((cache) => cache.match('/'))),
    );
    return;
  }
  if (url.pathname.startsWith('/assets/') || url.pathname.startsWith('/icons/')) {
    event.respondWith(
      // These same-origin public files have one representation per URL. A server's
      // Vary: Origin must not hide precached modules from an offline module request.
      caches.match(event.request, { ignoreVary: true }).then(
        (cached) =>
          cached ||
          fetch(event.request).then((response) => {
            if (response.ok) {
              const copy = response.clone();
              event.waitUntil(caches.open(CACHE).then((cache) => cache.put(event.request, copy)));
            }
            return response;
          }),
      ),
    );
  }
});
