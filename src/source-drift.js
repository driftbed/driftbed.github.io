import { rngFor } from './random.js';

export const SOURCE_DRIFT_VERSION = 1;
export const DEFAULT_SOURCE_DRIFT_CONFIG = Object.freeze({
  enabled: true,
  targetPowerShare: 0.08,
  normalWetBudget: 0.10,
  absoluteWetCeiling: 0.18,
  voiceCount: 3,
  maxDelayMs: 18,
  fractionalDelay: 'linear',
  delayMorph: 'convex-crossfade',
  phaseDiffusion: 'fixed-allpass',
  allpassStages: 2,
  lowCutHz: 100,
  highCutHz: 12000,
  transientProtection: true,
  stereoMode: 'source-aware'
});

const EPSILON = 1e-12;
const TAU = Math.PI * 2;
const VOICE_RANGES_MS = Object.freeze([[0.2, 0.8], [1.2, 4], [7, 18]]);
const VOICE_SHARES = Object.freeze([0.45, 0.35, 0.20]);

const clamp = (value, lo, hi) => Math.max(lo, Math.min(hi, value));
const finiteOr = (value, fallback) => Number.isFinite(value) ? value : fallback;

export function coherentGainFloor(wetBudget) {
  return Math.max(0, 1 - Math.max(0, Number(wetBudget) || 0));
}

class OnePoleLowPass {
  constructor(sampleRate, cutoffHz) {
    this.coefficient = 1 - Math.exp(-TAU * clamp(cutoffHz, 1, sampleRate * 0.45) / sampleRate);
    this.value = 0;
  }

  process(input) {
    this.value += (input - this.value) * this.coefficient;
    return this.value;
  }
}

export class FirstOrderAllpass {
  constructor(coefficient) {
    this.coefficient = clamp(Number(coefficient) || 0, -0.92, 0.92);
    this.input = 0;
    this.output = 0;
  }

  process(input) {
    const output = -this.coefficient * input + this.input + this.coefficient * this.output;
    this.input = input;
    this.output = output;
    return output;
  }
}

export class FractionalDelayReader {
  constructor(maxDelaySamples) {
    this.buffer = new Float32Array(Math.max(8, Math.ceil(maxDelaySamples) + 4));
    this.index = 0;
  }

  write(value) {
    this.buffer[this.index] = value;
  }

  read(delaySamples) {
    let position = this.index - clamp(delaySamples, 0, this.buffer.length - 3);
    while (position < 0) position += this.buffer.length;
    while (position >= this.buffer.length) position -= this.buffer.length;
    const first = Math.floor(position);
    const fraction = position - first;
    const second = first + 1 < this.buffer.length ? first + 1 : 0;
    return this.buffer[first] + (this.buffer[second] - this.buffer[first]) * fraction;
  }

  advance() {
    this.index++;
    if (this.index === this.buffer.length) this.index = 0;
  }
}

function powerAt(model, componentCount, cellCount, band, frame, field) {
  const index = band * model.frameCount + frame;
  let total = 0;
  for (let component = 0; component < componentCount; component++) total += model[field][component * cellCount + index] || 0;
  return total;
}

