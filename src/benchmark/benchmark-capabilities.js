import { createProcessingEngine } from '../engine/engine.js?v=1.10.0';
import { FULL_PIPELINE_CAPABILITY, loadWasmCore } from '../engine/wasm-loader.js?v=1.7.0';

export const BENCHMARK_PROTOCOL_VERSION = 1;
export const WASM_FOUNDATION_CAPABILITY = 1;

export const BENCHMARK_DEFINITIONS = Object.freeze([
  { id: 'pcmAnalysis', tier: 'kernels', title: 'PCM analysis', description: 'Finite stereo RMS and peak analysis over the shared fixture.' },
  { id: 'sampleScaling', tier: 'kernels', title: 'PCM scaling', description: 'Scalar gain over one fixture channel.' },
  { id: 'environmentSynthesis', tier: 'dsp', title: 'Environment synthesis', description: 'Deterministic environmental bed generation.' },
  { id: 'sourceAnalysis', tier: 'source', title: 'Source-component analysis', description: 'Structural source analysis before factorization.' },
  { id: 'nmf', tier: 'source', title: 'NMF factorization', description: 'Latent spectral component factorization.' },
  { id: 'sourceNoiseRendering', tier: 'source', title: 'Source-spectrum rendering', description: 'Multi-component source-following noise rendering.' },
  { id: 'sourceDriftRendering', tier: 'source', title: 'Source-coupled phase drift', description: 'Bounded coherent phase-shadow rendering from the source.' },
  { id: 'completeAudioPipeline', tier: 'production', title: 'Complete Driftbed audio pipeline', description: 'The backend-neutral production audio workload.' }
]);

function hasExport(core, name) {
  const value = core?.exports?.[name];
  return typeof value === 'function' || value === true;
}

export function describeBenchmarkCapabilities({ wasmCore = null, wasmError = '' } = {}) {
  const fullPipeline = Boolean(wasmCore && (wasmCore.capabilities & FULL_PIPELINE_CAPABILITY));
  const capabilities = Object.freeze({
    pcmAnalysis: hasExport(wasmCore, 'driftbed_analyze_pcm_f32'),
    sampleScaling: hasExport(wasmCore, 'driftbed_scale_f32'),
    environmentSynthesis: fullPipeline,
    sourceAnalysis: fullPipeline,
    nmf: fullPipeline,
    sourceNoiseRendering: fullPipeline,
    sourceDriftRendering: fullPipeline,
    completeAudioPipeline: fullPipeline
  });
  return Object.freeze({
    wasmAvailable: Boolean(wasmCore),
    wasmAbiVersion: wasmCore?.abiVersion ?? null,
    numericContractVersion: wasmCore?.numericContractVersion ?? null,
    wasmCapabilitiesMask: wasmCore?.capabilities ?? 0,
    wasmError,
    capabilities
  });
}

export async function discoverBenchmarkCapabilities() {
  try {
    const wasmCore = await loadWasmCore();
    return describeBenchmarkCapabilities({ wasmCore });
  } catch (error) {
    return describeBenchmarkCapabilities({ wasmError: error?.message || String(error) });
  }
}

function ensureFinite(value, label) {
  if (!Number.isFinite(value)) throw new Error(`${label} returned a non-finite value.`);
}

function createWasmKernelAdapter(core) {
  const memory = core.exports.memory;
  if (!memory) throw new Error('Wasm benchmark core does not export linear memory.');
  let fixtureState = null;
  function prepareFixture(fixture) {
    if (fixtureState?.frames === fixture.frames) return fixtureState;
    const frames = fixture.frames;
    const leftOffset = 4096;
    const rightOffset = leftOffset + frames * 4;
    const outputOffset = rightOffset + frames * 4;
    const rmsOffset = outputOffset + frames * 4;
    const peakOffset = rmsOffset + 4;
    const requiredBytes = peakOffset + 4;
    const currentBytes = memory.buffer.byteLength;
    if (currentBytes < requiredBytes) memory.grow(Math.ceil((requiredBytes - currentBytes) / 65536));
    const view = new Float32Array(memory.buffer);
    view.set(fixture.left, leftOffset / 4);
    view.set(fixture.right, rightOffset / 4);
    fixtureState = { frames, leftOffset, rightOffset, outputOffset, rmsOffset, peakOffset, view: new Float32Array(memory.buffer) };
    return fixtureState;
  }
  return {
    analyzePcmFixture(fixture) {
      const state = prepareFixture(fixture);
      const status = core.exports.driftbed_analyze_pcm_f32(state.leftOffset, state.rightOffset, state.frames, 2, state.rmsOffset, state.peakOffset);
      if (status !== 0) throw new Error(`Wasm PCM analysis failed with status ${status}.`);
      const view = new Float32Array(memory.buffer);
      const result = { rms: view[state.rmsOffset / 4], peak: view[state.peakOffset / 4] };
      ensureFinite(result.rms, 'Wasm RMS');
      ensureFinite(result.peak, 'Wasm peak');
      return result;
    },
    scalePcmFixture(fixture, gain) {
      const state = prepareFixture(fixture);
      const status = core.exports.driftbed_scale_f32(state.leftOffset, state.outputOffset, state.frames, gain);
      if (status !== 0) throw new Error(`Wasm PCM scaling failed with status ${status}.`);
      return new Float32Array(memory.buffer, state.outputOffset, state.frames);
    }
  };
}

export async function createBenchmarkBackend(kind) {
  if (kind === 'javascript') {
    const engine = await createProcessingEngine({ preference: 'javascript' });
    return {
      backend: engine.backend,
      name: 'JavaScript',
      version: 'javascript-reference',
      capabilities: engine.capabilities,
      analyzePcmFixture: (fixture) => engine.analyzePcmFixture(fixture.left, fixture.right),
      scalePcmFixture: (fixture, gain) => engine.scalePcmFixture(fixture.left, gain)
    };
  }
  if (kind !== 'wasm') throw new Error(`Unknown benchmark backend ${kind}.`);
  const core = await loadWasmCore();
  const kernel = createWasmKernelAdapter(core);
  return {
    backend: 'wasm',
    name: 'WebAssembly',
    version: `wasm-abi-${core.abiVersion}`,
    capabilities: describeBenchmarkCapabilities({ wasmCore: core }).capabilities,
    abiVersion: core.abiVersion,
    numericContractVersion: core.numericContractVersion,
    capabilitiesMask: core.capabilities,
    ...kernel
  };
}
