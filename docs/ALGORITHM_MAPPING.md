# Mapping the Generalized Deterministic Dataset Algorithm to Audio v6

Version 5 treats both **time** and **frequency** as deterministic synthetic datasets and adds a deterministic multi-component source-spectrum stochastic layer for offline audio. The existing environmental synthesizer remains version 3.

## 1. Timeline objects

A timeline slot is one dataset object:

`scene(i) = F(seed, baseLayerVersion, profile, duration, scenePace, i)`

Exact weighted category counts are calculated with largest remainder, and a seeded Feistel/cycle-walk permutation scatters the categories through time.

Categories include calm room tone, deep structural rumble, ventilation flow, resonant machinery, distant activity, quiet lull, and air/spectral shift.

## 2. Frequency-component objects

A spectral component is a second kind of deterministic object:

`component(j) = F(seed, algorithmVersion, profile, spectralDetail, j)`

Each component is independently reconstructible and owns domain-separated properties:

- frequency
- base magnitude
- initial phase angle
- stereo phase offset
- stereo balance
- amplitude drift
- frequency drift

The component count is controlled by `spectralDetail` within profile-specific bounds.

## 3. Exact weighted frequency-band composition

Every environment profile defines low/middle/high spectral-component weights. Largest-remainder integerization gives exact band counts for the chosen component count. Seeded category assignment scatters those bands across component indices.

For the included Indoor Low demo, the 27-component field is exactly:

- low band: 6
- middle band: 16
- high band: 5

The expected counts are also `[6, 16, 5]`.

## 4. Independent amplitudes

Each component gets an independently derived bounded log-amplitude. The profile's spectral tilt shapes the long-run envelope without making neighboring frequencies share the same amplitude.

The entire field is then RMS-power normalized so one lucky component cannot dominate the generated environment.

This directly applies the supplied algorithm's principle that every object owns its own deterministic random stream.

## 5. Independent phase angles

Each frequency component receives an independently derived initial phase `phi_j` in `[0, 2π)`.

Its oscillator remains phase-continuous for the entire media duration. A tiny independent frequency drift means relative phase differences keep evolving with time:

`phi_j(t + dt) = phi_j(t) + 2π f_j(t) dt`

The right channel receives a small frequency-dependent phase offset and amplitude-balance offset for the same component, modeling spatial/path differences while keeping low-frequency content strongly coherent.

## 6. Per-scene frequency amplitudes as another exact dataset

For every scene `i`, all spectral components `j` are assigned one of five amplitude classes:

1. suppressed
2. low
3. nominal
4. emphasized
5. strongly emphasized

The class weights are fixed at:

`[0.12, 0.23, 0.34, 0.23, 0.08]`

Largest remainder makes the class counts exact. For a 27-component field, every scene therefore has exactly:

`[4, 6, 9, 6, 2]`

The assignment is permuted independently per scene, so the same set of exact global counts produces a different frequency-energy pattern in each scene.

## 7. Hierarchical correlation across frequency

Components are placed into small deterministic frequency groups. A scene-group/frequency-group stream adds a shared local tendency, while every component also receives an independent local stream.

This applies the supplied algorithm's hierarchical-correlation model in the frequency dimension:

`shared frequency-region context + independent per-frequency variation`

## 8. Scene focus and structured entropy

The amplitude class is not the only influence. Each scene also has a focus frequency/width, low/mid/air tendencies, and local component jitter.

For component `j` in scene `i`:

`rawGain(i,j) = amplitudeClass × groupFactor × localFactor × focusFactor × regimeFactor`

This produces structured, realistic spectral variation rather than independent white-noise bins.

## 9. Power normalization

After every scene's per-frequency gains are calculated, they are normalized against the base component amplitudes:

`sum_j (A_j × G_ij)^2 ≈ sum_j A_j^2`

The included validation measures a scene power ratio of essentially `1.0` for every demo scene.

This is crucial: scene-to-scene spectral differences remain audible, but they do not become arbitrary loudness jumps.

## 10. Superposition

The additive spectral layer is:

`L(t) = Σ_j A_j(t) G_j(t) sin(phi_j(t))`

`R(t) = Σ_j A_j(t) G_j(t) B_j sin(phi_j(t) + delta_j)`

where:

- `A_j(t)` is the independently drifting amplitude,
- `G_j(t)` is the crossfaded scene-dependent amplitude gain,
- `phi_j(t)` is the phase-continuous oscillator phase,
- `delta_j` is the deterministic stereo phase offset,
- `B_j` is the deterministic stereo balance term.

This additive layer is combined with the existing filtered stochastic layers, resonant modes, and sparse environmental events. The stochastic layers fill the continuous spectrum between explicit components and prevent the output from sounding like a bank of obvious pure tones.

## 11. Domain-separated streams

Version 3 uses separate namespaces for:

- timeline category plan
- macro-scene groups
- local scene slots
- legacy resonant modes
- continuous stochastic layers
- spectral component band assignment
- each spectral component's base properties
- each component's amplitude drift
- each component's frequency drift
- per-scene amplitude-class assignment
- frequency-group scene context
- per-scene/per-component local gain
- environmental event types
- individual events

Adding a new property in one domain does not require changing unrelated domains.

## 12. Versioning and v2 continuity

The public synthesis identity is now:

`ALGORITHM_VERSION = 3`

Version 3 deliberately changes PCM by adding the deterministic spectral field.

The established version-2 environmental base layers keep their version-2 seed namespaces. This avoids unnecessarily randomizing the already-calibrated v2 timeline/stochastic/modal behavior; v3 adds new domain-separated spectral namespaces on top.

The complete v3 environmental identity is:

`algorithmVersion + seed + duration + sampleRate + profile + variation + scenePace + spectralDetail`

## 13. Multi-component source-spectrum stochastic layer

The audio output recipe adds a second source-dependent dataset without changing the v3 environment data. The model is intentionally latent and structural; it does not claim semantic vocal/instrumental stems:

`sourceModel = F(sourcePCM, sourceSpectrumNoiseVersion=2, sourceComponentModelVersion=1, sampleRate)`

Twenty-four logarithmic bands at 20 ms frames estimate power and left/right cross-power. Soft time/frequency median masks separate sustained, transient, and diffuse structure. Deterministic KL-NMF factorizes sustained power into four templates and full-timeline activations. Exact ratio masks assign measured power to all component layers, preserving the invariant `sum_k P[k,b,t] = V[b,t]` within floating-point tolerance. Each component modulates independently seeded, band-limited carriers and retains its own activation dynamics, small shared micro-modulation, and stereo covariance.

The raw source-following layer is normalized once and combined with the normalized environmental layer by power share before source-relative gain planning:

`rawNoise = sqrt(1 - q) × environment + sqrt(q) × sourceSpectrum`

with `q = 0.35` in the current recipe. The v6 recipe records `environmentSynthVersion = 3`, `sourceSpectrumNoiseVersion = 2`, `sourceComponentModelVersion = 1`, `processingBackend`, `engineAbiVersion`, `numericContractVersion`, and `algorithmVersion = 6` so the stable environmental contract, backend contract, and new audio layer can evolve independently. The realtime video implementation remains on the v3 environment-only path until an equivalent streaming integration is validated.
