import test from 'node:test';
import assert from 'node:assert/strict';
import { SourceSpectrumNoiseModel, renderMultiComponentSourceSpectrumNoise, renderSourceDerivedLayers } from '../src/multi-component-spectrum-noise.js';
import {
  DEFAULT_SOURCE_FREQUENCY_VARIED_CONFIG,
  FrequencyDriftTimeline,
  SOURCE_FREQUENCY_VARIED_NOISE_VERSION,
  frequencyFromCents,
  renderFrequencyVariedNoise
} from '../src/source-frequency-varied-noise.js';

function makeFixture(sampleRate = 8000, seconds = 2, mono = false) {
  const length = sampleRate * seconds;
  const left = new Float32Array(length);
  const right = mono ? null : new Float32Array(length);
  for (let i = 0; i < length; i++) {
    const time = i / sampleRate;
    const sustained = 0.22 * Math.sin(2 * Math.PI * 220 * time) + 0.11 * Math.sin(2 * Math.PI * 880 * time);
    const high = time > 0.45 && time < 1.55 ? 0.08 * Math.sin(2 * Math.PI * 1500 * time) : 0;
    left[i] = sustained + high;
    if (right) right[i] = 0.72 * sustained + 0.93 * high;
  }
  return right ? [left, right] : [left];
}

function buildModel(channels, sampleRate = 8000) {
  return SourceSpectrumNoiseModel.analyze({
    channels,
    sampleRate,
    seed: 'frequency-varied-test',
    config: { analysisBands: 24, frameMs: 20, componentRank: 2, nmfIterations: 10, activationIterations: 4, templateTrainingFrames: 512 }
  });
}

function framePower(model, frame) {
  const values = new Float64Array(model.componentCount);
  const cellCount = model.bandCount * model.frameCount;
  for (let component = 0; component < model.componentCount; component++) {
    for (let band = 0; band < model.bandCount; band++) values[component] += model.power[component * cellCount + band * model.frameCount + frame] || 0;
  }
  return values;
}

test('frequency-varied version uses proportional cents mapping', () => {
  const ratio = 2 ** (50 / 1200);
  assert.ok(Math.abs(frequencyFromCents(250, 50) / 250 - ratio) < 1e-12);
  assert.ok(Math.abs(frequencyFromCents(1000, 50) / 1000 - ratio) < 1e-12);
  assert.ok(Math.abs(frequencyFromCents(4000, 50) / 4000 - ratio) < 1e-12);
  assert.equal(SOURCE_FREQUENCY_VARIED_NOISE_VERSION, 1);
});

test('trajectory is deterministic, smooth, class-bounded, and has near-zero weighted bias', () => {
  const model = buildModel(makeFixture());
  const config = { ...DEFAULT_SOURCE_FREQUENCY_VARIED_CONFIG };
  const first = new FrequencyDriftTimeline({ model, seed: 'trajectory-seed', config });
  const second = new FrequencyDriftTimeline({ model, seed: 'trajectory-seed', config });
  assert.deepEqual(Array.from(first.cents), Array.from(second.cents));
  const cellCount = model.bandCount * model.frameCount;
  for (let component = 0; component < model.componentCount; component++) {
    let weightedSum = 0;
    let weight = 0;
    for (let frame = 0; frame < model.frameCount; frame++) {
      let frameWeight = 0;
      for (let band = 0; band < model.bandCount; band++) frameWeight += model.power[component * cellCount + band * model.frameCount + frame] || 0;
      weightedSum += first.centsAt(component, frame) * frameWeight;
      weight += frameWeight;
      assert.ok(Math.abs(first.centsAt(component, frame)) <= 67 + 1e-6);
    }
    assert.ok(Math.abs(weightedSum / Math.max(1e-12, weight)) < 2, `component ${component} bias`);
  }
  assert.ok(first.diagnostics.rmsCents > 0);
});

