# Changelog

## v1.11.0 — capability-driven video export

- Added capability probing for direct media capture, canvas capture, presented-frame callbacks, and paired MediaRecorder profiles.
- Added a canvas compatibility path for browsers without `HTMLVideoElement.captureStream()`, preserving decoded portrait dimensions and using `requestVideoFrameCallback()` when available.
- Added WebM/MP4 container sniffing, minimal ISO-BMFF inspection, fragmented-MP4 metadata handling, and format-aware duration auditing.
- Made video preflight, recorder selection, output extensions, and implementation notes reflect actual browser capabilities instead of recommending a browser brand.
- Added focused tests for MP4 parsing, recorder negotiation, portrait canvas capture, and service-worker cache coverage.

## v1.10.0 — frequency-varied source-spectrum noise

- Added a deterministic frequency-varied stochastic source layer beside the unchanged aligned source-spectrum v2 renderer and coherent Source Drift v1 layer.
- Warps component power in log frequency using slow hierarchical cent trajectories, bass/transient/Nyquist/edge protection, power-conserving forward scatter, and preserved stereo covariance. It never pitch-shifts or reuses source waveform phase.
- Combines the aligned and varied source-following stochastic layers in the source worker at a fixed 25% varied share, preserving the existing outer 0.35 source-follow power share and exact PCM duration.
- Added deterministic trajectory, cents-mapping, power-conservation, direction, stereo/mono, silence, duration, worker, and recipe/cache regression coverage.
- Bumped the user-visible app to 1.10.0 and the offline audio output recipe to 8. WebAssembly remains honestly unavailable for this feature until a full Rust parity implementation exists.

## v1.9.1 — media duration and encoding correctness

- Made decoded PCM frame count authoritative for offline-audio synthesis and WAV output duration, with strict channel-shape, sample-rate, finite-sample, and RIFF validation.
- Added WAV inspection tests covering exact frame counts at 44.1 kHz and 48 kHz for mono and stereo output.
- Removed the realtime video recorder timeslice, synchronized recorder startup and end-of-source stopping, added zero-fill and structured cleanup on teardown, and added source/wall/container/playback duration diagnostics.
- Added a read-only WebM EBML inspector with safe in-place repair support for an existing 32-bit or 64-bit Duration element; missing metadata remains a controlled validation failure.
- Bumped only the application/cache graph. The v7 output recipe and synthesis algorithms are unchanged.

## v1.9.0 — source-coupled phase drift

- Added a reusable source-coupled phase-drift renderer for offline audio. It uses three bounded fixed-delay voices, linear fractional-delay reads, convex delay transitions, fixed allpass diffusion, source-derived activity/transient controls, and source-aware stereo offsets.
- Kept the coherent contribution separate from independent noise planning. A downward-only drift allocation, finite noise/drift cross-term, exact peak scan, and shared master trim preserve the merged/noise-only contribution invariant without RMS-normalizing the coherent layer.
- Added a high-level source-derived engine API and module-worker path while preserving the existing source-spectrum API. The JavaScript backend advertises the new capability; the Wasm backend and source-drift benchmark row remain unavailable until parity exists.
- Bumped the offline audio output recipe and PWA cache graph to v1.9.0. Video remains on the validated environment-only realtime path.

## v1.8.2 — capability-aware engine benchmark

- Added a dedicated benchmark page with deterministic stereo fixtures, correctness gates, warmups, interleaved worker timing, median/p90/IQR/CV summaries, report export, and hidden-tab invalidation.
- Compare only the shared PCM analysis and scaling kernels currently implemented by JavaScript and the staged Wasm foundation; environment synthesis, source analysis, NMF, source rendering, and complete-pipeline rows remain visibly unavailable until both backends support them.
- Added cache-busted benchmark modules, mobile-friendly responsive controls, keyboard focus states, reduced-motion handling, and a main-page link to the benchmark.

## v1.7.0 — Wasm-first backend foundation

- Added a pinned, dependency-free Rust `wasm32-unknown-unknown` build with a versioned ABI, numeric contract, deterministic self-test, and checked scalar PCM functions.
- Added one backend-neutral processing-engine API with automatic WebAssembly preference, explicit JavaScript reference selection, and visible forced-Wasm failure when the complete Wasm DSP pipeline is not yet available.
- Routed audio and video generation through the shared engine API while preserving the validated JavaScript renderer and all existing golden fixtures.
- Added engine backend, ABI, and numeric-contract metadata to copied recipes.
- Added direct Node tests for the committed Wasm binary and refreshed the versioned PWA shell to cache it offline.

## v1.6.0 — multi-component source-spectrum audio model

- Added a 24-band, 20 ms source analysis timeline with soft sustained, transient, and diffuse masks.
- Added deterministic KL-NMF latent spectral components with bounded training, fixed activation inference, normalized templates, and duplicate merging.
- Added exact ratio-mask power partitioning so latent component power sums back to measured source power per band and frame.
- Added independent component carriers, component-level micro-modulation, activation-derived dynamics, and per-component stereo covariance.
- Moved audio source analysis and rendering to a module Web Worker when available, with a synchronous fallback.
- Preserved the v1 source-spectrum follower and its golden fixture; video remains on the validated environment-only path.
- Bumped the audio recipe to v5 and refreshed the PWA cache graph to v1.6.0.

## v1.5.1 — cache-bust changed browser modules

- Versioned the changed loudness and source-spectrum module URLs as well as the application entry so an already-active previous service worker cannot combine the new app with stale module exports during its activation window.

## v1.5.0 — source-spectrum-following audio noise

- Added a deterministic `SourceSpectrumNoiseFollower` filterbank that follows source spectral energy with smoothed power envelopes, source-activity gating, carrier normalization, and stereo covariance.
- Combined environmental and source-spectrum noise by explicit power share before the existing relative-level and peak-safe gain plan.
- Versioned output recipes separately from the preserved v3 environmental synthesizer and added deterministic DSP/golden-fixture tests.
- Refreshed the service-worker shell cache and documented that the new follower currently applies to offline audio generation; the realtime video path remains on the validated environment-only path.

## v1.4.0 — installable PWA

- Added a web app manifest, install metadata, and app icons for mobile home-screen installation.
- Added an Android/Chromium install prompt when the browser makes it available.
- Added iPhone/iPad Safari installation guidance.
- Added a versioned service-worker app shell for faster and offline relaunch of the interface.

## v1.3.0 — synthesis algorithm v3

- Added deterministic additive spectral field.
- Added independent per-frequency amplitude, initial phase, stereo phase offset, stereo balance, amplitude drift, and frequency drift.
- Added exact weighted low/mid/high spectral-component counts.
- Added exact weighted per-scene component amplitude classes with seeded permutation.
- Added hierarchical frequency-group correlation plus independent per-component scene jitter.
- Added scene spectral power normalization to avoid loudness jumps.
- Added Frequency detail / spectral complexity UI control.
- Added spectral-field metrics and two new automated tests.
- Preserved version-2 environmental base-layer seed namespaces while adding v3 spectral namespaces.

## v1.2.0 — synthesis algorithm v2

- Applied deterministic exact-weighted regime planning to the whole media timeline.
- Added crossfaded acoustic regimes, macro-scene hierarchy, and stronger time variation.

## v1.1.0

- Added continuous -60 dB to -3 dB source-relative noise-strength control.
- Added simultaneous noise-only preview/download output.

## v1.0.0

- Initial deterministic environmental noise web tool.
