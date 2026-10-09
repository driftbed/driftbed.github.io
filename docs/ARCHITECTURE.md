# Architecture — output recipe v4

## Deterministic identity

The v4 audio output identity is:

`outputRecipeVersion + environmentSynthVersion + sourceSpectrumNoiseVersion + seed + duration + sampleRate + profile + patternVariety + scenePace + spectralDetail`

The environment synthesizer remains algorithm v3. Source analysis drives the v1 source-spectrum follower and the source-relative gain plan. Video currently uses the established environment-only realtime path, so its validated output remains on the v3 synthesis contract.

Algorithm version 3 adds a deterministic per-frequency magnitude/phase field while retaining the version-2 calibrated environmental base layers in their own stable seed namespaces. Output recipe version 4 adds the separate audio-only source-spectrum layer without modifying `EnvironmentalNoiseSynth`.

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

## Source-spectrum-following audio layer

The follower is a separate streaming filterbank. Sixteen logarithmically spaced second-order band-pass filters cover approximately 40 Hz through 0.45 Nyquist. Each band analyzes source power with attack/release envelopes, applies a small log-frequency smoothing kernel at a 32-sample control rate, and modulates a separately seeded carrier passed through a matching synthesis filter. Carrier RMS is normalized from deterministic impulse-response energy so band levels are comparable.

Source activity is measured from the current input block and drives a soft gate. This prevents stale envelope state from producing a strong tail during digital silence while preserving smooth transitions. For stereo input, per-band cross-power estimates control a correlated pair of carriers; mono input is copied to both output channels.

The raw layers are normalized independently and combined before noise gain planning:

`rawNoise = sqrt(1 - q) × normalized(environment) + sqrt(q) × normalized(sourceSpectrum)`

where `q = 0.35` in the current recipe. The existing relative-noise and peak-safe master-gain stages then operate on this total noise layer. The exact post-gain contribution is still emitted as the noise-only output.

## Continuous loudness control

The UI exposes a source-relative dB offset from -60 dB to -3 dB, in 0.5 dB steps, plus quick presets. The gain planner estimates robust source program level and raw generated-noise level, then computes the gain needed to reach the requested offset.

## Audio mixing and dual output

Merged:

`(source + rawNoise × noiseGain) × masterGain`

Noise only:

`rawNoise × noiseGain × masterGain`

The noise-only WAV is therefore the exact isolated synthetic contribution used by the merged peak-safe path.

## Video path and dual output

The browser-native path uses `captureStream()`, Web Audio, and `MediaRecorder`. It currently uses the environment synthesizer only; the source-spectrum follower is not claimed for video until its realtime AudioWorklet/capture integration has its own equivalence and performance evidence. The path simultaneously records:

1. original video plus mixed source/noise audio; and
2. the same post-gain noise bus as separate audio-only WebM/Opus.

## Privacy

There is no upload API. Files remain local to the browser page.
