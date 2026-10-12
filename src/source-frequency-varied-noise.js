import { rngFor } from './random.js';

export const SOURCE_FREQUENCY_VARIED_NOISE_VERSION = 1;
export const DEFAULT_SOURCE_FREQUENCY_VARIED_CONFIG = Object.freeze({
  enabled: true,
  shareWithinSourceFollow: 0.25,
  frequencyUnit: 'cents',
  mapping: 'log-frequency-power-conserving',
  trajectory: 'component-hierarchical-slow-drift',
  carrierMode: 'independent',
  macroMaxCents: 7,
  macroHoldMinSeconds: 3,
  macroHoldMaxSeconds: 12,
  macroTransitionMinSeconds: 1,
  macroTransitionMaxSeconds: 5,
  sustainedSmoothMaxCents: 45,
  sustainedModulatedMaxCents: 35,
  sparseMaxCents: 25,
  transientMaxCents: 12,
  diffuseMaxCents: 60,
  componentHoldMinSeconds: 0.5,
  componentHoldMaxSeconds: 3,
  componentTransitionMinSeconds: 1,
  componentTransitionMaxSeconds: 5,
  microModulationDb: 0.5,
  controlBlock: 32,
  transientProtection: true,
  bassProtection: true,
  edgeProtection: true,
  nyquistProtection: true
});

const EPSILON = 1e-12;
const TAU = Math.PI * 2;
const clamp = (value, lo, hi) => Math.max(lo, Math.min(hi, value));

export function frequencyFromCents(frequency, cents) {
  return Number(frequency) * 2 ** (Number(cents) / 1200);
}

function smoothstep(value) {
  const x = clamp(value, 0, 1);
  return x * x * (3 - 2 * x);
}

function secondsToFrames(seconds, frameRate) {
  return Math.max(1, Math.round(Math.max(0, Number(seconds) || 0) * frameRate));
}

function trajectory({ frameCount, frameRate, rng, maxCents, holdMinSeconds, holdMaxSeconds, transitionMinSeconds, transitionMaxSeconds }) {
  const values = new Float64Array(frameCount);
  if (!frameCount || maxCents <= 0) return values;
  let frame = 0;
  let current = rng.range(-maxCents, maxCents);
  while (frame < frameCount) {
    const holdFrames = secondsToFrames(rng.range(holdMinSeconds, holdMaxSeconds), frameRate);
    const holdEnd = Math.min(frameCount, frame + holdFrames);
    for (; frame < holdEnd; frame++) values[frame] = current;
    if (frame >= frameCount) break;
    const next = rng.range(-maxCents, maxCents);
    const transitionFrames = secondsToFrames(rng.range(transitionMinSeconds, transitionMaxSeconds), frameRate);
    const transitionStart = frame;
    const transitionEnd = Math.min(frameCount, frame + transitionFrames);
    for (; frame < transitionEnd; frame++) {
      const fraction = (frame - transitionStart + 1) / Math.max(1, transitionEnd - transitionStart);
      values[frame] = current + (next - current) * smoothstep(fraction);
    }
    current = next;
  }
  return values;
}

function weightedMean(values, weights) {
  let numerator = 0;
  let denominator = 0;
  for (let i = 0; i < values.length; i++) {
    const weight = Math.max(0, weights[i] || 0);
    numerator += values[i] * weight;
    denominator += weight;
  }
  return denominator > EPSILON ? numerator / denominator : 0;
}

function fixedComponentValue(fixed, component, frame, componentCount, frameCount) {
  if (Number.isFinite(fixed)) return Number(fixed);
  if (!fixed || typeof fixed.length !== 'number') return null;
  if (fixed.length === componentCount * frameCount) return Number(fixed[component * frameCount + frame]) || 0;
  if (fixed.length === componentCount) return Number(fixed[component]) || 0;
  if (fixed.length === frameCount) return Number(fixed[frame]) || 0;
  return null;
}

