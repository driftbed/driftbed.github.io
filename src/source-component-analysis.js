const EPSILON = 1e-12;
const TAU = Math.PI * 2;

const clamp = (value, lo, hi) => Math.max(lo, Math.min(hi, value));

class BiquadBandPass {
  constructor(sampleRate, frequency, q) {
    const omega = TAU * frequency / sampleRate;
    const sine = Math.sin(omega);
    const alpha = sine / (2 * q);
    const a0 = 1 + alpha;
    this.b0 = (sine * 0.5) / a0;
    this.b1 = 0;
    this.b2 = -this.b0;
    this.a1 = (-2 * Math.cos(omega)) / a0;
    this.a2 = (1 - alpha) / a0;
    this.z1 = 0;
    this.z2 = 0;
  }

  process(value) {
    const output = this.b0 * value + this.z1;
    this.z1 = this.b1 * value - this.a1 * output + this.z2;
    this.z2 = this.b2 * value - this.a2 * output;
    return output;
  }
}

function makeLogCenters(sampleRate, bandCount, minFrequency, maxFrequency) {
  const count = Math.max(1, Math.floor(Number(bandCount) || 24));
  const min = clamp(Number(minFrequency) || 40, 20, sampleRate * 0.18);
  const max = clamp(Number(maxFrequency) || sampleRate * 0.45, min * 1.35, sampleRate * 0.47);
  const centers = new Float32Array(count);
  const ratio = count === 1 ? 1 : (max / min) ** (1 / (count - 1));
  for (let i = 0; i < count; i++) centers[i] = min * ratio ** i;
  return centers;
}

function medianWindow(values, start, step, count, scratch) {
  let length = 0;
  for (let i = 0; i < count; i++) {
    const value = values[start + i * step] || 0;
    let position = length;
    while (position > 0 && scratch[position - 1] > value) {
      scratch[position] = scratch[position - 1];
      position--;
    }
    scratch[position] = value;
    length++;
  }
  return scratch[length >> 1];
}

function normalizeCellMasks(power, sustainedScore, transientScore, diffuseScore, sustained, transient, diffuse, index) {
  const total = sustainedScore + transientScore + diffuseScore;
  if (total <= EPSILON) {
    sustained[index] = 0;
    transient[index] = 0;
    diffuse[index] = power > EPSILON ? 1 : 0;
    return;
  }
  sustained[index] = sustainedScore / total;
  transient[index] = transientScore / total;
  diffuse[index] = diffuseScore / total;
}

/** Build a deterministic band-power timeline and soft structural masks. */
export function analyzeSourceSpectrumTimeline(channels, sampleRate, {
  bandCount = 24,
  frameMs = 20,
  minFrequency = 40,
  maxFrequency = sampleRate * 0.45,
  temporalMedianRadius = 5,
  spectralMedianRadius = 1
} = {}) {
  const leftSource = channels?.[0] || new Float32Array(0);
  const rightSource = channels?.[1] || null;
  const frames = leftSource.length;
  const rate = Math.max(1000, Number(sampleRate) || 48000);
  const hopSamples = Math.max(1, Math.round(rate * Number(frameMs || 20) / 1000));
  const frameCount = frames ? Math.ceil(frames / hopSamples) : 0;
  const bandCenters = makeLogCenters(rate, bandCount, minFrequency, maxFrequency);
  const bands = bandCenters.length;
  const framePower = new Float32Array(bands * frameCount);
  const powerLeft = new Float32Array(bands * frameCount);
  const powerRight = new Float32Array(bands * frameCount);
  const crossPower = new Float32Array(bands * frameCount);
  const frameLengths = new Uint32Array(frameCount);
  const spacing = bands > 1 ? bandCenters[1] / bandCenters[0] : 2;
  const q = clamp(1 / (2 * Math.sinh(Math.log(spacing) * 0.5)), 0.7, 3.5);
  const analysisLeft = [];
  const analysisRight = [];
  for (let band = 0; band < bands; band++) {
    analysisLeft.push(new BiquadBandPass(rate, bandCenters[band], q));
    analysisRight.push(new BiquadBandPass(rate, bandCenters[band], q));
  }

  for (let frame = 0; frame < frameCount; frame++) frameLengths[frame] = Math.min(hopSamples, frames - frame * hopSamples);
  for (let i = 0; i < frames; i++) {
    const left = leftSource[i] || 0;
    const right = rightSource ? (rightSource[i] || 0) : left;
    const frame = Math.min(frameCount - 1, Math.floor(i / hopSamples));
    for (let band = 0; band < bands; band++) {
      const leftBand = analysisLeft[band].process(left);
      const rightBand = analysisRight[band].process(right);
      const index = band * frameCount + frame;
      powerLeft[index] += leftBand * leftBand;
      powerRight[index] += rightBand * rightBand;
      crossPower[index] += leftBand * rightBand;
    }
  }

  for (let band = 0; band < bands; band++) {
    for (let frame = 0; frame < frameCount; frame++) {
      const index = band * frameCount + frame;
      const divisor = Math.max(1, frameLengths[frame]);
      powerLeft[index] /= divisor;
      powerRight[index] /= divisor;
      crossPower[index] /= divisor;
      framePower[index] = (powerLeft[index] + powerRight[index]) * 0.5;
    }
  }

  const sustainedMask = new Float32Array(bands * frameCount);
  const transientMask = new Float32Array(bands * frameCount);
  const diffuseMask = new Float32Array(bands * frameCount);
  const temporalRadius = Math.max(1, Math.floor(Number(temporalMedianRadius) || 5));
  const spectralRadius = Math.max(1, Math.floor(Number(spectralMedianRadius) || 1));
  const temporalScratch = new Float64Array(temporalRadius * 2 + 1);
  const spectralScratch = new Float64Array(spectralRadius * 2 + 1);
  for (let band = 0; band < bands; band++) {
    for (let frame = 0; frame < frameCount; frame++) {
      const index = band * frameCount + frame;
      const power = framePower[index];
      const timeStart = Math.max(0, frame - temporalRadius);
      const timeEnd = Math.min(frameCount - 1, frame + temporalRadius);
      const timeCount = timeEnd - timeStart + 1;
      const timeMedian = medianWindow(framePower, band * frameCount + timeStart, 1, timeCount, temporalScratch);
      const bandStart = Math.max(0, band - spectralRadius);
      const bandEnd = Math.min(bands - 1, band + spectralRadius);
      const bandCountAtFrame = bandEnd - bandStart + 1;
      const spectralMedian = medianWindow(framePower, bandStart * frameCount + frame, frameCount, bandCountAtFrame, spectralScratch);
      const sustainedScore = timeMedian;
      const transientScore = spectralMedian;
      const diffuseScore = Math.max(0, power - Math.max(sustainedScore, transientScore)) + power * 0.02;
      normalizeCellMasks(power, sustainedScore, transientScore, diffuseScore, sustainedMask, transientMask, diffuseMask, index);
    }
  }

  return {
    sampleRate: rate,
    sampleCount: frames,
    frameMs: Number(frameMs || 20),
    hopSamples,
    frameCount,
    bandCount: bands,
    bandCenters,
    framePower,
    powerLeft,
    powerRight,
    crossPower,
    sustainedMask,
    transientMask,
    diffuseMask
  };
}
