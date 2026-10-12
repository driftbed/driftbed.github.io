# Architecture — output recipe 8 and dual backend foundation

## Deterministic identity

The v8 audio output identity is:

`outputRecipeVersion + environmentSynthVersion + sourceSpectrumNoiseVersion + sourceFrequencyVariedNoiseVersion + sourceComponentModelVersion + sourceDriftVersion + processingBackend + engineAbiVersion + numericContractVersion + seed + duration + sampleRate + profile + patternVariety + scenePace + spectralDetail`

The environment synthesizer remains algorithm v3. Audio source analysis drives the v2 multi-component source-spectrum model and the source-relative gain plan. Video currently uses the established environment-only realtime path, so its validated output remains on the v3 synthesis contract.

Algorithm version 3 adds a deterministic per-frequency magnitude/phase field while retaining the version-2 calibrated environmental base layers in their own stable seed namespaces. Output recipe version 8 records the resolved processing backend and contract versions in addition to the separate audio-only multi-component source-spectrum, frequency-varied source-spectrum, and source-coupled drift layers. These metadata changes do not modify `EnvironmentalNoiseSynth`.

## Processing engine boundary

The application imports one public engine factory from `src/engine/engine.js`. The JavaScript backend wraps the validated implementation modules, including the current module-worker source-spectrum renderer and the browser-native video path. Automatic selection attempts the committed Wasm core first; if the core is unavailable, fails its ABI/numeric/self-test checks, or does not advertise the full DSP capability, it records the reason and falls back to JavaScript. A forced Wasm selection fails visibly instead of silently changing output semantics.

The Rust module in `rust/` is the first staged Wasm boundary. It uses no third-party crates, keeps raw-pointer handling inside `rust/src/abi.rs`, exposes a versioned ABI, and currently advertises only the validated scalar foundation capability. The full pipeline capability is intentionally reserved until browser parity, determinism, boundary, and performance checks pass. `rust/BUILD.md` is the reproducible build contract and `tests/wasm.test.mjs` tests the committed artifact directly.

## Engine benchmark contract

`benchmark.html` compares only capabilities advertised by both the JavaScript reference backend and the loaded Wasm artifact. The current shared set is the stereo PCM analysis kernel and PCM scaling kernel; environment synthesis, source analysis, NMF, source-noise rendering, source-coupled drift, and the complete audio pipeline are not benchmarked until the Wasm capability mask and backend implementation both support them.

The benchmark worker creates one deterministic stereo fixture, runs correctness probes before collecting timings, excludes warmups, interleaves backend order across measured rounds, and summarizes `performance.now()` samples with median, p90, interquartile range, and coefficient of variation. Results include backend startup separately from steady-state kernel timings. A hidden-tab transition invalidates an active run, and the report records the fixture, protocol, ABI, numeric contract, capability mask, browser environment, and preset so results are reproducible and not presented as a universal speed claim.

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

## Multi-component source-spectrum audio layer

The v2 source model is deliberately a latent acoustic decomposition, not semantic stem separation. It does not promise to identify vocals, instruments, or background music in an arbitrary completed mix.

1. A 24-band, 20 ms analysis timeline stores measured band power and stereo left/right/cross power.
2. Time and frequency median neighborhoods produce soft sustained, transient, and diffuse masks whose sum is one for every active cell.
3. The sustained power matrix is factorized with deterministic KL-NMF: farthest-point frame initialization, a maximum training-frame budget, fixed training iterations, fixed full-timeline activation iterations, template normalization, and duplicate-template merging.
4. NMF reconstruction ratios divide the sustained mask. Measured source power is then assigned to each latent component, transient component, and diffuse component so component powers sum back to the measured source power in every band/frame cell.
5. Every component receives independent deterministic band carriers, a component-level micro-modulation stream, activation-derived attack/release behavior, and its own stereo covariance. Components are recombined once and normalized only at the outer source-spectrum power-share boundary.

The analysis and factorization run in a module Web Worker during hosted audio generation when the browser supports module workers. A synchronous fallback preserves functionality in environments without `Worker`.

The source model's identity is `sourceSpectrumNoiseVersion = 2` and `sourceComponentModelVersion = 1`. The original v1 follower remains in `src/source-spectrum-noise.js` with its golden fixture for regression comparison; the v2 app path does not silently rewrite that contract.

## Frequency-varied source-spectrum stochastic layer

`src/source-frequency-varied-noise.js` consumes the same component model and never reads source PCM phase. `FrequencyDriftTimeline` creates deterministic, slow macro-plus-component trajectories in cents. The renderer applies bass, transient, edge, and Nyquist protection, forward-scatters each component's power in log frequency between the existing fixed synthesis bands, clamps stereo covariance to its physical bound, and renders with independent carrier/modulation namespaces. Only current and next warped frames are used by the sample renderer; no second component-by-band timeline is allocated.