test('power scatter conserves each frame and a forced positive drift moves the centroid upward', () => {
  const model = buildModel(makeFixture());
  const timeline = new FrequencyDriftTimeline({
    model,
    seed: 'direction-seed',
    config: { fixedComponentCents: 50, bassProtection: false, edgeProtection: false, nyquistProtection: false }
  });
  const frame = Math.floor(model.frameCount / 2);
  const buffers = timeline.prepareWarpedFrame(frame);
  const originalPower = framePower(model, frame);
  const warpedPower = new Float64Array(model.componentCount);
  let sourceCentroid = 0;
  let warpedCentroid = 0;
  for (let component = 0; component < model.componentCount; component++) {
    const original = originalPower[component];
    for (let band = 0; band < model.bandCount; band++) {
      const sourceIndex = component * model.bandCount * model.frameCount + band * model.frameCount + frame;
      const warpedIndex = component * model.bandCount + band;
      warpedPower[component] += buffers.power[warpedIndex];
      sourceCentroid += (model.power[sourceIndex] || 0) * model.bandCenters[band];
      warpedCentroid += buffers.power[warpedIndex] * model.bandCenters[band];
    }
    assert.ok(Math.abs(warpedPower[component] - original) < 1e-9);
  }
  assert.ok(warpedCentroid > sourceCentroid, `${warpedCentroid} <= ${sourceCentroid}`);
  assert.ok(timeline.diagnostics.maxPowerConservationError < 1e-12);
});

test('varied renderer is independent, deterministic, mono-preserving, finite, and length-preserving', () => {
  const stereo = makeFixture();
  const model = buildModel(stereo);
  const config = { ...DEFAULT_SOURCE_FREQUENCY_VARIED_CONFIG, fixedComponentCents: 0, bassProtection: false, edgeProtection: false, nyquistProtection: false };
  const first = renderFrequencyVariedNoise({ model, seed: 'renderer-seed', config });
  const second = renderFrequencyVariedNoise({ model, seed: 'renderer-seed', config });
  assert.deepEqual(Array.from(first.channels[0]), Array.from(second.channels[0]));
  assert.deepEqual(Array.from(first.channels[1]), Array.from(second.channels[1]));
  assert.equal(first.channels[0].length, stereo[0].length);
  assert.ok(first.channels.flatMap(channel => Array.from(channel)).every(Number.isFinite));
  const aligned = renderMultiComponentSourceSpectrumNoise({ channels: makeFixture(), sampleRate: 8000, seed: 'renderer-seed', config: { analysisBands: 24, frameMs: 20, componentRank: 2, nmfIterations: 10, activationIterations: 4, templateTrainingFrames: 512 } });
  assert.notDeepEqual(Array.from(first.channels[0].subarray(1000, 1200)), Array.from(aligned.channels[0].subarray(1000, 1200)));

  const mono = renderFrequencyVariedNoise({ model: buildModel(makeFixture(8000, 1, true)), seed: 'mono-seed', config });
  assert.deepEqual(Array.from(mono.channels[0]), Array.from(mono.channels[1]));
});

test('silence produces exact silence and derived layers combine varied noise without changing duration', () => {
  const silence = [new Float32Array(1600)];
  const silentResult = renderFrequencyVariedNoise({ model: buildModel(silence, 8000), seed: 'silence-seed' });
  assert.ok(silentResult.channels.flatMap(channel => Array.from(channel)).every(value => value === 0));
  const channels = makeFixture(8000, 1.25);
  const result = renderSourceDerivedLayers({
    channels,
    sampleRate: 8000,
    seed: 'derived-frequency-seed',
    config: { analysisBands: 24, frameMs: 20, componentRank: 2, nmfIterations: 8, activationIterations: 3, templateTrainingFrames: 512 },
    driftConfig: { targetPowerShare: 0.08 }
  });
  assert.equal(result.sourceFrequencyVariedNoiseVersion, SOURCE_FREQUENCY_VARIED_NOISE_VERSION);
  assert.equal(result.sourceStochasticNoise[0].length, channels[0].length);
  assert.ok(result.sourceFrequencyVariedNoiseDiagnostics.maxPowerConservationError < 1e-12);
  assert.ok(result.sourceStochasticNoise.flatMap(channel => Array.from(channel)).every(Number.isFinite));
});