function maxDepthFor(model, component, settings) {
  const temporalClass = model.temporalClass?.[component];
  const kind = model.componentKind?.[component];
  if (kind === 'transient' || temporalClass === 'transient') return Math.max(0, Number(settings.transientMaxCents) || 0);
  if (kind === 'diffuse' || temporalClass === 'diffuse') return Math.max(0, Number(settings.diffuseMaxCents) || 0);
  if (temporalClass === 'smooth') return Math.max(0, Number(settings.sustainedSmoothMaxCents) || 0);
  if (temporalClass === 'sparse') return Math.max(0, Number(settings.sparseMaxCents) || 0);
  return Math.max(0, Number(settings.sustainedModulatedMaxCents) || 0);
}

function bassProtection(frequency, settings) {
  if (!settings.bassProtection) return 1;
  if (frequency <= 80) return 0.25;
  if (frequency >= 250) return 1;
  return 0.25 + (frequency - 80) / 170 * 0.75;
}

function nyquistProtection(frequency, sampleRate, settings) {
  if (!settings.nyquistProtection) return 1;
  const normalEdge = sampleRate * 0.35;
  const hardEdge = sampleRate * 0.47;
  if (frequency <= normalEdge) return 1;
  return clamp((hardEdge - frequency) / Math.max(EPSILON, hardEdge - normalEdge), 0, 1);
}

function edgeProtection(band, bandCount, settings) {
  if (!settings.edgeProtection || bandCount <= 1) return 1;
  const lower = band / 2;
  const upper = (bandCount - 1 - band) / 2;
  return clamp(Math.min(lower, upper), 0, 1);
}

function addScatter(buffer, index, value) {
  buffer[index] += Number.isFinite(value) ? value : 0;
}

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

function coefficientForSeconds(seconds, sampleRate) {
  return 1 - Math.exp(-1 / Math.max(1, seconds * sampleRate));
}

function rms(channels) {
  if (!channels?.length || !channels[0]?.length) return 0;
  let sum = 0;
  const frames = channels[0].length;
  for (let i = 0; i < frames; i++) {
    for (const channel of channels) {
      const value = channel[i] || 0;
      sum += value * value;
    }
  }
  return Math.sqrt(sum / Math.max(1, frames * channels.length));
}

export class FrequencyDriftTimeline {
  constructor({ model, seed = 'default', config = {} } = {}) {
    this.model = model;
    this.seed = seed;
    this.config = { ...DEFAULT_SOURCE_FREQUENCY_VARIED_CONFIG, ...config };
    this.frameCount = Math.max(0, model?.frameCount || 0);
    this.componentCount = Math.max(0, model?.componentCount || 0);
    this.cents = new Float32Array(this.componentCount * this.frameCount);
    this.macroCents = new Float32Array(this.frameCount);
    this.logBandCenters = new Float64Array(Math.max(0, model?.bandCount || 0));
    for (let band = 0; band < this.logBandCenters.length; band++) this.logBandCenters[band] = Math.log(Math.max(EPSILON, model.bandCenters[band]));
    this.diagnosticFrameSeen = new Uint8Array(this.frameCount);
    this.diagnostics = {
      version: SOURCE_FREQUENCY_VARIED_NOISE_VERSION,
      componentCount: this.componentCount,
      maxPositiveCents: 0,
      maxNegativeCents: 0,
      rmsCents: 0,
      edgeProtectionActivations: 0,
      maxPowerConservationError: 0,
      meanSpectralCentroidShiftCents: 0,
      maxSpectralCentroidShiftCents: 0
    };
    this.build();
  }

