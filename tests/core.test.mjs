import test from 'node:test';
import assert from 'node:assert/strict';
import { deriveSeed, Mulberry32 } from '../src/random.js';
import { exactWeightedCounts, permuteIndex } from '../src/distribution.js';
import { EnvironmentalNoiseSynth, buildSpectralField, SPECTRAL_AMPLITUDE_WEIGHTS } from '../src/synth.js';
import { analyzePcm, planNoiseGain, applyGainPcm } from '../src/loudness.js';

test('domain-separated seeds are stable and distinct', () => {
  assert.equal(deriveSeed('abc', 5, 'content'), deriveSeed('abc', 5, 'content'));
  assert.notEqual(deriveSeed('abc', 5, 'content'), deriveSeed('abc', 5, 'metadata'));
});

test('PRNG repeats exactly', () => {
  const a = new Mulberry32(123), b = new Mulberry32(123);
  for (let i=0;i<100;i++) assert.equal(a.nextUInt32(), b.nextUInt32());
});

test('largest-remainder counts are exact', () => {
  const counts = exactWeightedCounts([.5,.3,.2], 11);
  assert.deepEqual(counts, [6,3,2]);
  assert.equal(counts.reduce((a,b)=>a+b,0), 11);
});

test('cycle-walk Feistel permutation is bijective', () => {
  for (const total of [2,3,7,11,31,100,257]) {
    const values = new Set();
    for (let i=0;i<total;i++) values.add(permuteIndex(i,total,4567));
    assert.equal(values.size,total);
    for (const v of values) assert.ok(v>=0 && v<total);
  }
});

test('synth is deterministic and audible', () => {
  const cfg = {seed:'fixture',sampleRate:8000,durationSeconds:2,profile:'indoorLow',variation:.5};
  const a = new EnvironmentalNoiseSynth(cfg), b = new EnvironmentalNoiseSynth(cfg);
  const aa = a.render(16000), bb = b.render(16000);
  assert.deepEqual(Array.from(aa[0].slice(0,1000)), Array.from(bb[0].slice(0,1000)));
  const an = analyzePcm(aa,8000);
  assert.ok(an.rmsDb > -80 && an.rmsDb < -2);
  assert.ok(Number.isFinite(an.peakDb));
});

test('synth has no pathological single-sample jumps', () => {
  const s = new EnvironmentalNoiseSynth({seed:'smooth',sampleRate:16000,durationSeconds:3,profile:'natural',variation:.6});
  const [l] = s.render(48000);
  let maxDelta=0;
  for(let i=1;i<l.length;i++) maxDelta=Math.max(maxDelta,Math.abs(l[i]-l[i-1]));
  assert.ok(maxDelta < 0.8, `max delta ${maxDelta}`);
});


test('continuous relative level planning tracks requested dB offset', () => {
  const plan = planNoiseGain(
    { robustDb: -20, peakDb: -3 },
    { rmsDb: -12, peakDb: -2 },
    -37.5,
    -1
  );
  assert.equal(plan.desiredNoiseDb, -57.5);
  assert.equal(plan.noiseGainDb, -45.5);
  assert.equal(plan.relativeDb, -37.5);
});

test('isolated noise gain path scales PCM predictably', () => {
  const input = [new Float32Array([0.1, -0.1, 0.2]), new Float32Array([0.05, -0.05, 0.1])];
  const out = applyGainPcm(input, 20 * Math.log10(2));
  assert.ok(Math.abs(out[0][0] - 0.2) < 1e-6);
  assert.ok(Math.abs(out[0][1] + 0.2) < 1e-6);
  assert.ok(Math.abs(out[1][2] - 0.2) < 1e-6);
});

test('timeline uses exact weighted scene quotas with deterministic permutation', async () => {
  const { buildSceneTimeline } = await import('../src/synth.js');
  const { PROFILES } = await import('../src/profiles.js');
  const scenesA = buildSceneTimeline({ seed:'timeline-fixture', durationSeconds:48, profile:'indoorLow', variation:.85, scenePace:.8 });
  const scenesB = buildSceneTimeline({ seed:'timeline-fixture', durationSeconds:48, profile:'indoorLow', variation:.85, scenePace:.8 });
  assert.deepEqual(scenesA, scenesB);
  const actual = Array(PROFILES.indoorLow.sceneWeights.length).fill(0);
  for (const s of scenesA) actual[s.type]++;
  const expected = exactWeightedCounts(PROFILES.indoorLow.sceneWeights, scenesA.length);
  assert.deepEqual(actual, expected);
  assert.ok(new Set(scenesA.map(s => s.type)).size >= 5, 'expected several distinct scene regimes');
});

