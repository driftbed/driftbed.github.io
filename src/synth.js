import { deriveSeed, rngFor } from './random.js';
import { categoryAt } from './distribution.js';
import { PROFILES, SCENE_REGIMES } from './profiles.js';

export const ALGORITHM_VERSION = 3;
const BASE_LAYER_VERSION = 2;

const TAU = Math.PI * 2;
const clamp = (x, a, b) => Math.max(a, Math.min(b, x));
const lerp = (a, b, t) => a + (b - a) * t;
const smoothstep = x => { const t = clamp(x, 0, 1); return t * t * (3 - 2 * t); };

class OnePoleLP {
  constructor(sampleRate, cutoff) {
    this.y = 0;
    this.setCutoff(sampleRate, cutoff);
  }
  setCutoff(sampleRate, cutoff) {
    const c = clamp(cutoff, 1, sampleRate * 0.45);
    this.a = 1 - Math.exp(-TAU * c / sampleRate);
  }
  tick(x) {
    this.y += this.a * (x - this.y);
    return this.y;
  }
}

class SmoothRandom {
  constructor(seed, sampleRate, minSeconds, maxSeconds, amount = 1) {
    this.rng = rngFor(seed, 'smooth-random');
    this.sampleRate = sampleRate;
    this.minSeconds = minSeconds;
    this.maxSeconds = maxSeconds;
    this.amount = amount;
    this.value = this.rng.range(-1, 1) * amount;
    this.target = this.value;
    this.remaining = 0;
    this.step = 0;
  }
  #renew() {
    this.target = this.rng.range(-1, 1) * this.amount;
    this.remaining = Math.max(1, Math.floor(this.rng.range(this.minSeconds, this.maxSeconds) * this.sampleRate));
    this.step = (this.target - this.value) / this.remaining;
  }
  tick() {
    if (this.remaining <= 0) this.#renew();
    this.value += this.step;
    this.remaining--;
    return this.value;
  }
  advance(samples) {
    let left = Math.max(0, Math.floor(samples));
    while (left > 0) {
      if (this.remaining <= 0) this.#renew();
      const n = Math.min(left, this.remaining);
      this.value += this.step * n;
      this.remaining -= n;
      left -= n;
    }
    return this.value;
  }
}

function centeredMultiplier(base, strength) {
  return Math.exp(Math.log(Math.max(1e-4, base)) * strength);
}

export const SPECTRAL_AMPLITUDE_WEIGHTS = [0.12, 0.23, 0.34, 0.23, 0.08];
const SPECTRAL_AMPLITUDE_MULTIPLIERS = [0.42, 0.70, 0.96, 1.24, 1.62];

function logLerp(a, b, t) {
  return Math.exp(lerp(Math.log(a), Math.log(b), t));
}

/**
 * Build a deterministic frequency-component dataset. Each component owns independent
 * domains for frequency, amplitude, phase, stereo phase, frequency drift and amplitude
 * drift. Frequency-band counts are exact-weighted and then scattered by the same seeded
 * category assignment machinery used elsewhere in the generalized dataset algorithm.
 */
