import { writeFile } from 'node:fs/promises';
import { EnvironmentalNoiseSynth, buildSpectralField, SPECTRAL_AMPLITUDE_WEIGHTS, ALGORITHM_VERSION } from '../src/synth.js';
import { exactWeightedCounts } from '../src/distribution.js';

const config = {
  seed: 'reference-calibration-demo-v2',
  sampleRate: 48000,
  durationSeconds: 35.3920833333,
  profile: 'indoorLow',
  variation: 0.72,
  scenePace: 0.58,
  spectralDetail: 0.68
};
const field = buildSpectralField(config);
const synth = new EnvironmentalNoiseSynth(config);
const amplitudes = field.map(c => c.amplitude);
const phases = field.map(c => c.phase);
const frequencies = field.map(c => c.frequency);
const bandCounts = [0,0,0];
for (const c of field) bandCounts[c.band]++;
const sceneAmplitudeClassCounts = synth.scenePlan.map(scene => {
  const counts = Array(SPECTRAL_AMPLITUDE_WEIGHTS.length).fill(0);
  for (const cls of scene.spectralAmplitudeClasses) counts[cls]++;
  return { scene: scene.name, counts };
});
const basePower = synth.spectralComponents.reduce((sum,c)=>sum+c.amplitude*c.amplitude,0);
const scenePowerRatios = synth.scenePlan.map(scene => ({
  scene: scene.name,
  ratio: synth.spectralComponents.reduce((sum,c,i)=>sum+(c.amplitude*scene.spectralGains[i])**2,0) / basePower
}));
const mean = xs => xs.reduce((a,b)=>a+b,0)/xs.length;
const sd = xs => { const m=mean(xs); return Math.sqrt(mean(xs.map(x=>(x-m)**2))); };
const result = {
  algorithmVersion: ALGORITHM_VERSION,
  config,
  componentCount: field.length,
  frequencyHz: { min: Math.min(...frequencies), max: Math.max(...frequencies), mean: mean(frequencies), std: sd(frequencies) },
  amplitude: { min: Math.min(...amplitudes), max: Math.max(...amplitudes), mean: mean(amplitudes), std: sd(amplitudes) },
  phaseRadians: { min: Math.min(...phases), max: Math.max(...phases), mean: mean(phases), std: sd(phases) },
  exactFrequencyBandCounts: bandCounts,
  expectedFrequencyBandCounts: exactWeightedCounts([0.22,0.61,0.17], field.length),
  exactSceneAmplitudeClassCounts: sceneAmplitudeClassCounts,
  expectedSceneAmplitudeClassCounts: exactWeightedCounts(SPECTRAL_AMPLITUDE_WEIGHTS, field.length),
  scenePowerRatios
};
await writeFile(new URL('../docs/spectral_field_metrics.json', import.meta.url), JSON.stringify(result, null, 2));
console.log(JSON.stringify(result, null, 2));
