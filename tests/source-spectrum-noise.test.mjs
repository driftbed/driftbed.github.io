import test from 'node:test';
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { SourceSpectrumNoiseFollower } from '../src/source-spectrum-noise.js';

function sineSource(sampleRate, frames, frequency, amplitude = 0.4, phase = 0) {
  const out = new Float32Array(frames);
  for (let i = 0; i < frames; i++) out[i] = amplitude * Math.sin(2 * Math.PI * frequency * i / sampleRate + phase);
  return out;
}

function dftAmplitude(samples, sampleRate, frequency, start = 0, end = samples.length) {
  let cosine = 0;
  let sine = 0;
  for (let i = start; i < end; i++) {
    const angle = 2 * Math.PI * frequency * i / sampleRate;
    cosine += samples[i] * Math.cos(angle);
    sine += samples[i] * Math.sin(angle);
  }
  return Math.sqrt(cosine * cosine + sine * sine) / Math.max(1, end - start);
}

function interleavedHash(left, right) {
  const bytes = new Uint8Array(left.length * 8);
  const view = new DataView(bytes.buffer);
  for (let i = 0; i < left.length; i++) {
    view.setFloat32(i * 8, left[i], true);
    view.setFloat32(i * 8 + 4, right[i], true);
  }
  return createHash('sha256').update(bytes).digest('hex');
}

test('source-spectrum follower is deterministic and chunk-invariant', () => {
  const sampleRate = 8000;
  const frames = 4096;
  const source = sineSource(sampleRate, frames, 180, 0.32);
  const leftA = new Float32Array(frames), rightA = new Float32Array(frames);
  const leftB = new Float32Array(frames), rightB = new Float32Array(frames);
  const full = new SourceSpectrumNoiseFollower({ sampleRate, seed: 'chunk-fixture', bandCount: 12 });
  const chunked = new SourceSpectrumNoiseFollower({ sampleRate, seed: 'chunk-fixture', bandCount: 12 });
  full.processBlock(source, null, leftA, rightA, frames);
  chunked.processBlock(source.subarray(0, 1024), null, leftB.subarray(0, 1024), rightB.subarray(0, 1024), 1024);
  chunked.processBlock(source.subarray(1024, 3072), null, leftB.subarray(1024, 3072), rightB.subarray(1024, 3072), 2048);
  chunked.processBlock(source.subarray(3072), null, leftB.subarray(3072), rightB.subarray(3072), 1024);
  assert.deepEqual(leftB, leftA);
  assert.deepEqual(rightB, rightA);
  assert.deepEqual(leftA, rightA, 'mono input should remain mono');
});

test('source-spectrum follower preserves broad spectral tilt', () => {
  const sampleRate = 16000;
  const frames = sampleRate * 3;
  const lowSource = sineSource(sampleRate, frames, 180);
  const highSource = sineSource(sampleRate, frames, 2800);
  const lowOutput = new Float32Array(frames), highOutput = new Float32Array(frames);
  const scratch = new Float32Array(frames);
  new SourceSpectrumNoiseFollower({ sampleRate, seed: 'tilt-fixture' }).processBlock(lowSource, null, lowOutput, scratch, frames);
  new SourceSpectrumNoiseFollower({ sampleRate, seed: 'tilt-fixture' }).processBlock(highSource, null, highOutput, scratch, frames);
  const start = sampleRate;
  const lowBand = dftAmplitude(lowOutput, sampleRate, 180, start, frames);
  const lowHighBand = dftAmplitude(lowOutput, sampleRate, 2800, start, frames);
  const highBand = dftAmplitude(highOutput, sampleRate, 2800, start, frames);
  const highLowBand = dftAmplitude(highOutput, sampleRate, 180, start, frames);
  assert.ok(lowBand > lowHighBand * 2.5, `low tilt ratio ${lowBand / lowHighBand}`);
  assert.ok(highBand > highLowBand * 2.5, `high tilt ratio ${highBand / highLowBand}`);
});

test('source-spectrum follower preserves correlated stereo space', () => {
  const sampleRate = 16000;
  const frames = sampleRate * 3;
  const leftSource = sineSource(sampleRate, frames, 300, 0.35);
  const rightSource = sineSource(sampleRate, frames, 300, 0.35);
  const left = new Float32Array(frames), right = new Float32Array(frames);
  new SourceSpectrumNoiseFollower({ sampleRate, seed: 'stereo-fixture', bandCount: 16 })
    .processBlock(leftSource, rightSource, left, right, frames);
  let leftPower = 0;
  let rightPower = 0;
  let crossPower = 0;
  for (let i = sampleRate; i < frames; i++) {
    leftPower += left[i] * left[i];
    rightPower += right[i] * right[i];
    crossPower += left[i] * right[i];
  }
  const correlation = crossPower / Math.sqrt(leftPower * rightPower);
  assert.ok(correlation > 0.9, `correlated source should remain correlated, got ${correlation}`);
});

test('source-spectrum follower decays through silence without invalid samples', () => {
  const sampleRate = 8000;
  const activeFrames = 2000;
  const silentFrames = 8000;
  const source = new Float32Array(activeFrames + silentFrames);
  const active = sineSource(sampleRate, activeFrames, 260, 0.5);
  source.set(active);
  const left = new Float32Array(source.length), right = new Float32Array(source.length);
  new SourceSpectrumNoiseFollower({ sampleRate, seed: 'silence-fixture' }).processBlock(source, null, left, right, source.length);
  let activeSq = 0;
  let tailSq = 0;
  for (let i = 0; i < activeFrames; i++) activeSq += left[i] * left[i];
  for (let i = activeFrames + 4000; i < source.length; i++) tailSq += left[i] * left[i];
  assert.ok(left.every(Number.isFinite));
  assert.ok(Math.sqrt(tailSq / 4000) < Math.sqrt(activeSq / activeFrames) * 0.15, 'silence tail should decay');
  assert.ok(Math.abs(right[right.length - 1] - left[left.length - 1]) < 1e-12);
});

test('source-spectrum follower keeps a stable golden fixture', () => {
  const sampleRate = 8000;
  const frames = 4096;
  const leftSource = new Float32Array(frames);
  const rightSource = new Float32Array(frames);
  for (let i = 0; i < frames; i++) {
    leftSource[i] = 0.27 * Math.sin(2 * Math.PI * 180 * i / sampleRate) + 0.11 * Math.sin(2 * Math.PI * 1200 * i / sampleRate);
    rightSource[i] = 0.21 * Math.sin(2 * Math.PI * 180 * i / sampleRate + 0.23) + 0.08 * Math.sin(2 * Math.PI * 2200 * i / sampleRate + 0.4);
  }
  const left = new Float32Array(frames), right = new Float32Array(frames);
  new SourceSpectrumNoiseFollower({ sampleRate, seed: 'source-spectrum-golden', bandCount: 12 })
    .processBlock(leftSource, rightSource, left, right, frames);
  assert.equal(interleavedHash(left, right), '75517ef7039652e74d76aeb9de62ba56e98508d397ac87b389a62562be0539db');
});