export function buildSpectralField({
  seed = 'default', profile = 'natural', spectralDetail = 0.62, variation = 0.65
} = {}) {
  const p = typeof profile === 'string' ? (PROFILES[profile] || PROFILES.natural) : profile;
  const detail = clamp(Number(spectralDetail) || 0, 0, 1);
  const v = clamp(Number(variation) || 0, 0, 1);
  const [minCount, maxCount] = p.spectralCount || [12, 28];
  const count = Math.max(4, Math.round(lerp(minCount, maxCount, detail)));
  const weights = p.spectralBandWeights || [0.28, 0.48, 0.24];
  const [fMin0, fMax0] = p.spectralFreq || [45, Math.max(500, p.finalCutoff || 1600)];
  const fMin = Math.max(22, fMin0);
  const fMax = Math.max(fMin * 1.5, fMax0);
  const edges = [fMin, logLerp(fMin, fMax, 0.30), logLerp(fMin, fMax, 0.67), fMax];
  const bandSeed = deriveSeed(seed, ALGORITHM_VERSION, 'spectral-band-plan', p.id, count);
  const components = [];
  let rawPower = 0;

  for (let i = 0; i < count; i++) {
    const band = categoryAt(i, count, weights, bandSeed);
    const r = rngFor(seed, ALGORITHM_VERSION, 'spectral-component', p.id, i, band);
    const u = 0.055 + 0.89 * r.next();
    const frequency = logLerp(edges[band], edges[band + 1], u);
    const tilt = p.spectralTilt ?? -0.35;
    const referenceHz = Math.sqrt(fMin * fMax);
    const envelope = (frequency / referenceHz) ** tilt;
    // A bounded log-amplitude distribution gives every component an independent
    // magnitude while avoiding one random bin dominating the entire signal.
    const randomMagnitude = Math.exp(r.range(-0.62, 0.62) * (0.55 + 0.45 * v));
    const rawAmplitude = envelope * randomMagnitude;
    const width = clamp((frequency - 55) / 900, 0, 1);
    const stereoPhase = r.range(-1, 1) * (0.055 + 0.90 * width);
    const stereoBalance = r.range(-0.10, 0.10) * (0.25 + 0.75 * width);
    const component = {
      index: i, band, frequency, rawAmplitude,
      phase: r.range(0, TAU),
      stereoPhase, stereoBalance,
      frequencyGroup: Math.floor(i / 4),
      amplitudeDriftDepth: r.range(0.055, 0.13 + 0.13 * v),
      frequencyDriftDepth: r.range(0.00025, 0.0010 + 0.0020 * v)
    };
    components.push(component);
    rawPower += rawAmplitude * rawAmplitude;
  }

  // Normalize the aggregate sinusoidal field to the profile's intended contribution.
  // For random phases, sum(a_i^2 / 2) is the expected mean-square power.
  const targetRms = p.spectralLevel ?? 0.09;
  const scale = rawPower > 0 ? targetRms * Math.SQRT2 / Math.sqrt(rawPower) : 0;
  for (const c of components) {
    c.amplitude = c.rawAmplitude * scale;
    delete c.rawAmplitude;
  }
  return components;
}

/**
 * Build the deterministic timeline dataset.
 *
 * Every slot is a dataset object whose category is assigned by exact weighted quotas
 * plus a seeded permutation. Nearby slots inherit a macro-group context while retaining
 * independent per-slot streams. This directly applies the generalized dataset algorithm
 * to time-varying audio structure rather than merely to isolated events.
 */
