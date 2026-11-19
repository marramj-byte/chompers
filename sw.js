// Chompers service worker: offline play for whichever game registered it.
// chompers.html registers  sw.js?v=<CONFIG.version>&cache=<theme.cacheName>&manifest=<theme.manifest>
//   cache     "<cacheName>-<version>"; a new version installs a fresh cache and deletes
//             that game's older ones
//   files     the page, that game's manifest, and every icon the manifest lists
//   page (navigation):  network first, so a reload always picks up a new release;
//                       the cached copy is only used offline
//   manifest + icons:   cache first
const params = new URL(self.location.href).searchParams;
const VERSION = params.get('v') || 'dev';
const PREFIX = (params.get('cache') || 'chompers') + '-';
const MANIFEST = params.get('manifest') || 'manifest.json';
const CACHE = PREFIX + VERSION;

self.addEventListener('install', event => {
  event.waitUntil((async () => {
    const res = await fetch(MANIFEST, { cache: 'no-cache' });
    const man = await res.clone().json();
    const cache = await caches.open(CACHE);
    await cache.put(MANIFEST, res);
    await cache.addAll(['chompers.html', ...new Set(man.icons.map(i => i.src))]);
    await self.skipWaiting();
  })());
});

self.addEventListener('activate', event => {
  event.waitUntil(
    caches.keys()
      .then(keys => Promise.all(keys.filter(k => k.startsWith(PREFIX) && k !== CACHE).map(k => caches.delete(k))))
      .then(() => self.clients.claim()));
});

self.addEventListener('fetch', event => {
  const req = event.request;
  if (req.method !== 'GET' || new URL(req.url).origin !== self.location.origin) return;
  if (req.mode === 'navigate') {
    event.respondWith(
      fetch(req)
        .then(res => {
          if (res.ok && !res.redirected) {
            const copy = res.clone();
            caches.open(CACHE).then(c => c.put('chompers.html', copy));
          }
          return res;
        })
        .catch(() => caches.match('chompers.html', { cacheName: CACHE })));
    return;
  }
  event.respondWith(caches.match(req, { ignoreSearch: true, cacheName: CACHE }).then(hit => hit || fetch(req)));
});
