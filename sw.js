// Opens instantly and without signal (at the gym): the app's files come from the cache, and the
// cache is refreshed in the background, so a new version shows the time after.
// GitHub API calls aren't touched.

const CACHE = 'daily';

self.addEventListener('install', () => self.skipWaiting());
self.addEventListener('activate', e => e.waitUntil(self.clients.claim()));

self.addEventListener('fetch', e => {
  const url = new URL(e.request.url);
  if (e.request.method !== 'GET' || url.origin !== location.origin) return;
  e.respondWith(caches.open(CACHE).then(async cache => {
    const hit = await cache.match(e.request, { ignoreSearch: true });
    const fresh = fetch(e.request).then(r => { if (r.ok) cache.put(e.request, r.clone()); return r; });
    if (hit) { e.waitUntil(fresh.catch(() => {})); return hit; }
    return fresh;
  }));
});