export function buildSceneTimeline({
  seed = 'default', durationSeconds = 30, profile = 'natural', variation = 0.65, scenePace = 0.55
} = {}) {
  const p = typeof profile === 'string' ? (PROFILES[profile] || PROFILES.natural) : profile;
  const duration = Math.max(0.01, Number(durationSeconds) || 0.01);
  const v = clamp(Number(variation) || 0, 0, 1);
  const pace = clamp(Number(scenePace) || 0, 0, 1);
  const nominalSpacing = p.sceneSpacing * lerp(1.45, 0.62, pace);
  const slotCount = duration < 4 ? 1 : Math.max(2, Math.ceil(duration / nominalSpacing));
  const slotDuration = duration / slotCount;
  const categorySeed = deriveSeed(seed, BASE_LAYER_VERSION, 'scene-category-plan', p.id, slotCount);
  const sceneStrength = 0.28 + 0.72 * v;
  const scenes = [];

  for (let index = 0; index < slotCount; index++) {
    const type = categoryAt(index, slotCount, p.sceneWeights, categorySeed);
    const regime = SCENE_REGIMES[type];
    const group = Math.floor(index / (p.sceneGroupSize || 3));
    const macro = rngFor(seed, BASE_LAYER_VERSION, 'macro-scene', p.id, group);
    const local = rngFor(seed, BASE_LAYER_VERSION, 'scene-slot', p.id, index, regime.id);

    // Group-level context produces hierarchical correlation: adjacent slots share a
    // room/machine state while their detailed realizations remain independent.
    const macroLow = Math.exp(macro.range(-0.10, 0.10) * v);
    const macroMid = Math.exp(macro.range(-0.09, 0.09) * v);
    const macroAir = Math.exp(macro.range(-0.15, 0.15) * v);
    const macroModal = Math.exp(macro.range(-0.08, 0.08) * v);
    const macroTexture = Math.exp(macro.range(-0.11, 0.11) * v);
    const macroStereo = Math.exp(macro.range(-0.08, 0.08) * v);
    const macroLevelDb = macro.range(-0.35, 0.35) * v;
    const macroFocusShift = Math.exp(macro.range(-0.08, 0.08) * v);

    const localMul = amount => Math.exp(local.range(-amount, amount) * v);
    const focusMin = p.modalFreq[0] * 0.75;
    const focusMax = p.modalFreq[1] * 1.2;
    scenes.push({
      index, type, id: regime.id, name: regime.name, group,
      start: index * slotDuration,
      end: (index + 1) * slotDuration,
      lowMul: centeredMultiplier(regime.low, sceneStrength) * macroLow * localMul(0.075),
      midMul: centeredMultiplier(regime.mid, sceneStrength) * macroMid * localMul(0.075),
      airMul: centeredMultiplier(regime.air, sceneStrength) * macroAir * localMul(0.12),
      modalMul: centeredMultiplier(regime.modal, sceneStrength) * macroModal * localMul(0.07),
      textureMul: centeredMultiplier(regime.texture, sceneStrength) * macroTexture * localMul(0.09),
      stereoMul: centeredMultiplier(regime.stereo, sceneStrength) * macroStereo * localMul(0.06),
      levelDb: regime.levelDb * sceneStrength + macroLevelDb + local.range(-0.20, 0.20) * v,
      focusHz: clamp(regime.focusHz * (p.sceneFocusScale || 1) * macroFocusShift * localMul(0.06), focusMin, focusMax),
      focusWidth: clamp(regime.focusWidth * localMul(0.09), 0.20, 1.15),
      focusStrength: regime.focusStrength * (0.55 + 0.65 * v) * localMul(0.06),
      textureFlavor: clamp(regime.textureFlavor * sceneStrength + (p.textureFlavorBias || 0) + local.range(-0.10, 0.10) * v, -1, 1),
      pulseRate: clamp(regime.pulseRate * localMul(0.18), 0.03, 1.4),
      pulseDepth: clamp(regime.pulseDepth * (0.45 + 0.75 * v) * localMul(0.10), 0, 0.24),
      eventMul: centeredMultiplier(regime.eventMul, sceneStrength) * localMul(0.08)
    });
  }
  return scenes;
}

export function summarizeSceneTimeline(scenes) {
  const counts = new Map();
  for (const s of scenes || []) counts.set(s.name, (counts.get(s.name) || 0) + 1);
  return [...counts.entries()].map(([name, count]) => `${name}×${count}`).join(' · ');
}

