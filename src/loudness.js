const EPS = 1e-12;
const db = x => 20 * Math.log10(Math.max(EPS, x));
const gain = dB => 10 ** (dB / 20);

export function analyzePcm(channels, sampleRate) {
  if (!channels?.length || !channels[0]?.length) return { rmsDb: -Infinity, robustDb: -Infinity, peakDb: -Infinity, duration: 0 };
  const n = channels[0].length;
  let sumSq = 0;
  let peak = 0;
  const win = Math.max(1, Math.round(sampleRate * 0.4));
  const levels = [];
  let windowSumSq = 0;
  let windowCount = 0;
  for (let i = 0; i < n; i++) {
    let frameSq = 0;
    for (const ch of channels) {
      const x = ch[i] || 0;
      const square = x * x;
      frameSq += square;
      windowSumSq += square;
      peak = Math.max(peak, Math.abs(x));
      windowCount++;
    }
    sumSq += frameSq / channels.length;
    if ((i + 1) % win === 0 || i === n - 1) {
      levels.push(db(Math.sqrt(windowSumSq / Math.max(1, windowCount))));
      windowSumSq = 0;
      windowCount = 0;
    }
  }
  const rms = Math.sqrt(sumSq / n);

  // Robust program-level estimate: 400 ms RMS windows, discard windows >18 dB below the 80th percentile.
  const sorted = levels.filter(Number.isFinite).sort((a,b)=>a-b);
  const p80 = sorted.length ? sorted[Math.floor((sorted.length - 1) * 0.8)] : -Infinity;
  const gate = p80 - 18;
  const active = levels.filter(v => v >= gate);
  const robustDb = active.length ? active.reduce((a,b)=>a+b,0)/active.length : db(rms);

  return { rmsDb: db(rms), robustDb, peakDb: db(peak), duration: n / sampleRate };
}

export function planNoiseGain(sourceAnalysis, rawNoiseAnalysis, relativeDb = -27, outputCeilingDb = -1) {
  const desiredNoiseDb = sourceAnalysis.robustDb + relativeDb;
  let noiseGainDb = desiredNoiseDb - rawNoiseAnalysis.rmsDb;
  const sourcePeak = gain(sourceAnalysis.peakDb);
  const predictedNoisePeak = gain(rawNoiseAnalysis.peakDb + noiseGainDb);
  const ceiling = gain(outputCeilingDb);
  const predicted = sourcePeak + predictedNoisePeak;
  let masterGainDb = 0;
  if (predicted > ceiling && predicted > 0) masterGainDb = 20 * Math.log10(ceiling / predicted);
  return { desiredNoiseDb, noiseGainDb, masterGainDb, relativeDb };
}

export function applyGainPcm(channels, gainDb) {
  const g = gain(gainDb);
  return channels.map(ch => {
    const out = new Float32Array(ch.length);
    for (let i = 0; i < ch.length; i++) out[i] = Math.max(-1, Math.min(1, (ch[i] || 0) * g));
    return out;
  });
}

export function mixPcm(sourceChannels, noiseChannels, noiseGainDb, masterGainDb = 0) {
  const n = sourceChannels[0].length;
  const outChannels = Math.max(2, sourceChannels.length);
  const out = Array.from({length: outChannels}, () => new Float32Array(n));
  const ng = gain(noiseGainDb);
  const mg = gain(masterGainDb);
  for (let i = 0; i < n; i++) {
    for (let c = 0; c < outChannels; c++) {
      const source = sourceChannels[Math.min(c, sourceChannels.length - 1)][i] || 0;
      const noise = noiseChannels[Math.min(c, noiseChannels.length - 1)][i] || 0;
      out[c][i] = Math.max(-1, Math.min(1, (source + noise * ng) * mg));
    }
  }
  return out;
}

function rmsPower(channels) {
  if (!channels?.length || !channels[0]?.length) return 0;
  let sum = 0;
  const frames = channels[0].length;
  for (let i = 0; i < frames; i++) {
    for (const channel of channels) {
      const x = channel[i] || 0;
      sum += x * x;
    }
  }
  return Math.sqrt(sum / Math.max(1, frames * channels.length));
}

