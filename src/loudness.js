const EPS = 1e-12;
const db = x => 20 * Math.log10(Math.max(EPS, x));
const gain = dB => 10 ** (dB / 20);

export function analyzePcm(channels, sampleRate) {
  if (!channels?.length || !channels[0]?.length) return { rmsDb: -Infinity, robustDb: -Infinity, peakDb: -Infinity, duration: 0 };
  const n = channels[0].length;
  let sumSq = 0;
  let peak = 0;
  for (let i = 0; i < n; i++) {
    let frameSq = 0;
    for (const ch of channels) {
      const x = ch[i] || 0;
      frameSq += x * x;
      peak = Math.max(peak, Math.abs(x));
    }
    sumSq += frameSq / channels.length;
  }
  const rms = Math.sqrt(sumSq / n);

  // Robust program-level estimate: 400 ms RMS windows, discard windows >18 dB below the 80th percentile.
  const win = Math.max(1, Math.round(sampleRate * 0.4));
  const levels = [];
  for (let start = 0; start < n; start += win) {
    const end = Math.min(n, start + win);
    let ss = 0, count = 0;
    for (let i = start; i < end; i++) {
      for (const ch of channels) { const x = ch[i] || 0; ss += x * x; count++; }
    }
    levels.push(db(Math.sqrt(ss / Math.max(1, count))));
  }
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
