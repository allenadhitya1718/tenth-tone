/* === FLYP Service Worker — DEV MODE (cache-bypass) === */
// This SW clears all caches and unregisters itself so the browser
// always fetches fresh JS/CSS from the dev server.
self.addEventListener('install', () => self.skipWaiting());

self.addEventListener('activate', (e) => {
  e.waitUntil(
    caches.keys()
      .then((keys) => Promise.all(keys.map((k) => caches.delete(k))))
      .then(() => self.clients.claim())
      .then(() => {
        // Tell all open tabs to reload so they pick up fresh assets
        self.clients.matchAll({ type: 'window' }).then((clients) => {
          clients.forEach((c) => c.postMessage('SW_CLEARED'));
        });
      })
  );
});

// Pass ALL requests straight to the network — no caching at all
self.addEventListener('fetch', (e) => {
  e.respondWith(fetch(e.request));
});
