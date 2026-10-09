import { analyzeSourceSpectrumTimeline } from './source-component-analysis.js';
import { factorizeNmf } from './nonnegative-factorization.js';
import { rngFor } from './random.js';

export const SOURCE_SPECTRUM_NOISE_VERSION = 2;
export const SOURCE_COMPONENT_MODEL_VERSION = 1;
export const DEFAULT_SOURCE_SPECTRUM_POWER_SHARE = 0.35;
export const DEFAULT_MULTI_COMPONENT_CONFIG = Object.freeze({
  analysisBands: 24,
  frameMs: 20,
  componentRank: 4,
  transientComponent: true,
  diffuseComponent: true,
  templateTrainingFrames: 4096,
  nmfIterations: 60,
  activationIterations: 10,
  microModulationDb: 0.5
});

const EPSILON = 1e-12;
const TAU = Math.PI * 2;
const clamp = (value, lo, hi) => Math.max(lo, Math.min(hi, value));

class BiquadBandPass {
  constructor(sampleRate, frequency, q) {
    this.sampleRate = sampleRate;
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

  impulseEnergy(length = 4096) {
    const filter = new BiquadBandPass(this.sampleRate || 48000, 100, 1);
    filter.b0 = this.b0;
    filter.b1 = this.b1;
    filter.b2 = this.b2;
    filter.a1 = this.a1;
    filter.a2 = this.a2;
    let energy = 0;
    for (let i = 0; i < length; i++) {
      const output = filter.process(i === 0 ? 1 : 0);
      energy += output * output;
    }
    return Math.max(EPSILON, energy);
  }
}

function coefficientForSeconds(seconds, sampleRate) {
  return 1 - Math.exp(-1 / Math.max(1, seconds * sampleRate));
}

function componentSortKey(model, component) {
  const kind = model.componentKind[component];
  if (kind === 'sustained') return 0;
  if (kind === 'transient') return 1;
  return 2;
}

function orderComponents(model) {
  const order = Array.from({ length: model.componentCount }, (_, component) => component);
  order.sort((left, right) => {
    const kindDifference = componentSortKey(model, left) - componentSortKey(model, right);
    if (kindDifference) return kindDifference;
    const centroidDifference = model.componentCentroid[left] - model.componentCentroid[right];
    if (centroidDifference) return centroidDifference;
    return left - right;
  });
  const fields = ['power', 'powerLeft', 'powerRight', 'crossPower'];
  for (const field of fields) {
    const original = model[field];
    const reordered = new Float32Array(original.length);
    for (let newComponent = 0; newComponent < order.length; newComponent++) {
      const oldComponent = order[newComponent];
      for (let index = 0; index < model.bandCount * model.frameCount; index++) reordered[newComponent * model.bandCount * model.frameCount + index] = original[oldComponent * model.bandCount * model.frameCount + index];
    }
    model[field] = reordered;
  }
  const oldKindsBeforeSort = model.componentKind.slice();
  const sustainedOrder = order.filter(component => oldKindsBeforeSort[component] === 'sustained');
  const sustainedRank = sustainedOrder.length;
  if (model.templates && model.activations && sustainedRank > 0) {
    const oldTemplates = model.templates;
    const oldActivations = model.activations;
    const reorderedTemplates = new Float32Array(oldTemplates.length);
    const reorderedActivations = new Float32Array(oldActivations.length);
    for (let newComponent = 0; newComponent < sustainedRank; newComponent++) {
      const oldComponent = sustainedOrder[newComponent];
      for (let band = 0; band < model.bandCount; band++) reorderedTemplates[band * sustainedRank + newComponent] = oldTemplates[band * sustainedRank + oldComponent];
      for (let frame = 0; frame < model.frameCount; frame++) reorderedActivations[newComponent * model.frameCount + frame] = oldActivations[oldComponent * model.frameCount + frame];
    }
    model.templates = reorderedTemplates;
    model.activations = reorderedActivations;
  }
  const oldKinds = model.componentKind.slice();
  const oldCentroids = model.componentCentroid.slice();
  const oldClasses = model.temporalClass.slice();
  for (let component = 0; component < order.length; component++) {
    model.componentKind[component] = oldKinds[order[component]];
    model.componentCentroid[component] = oldCentroids[order[component]];
    model.temporalClass[component] = oldClasses[order[component]];
  }
}

function classifyActivation(values, start, length, kind) {
  if (kind === 'transient') return 'transient';
  if (kind === 'diffuse') return 'diffuse';
  let maximum = 0;
  let sum = 0;
  let sumSquares = 0;
  let activeCount = 0;
  for (let i = 0; i < length; i++) {
    const value = values[start + i] || 0;
    maximum = Math.max(maximum, value);
    sum += value;
    sumSquares += value * value;
    if (value > maximum * 0.2) activeCount++;
  }
  const activeFraction = maximum > EPSILON ? activeCount / length : 0;
  const mean = sum / Math.max(1, length);
  const variance = Math.max(0, sumSquares / Math.max(1, length) - mean * mean);
  if (activeFraction < 0.3) return 'sparse';
  if (Math.sqrt(variance) / Math.max(EPSILON, mean) < 0.25) return 'smooth';
  return 'modulated';
}

function buildComponentModel(timeline, nmf, config) {
  const bands = timeline.bandCount;
  const frameCount = timeline.frameCount;
  const sustainedRank = nmf.componentCount;
  const componentCount = sustainedRank + (config.transientComponent ? 1 : 0) + (config.diffuseComponent ? 1 : 0);
  const cellCount = bands * frameCount;
  const power = new Float32Array(componentCount * cellCount);
  const powerLeft = new Float32Array(componentCount * cellCount);
  const powerRight = new Float32Array(componentCount * cellCount);
  const crossPower = new Float32Array(componentCount * cellCount);
  const componentKind = new Array(componentCount);
  const componentCentroid = new Array(componentCount).fill(0);
  const temporalClass = new Array(componentCount);

  for (let component = 0; component < sustainedRank; component++) componentKind[component] = 'sustained';
  const transientComponentIndex = config.transientComponent ? sustainedRank : -1;
  const diffuseComponentIndex = config.diffuseComponent ? sustainedRank + (config.transientComponent ? 1 : 0) : -1;
  if (transientComponentIndex >= 0) componentKind[transientComponentIndex] = 'transient';
  if (diffuseComponentIndex >= 0) componentKind[diffuseComponentIndex] = 'diffuse';

  for (let band = 0; band < bands; band++) {
    for (let frame = 0; frame < frameCount; frame++) {
      const sourceIndex = band * frameCount + frame;
      const sourcePower = timeline.framePower[sourceIndex];
      const sustainedPower = sourcePower * timeline.sustainedMask[sourceIndex];
      let reconstruction = 0;
      for (let component = 0; component < sustainedRank; component++) reconstruction += nmf.templates[band * sustainedRank + component] * nmf.activations[component * frameCount + frame];
      for (let component = 0; component < sustainedRank; component++) {
        const contribution = nmf.templates[band * sustainedRank + component] * nmf.activations[component * frameCount + frame];
        const ratio = reconstruction > EPSILON ? contribution / reconstruction : 0;
        const target = sustainedPower * ratio;
        const destination = component * cellCount + sourceIndex;
        const mask = sourcePower > EPSILON ? target / sourcePower : 0;
        power[destination] = target;
        powerLeft[destination] = timeline.powerLeft[sourceIndex] * mask;
        powerRight[destination] = timeline.powerRight[sourceIndex] * mask;
        crossPower[destination] = timeline.crossPower[sourceIndex] * mask;
      }
      if (config.transientComponent) {
        const destination = transientComponentIndex;
        const mask = timeline.transientMask[sourceIndex];
        const target = sourcePower * mask;
        const index = destination * cellCount + sourceIndex;
        power[index] = target;
        powerLeft[index] = timeline.powerLeft[sourceIndex] * mask;
        powerRight[index] = timeline.powerRight[sourceIndex] * mask;
        crossPower[index] = timeline.crossPower[sourceIndex] * mask;
      }
      if (config.diffuseComponent) {
        const destination = diffuseComponentIndex;
        const mask = timeline.diffuseMask[sourceIndex];
        const target = sourcePower * mask;
        const index = destination * cellCount + sourceIndex;
        power[index] = target;
        powerLeft[index] = timeline.powerLeft[sourceIndex] * mask;
        powerRight[index] = timeline.powerRight[sourceIndex] * mask;
        crossPower[index] = timeline.crossPower[sourceIndex] * mask;
      }
    }
  }

  for (let component = 0; component < componentCount; component++) {
    let weightedFrequency = 0;
    let total = 0;
    for (let frame = 0; frame < frameCount; frame++) {
      let framePower = 0;
      for (let band = 0; band < bands; band++) framePower += power[component * cellCount + band * frameCount + frame];
      total += framePower;
    }
    for (let band = 0; band < bands; band++) {
      let bandTotal = 0;
      for (let frame = 0; frame < frameCount; frame++) bandTotal += power[component * cellCount + band * frameCount + frame];
      weightedFrequency += timeline.bandCenters[band] * bandTotal;
    }
    componentCentroid[component] = weightedFrequency / Math.max(EPSILON, total);
    const activation = new Float32Array(frameCount);
    for (let frame = 0; frame < frameCount; frame++) {
      for (let band = 0; band < bands; band++) activation[frame] += power[component * cellCount + band * frameCount + frame];
    }
    temporalClass[component] = classifyActivation(activation, 0, frameCount, componentKind[component]);
  }

  const model = {
    sourceSpectrumNoiseVersion: SOURCE_SPECTRUM_NOISE_VERSION,
    sourceComponentModelVersion: SOURCE_COMPONENT_MODEL_VERSION,
    sampleRate: timeline.sampleRate,
    frameMs: timeline.frameMs,
    hopSamples: timeline.hopSamples,
    sampleCount: timeline.sampleCount,
    frameCount,
    bandCount: bands,
    bandCenters: timeline.bandCenters,
    componentCount,
    power,
    powerLeft,
    powerRight,
    crossPower,
    componentKind,
    componentCentroid,
    temporalClass,
    sustainedMask: timeline.sustainedMask,
    transientMask: timeline.transientMask,
    diffuseMask: timeline.diffuseMask,
    templates: nmf.templates,
    activations: nmf.activations,
    nmfCosts: nmf.costs
  };
  orderComponents(model);
  return model;
}

export class SourceSpectrumNoiseModel {
  static analyze({ channels, sampleRate, seed = 'default', config = {}, onProgress } = {}) {
    const settings = { ...DEFAULT_MULTI_COMPONENT_CONFIG, ...config };
    onProgress?.({ value: 0.15, message: 'Analyzing source structure…' });
    const timeline = analyzeSourceSpectrumTimeline(channels, sampleRate, settings);
    const sustained = new Float32Array(timeline.framePower.length);
    for (let i = 0; i < sustained.length; i++) sustained[i] = timeline.framePower[i] * timeline.sustainedMask[i];
    onProgress?.({ value: 0.45, message: 'Discovering spectral components…' });
    const nmf = factorizeNmf(sustained, timeline.bandCount, timeline.frameCount, {
      rank: settings.componentRank,
      trainingMaxFrames: settings.templateTrainingFrames,
      iterations: settings.nmfIterations,
      activationIterations: settings.activationIterations
    });
    const model = buildComponentModel(timeline, nmf, settings);
    model.seed = seed;
    onProgress?.({ value: 0.7, message: 'Preparing component-specific stochastic layers…' });
    return model;
  }
}

function interpolate(values, index, nextIndex, fraction) {
  return values[index] + (values[nextIndex] - values[index]) * fraction;
}

export class MultiComponentSpectrumNoiseRenderer {
  constructor({ model, seed = 'default', controlBlock = 32, microModulationDb = DEFAULT_MULTI_COMPONENT_CONFIG.microModulationDb } = {}) {
    this.model = model;
    this.seed = seed;
    this.controlBlock = Math.max(1, Math.floor(Number(controlBlock) || 32));
    this.microModulationDb = Number(microModulationDb) || 0;
    this.filters = [];
    this.carriersLeft = [];
    this.carriersRight = [];
    this.carrierScale = new Float64Array(model.componentCount * model.bandCount);
    this.gainLeft = new Float64Array(model.componentCount * model.bandCount);
    this.gainRight = new Float64Array(model.componentCount * model.bandCount);
    this.modulation = new Float64Array(model.componentCount);
    this.modulationTarget = new Float64Array(model.componentCount);
    this.modulationRemaining = new Uint32Array(model.componentCount);
    this.attackCoefficient = new Float64Array(model.componentCount);
    this.releaseCoefficient = new Float64Array(model.componentCount);
    this.modulationRng = [];
    const spacing = model.bandCount > 1 ? model.bandCenters[1] / model.bandCenters[0] : 2;
    const q = clamp(1 / (2 * Math.sinh(Math.log(spacing) * 0.5)), 0.7, 3.5);
    for (let component = 0; component < model.componentCount; component++) {
      this.modulation[component] = 1;
      this.modulationTarget[component] = 1;
      this.modulationRemaining[component] = this.controlBlock;
      const dynamics = this.dynamicsFor(component);
      this.attackCoefficient[component] = coefficientForSeconds(dynamics[0], model.sampleRate);
      this.releaseCoefficient[component] = coefficientForSeconds(dynamics[1], model.sampleRate);
      this.modulationRng.push(rngFor(seed, SOURCE_SPECTRUM_NOISE_VERSION, 'latent-modulation', component));
      for (let band = 0; band < model.bandCount; band++) {
        const index = component * model.bandCount + band;
        const frequency = model.bandCenters[band];
        const leftFilter = new BiquadBandPass(model.sampleRate, frequency, q);
        const rightFilter = new BiquadBandPass(model.sampleRate, frequency, q);
        this.filters.push({ left: leftFilter, right: rightFilter });
        this.carriersLeft.push(rngFor(seed, SOURCE_SPECTRUM_NOISE_VERSION, 'latent-carrier', component, band, 'left'));
        this.carriersRight.push(rngFor(seed, SOURCE_SPECTRUM_NOISE_VERSION, 'latent-carrier', component, band, 'right'));
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
    const left = new Float32Array(frameCount);
    const right = new Float32Array(frameCount);
    this.processBlock(left, right, frameCount);
    return [left, right];
  }

  processBlock(outputLeft, outputRight, frameCount = outputLeft.length) {
    const frames = Math.min(frameCount, outputLeft.length, outputRight?.length ?? outputLeft.length, this.model.sampleCount);
    const cellCount = this.model.bandCount * this.model.frameCount;
    for (let frame = 0; frame < frames; frame++) {
      const analysisFrame = Math.min(this.model.frameCount - 1, Math.floor(frame / this.model.hopSamples));
      const nextFrame = Math.min(this.model.frameCount - 1, analysisFrame + 1);
      const fraction = this.model.hopSamples ? (frame % this.model.hopSamples) / this.model.hopSamples : 0;
      let left = 0;
      let right = 0;
      for (let component = 0; component < this.model.componentCount; component++) {
        if (--this.modulationRemaining[component] <= 0) {
          const depth = this.microModulationDb;
          this.modulationTarget[component] = 10 ** (((this.modulationRng[component].next() * 2 - 1) * depth) / 20);
          this.modulationRemaining[component] = this.controlBlock;
        }
        this.modulation[component] += (this.modulationTarget[component] - this.modulation[component]) * (1 / this.controlBlock);
        const attack = this.attackCoefficient[component];
        const release = this.releaseCoefficient[component];
        for (let band = 0; band < this.model.bandCount; band++) {
          const filterIndex = component * this.model.bandCount + band;
          const cell = band * this.model.frameCount + analysisFrame;
          const nextCell = band * this.model.frameCount + nextFrame;
          const targetLeft = Math.sqrt(Math.max(0, interpolate(this.model.powerLeft, component * cellCount + cell, component * cellCount + nextCell, fraction)));
          const targetRight = Math.sqrt(Math.max(0, interpolate(this.model.powerRight, component * cellCount + cell, component * cellCount + nextCell, fraction)));
          const gainIndex = filterIndex;
          const leftCoefficient = targetLeft > this.gainLeft[gainIndex] ? attack : release;
          const rightCoefficient = targetRight > this.gainRight[gainIndex] ? attack : release;
          this.gainLeft[gainIndex] += (targetLeft - this.gainLeft[gainIndex]) * leftCoefficient;
          this.gainRight[gainIndex] += (targetRight - this.gainRight[gainIndex]) * rightCoefficient;
          const sourceLeftPower = Math.max(EPSILON, interpolate(this.model.powerLeft, component * cellCount + cell, component * cellCount + nextCell, fraction));
          const sourceRightPower = Math.max(EPSILON, interpolate(this.model.powerRight, component * cellCount + cell, component * cellCount + nextCell, fraction));
          const sourceCrossPower = interpolate(this.model.crossPower, component * cellCount + cell, component * cellCount + nextCell, fraction);
          const correlation = clamp(sourceCrossPower / Math.sqrt(sourceLeftPower * sourceRightPower), -1, 1);
          const carrierU = this.filters[filterIndex].left.process(this.carriersLeft[filterIndex].next() * 2 - 1) * this.carrierScale[filterIndex];
          const carrierV = this.filters[filterIndex].right.process(this.carriersRight[filterIndex].next() * 2 - 1) * this.carrierScale[filterIndex];
          const orthogonal = Math.sqrt(Math.max(0, 1 - correlation * correlation));
          const modulation = this.modulation[component];
          left += carrierU * this.gainLeft[gainIndex] * modulation;
          right += (correlation * carrierU + orthogonal * carrierV) * this.gainRight[gainIndex] * modulation;
        }
      }
      outputLeft[frame] = left;
      if (outputRight) outputRight[frame] = right;
    }
    return frames;
  }
}

export function renderMultiComponentSourceSpectrumNoise({ channels, sampleRate, seed = 'default', config = {}, onProgress } = {}) {
  const model = SourceSpectrumNoiseModel.analyze({ channels, sampleRate, seed, config, onProgress });
  onProgress?.({ value: 0.8, message: 'Generating source-following layers…' });
  const renderer = new MultiComponentSpectrumNoiseRenderer({ model, seed, microModulationDb: config.microModulationDb ?? DEFAULT_MULTI_COMPONENT_CONFIG.microModulationDb });
  const output = renderer.render(channels?.[0]?.length || 0);
  onProgress?.({ value: 1, message: 'Source-following layers ready.' });
  return { channels: output, model };
}

export function renderSourceSpectrumNoiseInWorker({ channels, sampleRate, seed = 'default', config = {}, onProgress } = {}) {
  if (typeof Worker !== 'function') return Promise.resolve(renderMultiComponentSourceSpectrumNoise({ channels, sampleRate, seed, config, onProgress }).channels);
  return new Promise((resolve, reject) => {
    const worker = new Worker(new URL('./source-spectrum-worker.js?v=1.6.0', import.meta.url), { type: 'module' });
    const left = channels[0];
    const right = channels[1] || null;
    worker.onmessage = event => {
      const data = event.data || {};
      if (data.type === 'progress') {
        onProgress?.({ value: data.value, message: data.message });
        return;
      }
      if (data.type === 'result') {
        channels[0] = new Float32Array(data.sourceLeft);
        if (data.sourceRight) channels[1] = new Float32Array(data.sourceRight);
        worker.terminate();
        resolve([new Float32Array(data.outputLeft), new Float32Array(data.outputRight)]);
        return;
      }
      if (data.type === 'error') {
        worker.terminate();
        reject(new Error(data.message || 'Source-spectrum worker failed.'));
      }
    };
    worker.onerror = error => {
      worker.terminate();
      reject(error);
    };
    const transfer = [left.buffer];
    if (right) transfer.push(right.buffer);
    worker.postMessage({ type: 'render', left: left.buffer, right: right?.buffer || null, sampleRate, seed, config }, transfer);
  });
}