  build() {
    const model = this.model;
    if (!model || !this.frameCount || !this.componentCount) return;
    const settings = this.config;
    const frameRate = model.sampleRate / Math.max(1, model.hopSamples);
    const fixedMacro = Number.isFinite(settings.fixedMacroCents) ? Number(settings.fixedMacroCents) : null;
    const macro = fixedMacro === null
      ? trajectory({
        frameCount: this.frameCount,
        frameRate,
        rng: rngFor(this.seed, SOURCE_FREQUENCY_VARIED_NOISE_VERSION, 'frequency-drift-target', 'macro'),
        maxCents: Math.max(0, Number(settings.macroMaxCents) || 0),
        holdMinSeconds: Math.max(0, Number(settings.macroHoldMinSeconds) || 0),
        holdMaxSeconds: Math.max(0, Number(settings.macroHoldMaxSeconds) || 0),
        transitionMinSeconds: Math.max(0, Number(settings.macroTransitionMinSeconds) || 0),
        transitionMaxSeconds: Math.max(0, Number(settings.macroTransitionMaxSeconds) || 0)
      })
      : new Float64Array(this.frameCount).fill(fixedMacro);
    this.macroCents.set(macro);
    const cellCount = model.bandCount * model.frameCount;
    const frameWeights = new Float64Array(this.frameCount);
    let totalTrajectoryWeight = 0;
    for (let component = 0; component < this.componentCount; component++) {
      for (let frame = 0; frame < this.frameCount; frame++) {
        let total = 0;
        for (let band = 0; band < model.bandCount; band++) total += model.power[component * cellCount + band * this.frameCount + frame] || 0;
        frameWeights[frame] = total;
      }
      const depth = maxDepthFor(model, component, settings);
      const componentRng = rngFor(this.seed, SOURCE_FREQUENCY_VARIED_NOISE_VERSION, 'frequency-drift-target', 'component', component);
      const componentTrajectory = trajectory({
        frameCount: this.frameCount,
        frameRate,
        rng: componentRng,
        maxCents: depth,
        holdMinSeconds: Math.max(0, Number(settings.componentHoldMinSeconds) || 0),
        holdMaxSeconds: Math.max(0, Number(settings.componentHoldMaxSeconds) || 0),
        transitionMinSeconds: Math.max(0, Number(settings.componentTransitionMinSeconds) || 0),
        transitionMaxSeconds: Math.max(0, Number(settings.componentTransitionMaxSeconds) || 0)
      });
      const fixed = settings.fixedComponentCents;
      const fixedValues = fixed !== undefined && fixed !== null;
      const values = new Float64Array(this.frameCount);
      for (let frame = 0; frame < this.frameCount; frame++) {
        const fixedValue = fixedValues ? fixedComponentValue(fixed, component, frame, this.componentCount, this.frameCount) : null;
        values[frame] = fixedValue === null ? macro[frame] + componentTrajectory[frame] : fixedValue;
      }
      if (!fixedValues) {
        const mean = weightedMean(values, frameWeights);
        const maximum = depth + Math.max(0, Number(settings.macroMaxCents) || 0);
        for (let frame = 0; frame < this.frameCount; frame++) values[frame] = clamp(values[frame] - mean, -maximum, maximum);
      }
      for (let frame = 0; frame < this.frameCount; frame++) {
        const value = values[frame];
        this.cents[component * this.frameCount + frame] = value;
        this.diagnostics.maxPositiveCents = Math.max(this.diagnostics.maxPositiveCents, value);
        this.diagnostics.maxNegativeCents = Math.min(this.diagnostics.maxNegativeCents, value);
        this.diagnostics.rmsCents += value * value * Math.max(0, frameWeights[frame]);
      }
      totalTrajectoryWeight += frameWeights.reduce((sum, value) => sum + value, 0);
    }
    this.diagnostics.rmsCents = Math.sqrt(this.diagnostics.rmsCents / Math.max(EPSILON, totalTrajectoryWeight));
  }

  centsAt(component, frame) {
    if (!this.frameCount) return 0;
    return this.cents[component * this.frameCount + clamp(frame, 0, this.frameCount - 1)] || 0;
  }

