import { PROFILES, STRENGTH_PRESETS } from './profiles.js';
import { ALGORITHM_VERSION, EnvironmentalNoiseSynth, buildSpectralField, summarizeSceneTimeline } from './synth.js';
import { analyzePcm, planNoiseGain, mixPcm, applyGainPcm, combineNoiseLayers } from './loudness.js?v=1.6.0';
import { encodeWav16 } from './wav.js';
import { decodeFileToPcm, downloadBlob } from './audio-io.js';
import { exportVideoRealtime } from './video-export.js';
import { DEFAULT_MULTI_COMPONENT_CONFIG, DEFAULT_SOURCE_SPECTRUM_POWER_SHARE, SOURCE_COMPONENT_MODEL_VERSION, SOURCE_SPECTRUM_NOISE_VERSION, renderSourceSpectrumNoiseInWorker } from './multi-component-spectrum-noise.js?v=1.6.0';

const OUTPUT_RECIPE_VERSION = 5;

const $ = s => document.querySelector(s);
const els = {
  file: $('#file'), drop: $('#drop'), fileName: $('#fileName'), profile: $('#profile'),
  strengthPreset: $('#strengthPreset'), strength: $('#strength'), strengthDb: $('#strengthDb'), strengthInfo: $('#strengthInfo'),
  variation: $('#variation'), scenePace: $('#scenePace'), paceInfo: $('#paceInfo'), spectralDetail: $('#spectralDetail'), spectralInfo: $('#spectralInfo'), seed: $('#seed'), randomize: $('#randomize'), generate: $('#generate'), status: $('#status'), metrics: $('#metrics'), progress: $('#progress'),
  original: $('#originalPlayer'), result: $('#resultPlayer'), noise: $('#noisePlayer'),
  download: $('#downloadBtn'), downloadNoise: $('#downloadNoiseBtn'), recipe: $('#recipeBtn'), advanced: $('#advancedInfo'), install: $('#installBtn')
};

for (const p of Object.values(PROFILES)) {
  const o = document.createElement('option'); o.value = p.id; o.textContent = p.name; els.profile.appendChild(o);
}
for (const [id, preset] of Object.entries(STRENGTH_PRESETS)) {
  const o = document.createElement('option'); o.value = id; o.textContent = `${preset.label} (${preset.db} dB)`; els.strengthPreset.appendChild(o);
}
{
  const o = document.createElement('option'); o.value = 'custom'; o.textContent = 'Custom'; els.strengthPreset.appendChild(o);
}
els.profile.value = 'indoorLow';
els.strengthPreset.value = 'subtle';
els.strength.value = String(STRENGTH_PRESETS.subtle.db);
els.strengthDb.value = els.strength.value;
els.seed.value = `environment-${crypto.getRandomValues(new Uint32Array(1))[0]}`;

let selectedFile = null;
let lastMergedBlob = null, lastMergedName = null;
let lastNoiseBlob = null, lastNoiseName = null;
const objectUrls = new Set();
const playerUrls = new Map();

function isVideo(file) { return file?.type?.startsWith('video/') || /\.(mp4|webm|mov|mkv|m4v)$/i.test(file?.name || ''); }
function setStatus(text, error=false) { els.status.textContent = text; els.status.className = error ? 'status error' : 'status'; }
function setProgress(v) { els.progress.value = Math.max(0, Math.min(1, v)); }
function fmt(x, n=1) { return Number.isFinite(x) ? x.toFixed(n) : '—'; }
function clamp(x, lo, hi) { return Math.max(lo, Math.min(hi, x)); }
function releasePlayerUrl(key) {
  const oldUrl = playerUrls.get(key);
  if (!oldUrl) return;
  URL.revokeObjectURL(oldUrl);
  objectUrls.delete(oldUrl);
  playerUrls.delete(key);
}
function rememberUrl(blob, key) {
  if (key) releasePlayerUrl(key);
  const url = URL.createObjectURL(blob);
  objectUrls.add(url);
  if (key) playerUrls.set(key, url);
  return url;
}
function clearGeneratedUrls() {
  for (const u of objectUrls) URL.revokeObjectURL(u);
  objectUrls.clear();
  playerUrls.clear();
}

let deferredInstallPrompt = null;
const standalone = () => window.matchMedia('(display-mode: standalone)').matches || window.navigator.standalone === true;

if ('serviceWorker' in navigator) {
  navigator.serviceWorker.register('./sw.js').catch(error => console.warn('Driftbed offline shell unavailable', error));
}