export function buildDriftControlTimeline(model) {
  const frameCount = Math.max(0, model?.frameCount || 0);
  const bandCount = Math.max(0, model?.bandCount || 0);
  const componentCount = Math.max(0, model?.componentCount || 0);
  const cellCount = bandCount * frameCount;
  const activity = new Float32Array(frameCount);
  const transientShare = new Float32Array(frameCount);
  const diffuseShare = new Float32Array(frameCount);
  const spectralCentroid = new Float32Array(frameCount);
  const stereoCorrelation = new Float32Array(frameCount);
  const framePower = new Float64Array(frameCount);
  const rawTransient = new Float64Array(frameCount);
  const rawDiffuse = new Float64Array(frameCount);
  const rawCentroid = new Float64Array(frameCount);
  const rawLeft = new Float64Array(frameCount);
  const rawRight = new Float64Array(frameCount);
  const rawCross = new Float64Array(frameCount);

  for (let frame = 0; frame < frameCount; frame++) {
    for (let band = 0; band < bandCount; band++) {
      const index = band * frameCount + frame;
      let total = 0;
      let transient = 0;
      let diffuse = 0;
      let left = 0;
      let right = 0;
      let cross = 0;
      for (let component = 0; component < componentCount; component++) {
        const base = component * cellCount + index;
        const power = model.power[base] || 0;
        total += power;
        left += model.powerLeft[base] || 0;
        right += model.powerRight[base] || 0;
        cross += model.crossPower[base] || 0;
        if (model.componentKind[component] === 'transient') transient += power;
        if (model.componentKind[component] === 'diffuse') diffuse += power;
      }
      framePower[frame] += total;
      rawTransient[frame] += transient;
      rawDiffuse[frame] += diffuse;
      rawCentroid[frame] += (model.bandCenters[band] || 0) * total;
      rawLeft[frame] += left;
      rawRight[frame] += right;
      rawCross[frame] += cross;
    }
  }

  const positive = Array.from(framePower).filter(value => value > EPSILON).sort((a, b) => a - b);
  const referencePower = positive.length ? positive[Math.floor((positive.length - 1) * 0.8)] : 0;
  for (let frame = 0; frame < frameCount; frame++) {
    const power = framePower[frame];
    activity[frame] = referencePower > EPSILON ? clamp(Math.sqrt(power / referencePower), 0, 1) : 0;
    transientShare[frame] = power > EPSILON ? clamp(rawTransient[frame] / power, 0, 1) : 0;
    diffuseShare[frame] = power > EPSILON ? clamp(rawDiffuse[frame] / power, 0, 1) : 0;
    spectralCentroid[frame] = power > EPSILON ? rawCentroid[frame] / power : 0;
    const denominator = Math.sqrt(Math.max(EPSILON, rawLeft[frame] * rawRight[frame]));
    stereoCorrelation[frame] = clamp(rawCross[frame] / denominator, -1, 1);
  }
  return { frameCount, hopSamples: model?.hopSamples || 1, activity, transientShare, diffuseShare, spectralCentroid, stereoCorrelation };
}

function interpolate(values, first, second, fraction) {
  return values[first] + (values[second] - values[first]) * fraction;
}

class DriftVoice {
  constructor({ sampleRate, index, seed, rangeMs, share, config, initialCorrelation }) {
    this.sampleRate = sampleRate;
    this.index = index;
    this.share = share;
    this.minDelayMs = rangeMs[0];
    this.maxDelayMs = Math.max(rangeMs[0], Math.min(rangeMs[1], config.maxDelayMs));
    this.rng = rngFor(seed, SOURCE_DRIFT_VERSION, 'delay-target', index);
    this.transitionRng = rngFor(seed, SOURCE_DRIFT_VERSION, 'transition-duration', index);
    this.holdRng = rngFor(seed, SOURCE_DRIFT_VERSION, 'hold-duration', index);
    this.stereoRng = rngFor(seed, SOURCE_DRIFT_VERSION, 'stereo-offset', index);
    const maxDelaySamples = sampleRate * (this.maxDelayMs + 0.5) / 1000;
    this.leftDelay = new FractionalDelayReader(maxDelaySamples);
    this.rightDelay = new FractionalDelayReader(maxDelaySamples);
    this.delayA = this.pickDelay(0);
    this.delayB = this.delayA;
    this.delayOffset = config.stereoMode === 'source-aware'
      ? sampleRate * (0.25 * (1 - Math.abs(initialCorrelation)) * this.stereoRng.next()) / 1000
      : 0;
    this.transitionLength = 1;
    this.transitionRemaining = 0;
    this.holdRemaining = Math.round(sampleRate * this.holdRng.range(0.5, 3));
    this.weight = 0;
    this.allpassLeft = [];
    this.allpassRight = [];
    const stages = Math.max(0, Math.min(2, Math.floor(Number(config.allpassStages) || 0)));
    const allpassRng = rngFor(seed, SOURCE_DRIFT_VERSION, 'allpass-configuration', index);
    for (let stage = 0; stage < stages; stage++) {
      const coefficient = allpassRng.range(0.08, 0.34);
      this.allpassLeft.push(new FirstOrderAllpass(coefficient));
      this.allpassRight.push(new FirstOrderAllpass(coefficient));
    }
    this.leftLow = new OnePoleLowPass(sampleRate, config.lowCutHz);
    this.rightLow = new OnePoleLowPass(sampleRate, config.lowCutHz);
    this.leftHigh = new OnePoleLowPass(sampleRate, config.highCutHz);
    this.rightHigh = new OnePoleLowPass(sampleRate, config.highCutHz);
    this.lastLeft = 0;
    this.lastRight = 0;
  }

