import { createBenchmarkBackend, describeBenchmarkCapabilities, BENCHMARK_DEFINITIONS, BENCHMARK_PROTOCOL_VERSION } from './benchmark-capabilities.js?v=1.11.0';
import { createPcmFixture, fixtureSignature, BENCHMARK_FIXTURE_VERSION, BENCHMARK_FIXTURE_SEED } from './benchmark-fixtures.js?v=1.11.0';
import { summarizeTimings } from './benchmark-statistics.js?v=1.11.0';

function sendProgress(stage, completed, total, detail) {
  self.postMessage({ type: 'progress', stage, completed, total, detail });
}

function assertClose(actual, expected, tolerance, label) {
  if (!Number.isFinite(actual) || Math.abs(actual - expected) > tolerance) {
    throw new Error(`${label} correctness check failed.`);
  }
}

function outputChecksum(output) {
  const points = [0, Math.floor(output.length / 2), output.length - 1];
  return points.reduce((sum, index) => sum + output[index], 0);
}

function runOperation(backend, id, fixture, batchSize) {
  if (id === 'pcmAnalysis') return backend.analyzePcmFixture(fixture);
  if (id === 'sampleScaling') return backend.scalePcmFixture(fixture, 0.73);
  throw new Error(`No runnable benchmark operation exists for ${id}.`);
}

async function run(config) {
  const fixture = createPcmFixture({ sampleRate: config.sampleRate, durationSeconds: config.durationSeconds, seed: BENCHMARK_FIXTURE_SEED });
  const startup = {};
  sendProgress('initializing', 0, 1, 'Initializing JavaScript reference backend…');
  let started = performance.now();
  const javascript = await createBenchmarkBackend('javascript');
  startup.javascript = performance.now() - started;
  if (javascript.backend !== 'javascript') throw new Error('JavaScript benchmark resolved to the wrong backend.');
  sendProgress('initializing', 1, 2, 'Initializing WebAssembly core…');
  started = performance.now();
  const wasm = await createBenchmarkBackend('wasm');
  startup.wasm = performance.now() - started;
  if (wasm.backend !== 'wasm') throw new Error('WebAssembly benchmark resolved to the wrong backend.');

  const wasmCapabilities = {
    wasmAvailable: true,
    wasmAbiVersion: wasm.abiVersion,
    numericContractVersion: wasm.numericContractVersion,
    wasmCapabilitiesMask: wasm.capabilitiesMask,
    wasmError: '',
    capabilities: wasm.capabilities
  };
  const expected = javascript.analyzePcmFixture(fixture);
  const wasmProbe = wasm.analyzePcmFixture(fixture);
  assertClose(wasmProbe.rms, expected.rms, 1e-6, 'PCM analysis RMS');
  assertClose(wasmProbe.peak, expected.peak, 1e-6, 'PCM analysis peak');
  const jsScaledProbe = javascript.scalePcmFixture(fixture, 0.73);
  const wasmScaledProbe = wasm.scalePcmFixture(fixture, 0.73);
  assertClose(outputChecksum(wasmScaledProbe), outputChecksum(jsScaledProbe), 1e-5, 'PCM scaling');
  sendProgress('checking', 2, 2, 'Correctness checks passed.');

  const runnable = BENCHMARK_DEFINITIONS.filter(definition => wasmCapabilities.capabilities[definition.id]);
  const rows = [];
  const totalSamples = runnable.length * 2 * (config.warmups + config.runs);
  let completed = 2;
  const total = totalSamples + 2;
  for (const definition of runnable) {
    const timings = { javascript: [], wasm: [] };
    for (let round = 0; round < config.warmups + config.runs; round++) {
      const order = round % 2 === 0 ? [['javascript', javascript], ['wasm', wasm]] : [['wasm', wasm], ['javascript', javascript]];
      for (const [name, backend] of order) {
        const measured = round >= config.warmups;
        const before = performance.now();
        let sink = 0;
        for (let batch = 0; batch < config.batchSize; batch++) {
          const output = runOperation(backend, definition.id, fixture, config.batchSize);
          sink += definition.id === 'pcmAnalysis' ? output.rms + output.peak : outputChecksum(output);
        }
        const elapsed = (performance.now() - before) / config.batchSize;
        if (!Number.isFinite(sink)) throw new Error(`${definition.title} produced a non-finite result.`);
        if (measured) timings[name].push(elapsed);
        completed++;
        sendProgress('measuring', completed, total, `${definition.title} · ${name === 'wasm' ? 'WebAssembly' : 'JavaScript'} · ${Math.min(round + 1, config.warmups + config.runs)} of ${config.warmups + config.runs}`);
      }
    }
    rows.push({
      id: definition.id,
      title: definition.title,
      description: definition.description,
      javascript: summarizeTimings(timings.javascript),
      wasm: summarizeTimings(timings.wasm),
      batchSize: config.batchSize
    });
  }
  sendProgress('complete', total, total, 'Benchmark complete.');
  return {
    protocolVersion: BENCHMARK_PROTOCOL_VERSION,
    fixtureVersion: BENCHMARK_FIXTURE_VERSION,
    fixtureSeed: BENCHMARK_FIXTURE_SEED,
    fixtureSignature: fixtureSignature(fixture),
    fixtureFrames: fixture.frames,
    startup,
    rows,
    config,
    capabilities: wasmCapabilities
  };
}

self.onmessage = event => {
  if (event.data?.type !== 'start') return;
  run(event.data.config)
    .then(result => self.postMessage({ type: 'result', result }))
    .catch(error => self.postMessage({ type: 'error', message: error?.message || String(error) }));
};
