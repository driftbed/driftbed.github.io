export function median(values) {
  if (!values.length) return NaN;
  const sorted = [...values].sort((a, b) => a - b);
  const middle = Math.floor(sorted.length / 2);
  return sorted.length % 2 ? sorted[middle] : (sorted[middle - 1] + sorted[middle]) / 2;
}

export function percentile(values, probability) {
  if (!values.length) return NaN;
  const sorted = [...values].sort((a, b) => a - b);
  const position = Math.max(0, Math.min(1, probability)) * (sorted.length - 1);
  const lower = Math.floor(position);
  const upper = Math.ceil(position);
  if (lower === upper) return sorted[lower];
  return sorted[lower] + (sorted[upper] - sorted[lower]) * (position - lower);
}

export function interquartileRange(values) {
  return percentile(values, 0.75) - percentile(values, 0.25);
}

export function coefficientOfVariation(values) {
  if (!values.length) return NaN;
  const mean = values.reduce((sum, value) => sum + value, 0) / values.length;
  if (!Number.isFinite(mean) || mean === 0) return NaN;
  const variance = values.reduce((sum, value) => sum + (value - mean) ** 2, 0) / values.length;
  return Math.sqrt(Math.max(0, variance)) / mean;
}

export function summarizeTimings(values) {
  return {
    samples: [...values],
    median: median(values),
    minimum: Math.min(...values),
    maximum: Math.max(...values),
    p90: percentile(values, 0.9),
    iqr: interquartileRange(values),
    coefficientOfVariation: coefficientOfVariation(values)
  };
}

export function speedup(jsMilliseconds, wasmMilliseconds) {
  return jsMilliseconds / wasmMilliseconds;
}

export function stabilityLabel(coefficient) {
  if (!Number.isFinite(coefficient)) return 'Unavailable';
  if (coefficient < 0.03) return 'Stable';
  if (coefficient <= 0.08) return 'Moderate variation';
  return 'High variation';
}

export function comparisonLabel(jsSummary, wasmSummary) {
  const ratio = speedup(jsSummary.median, wasmSummary.median);
  const variationEnvelope = Math.max(jsSummary.coefficientOfVariation, wasmSummary.coefficientOfVariation) * 1.5;
  const relativeDifference = Math.abs(ratio - 1);
  if (relativeDifference <= Math.max(0.03, variationEnvelope)) return { kind: 'tie', text: 'No meaningful difference detected', speedup: ratio };
  if (ratio > 1) return { kind: 'wasm', text: `${ratio.toFixed(2)}× faster with WebAssembly`, speedup: ratio };
  return { kind: 'javascript', text: `JavaScript is ${(1 / ratio).toFixed(2)}× faster`, speedup: ratio };
}
