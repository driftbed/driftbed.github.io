import { Mulberry32 } from '../random.js';

export const BENCHMARK_FIXTURE_VERSION = 1;
export const BENCHMARK_FIXTURE_SEED = 'driftbed-engine-benchmark-fixture-v1';

export function createPcmFixture({ sampleRate = 48000, durationSeconds = 2, seed = BENCHMARK_FIXTURE_SEED } = {}) {
  const frames = Math.max(1, Math.round(sampleRate * durationSeconds));
  const left = new Float32Array(frames);
  const right = new Float32Array(frames);
  const random = new Mulberry32(seed);
  let lowPhase = 0;
  let midPhase = 0;
  for (let i = 0; i < frames; i++) {
    const t = i / sampleRate;
    const envelope = 0.72 + 0.18 * Math.sin(2 * Math.PI * 0.37 * t);
    const low = 0.22 * Math.sin(lowPhase);
    const mid = 0.11 * Math.sin(midPhase) * (0.65 + 0.35 * Math.sin(2 * Math.PI * 0.91 * t));
    const noise = (random.next() * 2 - 1) * 0.035;
    const impulse = i % Math.max(1, Math.round(sampleRate * 0.43)) < 4 ? 0.18 * (1 - (i % Math.max(1, Math.round(sampleRate * 0.43))) / 4) : 0;
    left[i] = envelope * (low + mid) + noise + impulse;
    right[i] = envelope * (0.92 * low - 0.78 * mid) + noise * 0.7 - impulse * 0.55;
    lowPhase += 2 * Math.PI * 72 / sampleRate;
    midPhase += 2 * Math.PI * 517 / sampleRate;
  }
  return Object.freeze({ left, right, frames, sampleRate, durationSeconds: frames / sampleRate, seed });
}

export function fixtureSignature(fixture) {
  let checksum = 2166136261;
  for (let i = 0; i < fixture.frames; i += Math.max(1, Math.floor(fixture.frames / 4096))) {
    checksum ^= Math.round(fixture.left[i] * 1e6) >>> 0;
    checksum = Math.imul(checksum, 16777619) >>> 0;
    checksum ^= Math.round(fixture.right[i] * 1e6) >>> 0;
    checksum = Math.imul(checksum, 16777619) >>> 0;
  }
  return checksum >>> 0;
}
