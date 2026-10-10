import test from 'node:test';
import assert from 'node:assert/strict';
import { createPcmFixture, fixtureSignature } from '../src/benchmark/benchmark-fixtures.js';
import { comparisonLabel, coefficientOfVariation, interquartileRange, median, percentile, stabilityLabel } from '../src/benchmark/benchmark-statistics.js';
import { BENCHMARK_DEFINITIONS, describeBenchmarkCapabilities } from '../src/benchmark/benchmark-capabilities.js';
import { BENCHMARK_PRESETS, createBenchmarkConfig } from '../src/benchmark/benchmark-runner.js';

test('benchmark fixture is deterministic and stereo-aware', () => {
  const a = createPcmFixture({ sampleRate: 8000, durationSeconds: 1.25 });
  const b = createPcmFixture({ sampleRate: 8000, durationSeconds: 1.25 });
  assert.deepEqual(Array.from(a.left), Array.from(b.left));
  assert.deepEqual(Array.from(a.right), Array.from(b.right));
  assert.equal(fixtureSignature(a), fixtureSignature(b));
  assert.notDeepEqual(Array.from(a.left), Array.from(a.right));
  assert.equal(a.frames, 10000);
});

test('benchmark statistics retain samples and classify dispersion', () => {
  const values = [10, 12, 11, 13, 14];
  assert.equal(median(values), 12);
  assert.equal(percentile(values, 0.9), 13.6);
  assert.equal(interquartileRange(values), 2);
  assert.ok(coefficientOfVariation(values) > 0);
  assert.equal(stabilityLabel(0.02), 'Stable');
  assert.equal(stabilityLabel(0.05), 'Moderate variation');
  assert.equal(stabilityLabel(0.12), 'High variation');
});

test('benchmark comparison labels meaningful and tied results', () => {
  const stable = { median: 100, coefficientOfVariation: 0.01 };
  assert.equal(comparisonLabel(stable, { median: 50, coefficientOfVariation: 0.01 }).kind, 'wasm');
  assert.equal(comparisonLabel(stable, { median: 99, coefficientOfVariation: 0.01 }).kind, 'tie');
});

test('capability descriptor gates full-pipeline rows by exports and mask', () => {
  const descriptor = describeBenchmarkCapabilities({ wasmCore: { abiVersion: 1, numericContractVersion: 1, capabilities: 1, exports: { driftbed_analyze_pcm_f32() {}, driftbed_scale_f32() {} } } });
  assert.equal(descriptor.wasmAvailable, true);
  assert.equal(descriptor.capabilities.pcmAnalysis, true);
  assert.equal(descriptor.capabilities.sampleScaling, true);
  assert.equal(descriptor.capabilities.completeAudioPipeline, false);
  assert.ok(BENCHMARK_DEFINITIONS.some(definition => definition.id === 'completeAudioPipeline'));
});

test('benchmark preset configuration has bounded, reproducible defaults', () => {
  const config = createBenchmarkConfig({ preset: 'standard' });
  assert.equal(config.preset, 'standard');
  assert.equal(config.sampleRate, 48000);
  assert.equal(config.warmups, BENCHMARK_PRESETS.standard.warmups);
  assert.equal(config.runs, BENCHMARK_PRESETS.standard.runs);
  assert.ok(Object.isFrozen(config));
});
