import { FULL_PIPELINE_CAPABILITY, loadWasmCore } from './wasm-loader.js?v=1.7.0';

export async function createWasmBackend(options = {}) {
  const core = await loadWasmCore(options.url);
  if ((core.capabilities & FULL_PIPELINE_CAPABILITY) === 0) {
    throw new Error('The Wasm core is installed but its full DSP pipeline is not enabled yet.');
  }
  throw new Error('The full Wasm DSP backend is not available in this build.');
}
