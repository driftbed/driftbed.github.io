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
  assert.match(index, /manifest\.webmanifest/);
  assert.match(index, /apple-touch-icon/);
  assert.match(app, /serviceWorker\.register\('\.\/sw\.js'\)/);
  assert.match(worker, /driftbed-shell-v1\.4\.0/);
});

test('app imports every synthesis helper used by its controls', async () => {
  const app = await text('src/app.js');
  assert.match(app, /import \{[^}]*buildSpectralField[^}]*\} from '\.\/synth\.js'/);
});

test('PWA icon files exist', async () => {
  await Promise.all([
    access(new URL('../icons/icon-192.png', import.meta.url)),
    access(new URL('../icons/icon-512.png', import.meta.url)),
    access(new URL('../icons/apple-touch-icon.png', import.meta.url))
  ]);
});