function meanSquare(channels) {
  if (!channels?.length || !channels[0]?.length) return 0;
  let sum = 0;
  const frames = channels[0].length;
  for (let i = 0; i < frames; i++) {
    for (const channel of channels) {
      const value = channel[i] || 0;
      sum += value * value;
    }
  }
  return sum / Math.max(1, frames * channels.length);
}

function meanCrossPower(leftChannels, rightChannels) {
  if (!leftChannels?.length || !rightChannels?.length || !leftChannels[0]?.length || !rightChannels[0]?.length) return 0;
  const frames = Math.min(leftChannels[0].length, rightChannels[0].length);
  const channels = Math.max(leftChannels.length, rightChannels.length);
  let sum = 0;
  for (let i = 0; i < frames; i++) {
    for (let c = 0; c < channels; c++) {
      const left = leftChannels[Math.min(c, leftChannels.length - 1)]?.[i] || 0;
      const right = rightChannels[Math.min(c, rightChannels.length - 1)]?.[i] || 0;
      sum += left * right;
    }
  }
  return sum / Math.max(1, frames * channels);
}

const gainToDb = value => value > EPS ? 20 * Math.log10(value) : -Infinity;

/** Plan the total additive level while keeping coherent source drift downward-only. */
export function planCompositeAddedSignal({
  sourceChannels,
  independentNoiseChannels,
  driftChannels,
  sourceAnalysis,
  relativeDb = -27,
  driftPowerShare = 0.08,
  outputCeilingDb = -1
} = {}) {
  const desiredAddedDb = sourceAnalysis.robustDb + relativeDb;
  const desiredPower = gain(desiredAddedDb) ** 2;
  const requestedShare = Math.max(0, Math.min(1, Number(driftPowerShare) || 0));
  const rawDriftPower = meanSquare(driftChannels);
  const rawNoisePower = meanSquare(independentNoiseChannels);
  const desiredDriftPower = desiredPower * requestedShare;
  const driftLinearGain = rawDriftPower > EPS ? Math.min(1, Math.sqrt(desiredDriftPower / rawDriftPower)) : 0;
  const fixedDriftPower = rawDriftPower * driftLinearGain * driftLinearGain;
  const crossPower = meanCrossPower(independentNoiseChannels, driftChannels);
  const quadraticA = rawNoisePower;
  const quadraticB = 2 * crossPower * driftLinearGain;
  const quadraticC = fixedDriftPower - desiredPower;
  let noiseLinearGain = 0;
  if (quadraticA > EPS) {
    const discriminant = Math.max(0, quadraticB * quadraticB - 4 * quadraticA * quadraticC);
    const root = (-quadraticB + Math.sqrt(discriminant)) / (2 * quadraticA);
    noiseLinearGain = Math.max(0, Number.isFinite(root) ? root : 0);
  }

  const outputChannels = Math.max(2, sourceChannels?.length || 0, independentNoiseChannels?.length || 0, driftChannels?.length || 0);
  const frames = sourceChannels?.[0]?.length || independentNoiseChannels?.[0]?.length || driftChannels?.[0]?.length || 0;
  let predictedPeak = 0;
  for (let i = 0; i < frames; i++) {
    for (let c = 0; c < outputChannels; c++) {
      const source = sourceChannels?.[Math.min(c, (sourceChannels?.length || 1) - 1)]?.[i] || 0;
      const noise = independentNoiseChannels?.[Math.min(c, (independentNoiseChannels?.length || 1) - 1)]?.[i] || 0;
      const drift = driftChannels?.[Math.min(c, (driftChannels?.length || 1) - 1)]?.[i] || 0;
      predictedPeak = Math.max(predictedPeak, Math.abs(source + noise * noiseLinearGain + drift * driftLinearGain));
    }
  }
  const ceiling = gain(outputCeilingDb);
  const masterGainDb = predictedPeak > ceiling && predictedPeak > EPS ? 20 * Math.log10(ceiling / predictedPeak) : 0;
  return {
    desiredAddedDb,
    relativeDb,
    driftPowerShare: requestedShare,
    rawDriftPower,
    rawNoisePower,
    crossPower,
    driftGainDb: gainToDb(driftLinearGain),
    noiseGainDb: gainToDb(noiseLinearGain),
    masterGainDb,
    predictedPeak,
    outputCeilingDb
  };
}

