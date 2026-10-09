import test from 'node:test';
import assert from 'node:assert/strict';
import { analyzeSourceSpectrumTimeline } from '../src/source-component-analysis.js';
import { factorizeNmf, klDivergence } from '../src/nonnegative-factorization.js';
import { SourceSpectrumNoiseModel, renderMultiComponentSourceSpectrumNoise } from '../src/multi-component-spectrum-noise.js';

function makeMixedFixture(sampleRate = 8000, seconds = 2) {
  const length = sampleRate * seconds;
  const left = new Float32Array(length);
  const right = new Float32Array(length);
  for (let i = 0; i < length; i++) {
    const time = i / sampleRate;
    const low = time < 0.8 || time > 1.2
      ? 0.35 * Math.sin(2 * Math.PI * 180 * time) + 0.2 * Math.sin(2 * Math.PI * 360 * time)
      : 0;
    const high = 0.14 * Math.sin(2 * Math.PI * 1200 * time) + 0.09 * Math.sin(2 * Math.PI * 2400 * time);
    left[i] = low + high;
    right[i] = 0.7 * low + 0.95 * high;
  }
  return [left, right];
}

const config = {
  analysisBands: 24,
  frameMs: 20,
  componentRank: 2,
  nmfIterations: 20,
  activationIterations: 6,
  templateTrainingFrames: 4096
};

test('component analysis emits normalized structural masks and preserves source sample count', () => {
  const channels = makeMixedFixture();
  const timeline = analyzeSourceSpectrumTimeline(channels, 8000, config);
  assert.equal(timeline.sampleCount, channels[0].length);
  assert.equal(timeline.frameCount, 100);
  let maxMaskError = 0;
  for (let index = 0; index < timeline.framePower.length; index++) {
    const sum = timeline.sustainedMask[index] + timeline.transientMask[index] + timeline.diffuseMask[index];
    maxMaskError = Math.max(maxMaskError, Math.abs(sum - (timeline.framePower[index] > 1e-12 ? 1 : 0)));
  }
  assert.ok(maxMaskError < 1e-6, `mask normalization error ${maxMaskError}`);
});

test('KL-NMF is deterministic and improves its reconstruction objective', () => {
  const power = new Float32Array([
    4, 4, 1, 1, 3, 3,
    1, 1, 4, 4, 2, 2,
    0.5, 0.5, 0.5, 0.5, 0.5, 0.5
  ]);
  const first = factorizeNmf(power, 3, 6, { rank: 2, iterations: 20, activationIterations: 4 });
  const second = factorizeNmf(power, 3, 6, { rank: 2, iterations: 20, activationIterations: 4 });
  assert.deepEqual(Array.from(first.templates), Array.from(second.templates));
  assert.deepEqual(Array.from(first.activations), Array.from(second.activations));
  assert.ok(first.costs.at(-1) <= first.costs[0], `${first.costs[0]} -> ${first.costs.at(-1)}`);
  assert.ok(Number.isFinite(klDivergence(power, first.templates, first.activations, 3, first.componentCount, 6)));
});

test('latent component powers exactly partition measured source power', () => {
  const channels = makeMixedFixture();
  const timeline = analyzeSourceSpectrumTimeline(channels, 8000, config);
  const model = SourceSpectrumNoiseModel.analyze({ channels, sampleRate: 8000, seed: 'v2-test', config });
  assert.deepEqual(model.componentKind, ['sustained', 'sustained', 'transient', 'diffuse']);
  assert.ok(model.componentCentroid[1] - model.componentCentroid[0] > 150, model.componentCentroid);
  let maxPowerError = 0;
  const cellCount = model.bandCount * model.frameCount;
  for (let index = 0; index < cellCount; index++) {
    let sum = 0;
    for (let component = 0; component < model.componentCount; component++) sum += model.power[component * cellCount + index];
    maxPowerError = Math.max(maxPowerError, Math.abs(sum - timeline.framePower[index]));
  }
  assert.ok(maxPowerError < 5e-6, `power partition error ${maxPowerError}`);
});

test('multi-component renderer is deterministic, finite, stereo-aware, and length-preserving', () => {
  const channels = makeMixedFixture();
  const first = renderMultiComponentSourceSpectrumNoise({ channels, sampleRate: 8000, seed: 'v2-render', config });
  const second = renderMultiComponentSourceSpectrumNoise({ channels: makeMixedFixture(), sampleRate: 8000, seed: 'v2-render', config });
  assert.equal(first.channels[0].length, channels[0].length);
  assert.equal(first.channels[1].length, channels[0].length);
  assert.deepEqual(Array.from(first.channels[0]), Array.from(second.channels[0]));
  assert.deepEqual(Array.from(first.channels[1]), Array.from(second.channels[1]));
  let finite = true;
  for (const output of first.channels) for (const sample of output) finite &&= Number.isFinite(sample);
  assert.ok(finite);
  assert.notDeepEqual(Array.from(first.channels[0].subarray(1000, 1200)), Array.from(first.channels[1].subarray(1000, 1200)));
});
