// Offline support: network-first for same-origin GETs, falling back to the cache.
// Everything the app loads (HTML, hashed JS/CSS, workers, and the ffmpeg core once used)
// ends up cached, so the app keeps working without a connection after the first visit.
const CACHE = 'vinilo-loop-v1';

// The first visit loads the main bundle before this worker controls the page, so precache
// whatever index.html references (hashed JS/CSS) right at install time.
async function precache() {
  const cache = await caches.open(CACHE);
  const res = await fetch('./index.html', { cache: 'no-store' });
  const html = await res.clone().text();
  await cache.put('./index.html', res.clone());
  await cache.put('./', res);
  const assets = [...html.matchAll(/(?:src|href)="([^"]+\.(?:js|css|svg|png|ico))"/g)].map((m) => m[1]);
  await cache.addAll(assets);
}

self.addEventListener('install', (event) => {
  event.waitUntil(precache().then(() => self.skipWaiting()));
});

// The page sends the same-origin resources it loaded before this worker took control
// (lazy chunks, workers) so they are available offline too.
self.addEventListener('message', (event) => {
  const urls = event.data && event.data.type === 'cache' ? event.data.urls : null;
  if (!Array.isArray(urls)) return;
  event.waitUntil(
    caches.open(CACHE).then((c) =>
      Promise.all(
        urls
          .filter((u) => typeof u === 'string' && new URL(u).origin === self.location.origin)
          .map((u) => c.match(u, { ignoreVary: true }).then((hit) => hit || c.add(u).catch(() => {}))),
      ),
    ),
  );
});

self.addEventListener('activate', (event) => {
  event.waitUntil(
    caches
      .keys()
      .then((keys) => Promise.all(keys.filter((k) => k !== CACHE).map((k) => caches.delete(k))))
      .then(() => self.clients.claim()),
  );
});

self.addEventListener('fetch', (event) => {
  const req = event.request;
  const url = new URL(req.url);
  if (req.method !== 'GET' || url.origin !== self.location.origin) return;
  event.respondWith(
    fetch(req)
      .then((res) => {
        if (res.ok && res.type === 'basic') {
          const copy = res.clone();
          caches.open(CACHE).then((c) => c.put(req, copy));
        }
        return res;
      })
      .catch(async () => {
        // ignoreVary: module scripts carry an Origin header the precached copies didn't have.
        const hit = await caches.match(req, { ignoreVary: true });
        if (hit) return hit;
        return req.mode === 'navigate' ? (await caches.match('./index.html')) || Response.error() : Response.error();
      }),
  );
});