window.addEventListener('beforeinstallprompt', event => {
  event.preventDefault();
  deferredInstallPrompt = event;
  if (!standalone()) els.install.hidden = false;
});

els.install.onclick = async () => {
  if (!deferredInstallPrompt) return;
  const promptEvent = deferredInstallPrompt;
  deferredInstallPrompt = null;
  els.install.hidden = true;
  await promptEvent.prompt();
  const choice = await promptEvent.userChoice;
  setStatus(choice.outcome === 'accepted' ? 'Driftbed was added to your apps.' : 'Installation was dismissed. You can use your browser menu whenever you are ready.');
};

window.addEventListener('appinstalled', () => {
  deferredInstallPrompt = null;
  els.install.hidden = true;
  setStatus('Driftbed was added to your apps.');
});

if (standalone()) els.install.hidden = true;

function updateSpectralInfo() {
  const components = buildSpectralField({
    seed: els.seed.value || 'default',
    profile: els.profile.value,
    spectralDetail: Number(els.spectralDetail.value),
    variation: Number(els.variation.value)
  });
  const [lo, hi] = components.reduce(([a,b], c) => [Math.min(a, c.frequency), Math.max(b, c.frequency)], [Infinity, 0]);
  els.spectralInfo.textContent = `${components.length} independently seeded frequency components · ${Math.round(lo)}–${Math.round(hi)} Hz · independent magnitude, phase and slow drift`;
}

function describeStrength(db) {
  const ratio = 100 * (10 ** (db / 20));
  let phrase = 'background-like';
  let warning = '';
  if (db <= -42) phrase = 'extremely faint';
  else if (db <= -34) phrase = 'very subtle';
  else if (db <= -27) phrase = 'subtle / natural';
  else if (db <= -20) phrase = 'clearly audible';
  else if (db <= -12) phrase = 'strong';
  else warning = ' — very strong: may no longer behave like insignificant background noise';
  return `${db.toFixed(1)} dB relative · ≈ ${ratio < 1 ? ratio.toFixed(2) : ratio.toFixed(1)}% amplitude ratio · ${phrase}${warning}`;
}

function syncStrengthFromValue(value, origin = 'slider') {
  const v = clamp(Number(value), -60, -3);
  els.strength.value = String(v);
  els.strengthDb.value = String(v);
  const match = Object.entries(STRENGTH_PRESETS).find(([, p]) => Math.abs(p.db - v) < 1e-9);
  els.strengthPreset.value = match ? match[0] : 'custom';
  els.strengthInfo.textContent = describeStrength(v);
  if (origin === 'number' && Number(value) !== v) els.strengthDb.value = String(v);
}

function resetOutputs() {
  lastMergedBlob = null; lastMergedName = null; lastNoiseBlob = null; lastNoiseName = null;
  els.result.hidden = true; els.noise.hidden = true;
  els.download.disabled = true; els.downloadNoise.disabled = true;
  els.metrics.textContent = '';
}

function replacePlayer(key, tagName, blob) {
  const old = els[key];
  const id = old.id;
  old.outerHTML = `<${tagName} id="${id}" controls class="player"></${tagName}>`;
  els[key] = document.getElementById(id);
  els[key].src = rememberUrl(blob, key);
  els[key].hidden = false;
}

function chooseFile(file) {
  selectedFile = file;
  clearGeneratedUrls();
  resetOutputs();
  els.fileName.textContent = file ? `${file.name} · ${(file.size / 1048576).toFixed(1)} MB` : 'No file selected';
  els.generate.disabled = !file;
  if (file) {
    const url = rememberUrl(file, 'original');
    const tag = isVideo(file) ? 'video' : 'audio';
    els.original.outerHTML = `<${tag} id="originalPlayer" controls class="player" src="${url}"></${tag}>`;
    els.original = $('#originalPlayer');
  }
}

els.file.onchange = () => chooseFile(els.file.files[0]);
els.drop.ondragover = e => { e.preventDefault(); els.drop.classList.add('drag'); };
els.drop.ondragleave = () => els.drop.classList.remove('drag');
els.drop.ondrop = e => { e.preventDefault(); els.drop.classList.remove('drag'); chooseFile(e.dataTransfer.files[0]); };
els.drop.onclick = () => els.file.click();
els.randomize.onclick = () => { els.seed.value = `environment-${crypto.getRandomValues(new Uint32Array(1))[0]}`; updateSpectralInfo(); };