  effectiveCents(component, band, frame) {
    const model = this.model;
    const frequency = model.bandCenters[band];
    const settings = this.config;
    let factor = 1;
    factor *= bassProtection(frequency, settings);
    factor *= nyquistProtection(frequency, model.sampleRate, settings);
    factor *= edgeProtection(band, model.bandCount, settings);
    if (factor < 0.999) this.diagnostics.edgeProtectionActivations++;
    return this.centsAt(component, frame) * factor;
  }

  createFrameBuffers() {
    const size = this.componentCount * Math.max(0, this.model?.bandCount || 0);
    return {
      power: new Float64Array(size),
      powerLeft: new Float64Array(size),
      powerRight: new Float64Array(size),
      crossPower: new Float64Array(size)
    };
  }

  prepareWarpedFrame(frame, buffers = this.createFrameBuffers()) {
    const model = this.model;
    const frameIndex = clamp(frame, 0, Math.max(0, this.frameCount - 1));
    buffers.power.fill(0);
    buffers.powerLeft.fill(0);
    buffers.powerRight.fill(0);
    buffers.crossPower.fill(0);
    if (!model || !this.frameCount || !model.bandCount) return buffers;
    const cellCount = model.bandCount * model.frameCount;
    let frameSourcePower = 0;
    let frameWarpedPower = 0;
    let frameSourceCentroid = 0;
    let frameWarpedCentroid = 0;
    for (let component = 0; component < this.componentCount; component++) {
      let sourceComponentPower = 0;
      let warpedComponentPower = 0;
      let sourceComponentCentroid = 0;
      let warpedComponentCentroid = 0;
      for (let band = 0; band < model.bandCount; band++) {
        const sourceIndex = component * cellCount + band * model.frameCount + frameIndex;
        const power = Math.max(0, model.power[sourceIndex] || 0);
        const powerLeft = Math.max(0, model.powerLeft[sourceIndex] || 0);
        const powerRight = Math.max(0, model.powerRight[sourceIndex] || 0);
        const crossPower = model.crossPower[sourceIndex] || 0;
        const cents = this.effectiveCents(component, band, frameIndex);
        const targetFrequency = frequencyFromCents(model.bandCenters[band], cents);
        let lower = 0;
        let upper = model.bandCount - 1;
        if (targetFrequency > model.bandCenters[0] && targetFrequency < model.bandCenters[model.bandCount - 1]) {
          while (upper - lower > 1) {
            const middle = (lower + upper) >> 1;
            if (model.bandCenters[middle] <= targetFrequency) lower = middle;
            else upper = middle;
          }
        } else if (targetFrequency >= model.bandCenters[model.bandCount - 1]) {
          lower = model.bandCount - 1;
          upper = lower;
        }
        const lambda = upper === lower
          ? 0
          : clamp((Math.log(Math.max(EPSILON, targetFrequency)) - this.logBandCenters[lower]) / Math.max(EPSILON, this.logBandCenters[upper] - this.logBandCenters[lower]), 0, 1);
        const lowerIndex = component * model.bandCount + lower;
        const upperIndex = component * model.bandCount + upper;
        addScatter(buffers.power, lowerIndex, power * (1 - lambda));
        addScatter(buffers.powerLeft, lowerIndex, powerLeft * (1 - lambda));
        addScatter(buffers.powerRight, lowerIndex, powerRight * (1 - lambda));
        addScatter(buffers.crossPower, lowerIndex, crossPower * (1 - lambda));
        if (upper !== lower) {
          addScatter(buffers.power, upperIndex, power * lambda);
          addScatter(buffers.powerLeft, upperIndex, powerLeft * lambda);
          addScatter(buffers.powerRight, upperIndex, powerRight * lambda);
          addScatter(buffers.crossPower, upperIndex, crossPower * lambda);
        }
        sourceComponentPower += power;
        sourceComponentCentroid += power * model.bandCenters[band];
        warpedComponentCentroid += power * targetFrequency;
      }
      frameSourcePower += sourceComponentPower;
      frameWarpedPower += warpedComponentPower;
      frameSourceCentroid += sourceComponentCentroid;
      frameWarpedCentroid += warpedComponentCentroid;
    }
    frameWarpedPower = 0;
    frameWarpedCentroid = 0;
    for (let component = 0; component < this.componentCount; component++) {
      for (let band = 0; band < model.bandCount; band++) {
        const index = component * model.bandCount + band;
        frameWarpedPower += buffers.power[index];
        frameWarpedCentroid += buffers.power[index] * model.bandCenters[band];
      }
    }
    for (let component = 0; component < this.componentCount; component++) {
      for (let band = 0; band < model.bandCount; band++) {
        const index = component * model.bandCount + band;
        const limit = Math.sqrt(Math.max(0, buffers.powerLeft[index]) * Math.max(0, buffers.powerRight[index]));
        buffers.crossPower[index] = clamp(buffers.crossPower[index], -limit, limit);
      }
    }
    const relativePowerError = Math.abs(frameWarpedPower - frameSourcePower) / Math.max(EPSILON, frameSourcePower);
    this.diagnostics.maxPowerConservationError = Math.max(this.diagnostics.maxPowerConservationError, relativePowerError);
    if (frameSourcePower > EPSILON) {
      const sourceCentroid = frameSourceCentroid / frameSourcePower;
      const warpedCentroid = frameWarpedCentroid / frameWarpedPower;
      const shift = 1200 * Math.log2(Math.max(EPSILON, warpedCentroid) / Math.max(EPSILON, sourceCentroid));
      if (!this.diagnosticFrameSeen[frameIndex]) this.diagnostics.meanSpectralCentroidShiftCents += shift * frameSourcePower;
      this.diagnostics.maxSpectralCentroidShiftCents = Math.max(this.diagnostics.maxSpectralCentroidShiftCents, Math.abs(shift));
    }
    this.diagnosticFrameSeen[frameIndex] = 1;
    return buffers;
  }

