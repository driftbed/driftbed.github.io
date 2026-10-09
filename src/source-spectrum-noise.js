import { rngFor } from './random.js';

export const SOURCE_SPECTRUM_NOISE_VERSION = 1;
export const DEFAULT_SOURCE_SPECTRUM_CONFIG = Object.freeze({
  bandCount: 16,
  attackSeconds: 0.025,
  releaseSeconds: 0.22,
  spectralSmoothing: 0.20
});
export const DEFAULT_SOURCE_SPECTRUM_POWER_SHARE = 0.35;

const EPSILON = 1e-12;
const TAU = Math.PI * 2;
const clamp = (x, lo, hi) => Math.max(lo, Math.min(hi, x));
const smoothstep = x => { const t = clamp(x, 0, 1); return t * t * (3 - 2 * t); };

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

  process(x) {
    const y = this.b0 * x + this.z1;
    this.z1 = this.b1 * x - this.a1 * y + this.z2;
    this.z2 = this.b2 * x - this.a2 * y;
    return y;
  }

  reset() {
    this.z1 = 0;
    this.z2 = 0;
  }

  impulseEnergy(length = 4096) {
    const filter = new BiquadBandPassFromCoefficients(this);
    let energy = 0;
    for (let i = 0; i < length; i++) {
      const y = filter.process(i === 0 ? 1 : 0);
      energy += y * y;
    }
    return Math.max(EPSILON, energy);
  }
}

class BiquadBandPassFromCoefficients {
  constructor(source) {
    this.b0 = source.b0;
    this.b1 = source.b1;
    this.b2 = source.b2;
    this.a1 = source.a1;
    this.a2 = source.a2;
    this.z1 = 0;
    this.z2 = 0;
  }

  process(x) {
    const y = this.b0 * x + this.z1;
    this.z1 = this.b1 * x - this.a1 * y + this.z2;
    this.z2 = this.b2 * x - this.a2 * y;
    return y;
  }
}

function coefficientForSeconds(seconds, sampleRate) {
  return 1 - Math.exp(-1 / Math.max(1, seconds * sampleRate));
}

function makeLogCenters(sampleRate, bandCount, minFrequency, maxFrequency) {
  const count = Math.max(1, Math.floor(Number(bandCount) || DEFAULT_SOURCE_SPECTRUM_CONFIG.bandCount));
  const min = clamp(Number(minFrequency) || 40, 20, sampleRate * 0.18);
  const max = clamp(Number(maxFrequency) || sampleRate * 0.45, min * 1.35, sampleRate * 0.47);
  const centers = new Float64Array(count);
  const ratio = count === 1 ? 1 : (max / min) ** (1 / (count - 1));
  for (let i = 0; i < count; i++) centers[i] = min * ratio ** i;
  return centers;
}

/**
 * Streaming source-spectrum-shaped stochastic noise. The source supplies slowly
 * varying per-band power and stereo covariance; independently seeded filtered
 * carriers supply the fine random structure.
 */
export class SourceSpectrumNoiseFollower {
  constructor({
    sampleRate = 48000,
    seed = 'default',
    bandCount = DEFAULT_SOURCE_SPECTRUM_CONFIG.bandCount,
    minFrequency = 40,
    maxFrequency = sampleRate * 0.45,
    attackSeconds = DEFAULT_SOURCE_SPECTRUM_CONFIG.attackSeconds,
    releaseSeconds = DEFAULT_SOURCE_SPECTRUM_CONFIG.releaseSeconds,
    spectralSmoothing = DEFAULT_SOURCE_SPECTRUM_CONFIG.spectralSmoothing,
    controlBlock = 32
  } = {}) {
    this.sampleRate = Math.max(1000, Number(sampleRate) || 48000);
    this.seed = seed;
    this.bandCenters = makeLogCenters(this.sampleRate, bandCount, minFrequency, maxFrequency);
    this.bandCount = this.bandCenters.length;
    this.controlBlock = Math.max(1, Math.floor(Number(controlBlock) || 32));
    this.spectralSmoothing = clamp(Number(spectralSmoothing), 0, 0.5);
    this.attackCoefficient = coefficientForSeconds(attackSeconds, this.sampleRate);
    this.releaseCoefficient = coefficientForSeconds(releaseSeconds, this.sampleRate);
    this.gateFloorDb = -72;
    this.gateRangeDb = 24;
    this.controlRemaining = this.controlBlock;
    this.inputPowerAccum = 0;

    const spacing = this.bandCount > 1 ? this.bandCenters[1] / this.bandCenters[0] : 2;
    const q = clamp(1 / (2 * Math.sinh(Math.log(spacing) * 0.5)), 0.7, 3.5);
    this.analysisLeft = [];
    this.analysisRight = [];
    this.synthesis = [];
    this.carrierLeft = [];
    this.carrierRight = [];
    this.carrierScale = new Float64Array(this.bandCount);
    this.powerLeft = new Float64Array(this.bandCount);
    this.powerRight = new Float64Array(this.bandCount);
    this.crossPower = new Float64Array(this.bandCount);
    this.logPowerLeft = new Float64Array(this.bandCount);
    this.logPowerRight = new Float64Array(this.bandCount);
    this.bandGainLeft = new Float64Array(this.bandCount);
    this.bandGainRight = new Float64Array(this.bandCount);
    this.bandCorrelation = new Float64Array(this.bandCount);

    for (let i = 0; i < this.bandCount; i++) {
      const frequency = this.bandCenters[i];
      const analysis = new BiquadBandPass(this.sampleRate, frequency, q);
      this.analysisLeft.push(analysis);
      this.analysisRight.push(new BiquadBandPass(this.sampleRate, frequency, q));
      this.synthesis.push({
        left: new BiquadBandPass(this.sampleRate, frequency, q),
        right: new BiquadBandPass(this.sampleRate, frequency, q)
      });
      this.carrierLeft.push(rngFor(seed, SOURCE_SPECTRUM_NOISE_VERSION, 'source-spectrum-carrier', i, 'left'));
      this.carrierRight.push(rngFor(seed, SOURCE_SPECTRUM_NOISE_VERSION, 'source-spectrum-carrier', i, 'right'));
      this.carrierScale[i] = 1 / Math.sqrt(analysis.impulseEnergy());
    }
  }

