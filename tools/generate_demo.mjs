import { writeFile } from 'node:fs/promises';
import { EnvironmentalNoiseSynth, buildSpectralField, summarizeSceneTimeline, ALGORITHM_VERSION } from '../src/synth.js';
import { analyzePcm } from '../src/loudness.js';
import { encodeWav16 } from '../src/wav.js';

const sampleRate = 48000;
const durationSeconds = 35.3920833333;
const config = {
  seed: 'reference-calibration-demo-v2',
  sampleRate,
  durationSeconds,
  profile: 'indoorLow',
  variation: 0.72,
  scenePace: 0.58,
  spectralDetail: 0.68
};
const spectralField = buildSpectralField(config);
const synth = new EnvironmentalNoiseSynth(config);
const scenes = synth.scenePlan.map(scene => ({ ...scene }));
const noise = synth.render(Math.round(sampleRate * durationSeconds));
const a = analyzePcm(noise, sampleRate);
const targetDb = -25.4;
const g = 10 ** ((targetDb - a.rmsDb) / 20);
for (const ch of noise) for (let i = 0; i < ch.length; i++) ch[i] *= g;
const blob = encodeWav16(noise, sampleRate);
await writeFile(new URL('../reference/generated_indoor_low_demo.wav', import.meta.url), Buffer.from(await blob.arrayBuffer()));
await writeFile(new URL('../docs/demo_scene_plan.json', import.meta.url), JSON.stringify({
  algorithmVersion: ALGORITHM_VERSION,
  config,
  summary: summarizeSceneTimeline(scenes),
  spectralField,
  scenes
}, null, 2));
console.log(`generated demo: raw ${a.rmsDb.toFixed(2)} dBFS -> ${targetDb.toFixed(1)} dBFS target`);
console.log(`${scenes.length} scenes: ${summarizeSceneTimeline(scenes)}`);
console.log(`${spectralField.length} deterministic frequency components`);
