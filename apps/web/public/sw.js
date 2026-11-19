/* Circular2Action service worker: shows push notifications and opens the right page when one is tapped.
   It does no caching and handles no fetches, so it can never serve stale or private pages. */

self.addEventListener('install', () => self.skipWaiting());
self.addEventListener('activate', (event) => event.waitUntil(self.clients.claim()));

self.addEventListener('push', (event) => {
  let data = {};
  try {
    data = event.data ? event.data.json() : {};
  } catch {
    data = {};
  }
  const title =
    typeof data.title === 'string' && data.title ? data.title.slice(0, 100) : 'Circular2Action';
  const body = typeof data.body === 'string' ? data.body.slice(0, 200) : '';
  const url =
    typeof data.url === 'string' && data.url.startsWith('/') && !data.url.startsWith('//')
      ? data.url
      : '/';
  event.waitUntil(
    self.registration.showNotification(title, {
      body,
      tag: typeof data.tag === 'string' ? data.tag.slice(0, 60) : undefined,
      icon: '/icon.svg',
      badge: '/icon.svg',
      data: { url },
    }),
  );
});

self.addEventListener('notificationclick', (event) => {
  event.notification.close();
  const raw = event.notification.data && event.notification.data.url;
  const path = typeof raw === 'string' && raw.startsWith('/') && !raw.startsWith('//') ? raw : '/';
  const target = new URL(path, self.location.origin).href;
  event.waitUntil(
    self.clients.matchAll({ type: 'window', includeUncontrolled: true }).then((list) => {
      for (const client of list) {
        if (client.url.startsWith(self.location.origin) && 'focus' in client) {
          if ('navigate' in client) client.navigate(target);
          return client.focus();
        }
      }
      return self.clients.openWindow(target);
    }),
  );
});
