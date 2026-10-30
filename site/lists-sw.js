// The wish list's service worker. It exists so Android can install the page,
// which is what puts "Wish List" in the phone's Share menu (see lists/manifest.webmanifest).
// It caches nothing: every page and every list comes fresh from the server. The only
// thing it does is show a plain note instead of the browser's error page when offline.
self.addEventListener('install', () => self.skipWaiting());
self.addEventListener('activate', event => event.waitUntil(self.clients.claim()));
self.addEventListener('fetch', event => {
  if (event.request.mode !== 'navigate') return;
  event.respondWith(fetch(event.request).catch(() => new Response(
    '<!doctype html><html lang="en"><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1">' +
    '<title>Offline</title><p style="font:16px/1.5 system-ui,sans-serif;padding:24px;max-width:36em">' +
    'You are offline. The wish list needs a connection. Try again when you are back online.</p></html>',
    { headers: { 'Content-Type': 'text/html; charset=utf-8' } })));
});