export function mixCompositePcm(sourceChannels, independentNoiseChannels, driftChannels, plan) {
  const frames = sourceChannels?.[0]?.length || independentNoiseChannels?.[0]?.length || driftChannels?.[0]?.length || 0;
  const outputChannels = Math.max(2, sourceChannels?.length || 0, independentNoiseChannels?.length || 0, driftChannels?.length || 0);
  const out = Array.from({ length: outputChannels }, () => new Float32Array(frames));
  const noiseGain = gain(plan.noiseGainDb);
  const driftGain = gain(plan.driftGainDb);
  const masterGain = gain(plan.masterGainDb);
  for (let i = 0; i < frames; i++) {
    for (let c = 0; c < outputChannels; c++) {
      const source = sourceChannels?.[Math.min(c, (sourceChannels?.length || 1) - 1)]?.[i] || 0;
      const noise = independentNoiseChannels?.[Math.min(c, (independentNoiseChannels?.length || 1) - 1)]?.[i] || 0;
      const drift = driftChannels?.[Math.min(c, (driftChannels?.length || 1) - 1)]?.[i] || 0;
      out[c][i] = Math.max(-1, Math.min(1, (source + noise * noiseGain + drift * driftGain) * masterGain));
    }
  }
  return out;
}

export function renderCompositeNoiseOnly(independentNoiseChannels, driftChannels, plan) {
  const frames = independentNoiseChannels?.[0]?.length || driftChannels?.[0]?.length || 0;
  const outputChannels = Math.max(2, independentNoiseChannels?.length || 0, driftChannels?.length || 0);
  const out = Array.from({ length: outputChannels }, () => new Float32Array(frames));
  const noiseGain = gain(plan.noiseGainDb);
  const driftGain = gain(plan.driftGainDb);
  const masterGain = gain(plan.masterGainDb);
  for (let i = 0; i < frames; i++) {
    for (let c = 0; c < outputChannels; c++) {
      const noise = independentNoiseChannels?.[Math.min(c, (independentNoiseChannels?.length || 1) - 1)]?.[i] || 0;
      const drift = driftChannels?.[Math.min(c, (driftChannels?.length || 1) - 1)]?.[i] || 0;
      out[c][i] = Math.max(-1, Math.min(1, (noise * noiseGain + drift * driftGain) * masterGain));
    }
  }
  return out;
}

/** Combine independent raw noise layers by power share before total-noise gain planning. */
export function combineNoiseLayers(environmentChannels, sourceSpectrumChannels, sourcePowerShare = 0.35) {
  const frames = environmentChannels?.[0]?.length || sourceSpectrumChannels?.[0]?.length || 0;
  const outputChannels = Math.max(2, environmentChannels?.length || 0, sourceSpectrumChannels?.length || 0);
  const out = Array.from({ length: outputChannels }, () => new Float32Array(frames));
  const share = Math.max(0, Math.min(1, Number(sourcePowerShare) || 0));
  const environmentGain = Math.sqrt(1 - share) / Math.max(EPS, rmsPower(environmentChannels));
  const sourceGain = Math.sqrt(share) / Math.max(EPS, rmsPower(sourceSpectrumChannels));
  for (let i = 0; i < frames; i++) {
    for (let c = 0; c < outputChannels; c++) {
      const environment = environmentChannels?.[Math.min(c, (environmentChannels?.length || 1) - 1)]?.[i] || 0;
      const source = sourceSpectrumChannels?.[Math.min(c, (sourceSpectrumChannels?.length || 1) - 1)]?.[i] || 0;
      out[c][i] = environment * environmentGain + source * sourceGain;
    }
  }
  return out;
}
