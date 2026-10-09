# Changelog

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
