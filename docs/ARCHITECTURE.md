# Architecture — synthesis algorithm v3

## Deterministic identity

`algorithmVersion + seed + duration + sampleRate + profile + patternVariety + scenePace + spectralDetail` defines the raw synthetic background. Source analysis plus `relativeNoiseDb` deterministically defines its gain for the merged audio path.

Algorithm version 3 adds a deterministic per-frequency magnitude/phase field while retaining the version-2 calibrated environmental base layers in their own stable seed namespaces.

## Timeline dataset

The media duration is divided into deterministic scene slots. Each slot is one generated dataset object.

1. Environment profile supplies exact scene-category weights.
2. Largest-remainder integerization computes exact counts.
3. Seeded Feistel permutation plus cycle walking scatters category positions.
4. Each slot receives an independent local stream.
5. Neighboring slots inherit shared macro-scene state from a coarse group index.
6. Scene parameters crossfade without resetting filters or oscillators.

## Frequency-component dataset

The spectral field is a second object collection.

1. `spectralDetail` chooses a component count inside a profile-specific range.
2. Profile low/mid/high frequency-band weights are integerized exactly.
3. Seeded category assignment scatters those bands across component indices.
4. Every component receives independent frequency, magnitude, phase, stereo phase, stereo balance, amplitude drift, and frequency drift.
5. Base component powers are normalized to the profile's spectral-field target RMS.

## Per-scene frequency amplitudes

Every scene deterministically assigns the component population into five exact weighted amplitude classes. The allocation is seed-permuted independently by scene.

Each component gain combines:

- exact amplitude class
- shared frequency-group context
- independent scene/component jitter
- scene focus frequency and width
- broad regime low/mid/air tendency

The gains are then weighted-power normalized so the spectral field keeps approximately constant aggregate power despite large spectral-shape changes.

## Additive synthesis implementation

Each component is a phase-continuous recursive oscillator. Frequency and amplitude controls update at a 128-sample control interval; oscillator phase itself advances every sample.

The recursive oscillator avoids calling `sin()` separately for every frequency and every audio sample, allowing dozens of components to run comfortably in the browser.

The right-channel waveform is calculated from the same sine/cosine state plus a deterministic phase offset, maintaining physical coherence rather than generating an unrelated channel.

## Natural-sound model

The complete synth combines:

1. deterministic additive frequency field with independent amplitude/phase structure;
2. low-frequency resonant modes with smooth frequency and amplitude drift;
3. primary filtered stochastic excitation;
4. secondary independently seeded stochastic texture;
5. weak decorrelated stereo-side texture;
6. slow master/spectral/stereo control fields;
7. scene-dependent mechanical pulse modulation;
8. sparse deterministic environmental micro-events;
9. smooth scene crossfades with continuous DSP state.

The additive field supplies structured frequency-by-frequency differences. The filtered stochastic paths fill the continuum between explicit components so the result does not reduce to audible pure tones.

## Loudness stability

Pattern variety is expressed primarily through spectral and structural changes. Scene-level offsets are modest, master drift is bounded, and spectral-field scene gains are explicitly power-normalized.

The validation suite checks both meaningful temporal spectral movement and bounded multi-second loudness variation.

## Continuous loudness control

The UI exposes a source-relative dB offset from -60 dB to -3 dB, in 0.5 dB steps, plus quick presets. The gain planner estimates robust source program level and raw generated-noise level, then computes the gain needed to reach the requested offset.

## Audio mixing and dual output

Merged:

`(source + rawNoise × noiseGain) × masterGain`

Noise only:

`rawNoise × noiseGain × masterGain`

The noise-only WAV is therefore the exact isolated synthetic contribution used by the merged peak-safe path.

## Video path and dual output

The browser-native path uses `captureStream()`, Web Audio, and `MediaRecorder`. It simultaneously records:

1. original video plus mixed source/noise audio; and
2. the same post-gain noise bus as separate audio-only WebM/Opus.

## Privacy

There is no upload API. Files remain local to the browser page.
