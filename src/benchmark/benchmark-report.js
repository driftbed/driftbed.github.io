import { comparisonLabel, stabilityLabel } from './benchmark-statistics.js?v=1.8.2';
import { DRIFTBED_VERSION } from '../build-version.js?v=1.8.2';

const fixed = value => Number.isFinite(value) ? value.toFixed(value < 10 ? 2 : 1) : '—';

export function buildEnvironmentMetadata(capabilities, config) {
  return {
    browser: navigator.userAgent,
    logicalProcessors: navigator.hardwareConcurrency ?? null,
    deviceMemoryGiB: navigator.deviceMemory ?? null,
    crossOriginIsolated: Boolean(globalThis.crossOriginIsolated),
    webAssembly: typeof WebAssembly !== 'undefined',
    wasmAbiVersion: capabilities.wasmAbiVersion,
    numericContractVersion: capabilities.numericContractVersion,
    wasmCapabilitiesMask: capabilities.wasmCapabilitiesMask,
    driftbedVersion: DRIFTBED_VERSION,
    preset: config.preset,
    sampleRate: config.sampleRate,
    fixtureDurationSeconds: config.durationSeconds,
    warmups: config.warmups,
    measuredRuns: config.runs,
    benchmarkProtocolVersion: 1,
    timestamp: new Date().toISOString()
  };
}

export function formatReportText(report, environment) {
  const lines = [
    'Driftbed Engine Benchmark',
    `Build: ${environment.driftbedVersion} · Protocol: ${environment.benchmarkProtocolVersion}`,
    `Preset: ${environment.preset} · Fixture: ${environment.sampleRate} Hz · ${environment.fixtureDurationSeconds}s`,
    '',
    'Startup (this page/session)',
    `WebAssembly: ${fixed(report.startup.wasm)} ms`,
    `JavaScript: ${fixed(report.startup.javascript)} ms`,
    ''
  ];
  for (const row of report.rows) {
    const comparison = comparisonLabel(row.javascript, row.wasm);
    lines.push(row.title);
    lines.push(`WebAssembly: ${fixed(row.wasm.median)} ms · ${stabilityLabel(row.wasm.coefficientOfVariation)}`);
    lines.push(`JavaScript: ${fixed(row.javascript.median)} ms · ${stabilityLabel(row.javascript.coefficientOfVariation)}`);
    lines.push(`Result: ${comparison.text}`);
    lines.push('');
  }
  lines.push('Full Driftbed pipeline: unavailable until the Wasm full-pipeline capability is enabled.');
  lines.push('Benchmarks ran locally; no results or device information were uploaded.');
  return lines.join('\n');
}

export function serializeReport(report, environment) {
  return JSON.stringify({ ...report, environment }, null, 2);
}
