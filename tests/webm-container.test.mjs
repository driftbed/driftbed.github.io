import test from 'node:test';
import assert from 'node:assert/strict';
import { inspectWebm, patchExistingWebmDuration, readEbmlVint } from '../src/webm-container.js';

function concat(...parts) {
  const output = new Uint8Array(parts.reduce((total, part) => total + part.length, 0));
  let offset = 0;
  for (const part of parts) { output.set(part, offset); offset += part.length; }
  return output;
}

function sizeVint(size) {
  if (size >= 0x7f) throw new Error('fixture helper only supports one-byte sizes');
  return new Uint8Array([0x80 | size]);
}

function element(id, payload) {
  return concat(Uint8Array.from(id), sizeVint(payload.length), payload);
}

function unsigned(value) {
  const output = [];
  do { output.unshift(value & 0xff); value = Math.floor(value / 256); } while (value);
  return Uint8Array.from(output);
}

function float64(value) {
  const output = new Uint8Array(8);
  new DataView(output.buffer).setFloat64(0, value, false);
  return output;
}

function fixtureWebm(durationSeconds = 2.5) {
  const ebml = element([0x1a, 0x45, 0xdf, 0xa3], element([0x42, 0x86], new Uint8Array([0x81])));
  const info = element([0x15, 0x49, 0xa9, 0x66], concat(
    element([0x2a, 0xd7, 0xb1], unsigned(1000000)),
    element([0x44, 0x89], float64(durationSeconds * 1000))
  ));
  const tracks = element([0x16, 0x54, 0xae, 0x6b], new Uint8Array());
  const cluster = element([0x1f, 0x43, 0xb6, 0x75], element([0xe7], new Uint8Array([0])));
  return concat(ebml, element([0x18, 0x53, 0x80, 0x67], concat(info, tracks, cluster)));
}

test('EBML VINT reader handles size values and unknown sizes', () => {
  assert.deepEqual(readEbmlVint(new Uint8Array([0x84, 0x01, 0x02, 0x03]), 0), { length: 1, value: 4, unknown: false });
  assert.deepEqual(readEbmlVint(new Uint8Array([0xff]), 0), { length: 1, value: null, unknown: true });
});

test('WebM inspector reads TimestampScale, Duration, Tracks, and Clusters', () => {
  const inspection = inspectWebm(fixtureWebm());
  assert.equal(inspection.container, 'webm');
  assert.equal(inspection.timestampScale, 1000000);
  assert.equal(inspection.durationTicks, 2500);
  assert.equal(inspection.durationSeconds, 2.5);
  assert.equal(inspection.hasTracks, true);
  assert.equal(inspection.clusterCount, 1);
  assert.equal(inspection.clusterTimecodes[0], 0);
  assert.equal(inspection.durationElement.byteLength, 8);
});

test('WebM duration repair only changes the existing Duration payload', () => {
  const original = fixtureWebm();
  const repaired = patchExistingWebmDuration(original, 3.125);
  assert.equal(repaired.status, 'repaired');
  assert.equal(repaired.inspection.durationSeconds, 3.125);
  const start = repaired.inspection.durationElement.dataStart;
  assert.deepEqual(repaired.bytes.slice(0, start), original.slice(0, start));
  assert.deepEqual(repaired.bytes.slice(start + 8), original.slice(start + 8));
});
