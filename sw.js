// Chompers service worker: offline play.
// The cache is named from CONFIG.version, which chompers.html passes in the
// registration URL (sw.js?v=<version>). A new version installs a fresh cache
// and deletes the old ones.
//   page (navigation):  network first, so a reload always picks up a new release;
//                       the cached copy is only used offline
//   manifest + icons:   cache first
const VERSION = new URL(self.location.href).searchParams.get('v') || 'dev';
const CACHE = 'chompers-' + VERSION;
const FILES = ['chompers.html', 'manifest.json', 'icons/chompers-192.png', 'icons/chompers-512.png'];

self.addEventListener('install', event => {
  event.waitUntil(caches.open(CACHE).then(c => c.addAll(FILES)).then(() => self.skipWaiting()));
});

self.addEventListener('activate', event => {
  event.waitUntil(
    caches.keys()
      .then(keys => Promise.all(keys.filter(k => k.startsWith('chompers-') && k !== CACHE).map(k => caches.delete(k))))
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
        .catch(() => caches.match('chompers.html')));
    return;
  }
  event.respondWith(caches.match(req, { ignoreSearch: true }).then(hit => hit || fetch(req)));
});
