import { DRIFTBED_VERSION } from '../build-version.js?v=1.11.0';
import { BENCHMARK_DEFINITIONS, discoverBenchmarkCapabilities } from './benchmark-capabilities.js?v=1.11.0';
import { BENCHMARK_PRESETS, createBenchmarkConfig, runBenchmark } from './benchmark-runner.js?v=1.11.0';
import { comparisonLabel, stabilityLabel } from './benchmark-statistics.js?v=1.11.0';
import { buildEnvironmentMetadata, formatReportText, serializeReport } from './benchmark-report.js?v=1.11.0';

const $ = selector => document.querySelector(selector);
const els = {
  wasmState: $('#wasmState'), wasmDetail: $('#wasmDetail'), wasmMeta: $('#wasmMeta'),
  jsState: $('#jsState'), jsDetail: $('#jsDetail'),
  preset: $('#preset'), presetDescription: $('#presetDescription'), run: $('#runBenchmark'), stop: $('#stopBenchmark'),
  status: $('#benchmarkStatus'), progress: $('#benchmarkProgress'), progressLabel: $('#progressLabel'),
  summary: $('#summary'), summaryTitle: $('#summaryTitle'), summaryDetail: $('#summaryDetail'),
  summaryWasm: $('#summaryWasm'), summaryJs: $('#summaryJs'), summaryRounds: $('#summaryRounds'),
  results: $('#results'), copy: $('#copyResults'), copyJson: $('#copyJson'),
  environment: $('#environmentDetails'), advanced: $('#advancedSettings'), sampleRate: $('#sampleRate'), duration: $('#durationSeconds'), warmups: $('#warmups'), runs: $('#measuredRuns')
};

let capabilities = null;
let activeRun = null;
let latestReport = null;
let latestEnvironment = null;

function setStatus(text, error = false) {
  els.status.textContent = text;
  els.status.className = error ? 'status error' : 'status';
}

function stateText(state) {
  return state === 'partial' ? 'Partial' : state === 'ready' ? 'Ready' : state === 'error' ? 'Error' : 'Unavailable';
}

function renderCapabilities() {
  if (!capabilities) return;
  const wasmState = !capabilities.wasmAvailable ? (capabilities.wasmError ? 'error' : 'unavailable') : capabilities.capabilities.completeAudioPipeline ? 'ready' : 'partial';
  els.wasmState.textContent = stateText(wasmState);
  els.wasmState.dataset.state = wasmState;
  els.wasmDetail.textContent = wasmState === 'partial' ? 'Scalar foundation ready · full DSP pipeline pending' : wasmState === 'ready' ? 'Full engine ready' : capabilities.wasmError || 'WebAssembly is unavailable in this browser.';
  els.wasmMeta.textContent = capabilities.wasmAvailable ? `ABI ${capabilities.wasmAbiVersion} · numeric ${capabilities.numericContractVersion}` : 'No validated Wasm core';
  els.jsState.textContent = 'Ready';
  els.jsState.dataset.state = 'ready';
  els.jsDetail.textContent = 'Complete JavaScript reference backend';
  els.run.disabled = !capabilities.wasmAvailable;
  els.run.title = capabilities.wasmAvailable ? '' : 'WebAssembly is required for a comparison.';
  renderRows(null);
}

function presetConfig() {
  const preset = els.preset.value;
  const base = BENCHMARK_PRESETS[preset];
  return createBenchmarkConfig({
    preset,
    sampleRate: Number(els.sampleRate.value),
    durationSeconds: Number(els.duration.value),
    warmups: Number(els.warmups.value),
    runs: Number(els.runs.value),
    batchSize: base.batchSize
  });
}

function syncPresetFields() {
  const base = BENCHMARK_PRESETS[els.preset.value];
  els.presetDescription.textContent = base.description;
  els.duration.value = String(base.durationSeconds);
  els.warmups.value = String(base.warmups);
  els.runs.value = String(base.runs);
}

function formatMs(value) {
  return Number.isFinite(value) ? `${value.toFixed(value < 10 ? 2 : 1)} ms` : '—';
}

function renderTimingBar(label, summary, max) {
  const percent = Math.max(4, Math.min(100, (summary.median / max) * 100));
  return `<div class="timing-line"><span>${label}</span><div class="timing-track"><i style="width:${percent}%"></i></div><strong>${formatMs(summary.median)}</strong></div>`;
}