test('high-variety synthesis changes over time without pathological loudness swings', () => {
  const sampleRate = 8000, durationSeconds = 42;
  const s = new EnvironmentalNoiseSynth({
    seed:'variety-test', sampleRate, durationSeconds,
    profile:'indoorLow', variation:.85, scenePace:.8
  });
  const [l, r] = s.render(sampleRate * durationSeconds);
  const window = sampleRate * 3;
  const levels = [];
  for (let start = 0; start < l.length; start += window) {
    let ss = 0, n = 0;
    for (let i = start; i < Math.min(l.length, start + window); i++) {
      ss += (l[i] * l[i] + r[i] * r[i]) * 0.5;
      n++;
    }
    levels.push(20 * Math.log10(Math.max(1e-9, Math.sqrt(ss / n))));
  }
  const spread = Math.max(...levels) - Math.min(...levels);
  assert.ok(spread > 2.5, `expected meaningful time variation, got ${spread.toFixed(2)} dB`);
  assert.ok(spread < 9.0, `expected bounded long-term loudness, got ${spread.toFixed(2)} dB`);
});


test('spectral field uses exact weighted frequency bands with independent magnitude and phase', async () => {
  const { PROFILES } = await import('../src/profiles.js');
  const cfg = { seed:'spectral-fixture', profile:'indoorLow', spectralDetail:.74, variation:.82 };
  const a = buildSpectralField(cfg);
  const b = buildSpectralField(cfg);
  assert.deepEqual(a, b);
  assert.ok(a.length >= 20, 'expected a dense frequency-component field');

  const actualBands = Array(PROFILES.indoorLow.spectralBandWeights.length).fill(0);
  for (const c of a) actualBands[c.band]++;
  const expectedBands = exactWeightedCounts(PROFILES.indoorLow.spectralBandWeights, a.length);
  assert.deepEqual(actualBands, expectedBands);

  const uniqueAmplitudes = new Set(a.map(c => c.amplitude.toFixed(8)));
  const uniquePhases = new Set(a.map(c => c.phase.toFixed(8)));
  assert.ok(uniqueAmplitudes.size > a.length * 0.8, 'per-frequency magnitudes should be independently varied');
  assert.ok(uniquePhases.size > a.length * 0.9, 'phase angles should be independently varied');
  assert.ok(a.every(c => c.frequency > 20 && c.amplitude > 0));
});

test('each scene applies exact weighted per-frequency amplitude classes while preserving spectral-field power', () => {
  const synth = new EnvironmentalNoiseSynth({
    seed:'spectral-scene-fixture', sampleRate:8000, durationSeconds:36,
    profile:'indoorLow', variation:.86, scenePace:.75, spectralDetail:.78
  });
  const n = synth.spectralComponents.length;
  const expectedClasses = exactWeightedCounts(SPECTRAL_AMPLITUDE_WEIGHTS, n);
  const basePower = synth.spectralComponents.reduce((sum, c) => sum + c.amplitude * c.amplitude, 0);

  for (const scene of synth.scenePlan) {
    const actualClasses = Array(SPECTRAL_AMPLITUDE_WEIGHTS.length).fill(0);
    for (const cls of scene.spectralAmplitudeClasses) actualClasses[cls]++;
    assert.deepEqual(actualClasses, expectedClasses);
    const shapedPower = synth.spectralComponents.reduce((sum, c, i) => {
      const a = c.amplitude * scene.spectralGains[i];
      return sum + a * a;
    }, 0);
    assert.ok(Math.abs(shapedPower / basePower - 1) < 1e-10, 'scene spectral reshaping should be power-normalized');
    assert.ok(new Set(scene.spectralGains.map(g => g.toFixed(5))).size > n * 0.6, 'frequency gains should vary independently within a scene');
  }
});
