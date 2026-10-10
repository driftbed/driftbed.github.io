import { ALGORITHM_VERSION, EnvironmentalNoiseSynth, buildSpectralField, summarizeSceneTimeline } from '../synth.js';
import { analyzePcm, planNoiseGain, planCompositeAddedSignal, mixPcm, mixCompositePcm, renderCompositeNoiseOnly, applyGainPcm, combineNoiseLayers } from '../loudness.js?v=1.9.0';
import { encodeWav16 } from '../wav.js';
import {
  DEFAULT_MULTI_COMPONENT_CONFIG,
  DEFAULT_SOURCE_SPECTRUM_POWER_SHARE,
  SOURCE_COMPONENT_MODEL_VERSION,
  SOURCE_SPECTRUM_NOISE_VERSION,
  renderSourceSpectrumNoiseInWorker,
  renderSourceDerivedLayersInWorker
} from '../multi-component-spectrum-noise.js?v=1.9.0';
import { SOURCE_DRIFT_VERSION, DEFAULT_SOURCE_DRIFT_CONFIG } from '../source-drift.js?v=1.9.0';

export const ENGINE_ABI_VERSION = 1;
export const NUMERIC_CONTRACT_VERSION = 1;

export class JavaScriptBackend {
  backend = 'javascript';
  abiVersion = ENGINE_ABI_VERSION;
  numericContractVersion = NUMERIC_CONTRACT_VERSION;
  algorithmVersion = ALGORITHM_VERSION;
  sourceSpectrumNoiseVersion = SOURCE_SPECTRUM_NOISE_VERSION;
  sourceComponentModelVersion = SOURCE_COMPONENT_MODEL_VERSION;
  sourceDriftVersion = SOURCE_DRIFT_VERSION;
  capabilities = Object.freeze({
    pcmAnalysis: true,
    sampleScaling: true,
    environmentSynthesis: true,
    sourceAnalysis: true,
    nmf: true,
    sourceNoiseRendering: true,
    sourceDerivedLayers: true,
    sourceDriftRendering: true,
    completeAudioPipeline: true,
    fullPipeline: true,
    wasmFoundation: false
  });
  fallbackReason = '';

  createEnvironmentSynth(options) {
    return new EnvironmentalNoiseSynth(options);
  }

  buildSpectralField(options) {
    return buildSpectralField(options);
  }

  summarizeSceneTimeline(scenes) {
    return summarizeSceneTimeline(scenes);
  }

  analyzePcm(channels, sampleRate) {
    return analyzePcm(channels, sampleRate);
  }

  analyzePcmFixture(left, right) {
    if (!(left instanceof Float32Array) || !(right instanceof Float32Array) || left.length !== right.length || left.length === 0) {
      throw new Error('The PCM benchmark fixture must contain equal, non-empty Float32Array channels.');
    }
    let sum = 0;
    let peak = 0;
    for (let i = 0; i < left.length; i++) {
      const leftValue = left[i];
      const rightValue = right[i];
      if (!Number.isFinite(leftValue) || !Number.isFinite(rightValue)) throw new Error('The PCM benchmark fixture contains a non-finite sample.');
      sum += (leftValue * leftValue + rightValue * rightValue) * 0.5;
      peak = Math.max(peak, Math.abs(leftValue), Math.abs(rightValue));
    }
    return { rms: Math.sqrt(sum / left.length), peak };
  }

  scalePcmFixture(input, gain) {
    if (!(input instanceof Float32Array) || input.length === 0 || !Number.isFinite(gain)) {
      throw new Error('The PCM scaling benchmark requires a non-empty Float32Array and finite gain.');
    }
    const output = new Float32Array(input.length);
    for (let i = 0; i < input.length; i++) output[i] = input[i] * gain;
    return output;
  }

  planNoiseGain(sourceAnalysis, rawNoiseAnalysis, relativeDb, outputCeilingDb) {
    return planNoiseGain(sourceAnalysis, rawNoiseAnalysis, relativeDb, outputCeilingDb);
  }

  mixPcm(sourceChannels, noiseChannels, noiseGainDb, masterGainDb) {
    return mixPcm(sourceChannels, noiseChannels, noiseGainDb, masterGainDb);
  }

  applyGainPcm(channels, gainDb) {
    return applyGainPcm(channels, gainDb);
  }

  combineNoiseLayers(environmentChannels, sourceSpectrumChannels, sourcePowerShare = DEFAULT_SOURCE_SPECTRUM_POWER_SHARE) {
    return combineNoiseLayers(environmentChannels, sourceSpectrumChannels, sourcePowerShare);
  }

  encodeWav16(channels, sampleRate) {
    return encodeWav16(channels, sampleRate);
  }

  renderSourceSpectrumNoise(options) {
    return renderSourceSpectrumNoiseInWorker(options);
  }

  renderSourceDerivedLayers(options) {
    return renderSourceDerivedLayersInWorker(options);
  }

  planCompositeAddedSignal(options) {
    return planCompositeAddedSignal(options);
  }

  mixCompositePcm(sourceChannels, independentNoiseChannels, driftChannels, plan) {
    return mixCompositePcm(sourceChannels, independentNoiseChannels, driftChannels, plan);
  }

  renderCompositeNoiseOnly(independentNoiseChannels, driftChannels, plan) {
    return renderCompositeNoiseOnly(independentNoiseChannels, driftChannels, plan);
  }

  get defaultSourceSpectrumConfig() {
    return DEFAULT_MULTI_COMPONENT_CONFIG;
  }

  get defaultSourceSpectrumPowerShare() {
    return DEFAULT_SOURCE_SPECTRUM_POWER_SHARE;
  }

  get defaultSourceDriftConfig() {
    return DEFAULT_SOURCE_DRIFT_CONFIG;
  }
}
