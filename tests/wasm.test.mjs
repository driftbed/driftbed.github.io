import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';

async function loadCore() {
  const bytes = await readFile(new URL('../wasm/driftbed_core.wasm', import.meta.url));
  return (await WebAssembly.instantiate(bytes, {})).instance;
}

test('committed Wasm core passes ABI, numeric, and deterministic self-tests', async () => {
  const instance = await loadCore();
  assert.equal(instance.exports.driftbed_abi_version(), 1);
  assert.equal(instance.exports.driftbed_numeric_contract_version(), 1);
  assert.equal(instance.exports.driftbed_capabilities(), 1);
  assert.equal(instance.exports.driftbed_self_test(), 0);
});

test('Wasm scalar ABI analyzes and scales finite PCM', async () => {
  const instance = await loadCore();
  const memory = new Float32Array(instance.exports.memory.buffer);
  const inputOffset = 4096 / 4;
  const outputOffset = 8192 / 4;
  memory.set([0.5, -0.5, 1, -1], inputOffset);
  const rmsOut = 12288;
  const peakOut = 12292;
  const status = instance.exports.driftbed_analyze_pcm_f32(4096, 0, 4, 1, rmsOut, peakOut);
  assert.equal(status, 0);
  assert.ok(Math.abs(memory[rmsOut / 4] - Math.sqrt(0.625)) < 1e-6);
  assert.equal(memory[peakOut / 4], 1);
  assert.equal(instance.exports.driftbed_scale_f32(4096, 8192, 4, 2), 0);
  assert.deepEqual(Array.from(memory.slice(outputOffset, outputOffset + 4)), [1, -1, 2, -2]);
});