export class EnvironmentalNoiseSynth {
  constructor({
    seed = 'default', sampleRate = 48000, durationSeconds = 30, profile = 'natural',
    variation = 0.65, scenePace = 0.55, spectralDetail = 0.62
  } = {}) {
    this.seed = seed;
    this.sampleRate = sampleRate;
    this.durationSeconds = Math.max(0.01, durationSeconds);
    this.profile = typeof profile === 'string' ? (PROFILES[profile] || PROFILES.natural) : (profile || PROFILES.natural);
    this.variation = clamp(Number(variation) || 0, 0, 1);
    this.scenePace = clamp(Number(scenePace) || 0, 0, 1);
    this.spectralDetail = clamp(Number(spectralDetail) || 0, 0, 1);
    this.sampleIndex = 0;
    this.scenePlan = buildSceneTimeline({
      seed, durationSeconds: this.durationSeconds, profile: this.profile,
      variation: this.variation, scenePace: this.scenePace
    });
    this.sceneFrames = (this.durationSeconds * this.sampleRate) / this.scenePlan.length;
    this.transitionFraction = 0.24 + 0.18 * this.variation;

    const modalCountRng = rngFor(seed, BASE_LAYER_VERSION, 'scene', this.profile.id, 'mode-count');
    const modalCount = modalCountRng.int(this.profile.modalCount[0], this.profile.modalCount[1]);
    const modalBandWeights = this.profile.modalBandWeights || [0.25, 0.50, 0.25];
    const modalCategorySeed = deriveSeed(seed, BASE_LAYER_VERSION, 'modal-band-plan', this.profile.id, modalCount);
    const [fMin, fMax] = this.profile.modalFreq;
    const span = fMax - fMin;
    const edges = [fMin, fMin + span * 0.29, fMin + span * 0.66, fMax];
    this.modes = [];
    for (let i = 0; i < modalCount; i++) {
      const band = categoryAt(i, modalCount, modalBandWeights, modalCategorySeed);
      const modalRng = rngFor(seed, BASE_LAYER_VERSION, 'mode', this.profile.id, i, band);
      // Exact weighted band assignment prevents an unlucky seed from clustering all
      // resonances into one narrow frequency region.
      const u = 0.08 + 0.84 * modalRng.next();
      const f = lerp(edges[band], edges[band + 1], u);
      this.modes.push({
        baseFreq: f,
        band,
        phase: modalRng.range(0, TAU),
        amp: this.profile.modalLevel * modalRng.range(0.62, 1.0) / Math.sqrt(modalCount),
        drift: new SmoothRandom(deriveSeed(seed, BASE_LAYER_VERSION, 'mode', i, 'freq'), sampleRate, 2.5, 9, 0.004 + 0.006 * this.variation),
        ampDrift: new SmoothRandom(deriveSeed(seed, BASE_LAYER_VERSION, 'mode', i, 'amp'), sampleRate, 1.8, 7, 0.18 + 0.15 * this.variation)
      });
    }

    // Each scene gets a strongly frequency-selective but power-normalized modal pattern.
    // This creates audible pattern changes without turning scene changes into loudness jumps.
    for (const scene of this.scenePlan) {
      const raw = this.modes.map(m => {
        const logDistance = Math.log2(Math.max(1e-6, m.baseFreq / scene.focusHz));
        const focus = Math.exp(-0.5 * (logDistance / scene.focusWidth) ** 2);
        return 0.16 + scene.focusStrength * focus;
      });
      const norm = Math.sqrt(raw.reduce((sum, g) => sum + g * g, 0) / Math.max(1, raw.length)) || 1;
      scene.modeGains = raw.map(g => g / norm);
    }

    // Frequency components are themselves a deterministic synthetic dataset. Every
    // component has independently derived magnitude and phase, while exact weighted
    // band composition prevents spectral collapse into one accidental frequency region.
    const field = buildSpectralField({
      seed, profile: this.profile, spectralDetail: this.spectralDetail, variation: this.variation
    });
    this.spectralComponents = field.map(c => ({
      ...c,
      sinPhase: Math.sin(c.phase),
      cosPhase: Math.cos(c.phase),
      cosStereoPhase: Math.cos(c.stereoPhase),
      sinStereoPhase: Math.sin(c.stereoPhase),
      stepSin: 0, stepCos: 1,
      ampMul: 1, ampStep: 0,
      ampDrift: new SmoothRandom(deriveSeed(seed, ALGORITHM_VERSION, 'spectral-component', c.index, 'amplitude-drift'), sampleRate, 1.4, 6.8, c.amplitudeDriftDepth),
      freqDrift: new SmoothRandom(deriveSeed(seed, ALGORITHM_VERSION, 'spectral-component', c.index, 'frequency-drift'), sampleRate, 2.2, 9.5, c.frequencyDriftDepth)
    }));
    this.spectralControlBlock = 128;
    this.spectralControlRemaining = 0;

    // For each timeline scene, independently assign exact weighted amplitude classes
    // to frequency components, then add hierarchical frequency-group correlation,
    // per-component jitter and scene focus. Weighted power normalization changes the
    // spectral shape much more than the total loudness.
    const componentPower = this.spectralComponents.reduce((sum, c) => sum + c.amplitude * c.amplitude, 0) || 1;
    for (const scene of this.scenePlan) {
      const classSeed = deriveSeed(seed, ALGORITHM_VERSION, 'spectral-amplitude-classes', this.profile.id, scene.index, this.spectralComponents.length);
      const classes = [];
      const rawGains = [];
      for (const c of this.spectralComponents) {
        const cls = categoryAt(c.index, this.spectralComponents.length, SPECTRAL_AMPLITUDE_WEIGHTS, classSeed);
        classes.push(cls);
        const groupRng = rngFor(seed, ALGORITHM_VERSION, 'spectral-frequency-group', this.profile.id, scene.group, c.frequencyGroup);
        const localRng = rngFor(seed, ALGORITHM_VERSION, 'spectral-scene-component', this.profile.id, scene.index, c.index);
        const groupMul = Math.exp(groupRng.range(-0.14, 0.14) * this.variation);
        const localMul = Math.exp(localRng.range(-0.24, 0.24) * (0.30 + 0.70 * this.variation));
        const classMul = centeredMultiplier(SPECTRAL_AMPLITUDE_MULTIPLIERS[cls], 0.30 + 0.70 * this.variation);
        const logDistance = Math.log2(Math.max(1e-6, c.frequency / scene.focusHz));
        const focus = Math.exp(-0.5 * (logDistance / Math.max(0.18, scene.focusWidth)) ** 2);
        const focusMul = 0.72 + 0.36 * scene.focusStrength * focus;
        const bandMul = c.band === 0 ? scene.lowMul : c.band === 1 ? scene.midMul : scene.airMul;
        const regimeMul = centeredMultiplier(bandMul, 0.24 + 0.18 * this.variation);
        rawGains.push(groupMul * localMul * classMul * focusMul * regimeMul);
      }
      const shapedPower = this.spectralComponents.reduce((sum, c, i) => {
        const a = c.amplitude * rawGains[i];
        return sum + a * a;
      }, 0);
      const powerNorm = Math.sqrt(shapedPower / componentPower) || 1;
      scene.spectralGains = rawGains.map(g => g / powerNorm);
      scene.spectralAmplitudeClasses = classes;
    }

    this.noiseRngMid = rngFor(seed, BASE_LAYER_VERSION, 'continuous', 'mid-noise');
    this.noiseRngSide = rngFor(seed, BASE_LAYER_VERSION, 'continuous', 'side-noise');
    this.noiseRngTexture = rngFor(seed, BASE_LAYER_VERSION, 'continuous', 'texture-noise');
    this.lp25 = new OnePoleLP(sampleRate, 25);
    this.lp115 = new OnePoleLP(sampleRate, 115);
    this.lp260 = new OnePoleLP(sampleRate, 260);
    this.lp700 = new OnePoleLP(sampleRate, 700);
    this.lp2500 = new OnePoleLP(sampleRate, 2500);
    this.sideLP = new OnePoleLP(sampleRate, 480);
    this.textureLP35 = new OnePoleLP(sampleRate, 35);
    this.textureLP120 = new OnePoleLP(sampleRate, 120);
    this.textureLP420 = new OnePoleLP(sampleRate, 420);
    this.textureLP1200 = new OnePoleLP(sampleRate, 1200);
    this.masterDrift = new SmoothRandom(deriveSeed(seed, BASE_LAYER_VERSION, 'master', 'level'), sampleRate, 2.0, 8.0, 1);
    this.spectralDrift = new SmoothRandom(deriveSeed(seed, BASE_LAYER_VERSION, 'master', 'spectrum'), sampleRate, 3.0, 11.0, 1);
    this.stereoDrift = new SmoothRandom(deriveSeed(seed, BASE_LAYER_VERSION, 'master', 'stereo'), sampleRate, 2.5, 10.0, 1);
    this.mechanicalPhase = rngFor(seed, BASE_LAYER_VERSION, 'mechanical-phase').range(0, TAU);

    const finalCutoff = this.profile.finalCutoff || 1800;
    this.finalL1 = new OnePoleLP(sampleRate, finalCutoff);
    this.finalL2 = new OnePoleLP(sampleRate, finalCutoff);
    this.finalR1 = new OnePoleLP(sampleRate, finalCutoff);
    this.finalR2 = new OnePoleLP(sampleRate, finalCutoff);

    this.eventPlan = this.#buildEventPlan();
    this.eventCursor = 0;
    this.activeEvents = [];
  }