  pickDelay(spectralCentroid) {
    const bright = clamp((spectralCentroid - 250) / 3000, 0, 1);
    const scale = 1 - 0.18 * bright;
    return this.sampleRate * clamp(this.rng.range(this.minDelayMs, this.maxDelayMs) * scale, this.minDelayMs * 0.85, this.maxDelayMs) / 1000;
  }

  beginTransition(spectralCentroid) {
    this.delayB = this.pickDelay(spectralCentroid);
    this.transitionLength = Math.max(1, Math.round(this.sampleRate * this.transitionRng.range(0.8, 3.5)));
    this.transitionRemaining = this.transitionLength;
    this.weight = 0;
  }

  updateMorph(spectralCentroid) {
    if (this.transitionRemaining > 0) {
      const progress = 1 - this.transitionRemaining / this.transitionLength;
      this.weight = progress * progress * (3 - 2 * progress);
      this.transitionRemaining--;
      if (this.transitionRemaining === 0) {
        this.delayA = this.delayB;
        this.weight = 0;
        this.holdRemaining = Math.max(1, Math.round(this.sampleRate * this.holdRng.range(0.5, 3)));
      }
    } else if (this.holdRemaining > 0) {
      this.holdRemaining--;
    } else {
      this.beginTransition(spectralCentroid);
    }
  }

  process(left, right, activity, spectralCentroid) {
    const inputLeft = left * activity;
    const inputRight = right * activity;
    this.leftDelay.write(inputLeft);
    this.rightDelay.write(inputRight);
    this.updateMorph(spectralCentroid);
    const leftA = this.leftDelay.read(this.delayA);
    const leftB = this.leftDelay.read(this.delayB);
    const rightA = this.rightDelay.read(this.delayA + this.delayOffset);
    const rightB = this.rightDelay.read(this.delayB + this.delayOffset);
    let wetLeft = leftA + (leftB - leftA) * this.weight;
    let wetRight = rightA + (rightB - rightA) * this.weight;
    for (let stage = 0; stage < this.allpassLeft.length; stage++) {
      wetLeft = this.allpassLeft[stage].process(wetLeft);
      wetRight = this.allpassRight[stage].process(wetRight);
    }
    wetLeft -= this.leftLow.process(wetLeft);
    wetRight -= this.rightLow.process(wetRight);
    wetLeft = this.leftHigh.process(wetLeft);
    wetRight = this.rightHigh.process(wetRight);
    this.lastLeft = wetLeft;
    this.lastRight = wetRight;
    this.leftDelay.advance();
    this.rightDelay.advance();
  }
}