  finalizeDiagnostics() {
    let totalPower = 0;
    const model = this.model;
    const cellCount = (model?.bandCount || 0) * (model?.frameCount || 0);
    if (model) for (let component = 0; component < this.componentCount; component++) {
      for (let frame = 0; frame < this.frameCount; frame++) {
        for (let band = 0; band < model.bandCount; band++) totalPower += model.power[component * cellCount + band * this.frameCount + frame] || 0;
      }
    }
    this.diagnostics.meanSpectralCentroidShiftCents /= Math.max(EPSILON, totalPower);
    return { ...this.diagnostics };
  }
}

export class FrequencyVariedSpectrumNoiseRenderer {
  constructor({ model, seed = 'default', config = {} } = {}) {
    this.model = model;
    this.seed = seed;
    this.config = { ...DEFAULT_SOURCE_FREQUENCY_VARIED_CONFIG, ...config };
    this.timeline = new FrequencyDriftTimeline({ model, seed, config: this.config });
    this.filters = [];
    this.carriersLeft = [];
    this.carriersRight = [];
    this.carrierScale = new Float64Array(model.componentCount * model.bandCount);
    this.gainLeft = new Float64Array(model.componentCount * model.bandCount);
    this.gainRight = new Float64Array(model.componentCount * model.bandCount);
    this.modulation = new Float64Array(model.componentCount).fill(1);
    this.modulationTarget = new Float64Array(model.componentCount).fill(1);
    this.modulationRemaining = new Uint32Array(model.componentCount).fill(Math.max(1, Math.floor(Number(this.config.controlBlock) || 32)));
    this.modulationRng = [];
    const spacing = model.bandCount > 1 ? model.bandCenters[1] / model.bandCenters[0] : 2;
    const q = clamp(1 / (2 * Math.sinh(Math.log(spacing) * 0.5)), 0.7, 3.5);
    for (let component = 0; component < model.componentCount; component++) {
      this.modulationRng.push(rngFor(seed, SOURCE_FREQUENCY_VARIED_NOISE_VERSION, 'frequency-varied-micro-mod', component));
      for (let band = 0; band < model.bandCount; band++) {
        const index = component * model.bandCount + band;
        const leftFilter = new BiquadBandPass(model.sampleRate, model.bandCenters[band], q);
        const rightFilter = new BiquadBandPass(model.sampleRate, model.bandCenters[band], q);
        this.filters.push({ left: leftFilter, right: rightFilter });
        this.carriersLeft.push(rngFor(seed, SOURCE_FREQUENCY_VARIED_NOISE_VERSION, 'frequency-varied-carrier', component, band, 'left'));
        this.carriersRight.push(rngFor(seed, SOURCE_FREQUENCY_VARIED_NOISE_VERSION, 'frequency-varied-carrier', component, band, 'right'));
        this.carrierScale[index] = 1 / Math.sqrt(this.impulseEnergy(leftFilter));
      }
    }
  }