function renderRows(report) {
  if (!capabilities) return;
  const rows = [];
  if (report) {
    const maxStartup = Math.max(report.startup.javascript, report.startup.wasm);
    rows.push(`<article class="benchmark-row"><div><h3>Backend startup</h3><p>Initialization in this page session, including Wasm self-test. It is separate from warm DSP throughput.</p></div>${renderTimingBar('WebAssembly', { median: report.startup.wasm }, maxStartup)}${renderTimingBar('JavaScript', { median: report.startup.javascript }, maxStartup)}</article>`);
  }
  for (const definition of BENCHMARK_DEFINITIONS) {
    const available = capabilities.capabilities[definition.id];
    const result = report?.rows.find(row => row.id === definition.id);
    if (!available) {
      rows.push(`<article class="benchmark-row unavailable"><div><h3>${definition.title}</h3><p>${definition.description}</p></div><p class="unavailable-copy">Comparison unavailable<br><span>WebAssembly implementation is not enabled in this build.</span></p></article>`);
      continue;
    }
    if (!result) {
      rows.push(`<article class="benchmark-row"><div><h3>${definition.title}</h3><p>${definition.description}</p></div><p class="ready-copy">Ready to compare<br><span>Correctness is checked before timing.</span></p></article>`);
      continue;
    }
    const comparison = comparisonLabel(result.javascript, result.wasm);
    const max = Math.max(result.javascript.median, result.wasm.median);
    rows.push(`<article class="benchmark-row"><div><h3>${definition.title}</h3><p>${definition.description}</p></div>${renderTimingBar('WebAssembly', result.wasm, max)}${renderTimingBar('JavaScript', result.javascript, max)}<div class="result-caption" data-result="${comparison.kind}">${comparison.text} · ${stabilityLabel(Math.max(result.javascript.coefficientOfVariation, result.wasm.coefficientOfVariation))} · ${result.javascript.samples.length} measured rounds</div><details class="row-details"><summary>Timing details</summary><p>WebAssembly p90 ${formatMs(result.wasm.p90)} · IQR ${formatMs(result.wasm.iqr)} · CV ${(result.wasm.coefficientOfVariation * 100).toFixed(1)}%</p><p>JavaScript p90 ${formatMs(result.javascript.p90)} · IQR ${formatMs(result.javascript.iqr)} · CV ${(result.javascript.coefficientOfVariation * 100).toFixed(1)}%</p></details></article>`);
  }
  els.results.innerHTML = rows.join('');
}

function renderSummary(report) {
  const shared = report.rows;
  els.summary.hidden = false;
  if (capabilities.capabilities.completeAudioPipeline) {
    els.summaryTitle.textContent = 'Full-engine comparison available';
    els.summaryDetail.textContent = 'The complete production workload is eligible for a headline result.';
  } else {
    els.summaryTitle.textContent = 'Full-engine comparison unavailable';
    els.summaryDetail.textContent = `This build includes the validated Wasm foundation but not the complete DSP pipeline. ${shared.length} shared-kernel benchmarks are available below.`;
  }
  els.summaryWasm.textContent = formatMs(medianOf(shared.map(row => row.wasm.median)));
  els.summaryJs.textContent = formatMs(medianOf(shared.map(row => row.javascript.median)));
  els.summaryRounds.textContent = `${report.config.runs} measured rounds · ${report.config.preset}`;
}

function medianOf(values) {
  if (!values.length) return NaN;
  const sorted = [...values].sort((a, b) => a - b);
  const middle = Math.floor(sorted.length / 2);
  return sorted.length % 2 ? sorted[middle] : (sorted[middle - 1] + sorted[middle]) / 2;
}

function updateEnvironment(report) {
  latestEnvironment = buildEnvironmentMetadata(report.capabilities, report.config);
  els.environment.textContent = JSON.stringify({ ...latestEnvironment, fixtureSignature: report.fixtureSignature, fixtureFrames: report.fixtureFrames }, null, 2);
}

async function copyText(text) {
  await navigator.clipboard.writeText(text);
  setStatus('Benchmark report copied to the clipboard.');
}

els.preset.onchange = syncPresetFields;
els.run.onclick = async () => {
  if (activeRun || !capabilities?.wasmAvailable) return;
  const config = presetConfig();
  els.run.disabled = true; els.stop.hidden = false; els.copy.disabled = true; els.copyJson.disabled = true;
  els.progress.hidden = false; els.progress.value = 0; els.progressLabel.textContent = 'Preparing benchmark…';
  setStatus('Keep this tab visible while the engines are measured.');
  const runner = runBenchmark(config, {
    onProgress(message) {
      els.progress.max = message.total || 1;
      els.progress.value = message.completed || 0;
      els.progressLabel.textContent = message.detail || message.stage;
      setStatus('Benchmark running… Keep this tab visible.');
    }
  });
  activeRun = runner;
  try {
    latestReport = await runner.promise;
    renderSummary(latestReport);
    renderRows(latestReport);
    updateEnvironment(latestReport);
    els.copy.disabled = false; els.copyJson.disabled = false;
    setStatus('Benchmark complete.');
  } catch (error) {
    setStatus(error?.message || String(error), true);
  } finally {
    activeRun = null; els.run.disabled = !capabilities?.wasmAvailable; els.stop.hidden = true;
  }
};
els.stop.onclick = () => activeRun?.stop('Benchmark stopped. No partial result was used for the summary.');
els.copy.onclick = () => { if (latestReport && latestEnvironment) copyText(formatReportText(latestReport, latestEnvironment)).catch(error => setStatus(error.message, true)); };
els.copyJson.onclick = () => { if (latestReport && latestEnvironment) copyText(serializeReport(latestReport, latestEnvironment)).catch(error => setStatus(error.message, true)); };
document.addEventListener('visibilitychange', () => {
  if (document.hidden && activeRun) activeRun.stop('Benchmark paused because this tab is not active. Run it again while keeping this page visible.');
});

syncPresetFields();
els.status.textContent = `Driftbed ${DRIFTBED_VERSION} · checking engine readiness…`;
discoverBenchmarkCapabilities().then(result => { capabilities = result; renderCapabilities(); setStatus(result.wasmAvailable ? 'Ready to compare the shared Wasm and JavaScript kernels.' : 'WebAssembly is unavailable; JavaScript remains usable, but no comparison can be run.', !result.wasmAvailable); }).catch(error => setStatus(error.message, true));
