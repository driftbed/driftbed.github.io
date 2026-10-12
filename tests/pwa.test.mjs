import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { access } from 'node:fs/promises';

const text = path => readFile(new URL(`../${path}`, import.meta.url), 'utf8');

test('PWA manifest declares an installable standalone app', async () => {
  const manifest = JSON.parse(await text('manifest.webmanifest'));
  assert.equal(manifest.name, 'Driftbed — Ambient Beds for Audio & Video');
  assert.equal(manifest.short_name, 'Driftbed');
  assert.equal(manifest.start_url, '/');
  assert.equal(manifest.scope, '/');
  assert.equal(manifest.display, 'standalone');
  assert.equal(manifest.prefer_related_applications, false);
  assert.deepEqual(manifest.icons.map(icon => icon.sizes), ['192x192', '512x512']);
});

test('PWA shell references the manifest, iOS icon, and service worker', async () => {
  const index = await text('index.html');
  const app = await text('src/app.js');
  const worker = await text('sw.js');
  const sourceWorker = await text('src/source-spectrum-worker.js');
  assert.match(index, /manifest\.webmanifest/);
  assert.match(index, /apple-touch-icon/);
  assert.match(index, /src\/app\.js\?v=1\.10\.0/);
  assert.match(app, /serviceWorker\.register\('\.\/sw\.js'\)/);
  assert.match(worker, /driftbed-shell-v1\.10\.0/);
  assert.match(worker, /\/benchmark\.html/);
  assert.match(worker, /\/benchmark\.css/);
  assert.match(worker, /src\/loudness\.js\?v=1\.10\.0/);
  assert.match(worker, /src\/multi-component-spectrum-noise\.js\?v=1\.10\.0/);
  assert.match(worker, /src\/source-frequency-varied-noise\.js\?v=1\.10\.0/);
  assert.match(worker, /src\/source-spectrum-worker\.js\?v=1\.10\.0/);
  assert.match(worker, /src\/source-drift\.js\?v=1\.10\.0/);
  assert.match(worker, /src\/engine\/engine\.js\?v=1\.10\.0/);
  assert.match(worker, /src\/engine\/javascript-backend\.js\?v=1\.10\.0/);
  assert.match(worker, /src\/engine\/wasm-loader\.js\?v=1\.7\.0/);
  assert.match(worker, /wasm\/driftbed_core\.wasm/);
  assert.match(worker, /src\/benchmark\/benchmark-worker\.js\?v=1\.10\.0/);
  assert.match(worker, /src\/source-component-analysis\.js/);
  assert.match(worker, /src\/nonnegative-factorization\.js/);
  assert.match(worker, /src\/audio-io\.js\?v=1\.10\.0/);
  assert.match(worker, /src\/media-duration\.js\?v=1\.10\.0/);
  assert.match(worker, /src\/video-export\.js\?v=1\.10\.0/);
  assert.match(worker, /src\/webm-container\.js\?v=1\.10\.0/);
  assert.match(worker, /src\/wav\.js\?v=1\.10\.0/);
  assert.match(sourceWorker, /data\.type !== 'render' && data\.type !== 'renderDerived'/);
  assert.match(sourceWorker, /type: 'derivedResult'/);
});

test('app imports every synthesis helper used by its controls', async () => {
  const app = await text('src/app.js');
  assert.match(app, /import \{[^}]*createProcessingEngine[^}]*\} from '\.\/engine\/engine\.js\?v=1\.10\.0'/);
  assert.doesNotMatch(app, /from '\.\/synth\.js'/);
  assert.doesNotMatch(app, /from '\.\/loudness\.js/);
  assert.match(app, /const OUTPUT_RECIPE_VERSION = 8/);
  assert.match(app, /renderSourceDerivedLayers/);
  assert.match(app, /sourceDriftVersion/);
  assert.match(app, /processingBackend/);
});

test('main page exposes semantic benchmark navigation', async () => {
  const index = await text('index.html');
  const benchmark = await text('benchmark.html');
  assert.match(index, /<a class="button-link secondary" href="\.\/benchmark\.html">Benchmark engines/);
  assert.match(benchmark, /href="\.\/"/);
  assert.match(benchmark, /src\/benchmark\/benchmark-page\.js\?v=1\.10\.0/);
  assert.match(benchmark, /aria-live="polite"/);
});

test('PWA icon files exist', async () => {
  await Promise.all([
    access(new URL('../icons/icon-192.png', import.meta.url)),
    access(new URL('../icons/icon-512.png', import.meta.url)),
    access(new URL('../icons/apple-touch-icon.png', import.meta.url))
  ]);
});