  impulseEnergy(filter, length = 4096) {
    const copy = new BiquadBandPass(this.model.sampleRate, 100, 1);
    copy.b0 = filter.b0;
    copy.b1 = filter.b1;
    copy.b2 = filter.b2;
    copy.a1 = filter.a1;
    copy.a2 = filter.a2;
    let energy = 0;
    for (let i = 0; i < length; i++) {
      const value = copy.process(i === 0 ? 1 : 0);
      energy += value * value;
    }
    return Math.max(EPSILON, energy);
  }

  dynamicsFor(component) {
    switch (this.model.temporalClass[component]) {
      case 'transient': return [0.004, 0.055];
      case 'sparse': return [0.01, 0.1];
      case 'smooth': return [0.04, 0.35];
      case 'diffuse': return [0.08, 0.5];
      default: return [0.025, 0.22];
    }
  }

  render(frameCount = this.model.sampleCount) {
    const frames = Math.max(0, Math.min(Number(frameCount) || 0, this.model.sampleCount));
    const left = new Float32Array(frames);
    const right = new Float32Array(frames);
    if (!frames || !this.model.frameCount) return [left, right];
    const current = this.timeline.prepareWarpedFrame(0);
    const next = this.timeline.prepareWarpedFrame(Math.min(1, this.model.frameCount - 1));
    const attackCoefficient = new Float64Array(this.model.componentCount);
    const releaseCoefficient = new Float64Array(this.model.componentCount);
    for (let component = 0; component < this.model.componentCount; component++) {
      const dynamics = this.dynamicsFor(component);
      attackCoefficient[component] = coefficientForSeconds(dynamics[0], this.model.sampleRate);
      releaseCoefficient[component] = coefficientForSeconds(dynamics[1], this.model.sampleRate);
    }
    let currentFrame = 0;
    const block = Math.max(1, Math.floor(Number(this.config.controlBlock) || 32));
    for (let frame = 0; frame < frames; frame++) {
      const analysisFrame = Math.min(this.model.frameCount - 1, Math.floor(frame / this.model.hopSamples));
      if (analysisFrame !== currentFrame) {
        current.power.set(next.power);
        current.powerLeft.set(next.powerLeft);
        current.powerRight.set(next.powerRight);
        current.crossPower.set(next.crossPower);
        this.timeline.prepareWarpedFrame(Math.min(this.model.frameCount - 1, analysisFrame + 1), next);
        currentFrame = analysisFrame;
      }
      const fraction = this.model.hopSamples ? (frame % this.model.hopSamples) / this.model.hopSamples : 0;
      let outputLeft = 0;
      let outputRight = 0;
      for (let component = 0; component < this.model.componentCount; component++) {
        if (--this.modulationRemaining[component] <= 0) {
          const depth = Number(this.config.microModulationDb) || 0;
          this.modulationTarget[component] = 10 ** (((this.modulationRng[component].next() * 2 - 1) * depth) / 20);
          this.modulationRemaining[component] = block;
        }
        this.modulation[component] += (this.modulationTarget[component] - this.modulation[component]) * (1 / block);
        for (let band = 0; band < this.model.bandCount; band++) {
          const index = component * this.model.bandCount + band;
          const leftPower = Math.max(0, current.powerLeft[index] + (next.powerLeft[index] - current.powerLeft[index]) * fraction);
          const rightPower = Math.max(0, current.powerRight[index] + (next.powerRight[index] - current.powerRight[index]) * fraction);
          const crossPower = current.crossPower[index] + (next.crossPower[index] - current.crossPower[index]) * fraction;
          const targetLeft = Math.sqrt(leftPower);
          const targetRight = Math.sqrt(rightPower);
          const leftCoefficient = targetLeft > this.gainLeft[index] ? attackCoefficient[component] : releaseCoefficient[component];
          const rightCoefficient = targetRight > this.gainRight[index] ? attackCoefficient[component] : releaseCoefficient[component];
          this.gainLeft[index] += (targetLeft - this.gainLeft[index]) * leftCoefficient;
          this.gainRight[index] += (targetRight - this.gainRight[index]) * rightCoefficient;
          const correlation = clamp(crossPower / Math.sqrt(Math.max(EPSILON, leftPower * rightPower)), -1, 1);
          const carrierU = this.filters[index].left.process(this.carriersLeft[index].next() * 2 - 1) * this.carrierScale[index];
          const carrierV = this.filters[index].right.process(this.carriersRight[index].next() * 2 - 1) * this.carrierScale[index];
          const orthogonal = Math.sqrt(Math.max(0, 1 - correlation * correlation));
          const modulation = this.modulation[component];
          outputLeft += carrierU * this.gainLeft[index] * modulation;
          outputRight += (correlation * carrierU + orthogonal * carrierV) * this.gainRight[index] * modulation;
        }
      }
      left[frame] = outputLeft;
      right[frame] = outputRight;
    }
    if (this.model.mono) right.set(left);
    return [left, right];
  }

