import test from 'node:test';
import assert from 'node:assert/strict';
import { encodeWav16 } from '../src/wav.js';

test('WAV encoder emits correct RIFF size', async () => {
  const a = new Float32Array(480), b = new Float32Array(480);
  const blob = encodeWav16([a,b],48000);
  assert.equal(blob.size,44+480*2*2);
  const buf = new Uint8Array(await blob.arrayBuffer());
  assert.equal(String.fromCharCode(...buf.slice(0,4)),'RIFF');
  assert.equal(String.fromCharCode(...buf.slice(8,12)),'WAVE');
});