The aligned and varied stochastic layers are normalized and combined inside the source worker with `sqrt(0.75)` / `sqrt(0.25)` weights. The result is returned as `sourceStochasticNoise`, while `renderSourceSpectrumNoise()` remains the historical aligned v2 API. WebAssembly does not advertise this feature until a full Rust implementation can pass parity checks.

## Source-coupled phase drift layer

The offline audio path derives a quiet coherent phase shadow from the same source-component model. `src/source-drift.js` owns the versioned renderer (`sourceDriftVersion = 1`) and never replaces the independent environmental/source-spectrum layers.

Three voices use fixed delay families of 0.2–0.8 ms, 1.2–4 ms, and 7–18 ms with 45/35/20 share. Each voice reads a ring buffer with linear fractional delay, transitions between deterministic delay targets with a convex crossfade, and applies fixed allpass stages plus gentle high-pass/low-pass protection. Voice input is activity-controlled, but delay/filter state is allowed to decay naturally. Mono is copied exactly; stereo uses source-derived covariance and a small deterministic channel offset.

The coherent layer is never RMS-normalized. Its summed wet gain is bounded by a normal budget of 0.10 and an absolute ceiling of 0.18, leaving a positive dry floor even under worst-case opposition. `planCompositeAddedSignal` first allocates drift downward to the requested power share, then solves the independent-noise gain using the measured finite noise/drift cross-term. A sample-accurate peak scan determines one shared master trim. The merged path is `source + independentNoise × noiseGain + drift × driftGain`; the noise-only path is the exact post-gain `independentNoise × noiseGain + drift × driftGain` contribution. The video path is unchanged.

## Historical v1 source-spectrum-following audio layer

The follower is a separate streaming filterbank. Sixteen logarithmically spaced second-order band-pass filters cover approximately 40 Hz through 0.45 Nyquist. Each band analyzes source power with attack/release envelopes, applies a small log-frequency smoothing kernel at a 32-sample control rate, and modulates a separately seeded carrier passed through a matching synthesis filter. Carrier RMS is normalized from deterministic impulse-response energy so band levels are comparable.

Source activity is measured from the current input block and drives a soft gate. This prevents stale envelope state from producing a strong tail during digital silence while preserving smooth transitions. For stereo input, per-band cross-power estimates control a correlated pair of carriers; mono input is copied to both output channels.

The historical raw layers are normalized independently and combined before noise gain planning:

`rawNoise = sqrt(1 - q) × normalized(environment) + sqrt(q) × normalized(sourceSpectrum)`

where `q = 0.35` in the current recipe. The existing relative-noise and peak-safe master-gain stages then operate on this total noise layer. The exact post-gain contribution is still emitted as the noise-only output.

## Continuous loudness control

The UI exposes a source-relative dB offset from -60 dB to -3 dB, in 0.5 dB steps, plus quick presets. The gain planner estimates robust source program level and raw generated-noise level, then computes the gain needed to reach the requested offset.

## Audio mixing and dual output

Merged:

`(source + rawNoise × noiseGain + sourceDrift × driftGain) × masterGain`

Noise only:

`(rawNoise × noiseGain + sourceDrift × driftGain) × masterGain`

The noise-only WAV is therefore the exact isolated synthetic contribution used by the merged peak-safe path.

## Media duration and encoding correctness

Offline audio treats decoded PCM frame count as authoritative. `decodeFileToPcm()` returns `frameCount` and derives duration as `frameCount / sampleRate`; every generated layer is checked against that exact count before mixing and the strict PCM16 WAV encoder rejects unequal channels, invalid sample rates, oversized RIFF values, and non-finite samples. `inspectWav()` re-reads the emitted header and data chunk so frame-count regressions are testable without relying on container duration metadata.

Realtime video starts both `MediaRecorder` instances without a timeslice, starts playback immediately after recorder startup, and stops both recorders from the source `ended` boundary. `src/webm-container.js` reads EBML `TimestampScale`, `Info/Duration`, `Tracks`, and `Cluster` metadata; export also measures browser playback duration. A video download is exposed only when source-timeline, container, and playback durations all fall within the shared tolerance. Cleanup stops tracks, disconnects Web Audio nodes, clears progress timers, closes the audio context, and revokes the object URL in a `finally` path.

## Video path and dual output

The browser-native path uses `captureStream()`, Web Audio, and `MediaRecorder`. It currently uses the environment synthesizer only; the multi-component source-spectrum model is not claimed for video until its realtime AudioWorklet/capture integration has its own equivalence and performance evidence. The path simultaneously records:

1. original video plus mixed source/noise audio; and
2. the same post-gain noise bus as separate audio-only WebM/Opus.

## Privacy

There is no upload API. Files remain local to the browser page.