  #sceneBlend() {
    const raw = this.sampleIndex / this.sceneFrames;
    const index = Math.min(this.scenePlan.length - 1, Math.floor(raw));
    const u = clamp(raw - index, 0, 1);
    const a = this.scenePlan[index];
    const b = this.scenePlan[Math.min(index + 1, this.scenePlan.length - 1)];
    const transitionStart = 1 - this.transitionFraction;
    const w = smoothstep((u - transitionStart) / Math.max(1e-6, this.transitionFraction));
    this.sceneA = a;
    this.sceneB = b;
    this.sceneW = w;
  }

  #updateSpectralControls() {
    const block = this.spectralControlBlock;
    for (const c of this.spectralComponents) {
      // Renormalize the recursive oscillator occasionally to avoid numerical drift.
      const mag = Math.hypot(c.sinPhase, c.cosPhase) || 1;
      c.sinPhase /= mag;
      c.cosPhase /= mag;
      const frequencyDrift = c.freqDrift.advance(block);
      const frequency = c.frequency * (1 + frequencyDrift);
      const angle = TAU * frequency / this.sampleRate;
      c.stepSin = Math.sin(angle);
      c.stepCos = Math.cos(angle);
      const targetAmp = clamp(1 + c.ampDrift.advance(block), 0.35, 1.75);
      c.ampStep = (targetAmp - c.ampMul) / block;
    }
    this.spectralControlRemaining = block;
  }

  #spectralSample(sceneA, sceneB, sceneW) {
    if (this.spectralControlRemaining <= 0) this.#updateSpectralControls();
    let left = 0, right = 0;
    for (let i = 0; i < this.spectralComponents.length; i++) {
      const c = this.spectralComponents[i];
      const s = c.sinPhase, co = c.cosPhase;
      const rightWave = s * c.cosStereoPhase + co * c.sinStereoPhase;
      const sceneGain = sceneW === 0 ? sceneA.spectralGains[i] : lerp(sceneA.spectralGains[i], sceneB.spectralGains[i], sceneW);
      const amplitude = c.amplitude * c.ampMul * sceneGain;
      left += s * amplitude * (1 - c.stereoBalance);
      right += rightWave * amplitude * (1 + c.stereoBalance);
      c.ampMul += c.ampStep;
      c.sinPhase = s * c.stepCos + co * c.stepSin;
      c.cosPhase = co * c.stepCos - s * c.stepSin;
    }
    this.spectralControlRemaining--;
    this.spectralLeft = left;
    this.spectralRight = right;
  }

  #buildEventPlan() {
    const spacing = this.profile.eventSpacing;
    const slotCount = Math.max(1, Math.ceil(this.durationSeconds / spacing));
    const weights = this.profile.eventWeights;
    const events = [];
    const typeSeed = deriveSeed(this.seed, BASE_LAYER_VERSION, 'event-types', this.profile.id, slotCount);
    for (let slot = 0; slot < slotCount; slot++) {
      const type = categoryAt(slot, slotCount, weights, typeSeed);
      if (type === 0) continue;
      const r = rngFor(this.seed, BASE_LAYER_VERSION, 'event', slot, type);
      const slotStart = slot * spacing;
      const start = clamp(slotStart + r.range(-0.22, 0.45) * spacing, 0, this.durationSeconds);
      const sceneIndex = Math.min(this.scenePlan.length - 1, Math.floor(start / (this.durationSeconds / this.scenePlan.length)));
      const sceneEventMul = this.scenePlan[sceneIndex].eventMul;
      const duration = r.range(type === 4 ? 0.8 : 2.7, type === 4 ? 2.6 : 8.5);
      const ranges = [[0, 0], [48, 135], [95, 240], [120, 390], [220, 680]];
      const freq = r.range(ranges[type][0], ranges[type][1]);
      const level = r.range(0.012, type === 4 ? 0.031 : 0.058) * sceneEventMul;
      const pan = r.range(-0.25, 0.25);
      const angle = (clamp(pan, -1, 1) + 1) * Math.PI / 4;
      events.push({
        type, start, duration, freq, level,
        pan, panLeft: Math.cos(angle), panRight: Math.sin(angle), phase: r.range(0, TAU),
        attackFrac: r.range(0.24, 0.52),
        fmRate: r.range(0.05, 0.31), fmDepth: r.range(0.003, 0.018),
        harmonicRatio: r.range(1.38, 1.83), harmonicLevel: r.range(0.16, 0.38)
      });
    }
    events.sort((a, b) => a.start - b.start);
    return events;
  }

  #eventSample(t) {
    while (this.eventCursor < this.eventPlan.length && this.eventPlan[this.eventCursor].start <= t) {
      this.activeEvents.push(this.eventPlan[this.eventCursor++]);
    }
    let left = 0, right = 0, write = 0;
    for (let i = 0; i < this.activeEvents.length; i++) {
      const e = this.activeEvents[i];
      if (t >= e.start + e.duration) continue;
      this.activeEvents[write++] = e;
      const u = clamp((t - e.start) / e.duration, 0, 1);
      const attack = u < e.attackFrac
        ? smoothstep(u / e.attackFrac)
        : smoothstep((1 - u) / (1 - e.attackFrac));
      const localT = t - e.start;
      const fm = 1 + e.fmDepth * Math.sin(TAU * e.fmRate * localT + e.phase * 0.31);
      const phase1 = TAU * e.freq * fm * localT + e.phase;
      const phase2 = TAU * e.freq * e.harmonicRatio * localT + e.phase * 0.73;
      let x = (Math.sin(phase1) + e.harmonicLevel * Math.sin(phase2));
      if (e.type === 4) x *= 0.72 + 0.28 * Math.sin(TAU * 1.7 * localT + e.phase * 0.2);
      x *= attack * e.level;
      left += x * e.panLeft;
      right += x * e.panRight;
    }
    this.activeEvents.length = write;
    this.eventLeft = left;
    this.eventRight = right;
  }

  #nextStereoInto() {
    const sr = this.sampleRate;
    const t = this.sampleIndex / sr;
    this.#sceneBlend();
    const { sceneA, sceneB, sceneW } = this;
    const inTransition = sceneW !== 0;

    const lowMul = inTransition ? lerp(sceneA.lowMul, sceneB.lowMul, sceneW) : sceneA.lowMul;
    const midMul = inTransition ? lerp(sceneA.midMul, sceneB.midMul, sceneW) : sceneA.midMul;
    const airMul = inTransition ? lerp(sceneA.airMul, sceneB.airMul, sceneW) : sceneA.airMul;
    const modalMul = inTransition ? lerp(sceneA.modalMul, sceneB.modalMul, sceneW) : sceneA.modalMul;
    const textureMul = inTransition ? lerp(sceneA.textureMul, sceneB.textureMul, sceneW) : sceneA.textureMul;
    const stereoMul = inTransition ? lerp(sceneA.stereoMul, sceneB.stereoMul, sceneW) : sceneA.stereoMul;
    const sceneLevelDb = inTransition ? lerp(sceneA.levelDb, sceneB.levelDb, sceneW) : sceneA.levelDb;
    const textureFlavor = inTransition ? lerp(sceneA.textureFlavor, sceneB.textureFlavor, sceneW) : sceneA.textureFlavor;
    const pulseRate = inTransition ? lerp(sceneA.pulseRate, sceneB.pulseRate, sceneW) : sceneA.pulseRate;
    const pulseDepth = inTransition ? lerp(sceneA.pulseDepth, sceneB.pulseDepth, sceneW) : sceneA.pulseDepth;

    this.sampleIndex++;

    const white = this.noiseRngMid.next() * 2 - 1;
    const low25 = this.lp25.tick(white);
    const audible = white - low25;
    const b115 = this.lp115.tick(audible);
    const b260 = this.lp260.tick(audible);
    const b700 = this.lp700.tick(audible);
    const b2500 = this.lp2500.tick(audible);

    const subBody = b115;
    const lowBody = b260 - b115;
    const lowMid = b700 - b260;
    const air = b2500 - b700;
    const spectralMove = this.spectralDrift.tick() * this.variation;

    let mid = subBody * this.profile.lowBody * 0.18 * lowMul
            + lowBody * this.profile.lowBody * lowMul * (1 + 0.10 * spectralMove)
            + lowMid * this.profile.midBody * midMul * (1 - 0.08 * spectralMove)
            + air * this.profile.air * airMul;

    // A second independent excitation path changes its low/mid texture mix by scene.
    // This prevents scene changes from being mere EQ/gain changes to the same noise bed.
    const tw = this.noiseRngTexture.next() * 2 - 1;
    const t35 = this.textureLP35.tick(tw);
    const ta = tw - t35;
    const t120 = this.textureLP120.tick(ta);
    const t420 = this.textureLP420.tick(ta);
    const t1200 = this.textureLP1200.tick(ta);
    const textureLow = t420 - t120;
    const textureMid = t1200 - t420;
    const lowWeight = 0.68 - 0.24 * textureFlavor;
    const midWeight = 0.30 + 0.34 * textureFlavor;
    this.mechanicalPhase += TAU * pulseRate / sr;
    if (this.mechanicalPhase > TAU) this.mechanicalPhase -= TAU;
    const pulse = 1 + pulseDepth * Math.sin(this.mechanicalPhase);
    mid += (textureLow * lowWeight + textureMid * midWeight) * this.profile.textureBase * textureMul * pulse;

    const overallModal = clamp(0.84 + 0.18 * modalMul, 0.88, 1.16);
    for (let modeIndex = 0; modeIndex < this.modes.length; modeIndex++) {
      const m = this.modes[modeIndex];
      const freq = m.baseFreq * (1 + m.drift.tick());
      m.phase += TAU * freq / sr;
      if (m.phase > TAU) m.phase -= TAU;
      const a = m.amp * (1 + m.ampDrift.tick());
      const focusGain = inTransition ? lerp(sceneA.modeGains[modeIndex], sceneB.modeGains[modeIndex], sceneW) : sceneA.modeGains[modeIndex];
      mid += Math.sin(m.phase) * a * focusGain * overallModal;
    }

    // Dense deterministic additive field: independent frequency magnitudes and phase
    // angles are superposed with slow independent amplitude/frequency evolution.
    this.#spectralSample(sceneA, sceneB, sceneW);
    const spectralL = this.spectralLeft;
    const spectralR = this.spectralRight;

    const sideWhite = this.noiseRngSide.next() * 2 - 1;
    const side = this.sideLP.tick(sideWhite) * this.profile.stereoSide * stereoMul
      * (0.75 + 0.25 * (1 + this.stereoDrift.tick()));
    const levelDriftDb = this.masterDrift.tick() * (0.65 + 1.35 * this.variation);
    const level = 10 ** ((levelDriftDb + sceneLevelDb) / 20);

    this.#eventSample(t);
    const evL = this.eventLeft;
    const evR = this.eventRight;
    const left = (mid + side + spectralL) * level + evL;
    const right = (mid - side + spectralR) * level + evR;
    this.outputLeft = this.finalL2.tick(this.finalL1.tick(left));
    this.outputRight = this.finalR2.tick(this.finalR1.tick(right));
  }

  nextStereo() {
    this.#nextStereoInto();
    return [this.outputLeft, this.outputRight];
  }

  renderInto(left, right) {
    const frames = Math.min(left.length, right.length);
    for (let i = 0; i < frames; i++) {
      this.#nextStereoInto();
      left[i] = this.outputLeft;
      right[i] = this.outputRight;
    }
    return frames;
  }

  render(frames) {
    const left = new Float32Array(frames);
    const right = new Float32Array(frames);
    this.renderInto(left, right);
    return [left, right];
  }
}

export function renderNoise({ seed, sampleRate, durationSeconds, profile, variation = 0.65, scenePace = 0.55, spectralDetail = 0.62 }) {
  const synth = new EnvironmentalNoiseSynth({ seed, sampleRate, durationSeconds, profile, variation, scenePace, spectralDetail });
  const frames = Math.round(durationSeconds * sampleRate);
  return synth.render(frames);
}
