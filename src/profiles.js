// Scene regimes are shared deterministic "templates". Individual timeline slots derive
// their own parameters from these templates using domain-separated seeded streams.
// The exact weighted composition of these regimes is planned per media item.
export const SCENE_REGIMES = [
  {
    id: 'calm', name: 'Calm room tone',
    low: 0.92, mid: 0.92, air: 0.82, modal: 0.82, texture: 0.78,
    stereo: 0.86, levelDb: -0.3, focusHz: 185, focusWidth: 0.70,
    focusStrength: 0.55, textureFlavor: -0.05, pulseRate: 0.19, pulseDepth: 0.035, eventMul: 0.45
  },
  {
    id: 'deepRumble', name: 'Deep structural rumble',
    low: 1.38, mid: 0.66, air: 0.30, modal: 1.12, texture: 0.95,
    stereo: 0.62, levelDb: 0.3, focusHz: 118, focusWidth: 0.48,
    focusStrength: 0.95, textureFlavor: -0.72, pulseRate: 0.11, pulseDepth: 0.055, eventMul: 0.85
  },
  {
    id: 'ventilation', name: 'Ventilation flow',
    low: 0.86, mid: 1.28, air: 1.20, modal: 0.70, texture: 1.34,
    stereo: 1.08, levelDb: 0.1, focusHz: 285, focusWidth: 0.62,
    focusStrength: 0.48, textureFlavor: 0.56, pulseRate: 0.34, pulseDepth: 0.10, eventMul: 1.05
  },
  {
    id: 'resonance', name: 'Resonant machinery',
    low: 0.98, mid: 0.82, air: 0.48, modal: 1.58, texture: 0.72,
    stereo: 0.72, levelDb: 0.2, focusHz: 215, focusWidth: 0.31,
    focusStrength: 1.34, textureFlavor: -0.20, pulseRate: 0.48, pulseDepth: 0.075, eventMul: 0.78
  },
  {
    id: 'distantActivity', name: 'Distant activity',
    low: 1.12, mid: 1.18, air: 0.82, modal: 0.88, texture: 1.20,
    stereo: 1.18, levelDb: 0.5, focusHz: 165, focusWidth: 0.68,
    focusStrength: 0.70, textureFlavor: 0.10, pulseRate: 0.67, pulseDepth: 0.12, eventMul: 1.30
  },
  {
    id: 'lull', name: 'Quiet lull',
    low: 0.68, mid: 0.63, air: 0.55, modal: 0.62, texture: 0.54,
    stereo: 0.70, levelDb: -1.2, focusHz: 180, focusWidth: 0.82,
    focusStrength: 0.35, textureFlavor: -0.10, pulseRate: 0.08, pulseDepth: 0.02, eventMul: 0.18
  },
  {
    id: 'airyShift', name: 'Air / spectral shift',
    low: 0.70, mid: 1.02, air: 1.55, modal: 0.64, texture: 1.12,
    stereo: 1.36, levelDb: -0.1, focusHz: 335, focusWidth: 0.72,
    focusStrength: 0.42, textureFlavor: 0.82, pulseRate: 0.27, pulseDepth: 0.08, eventMul: 0.66
  }
];

