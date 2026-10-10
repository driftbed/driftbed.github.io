const CACHE_NAME = 'driftbed-shell-v1.9.0';
const APP_SHELL = [
  '/',
  '/index.html',
  '/benchmark.html',
  '/benchmark.css',
  '/styles.css',
  '/manifest.webmanifest',
  '/src/app.js?v=1.9.0',
  '/src/build-version.js?v=1.9.0',
  '/src/audio-io.js',
  '/src/distribution.js',
  '/src/loudness.js?v=1.9.0',
  '/src/profiles.js',
  '/src/random.js',
  '/src/synth.js',
  '/src/multi-component-spectrum-noise.js?v=1.9.0',
  '/src/nonnegative-factorization.js',
  '/src/source-component-analysis.js',
  '/src/source-spectrum-worker.js?v=1.9.0',
  '/src/source-drift.js?v=1.9.0',
  '/src/engine/engine.js?v=1.9.0',
  '/src/engine/javascript-backend.js?v=1.9.0',
  '/src/engine/wasm-backend.js?v=1.7.0',
  '/src/engine/wasm-loader.js?v=1.7.0',
  '/src/video-export.js',
  '/src/wav.js',
  '/src/benchmark/benchmark-page.js?v=1.9.0',
  '/src/benchmark/benchmark-runner.js?v=1.9.0',
  '/src/benchmark/benchmark-worker.js?v=1.9.0',
  '/src/benchmark/benchmark-fixtures.js?v=1.9.0',
  '/src/benchmark/benchmark-statistics.js?v=1.9.0',
  '/src/benchmark/benchmark-capabilities.js?v=1.9.0',
  '/src/benchmark/benchmark-report.js?v=1.9.0',
  '/icons/icon-192.png',
  '/icons/icon-512.png',
  '/icons/apple-touch-icon.png',
  '/wasm/driftbed_core.wasm'
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
