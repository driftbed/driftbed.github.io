const CACHE_NAME = 'driftbed-shell-v1.4.1';
const APP_SHELL = [
  '/',
  '/index.html',
  '/styles.css',
  '/manifest.webmanifest',
  '/src/app.js?v=1.4.1',
  '/src/audio-io.js',
  '/src/distribution.js',
  '/src/loudness.js',
  '/src/profiles.js',
  '/src/random.js',
  '/src/synth.js',
  '/src/video-export.js',
  '/src/wav.js',
  '/icons/icon-192.png',
  '/icons/icon-512.png',
  '/icons/apple-touch-icon.png'
];

self.addEventListener('install', event => {
  event.waitUntil(
    caches.open(CACHE_NAME)
      .then(cache => cache.addAll(APP_SHELL))
      .then(() => self.skipWaiting())
  );
});

self.addEventListener('activate', event => {
  event.waitUntil(
    caches.keys()
      .then(keys => Promise.all(keys.filter(key => key !== CACHE_NAME).map(key => caches.delete(key))))
      .then(() => self.clients.claim())
  );
});

self.addEventListener('fetch', event => {
  if (event.request.method !== 'GET') return;
  const requestUrl = new URL(event.request.url);
  if (requestUrl.origin !== self.location.origin) return;

  event.respondWith((async () => {
    const cache = await caches.open(CACHE_NAME);
    const cached = await cache.match(event.request);
    if (cached && event.request.mode !== 'navigate') return cached;

    try {
      const response = await fetch(event.request);
      if (response.ok) {
        event.waitUntil(cache.put(event.request, response.clone()).catch(() => {}));
      }
      return response;
    } catch {
      return cached || cache.match('/index.html');
    }
  })());
});