els.profile.onchange = updateSpectralInfo;
els.spectralDetail.oninput = updateSpectralInfo;

els.strengthPreset.onchange = () => {
  if (els.strengthPreset.value !== 'custom') syncStrengthFromValue(STRENGTH_PRESETS[els.strengthPreset.value].db, 'preset');
};
els.strength.oninput = () => syncStrengthFromValue(els.strength.value, 'slider');
els.strengthDb.oninput = () => {
  if (els.strengthDb.value !== '' && Number.isFinite(Number(els.strengthDb.value))) syncStrengthFromValue(els.strengthDb.value, 'number');
};
els.strengthDb.onchange = () => syncStrengthFromValue(els.strengthDb.value || -32, 'number');
syncStrengthFromValue(els.strength.value);
updateSpectralInfo();

els.recipe.onclick = async () => {
  const recipe = {
    algorithmVersion: OUTPUT_RECIPE_VERSION,
    environmentSynthVersion: ALGORITHM_VERSION,
    sourceSpectrumNoiseVersion: SOURCE_SPECTRUM_NOISE_VERSION,
    sourceComponentModelVersion: SOURCE_COMPONENT_MODEL_VERSION,
    seed: els.seed.value,
    environment: els.profile.value,
    relativeNoiseDb: Number(els.strength.value),
    variation: Number(els.variation.value),
    scenePace: Number(els.scenePace.value),
    spectralDetail: Number(els.spectralDetail.value),
    sourceSpectrumNoise: {
      enabled: true,
      powerShare: DEFAULT_SOURCE_SPECTRUM_POWER_SHARE,
      analysisBands: DEFAULT_MULTI_COMPONENT_CONFIG.analysisBands,
      componentRank: DEFAULT_MULTI_COMPONENT_CONFIG.componentRank,
      maxComponents: DEFAULT_MULTI_COMPONENT_CONFIG.componentRank + 2,
      frameMs: DEFAULT_MULTI_COMPONENT_CONFIG.frameMs,
      decomposition: 'soft-hpss+nmf',
      carrierMode: 'independent-per-component-band',
      stereoMode: 'component-covariance',
      nmfIterations: DEFAULT_MULTI_COMPONENT_CONFIG.nmfIterations,
      activationIterations: DEFAULT_MULTI_COMPONENT_CONFIG.activationIterations
    },
    outputs: ['merged-media', 'noise-only-audio'],
    note: 'Same recipe + same source PCM + same implementation version reproduces the same synthesized noise. Audio noise-only WAV is the exact post-plan noise contribution used in the merged output. The source-spectrum model discovers latent spectral-temporal components; it does not claim semantic voice or music stems.'
  };
  await navigator.clipboard.writeText(JSON.stringify(recipe, null, 2));
  setStatus('Generation recipe copied to clipboard.');
};

els.download.onclick = () => { if (lastMergedBlob) downloadBlob(lastMergedBlob, lastMergedName); };
els.downloadNoise.onclick = () => { if (lastNoiseBlob) downloadBlob(lastNoiseBlob, lastNoiseName); };

