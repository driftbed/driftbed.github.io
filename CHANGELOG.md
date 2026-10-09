# Changelog

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