export const PROFILES = {
  natural: {
    id: 'natural', name: 'Natural / Neutral',
    modalCount: [3, 5], modalFreq: [75, 430], modalBandWeights: [0.24, 0.50, 0.26], modalLevel: 0.22,
    spectralCount: [14, 30], spectralFreq: [42, 1500], spectralBandWeights: [0.28, 0.46, 0.26], spectralLevel: 0.095, spectralTilt: -0.38,
    lowBody: 0.76, midBody: 0.16, air: 0.025, textureBase: 0.12, stereoSide: 0.10,
    driftAmount: 0.16, finalCutoff: 1600, eventSpacing: 9.0,
    eventWeights: [0.58, 0.18, 0.13, 0.08, 0.03],
    sceneSpacing: 8.5, sceneGroupSize: 3, sceneFocusScale: 0.95, textureFlavorBias: -0.08,
    sceneWeights: [0.23, 0.16, 0.16, 0.14, 0.12, 0.11, 0.08]
  },
  indoorLow: {
    id: 'indoorLow', name: 'Indoor Low Frequency',
    modalCount: [4, 6], modalFreq: [90, 360], modalBandWeights: [0.20, 0.60, 0.20], modalLevel: 0.23,
    spectralCount: [16, 32], spectralFreq: [48, 680], spectralBandWeights: [0.22, 0.61, 0.17], spectralLevel: 0.040, spectralTilt: -0.46,
    lowBody: 0.95, midBody: 0.14, air: 0.004, textureBase: 0.11, stereoSide: 0.07,
    driftAmount: 0.13, finalCutoff: 700, eventSpacing: 10.0,
    eventWeights: [0.60, 0.20, 0.12, 0.06, 0.02],
    sceneSpacing: 8.0, sceneGroupSize: 3, sceneFocusScale: 0.82, textureFlavorBias: -0.28,
    sceneWeights: [0.15, 0.25, 0.13, 0.24, 0.08, 0.11, 0.04]
  },
  hvac: {
    id: 'hvac', name: 'HVAC / Ventilation',
    modalCount: [3, 5], modalFreq: [65, 560], modalBandWeights: [0.18, 0.48, 0.34], modalLevel: 0.25,
    spectralCount: [16, 34], spectralFreq: [45, 2200], spectralBandWeights: [0.18, 0.48, 0.34], spectralLevel: 0.11, spectralTilt: -0.24,
    lowBody: 0.64, midBody: 0.30, air: 0.075, textureBase: 0.18, stereoSide: 0.13,
    driftAmount: 0.18, finalCutoff: 2400, eventSpacing: 8.0,
    eventWeights: [0.50, 0.27, 0.13, 0.07, 0.03],
    sceneSpacing: 7.5, sceneGroupSize: 3, sceneFocusScale: 1.00, textureFlavorBias: 0.12,
    sceneWeights: [0.14, 0.10, 0.31, 0.14, 0.08, 0.12, 0.11]
  },
  quietRoom: {
    id: 'quietRoom', name: 'Quiet Room',
    modalCount: [2, 4], modalFreq: [80, 330], modalBandWeights: [0.25, 0.55, 0.20], modalLevel: 0.15,
    spectralCount: [12, 26], spectralFreq: [55, 1400], spectralBandWeights: [0.30, 0.50, 0.20], spectralLevel: 0.072, spectralTilt: -0.44,
    lowBody: 0.46, midBody: 0.19, air: 0.045, textureBase: 0.08, stereoSide: 0.08,
    driftAmount: 0.08, finalCutoff: 1700, eventSpacing: 16.0,
    eventWeights: [0.78, 0.10, 0.07, 0.04, 0.01],
    sceneSpacing: 11.0, sceneGroupSize: 4, sceneFocusScale: 0.90, textureFlavorBias: -0.12,
    sceneWeights: [0.36, 0.08, 0.12, 0.10, 0.04, 0.24, 0.06]
  },
  urbanDistant: {
    id: 'urbanDistant', name: 'Urban Distant',
    modalCount: [3, 5], modalFreq: [50, 500], modalBandWeights: [0.24, 0.42, 0.34], modalLevel: 0.22,
    spectralCount: [16, 36], spectralFreq: [38, 2800], spectralBandWeights: [0.24, 0.40, 0.36], spectralLevel: 0.105, spectralTilt: -0.20,
    lowBody: 0.66, midBody: 0.25, air: 0.07, textureBase: 0.16, stereoSide: 0.16,
    driftAmount: 0.21, finalCutoff: 3000, eventSpacing: 7.5,
    eventWeights: [0.45, 0.23, 0.16, 0.11, 0.05],
    sceneSpacing: 6.8, sceneGroupSize: 3, sceneFocusScale: 0.95, textureFlavorBias: 0.10,
    sceneWeights: [0.12, 0.18, 0.10, 0.12, 0.31, 0.08, 0.09]
  }
};

// Offsets are relative to the robust source level. Users can override these
// continuously from -60 dB to -3 dB in the UI.
export const STRENGTH_PRESETS = {
  extremelyWeak: { label: 'Extremely weak', db: -48 },
  verySubtle: { label: 'Very subtle', db: -40 },
  subtle: { label: 'Subtle', db: -32 },
  natural: { label: 'Natural', db: -27 },
  stronger: { label: 'Stronger', db: -22 },
  strong: { label: 'Strong', db: -16 },
  veryStrong: { label: 'Very strong', db: -10 }
};

export const STRENGTH_DB = Object.fromEntries(
  Object.entries(STRENGTH_PRESETS).map(([key, value]) => [key, value.db])
);