  #updateControl() {
    for (let i = 0; i < this.bandCount; i++) {
      this.logPowerLeft[i] = Math.log(Math.max(EPSILON, this.powerLeft[i]));
      this.logPowerRight[i] = Math.log(Math.max(EPSILON, this.powerRight[i]));
    }

    const activityPower = this.inputPowerAccum / this.controlBlock;
    const activityDb = activityPower > EPSILON ? 10 * Math.log10(activityPower) : -Infinity;
    const gate = smoothstep((activityDb - this.gateFloorDb) / this.gateRangeDb);
    const neighborWeight = this.spectralSmoothing;
    const centerWeight = 1 - neighborWeight * 2;
    for (let i = 0; i < this.bandCount; i++) {
      const prev = Math.max(0, i - 1);
      const next = Math.min(this.bandCount - 1, i + 1);
      const leftLog = centerWeight * this.logPowerLeft[i]
        + neighborWeight * (this.logPowerLeft[prev] + this.logPowerLeft[next]);
      const rightLog = centerWeight * this.logPowerRight[i]
        + neighborWeight * (this.logPowerRight[prev] + this.logPowerRight[next]);
      const targetLeft = Math.sqrt(Math.exp(leftLog)) * gate;
      const targetRight = Math.sqrt(Math.exp(rightLog)) * gate;
      const smoothing = 1 - Math.exp(-this.controlBlock / (0.025 * this.sampleRate));
      this.bandGainLeft[i] += (targetLeft - this.bandGainLeft[i]) * smoothing;
      this.bandGainRight[i] += (targetRight - this.bandGainRight[i]) * smoothing;
      const denominator = Math.sqrt(this.powerLeft[i] * this.powerRight[i]) + EPSILON;
      const targetCorrelation = clamp(this.crossPower[i] / denominator, -1, 1);
      this.bandCorrelation[i] += (targetCorrelation - this.bandCorrelation[i]) * smoothing;
    }
    this.inputPowerAccum = 0;
    this.controlRemaining = this.controlBlock;
  }

  /** Process source PCM into stereo source-shaped noise without per-sample allocation. */
  processBlock(sourceLeft, sourceRight, outputLeft, outputRight, frameCount = outputLeft.length) {
    const frames = Math.min(frameCount, sourceLeft.length, outputLeft.length, outputRight?.length ?? outputLeft.length);
    const mono = sourceRight == null;
    for (let frame = 0; frame < frames; frame++) {
      const leftSource = sourceLeft[frame] || 0;
      const rightSource = mono ? leftSource : (sourceRight[frame] || 0);
      let left = 0;
      let right = 0;
      this.inputPowerAccum += (leftSource * leftSource + rightSource * rightSource) * 0.5;

      for (let band = 0; band < this.bandCount; band++) {
        const analysisLeft = this.analysisLeft[band].process(leftSource);
        const analysisRight = this.analysisRight[band].process(rightSource);
        const leftPower = analysisLeft * analysisLeft;
        const rightPower = analysisRight * analysisRight;
        const envelopeCoefficientLeft = leftPower > this.powerLeft[band] ? this.attackCoefficient : this.releaseCoefficient;
        const envelopeCoefficientRight = rightPower > this.powerRight[band] ? this.attackCoefficient : this.releaseCoefficient;
        this.powerLeft[band] += (leftPower - this.powerLeft[band]) * envelopeCoefficientLeft;
        this.powerRight[band] += (rightPower - this.powerRight[band]) * envelopeCoefficientRight;
        const cross = analysisLeft * analysisRight;
        this.crossPower[band] += (cross - this.crossPower[band]) * Math.min(envelopeCoefficientLeft, envelopeCoefficientRight);

        const carrierU = this.synthesis[band].left.process(this.carrierLeft[band].next() * 2 - 1) * this.carrierScale[band];
        const carrierV = this.synthesis[band].right.process(this.carrierRight[band].next() * 2 - 1) * this.carrierScale[band];
        const correlation = this.bandCorrelation[band];
        const orthogonal = Math.sqrt(Math.max(0, 1 - correlation * correlation));
        left += carrierU * this.bandGainLeft[band];
        right += (correlation * carrierU + orthogonal * carrierV) * this.bandGainRight[band];
      }
      this.controlRemaining--;
      if (this.controlRemaining <= 0) this.#updateControl();
      outputLeft[frame] = left;
      if (outputRight) outputRight[frame] = mono ? left : right;
    }
    return frames;
  }

  reset() {
    for (let i = 0; i < this.bandCount; i++) {
      this.analysisLeft[i].reset();
      this.analysisRight[i].reset();
      this.synthesis[i].left.reset();
      this.synthesis[i].right.reset();
    }
    this.powerLeft.fill(0);
    this.powerRight.fill(0);
    this.crossPower.fill(0);
    this.logPowerLeft.fill(0);
    this.logPowerRight.fill(0);
    this.bandGainLeft.fill(0);
    this.bandGainRight.fill(0);
    this.bandCorrelation.fill(0);
    this.controlRemaining = this.controlBlock;
    this.inputPowerAccum = 0;
  }
}