  getDiagnostics() {
    return this.timeline.finalizeDiagnostics();
  }
}

export function renderFrequencyVariedNoise({ model, seed = 'default', config = {}, onProgress } = {}) {
  onProgress?.({ value: 0.78, message: 'Preparing frequency-varied source layers…' });
  const renderer = new FrequencyVariedSpectrumNoiseRenderer({ model, seed, config });
  const channels = renderer.render(model?.sampleCount || 0);
  const diagnostics = renderer.getDiagnostics();
  onProgress?.({ value: 0.84, message: 'Frequency-varied source layers ready.' });
  return {
    channels,
    diagnostics,
    sourceFrequencyVariedNoiseVersion: SOURCE_FREQUENCY_VARIED_NOISE_VERSION
  };
}

export function combineIndependentLayersInPlace(destination, other, share = 0.25) {
  const amount = clamp(Number(share) || 0, 0, 1);
  const destinationRms = Math.max(EPSILON, rms(destination));
  const otherRms = Math.max(EPSILON, rms(other));
  const destinationGain = Math.sqrt(1 - amount) / destinationRms;
  const otherGain = Math.sqrt(amount) / otherRms;
  const channels = Math.max(destination?.length || 0, other?.length || 0);
  const frames = destination?.[0]?.length || other?.[0]?.length || 0;
  for (let channel = 0; channel < channels; channel++) {
    const output = destination?.[Math.min(channel, (destination?.length || 1) - 1)];
    const addition = other?.[Math.min(channel, (other?.length || 1) - 1)];
    if (!output) continue;
    for (let frame = 0; frame < frames; frame++) output[frame] = (output[frame] || 0) * destinationGain + (addition?.[frame] || 0) * otherGain;
  }
  return destination;
}
