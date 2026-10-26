import { initializeApp } from 'firebase/app';
import { getMessaging, onBackgroundMessage } from 'firebase/messaging/sw';
import { notificationPath } from '../features/notifications/paths';
/* global __KIDQUEST_FIREBASE_CONFIG__ */

/* Register before Firebase so it cannot replace our constrained click navigation. */
self.addEventListener('notificationclick', (event) => {
  if (!event.notification.data?.kidquest) return;
  event.stopImmediatePropagation();
  event.notification.close();
  const path = notificationPath(event.notification.data.path);
  const destination = new URL(path, self.location.origin).href;
  event.waitUntil(
    self.clients.matchAll({ type: 'window', includeUncontrolled: true }).then(async (clients) => {
      const existing = clients.find(
        (client) => new URL(client.url).origin === self.location.origin,
      );
      if (existing) {
        await existing.navigate(destination);
        return existing.focus();
      }
      return self.clients.openWindow(destination);
    }),
  );
});

self.addEventListener('install', (event) => {
  event.waitUntil(self.skipWaiting());
});

// Only public Firebase app configuration is compiled into this worker; never Admin credentials.
const config = __KIDQUEST_FIREBASE_CONFIG__;
if (Object.values(config).every(Boolean)) {
  try {
    // Register the push listener during worker evaluation, including a cold start.
    const messaging = getMessaging(initializeApp(config, 'kidquest-push-worker'));
    onBackgroundMessage(messaging, (payload) => {
      // Family names, task contents, balances and photos stay inside authenticated screens.
      return self.registration.showNotification('KidQuest', {
        body: 'У вас нове сповіщення. Відкрийте KidQuest, щоб переглянути.',
        icon: '/icons/icon-192.png',
        badge: '/icons/icon-192.png',
        tag: payload.data?.notificationId || 'kidquest-update',
        data: { kidquest: true, path: notificationPath(payload.data?.path) },
      });
    });
  } catch {
    /* The public shell and inbox work without push support. */
  }
}
