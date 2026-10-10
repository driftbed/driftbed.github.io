import test from 'node:test';
import assert from 'node:assert/strict';
import { renderSourceDerivedLayers, SourceSpectrumNoiseModel } from '../src/multi-component-spectrum-noise.js';
import { buildDriftControlTimeline, coherentGainFloor, renderSourceDrift, SOURCE_DRIFT_VERSION } from '../src/source-drift.js';

function makeFixture(sampleRate = 8000, seconds = 2, mono = false) {
  const frames = Math.round(sampleRate * seconds);
  const left = new Float32Array(frames);
  const right = mono ? null : new Float32Array(frames);
  for (let i = 0; i < frames; i++) {
    const time = i / sampleRate;
    const envelope = time < 0.35 ? time / 0.35 : time > 1.45 ? Math.max(0, 1 - (time - 1.45) / 0.55) : 1;
    const value = envelope * (0.24 * Math.sin(2 * Math.PI * 220 * time) + 0.12 * Math.sin(2 * Math.PI * 880 * time));
    left[i] = value;
    if (right) right[i] = 0.82 * value + 0.04 * Math.sin(2 * Math.PI * 530 * time);
  }
  return right ? [left, right] : [left];
}

function buildModel(channels, sampleRate) {
  return SourceSpectrumNoiseModel.analyze({
    channels,
    sampleRate,
    seed: 'source-drift-test',
    config: { analysisBands: 12, componentRank: 2, nmfIterations: 8, activationIterations: 3, templateTrainingFrames: 512 }
  });
}

test('source drift is deterministic, bounded, and versioned', () => {
  const channels = makeFixture();
  const model = buildModel(channels, 8000);
  const first = renderSourceDrift({ channels, sampleRate: 8000, model, seed: 'source-drift-test' });
  const second = renderSourceDrift({ channels: makeFixture(), sampleRate: 8000, model: buildModel(makeFixture(), 8000), seed: 'source-drift-test' });
  assert.equal(SOURCE_DRIFT_VERSION, 1);
  assert.deepEqual(Array.from(first.channels[0]), Array.from(second.channels[0]));
  assert.deepEqual(Array.from(first.channels[1]), Array.from(second.channels[1]));
  assert.ok(first.diagnostics.maxVoiceGainSum <= 0.10 + 1e-12);
  assert.ok(first.diagnostics.maxVoiceGainSum <= 0.18 + 1e-12);
  assert.ok(first.diagnostics.coherentGainFloor >= 0.90 - 1e-12);
  assert.ok(first.diagnostics.driftRms > 0);
  assert.ok(first.channels.flatMap(channel => Array.from(channel)).every(Number.isFinite));
});

test('mono source drift remains exactly mono', () => {
  const channels = makeFixture(8000, 1.5, true);
  const result = renderSourceDrift({ channels, sampleRate: 8000, model: buildModel(channels, 8000), seed: 'mono-drift' });
  assert.deepEqual(Array.from(result.channels[0]), Array.from(result.channels[1]));
});

test('drift controls reuse source component structure', () => {
  const channels = makeFixture();
  const model = buildModel(channels, 8000);
  const controls = buildDriftControlTimeline(model);
  assert.equal(controls.frameCount, model.frameCount);
  assert.equal(controls.hopSamples, model.hopSamples);
  assert.ok(Array.from(controls.activity).every(value => value >= 0 && value <= 1));
  assert.ok(Array.from(controls.transientShare).every(value => value >= 0 && value <= 1));
  assert.ok(Array.from(controls.diffuseShare).every(value => value >= 0 && value <= 1));
  assert.ok(Array.from(controls.stereoCorrelation).every(value => value >= -1 && value <= 1));
});

test('worst-case coherent opposition still has a positive dry floor', () => {
  for (const budget of [0.06, 0.08, 0.10, 0.18]) {
    const floor = coherentGainFloor(budget);
    assert.ok(floor >= 1 - budget - 1e-12);
    assert.ok(floor > 0);
  }
});

test('source drift transitions remain finite and do not create large discontinuities', () => {
  const channels = makeFixture(8000, 4);
  const result = renderSourceDrift({ channels, sampleRate: 8000, model: buildModel(channels, 8000), seed: 'transition-drift' });
  let maximumDelta = 0;
  for (let i = 1; i < result.channels[0].length; i++) maximumDelta = Math.max(maximumDelta, Math.abs(result.channels[0][i] - result.channels[0][i - 1]));
  assert.ok(maximumDelta < 0.15, `unexpected drift discontinuity ${maximumDelta}`);
});

test('source-derived renderer returns both layers from one versioned model', () => {
  const channels = makeFixture(8000, 1.25);
  const result = renderSourceDerivedLayers({
    channels,
    sampleRate: 8000,
    seed: 'source-derived-test',
    config: { analysisBands: 12, componentRank: 2, nmfIterations: 8, activationIterations: 3, templateTrainingFrames: 512 },
    driftConfig: { targetPowerShare: 0.08 }
  });
  assert.equal(result.sourceDriftVersion, SOURCE_DRIFT_VERSION);
  assert.equal(result.model.sampleRate, 8000);
  assert.equal(result.sourceSpectrumNoise[0].length, channels[0].length);
  assert.equal(result.sourceDrift[0].length, channels[0].length);
  assert.ok(result.driftDiagnostics.maxVoiceGainSum <= 0.10 + 1e-12);
});