els.generate.onclick = async () => {
  if (!selectedFile) return;
  els.generate.disabled = true; els.download.disabled = true; els.downloadNoise.disabled = true;
  setProgress(0); els.metrics.textContent = '';
  const seed = els.seed.value || 'default';
  const profile = els.profile.value;
  const variation = Number(els.variation.value);
  const relativeDb = Number(els.strength.value);
  const scenePace = Number(els.scenePace.value);
  const spectralDetail = Number(els.spectralDetail.value);
  try {
    if (isVideo(selectedFile)) {
      setStatus('Exporting merged video and matching noise-only audio in real time. Keep this tab active.');
      const { mixedBlob, noiseBlob, sceneCount, sceneSummary, spectralCount } = await exportVideoRealtime({ file: selectedFile, seed, profile, variation, scenePace, spectralDetail, relativeDb, onProgress: setProgress });
      const base = selectedFile.name.replace(/\.[^.]+$/, '');
      lastMergedBlob = mixedBlob; lastMergedName = `${base}-noised.webm`;
      lastNoiseBlob = noiseBlob; lastNoiseName = `${base}-noise-only.webm`;
      replacePlayer('result', 'video', mixedBlob);
      replacePlayer('noise', 'audio', noiseBlob);
      els.metrics.textContent = `Relative noise target ${relativeDb.toFixed(1)} dB · ${sceneCount} deterministic regimes · ${spectralCount} frequency components · ${sceneSummary} · merged WebM + matching noise-only Opus/WebM`; 
      setStatus('Video export complete. Both merged media and noise-only audio are ready.');
    } else {
      setStatus('Decoding and analyzing source…'); setProgress(0.08);
      const source = await decodeFileToPcm(selectedFile);
      const sourceAnalysis = analyzePcm(source.channels, source.sampleRate);
      setStatus('Synthesizing deterministic environment…'); setProgress(0.25);
      const synth = new EnvironmentalNoiseSynth({ seed, sampleRate: source.sampleRate, durationSeconds: source.duration, profile, variation, scenePace, spectralDetail });
      const frames = Math.round(source.duration * source.sampleRate);
      const rawEnvironmental = synth.render(frames);
      const sourceSpectrumNoise = await renderSourceSpectrumNoiseInWorker({
        channels: source.channels,
        sampleRate: source.sampleRate,
        seed,
        config: DEFAULT_MULTI_COMPONENT_CONFIG,
        onProgress: ({ value, message }) => {
          setStatus(message);
          setProgress(0.25 + value * 0.4);
        }
      });
      const rawNoise = combineNoiseLayers(rawEnvironmental, sourceSpectrumNoise, DEFAULT_SOURCE_SPECTRUM_POWER_SHARE);
      const scenePlan = synth.scenePlan;
      const noiseAnalysis = analyzePcm(rawNoise, source.sampleRate);
      const spectralCount = synth.spectralComponents.length;
      setStatus('Planning level and creating merged + noise-only outputs…'); setProgress(0.72);
      const plan = planNoiseGain(sourceAnalysis, noiseAnalysis, relativeDb, -1);
      const mixed = mixPcm(source.channels, rawNoise, plan.noiseGainDb, plan.masterGainDb);
      // The merged signal applies masterGainDb after summing, so the exact noise contribution
      // present in the merged file is rawNoise * noiseGain * masterGain.
      const noiseOnly = applyGainPcm(rawNoise, plan.noiseGainDb + plan.masterGainDb);
      const outputAnalysis = analyzePcm(mixed, source.sampleRate);
      const noiseOnlyAnalysis = analyzePcm(noiseOnly, source.sampleRate);
      setStatus('Encoding WAV outputs…'); setProgress(0.92);
      const mergedBlob = encodeWav16(mixed, source.sampleRate);
      const noiseBlob = encodeWav16(noiseOnly, source.sampleRate);
      const base = selectedFile.name.replace(/\.[^.]+$/, '');
      lastMergedBlob = mergedBlob; lastMergedName = `${base}-noised.wav`;
      lastNoiseBlob = noiseBlob; lastNoiseName = `${base}-noise-only.wav`;
      replacePlayer('result', 'audio', mergedBlob);
      replacePlayer('noise', 'audio', noiseBlob);
      els.metrics.textContent = `Source robust ${fmt(sourceAnalysis.robustDb)} dBFS · Requested offset ${relativeDb.toFixed(1)} dB · ${DEFAULT_MULTI_COMPONENT_CONFIG.componentRank + 2} latent source-following layers · ${spectralCount} environmental frequency components · Noise output ${fmt(noiseOnlyAnalysis.rmsDb)} dBFS · Output peak ${fmt(outputAnalysis.peakDb)} dBFS · Safety trim ${fmt(plan.masterGainDb)} dB · ${scenePlan.length} regimes: ${summarizeSceneTimeline(scenePlan)}`;
      setProgress(1); setStatus('Audio export complete. Both merged media and exact noise-only WAV are ready.');
    }
    els.download.disabled = false;
    els.downloadNoise.disabled = false;
  } catch (err) {
    console.error(err); setStatus(err?.message || String(err), true);
  } finally {
    els.generate.disabled = false;
  }
};

els.variation.oninput = () => {
  const v = Number(els.variation.value);
  updateSpectralInfo();
  els.advanced.textContent = `Pattern variety: ${v.toFixed(2)} · controls contrast between deterministic scene regimes, per-frequency amplitude reshaping, and within-scene drift`;
};
els.scenePace.oninput = () => {
  const p = Number(els.scenePace.value);
  const label = p < 0.25 ? 'slow scene evolution' : p < 0.70 ? 'natural scene evolution' : 'frequent scene evolution';
  els.paceInfo.textContent = `Scene pace: ${p.toFixed(2)} · ${label}; transitions remain crossfaded and continuous`;
};
els.variation.dispatchEvent(new Event('input'));
els.scenePace.dispatchEvent(new Event('input'));
