import { ALGORITHM_VERSION, EnvironmentalNoiseSynth, buildSpectralField, summarizeSceneTimeline } from '../synth.js';
import { analyzePcm, planNoiseGain, mixPcm, applyGainPcm, combineNoiseLayers } from '../loudness.js?v=1.7.0';
import { encodeWav16 } from '../wav.js';
import {
  DEFAULT_MULTI_COMPONENT_CONFIG,
  DEFAULT_SOURCE_SPECTRUM_POWER_SHARE,
  SOURCE_COMPONENT_MODEL_VERSION,
  SOURCE_SPECTRUM_NOISE_VERSION,
  renderSourceSpectrumNoiseInWorker
} from '../multi-component-spectrum-noise.js?v=1.7.0';

export const ENGINE_ABI_VERSION = 1;
export const NUMERIC_CONTRACT_VERSION = 1;

export class JavaScriptBackend {
  backend = 'javascript';
  abiVersion = ENGINE_ABI_VERSION;
  numericContractVersion = NUMERIC_CONTRACT_VERSION;
  algorithmVersion = ALGORITHM_VERSION;
  sourceSpectrumNoiseVersion = SOURCE_SPECTRUM_NOISE_VERSION;
  sourceComponentModelVersion = SOURCE_COMPONENT_MODEL_VERSION;
  capabilities = Object.freeze({ fullPipeline: true, wasmFoundation: false });
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

  get defaultSourceSpectrumConfig() {
    return DEFAULT_MULTI_COMPONENT_CONFIG;
  }

  get defaultSourceSpectrumPowerShare() {
    return DEFAULT_SOURCE_SPECTRUM_POWER_SHARE;
  }
}