export class SourceDriftRenderer {
  constructor({ channels, sampleRate, model, seed = 'default', config = {} } = {}) {
    this.sourceLeft = channels?.[0] || new Float32Array(0);
    this.sourceRight = channels?.[1] || null;
    this.mono = !this.sourceRight;
    this.sampleRate = Math.max(1000, Number(sampleRate) || model?.sampleRate || 48000);
    this.model = model;
    this.seed = seed;
    this.config = { ...DEFAULT_SOURCE_DRIFT_CONFIG, ...config };
    this.control = buildDriftControlTimeline(model);
    const initialCorrelation = this.control.frameCount ? this.control.stereoCorrelation[0] : 1;
    const count = Math.max(2, Math.min(3, Math.floor(Number(this.config.voiceCount) || 3)));
    this.voices = [];
    for (let index = 0; index < count; index++) {
      this.voices.push(new DriftVoice({
        sampleRate: this.sampleRate,
        index,
        seed,
        rangeMs: VOICE_RANGES_MS[index],
        share: VOICE_SHARES[index],
        config: this.config,
        initialCorrelation
      }));
    }
  }

  render() {
    const frames = this.sourceLeft.length;
    const left = new Float32Array(frames);
    const right = new Float32Array(frames);
    if (!this.config.enabled || !frames || !this.control.frameCount) return { channels: [left, right], diagnostics: { maxWetBudget: 0, maxVoiceGainSum: 0, driftRms: 0 } };
    const normalBudget = clamp(Number(this.config.normalWetBudget) || 0, 0, Number(this.config.absoluteWetCeiling) || 0);
    const hardCeiling = clamp(Number(this.config.absoluteWetCeiling) || 0, 0, 1);
    let maxWetBudget = 0;
    let maxVoiceGainSum = 0;
    let sumSquares = 0;
    const hop = Math.max(1, this.control.hopSamples);
    for (let frame = 0; frame < frames; frame++) {
      const analysisFrame = Math.min(this.control.frameCount - 1, Math.floor(frame / hop));
      const nextFrame = Math.min(this.control.frameCount - 1, analysisFrame + 1);
      const fraction = (frame % hop) / hop;
      const activity = interpolate(this.control.activity, analysisFrame, nextFrame, fraction);
      const transient = interpolate(this.control.transientShare, analysisFrame, nextFrame, fraction);
      const diffuse = interpolate(this.control.diffuseShare, analysisFrame, nextFrame, fraction);
      const centroid = interpolate(this.control.spectralCentroid, analysisFrame, nextFrame, fraction);
      const wetBudget = Math.min(hardCeiling, normalBudget) * (this.config.transientProtection ? clamp(1 - 0.65 * transient + 0.12 * diffuse, 0.25, 1) : 1);
      maxWetBudget = Math.max(maxWetBudget, wetBudget);
      let gainSum = 0;
      let outputLeft = 0;
      let outputRight = 0;
      for (let voiceIndex = 0; voiceIndex < this.voices.length; voiceIndex++) {
        const voice = this.voices[voiceIndex];
        const voiceGain = wetBudget * voice.share;
        gainSum += voiceGain;
        voice.process(this.sourceLeft[frame] || 0, this.mono ? this.sourceLeft[frame] || 0 : this.sourceRight[frame] || 0, activity, centroid);
        outputLeft += voice.lastLeft * voiceGain;
        outputRight += voice.lastRight * voiceGain;
      }
      maxVoiceGainSum = Math.max(maxVoiceGainSum, gainSum);
      left[frame] = Number.isFinite(outputLeft) ? outputLeft : 0;
      right[frame] = this.mono ? left[frame] : Number.isFinite(outputRight) ? outputRight : 0;
      sumSquares += (left[frame] * left[frame] + right[frame] * right[frame]) * 0.5;
    }
    return {
      channels: [left, right],
      diagnostics: {
        maxWetBudget,
        maxVoiceGainSum,
        coherentGainFloor: coherentGainFloor(maxVoiceGainSum),
        driftRms: Math.sqrt(sumSquares / Math.max(1, frames)),
        voiceCount: this.voices.length
      }
    };
  }
}

export function renderSourceDrift({ channels, sampleRate, model, seed = 'default', config = {} } = {}) {
  return new SourceDriftRenderer({ channels, sampleRate, model, seed, config }).render();
}
