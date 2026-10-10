export const BENCHMARK_PRESETS = Object.freeze({
  quick: Object.freeze({ label: 'Quick', description: 'A short check for phones and fast comparisons.', warmups: 2, runs: 5, durationSeconds: 1, batchSize: 4 }),
  standard: Object.freeze({ label: 'Standard', description: 'A balanced comparison for everyday use.', warmups: 3, runs: 9, durationSeconds: 2, batchSize: 8 }),
  stress: Object.freeze({ label: 'Stress', description: 'A longer sustained-throughput comparison.', warmups: 3, runs: 15, durationSeconds: 6, batchSize: 16 })
});

export function createBenchmarkConfig({ preset = 'standard', sampleRate = 48000, warmups, runs, durationSeconds, batchSize } = {}) {
  const base = BENCHMARK_PRESETS[preset] || BENCHMARK_PRESETS.standard;
  return Object.freeze({
    preset: BENCHMARK_PRESETS[preset] ? preset : 'standard',
    sampleRate: Number(sampleRate) || 48000,
    warmups: Math.max(0, Math.floor(Number(warmups ?? base.warmups))),
    runs: Math.max(1, Math.floor(Number(runs ?? base.runs))),
    durationSeconds: Math.max(0.25, Number(durationSeconds ?? base.durationSeconds)),
    batchSize: Math.max(1, Math.floor(Number(batchSize ?? base.batchSize)))
  });
}

export function runBenchmark(config, { onProgress = () => {}, onComplete = () => {}, onError = () => {} } = {}) {
  const worker = new Worker(new URL('./benchmark-worker.js?v=1.9.0', import.meta.url), { type: 'module' });
  let settled = false;
  let rejectPromise;
  const promise = new Promise((resolve, reject) => {
    rejectPromise = reject;
    worker.onmessage = event => {
      const message = event.data || {};
      if (message.type === 'progress') onProgress(message);
      if (message.type === 'result') {
        settled = true;
        worker.terminate();
        onComplete(message.result);
        resolve(message.result);
      }
      if (message.type === 'error') {
        settled = true;
        worker.terminate();
        const error = new Error(message.message || 'Benchmark failed.');
        onError(error);
        reject(error);
      }
    };
    worker.onerror = event => {
      if (settled) return;
      settled = true;
      worker.terminate();
      const error = new Error(event.message || 'Benchmark worker failed.');
      onError(error);
      reject(error);
    };
    worker.postMessage({ type: 'start', config });
  });
  return {
    promise,
    stop(message = 'Benchmark stopped.') {
      if (settled) return;
      settled = true;
      worker.terminate();
      const error = new Error(message);
      onError(error);
      rejectPromise(error);
    }
  };
}
