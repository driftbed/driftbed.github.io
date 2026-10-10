import test from 'node:test';
import assert from 'node:assert/strict';
import { createProcessingEngine, normalizeEnginePreference } from '../src/engine/engine.js';

test('engine preference normalization is closed over supported values', () => {
  assert.deepEqual(
    ['auto', 'wasm', 'javascript', '', 'unknown', null].map(normalizeEnginePreference),
    ['auto', 'wasm', 'javascript', 'auto', 'auto', 'auto']
  );
});

test('JavaScript backend exposes the shared engine contract', async () => {
  const engine = await createProcessingEngine({ preference: 'javascript' });
  assert.equal(engine.backend, 'javascript');
  assert.equal(engine.abiVersion, 1);
  assert.equal(engine.numericContractVersion, 1);
  assert.equal(engine.capabilities.fullPipeline, true);
  assert.equal(engine.capabilities.sourceDerivedLayers, true);
  assert.equal(engine.sourceDriftVersion, 1);
  assert.equal(typeof engine.createEnvironmentSynth, 'function');
  assert.equal(typeof engine.renderSourceSpectrumNoise, 'function');
  assert.equal(typeof engine.renderSourceDerivedLayers, 'function');
  assert.equal(typeof engine.planCompositeAddedSignal, 'function');
});

test('automatic selection falls back safely outside a browser', async () => {
  const engine = await createProcessingEngine({ preference: 'auto' });
  assert.equal(engine.backend, 'javascript');
  assert.match(engine.fallbackReason, /fetch|file|Wasm|WebAssembly/i);
});
