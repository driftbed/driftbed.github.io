import { deriveSeed, mix32 } from './random.js';

export function exactWeightedCounts(weights, total) {
  if (!Number.isInteger(total) || total < 0) throw new Error('total must be a non-negative integer');
  if (!Array.isArray(weights) || weights.length === 0) throw new Error('weights required');
  const safe = weights.map(w => Math.max(0, Number(w) || 0));
  const sum = safe.reduce((a, b) => a + b, 0);
  if (!(sum > 0)) throw new Error('at least one weight must be positive');

  const exact = safe.map(w => (w / sum) * total);
  const counts = exact.map(Math.floor);
  let remaining = total - counts.reduce((a, b) => a + b, 0);
  const order = exact
    .map((v, i) => ({ i, frac: v - Math.floor(v) }))
    .sort((a, b) => b.frac - a.frac || a.i - b.i);
  for (let i = 0; i < remaining; i++) counts[order[i].i]++;
  return counts;
}

function nextEvenBitWidth(total) {
  let bits = 1;
  while (2 ** bits < Math.max(2, total)) bits++;
  if (bits % 2) bits++;
  if (bits > 30) throw new Error('permutation domain too large');
  return bits;
}

function feistelPow2(x, bits, seed) {
  const half = bits / 2;
  const mask = (2 ** half - 1) >>> 0;
  let left = (x >>> half) & mask;
  let right = x & mask;
  for (let round = 0; round < 4; round++) {
    const f = mix32((right ^ deriveSeed(seed, 'feistel-round', round)) >>> 0) & mask;
    const newLeft = right;
    const newRight = (left ^ f) & mask;
    left = newLeft;
    right = newRight;
  }
  return (((left << half) >>> 0) | right) >>> 0;
}

export function permuteIndex(index, total, seed) {
  if (!Number.isInteger(index) || index < 0 || index >= total) throw new Error('index out of range');
  if (total <= 1) return 0;
  const bits = nextEvenBitWidth(total);
  let x = index >>> 0;
  do {
    x = feistelPow2(x, bits, deriveSeed(seed, 'permutation', total));
  } while (x >= total);
  return x;
}

export function categoryAt(index, total, weights, seed) {
  const counts = exactWeightedCounts(weights, total);
  const p = permuteIndex(index, total, seed);
  let cumulative = 0;
  for (let i = 0; i < counts.length; i++) {
    cumulative += counts[i];
    if (p < cumulative) return i;
  }
  return counts.length - 1;
}
