# Driftbed

Loop-free ambient beds for audio and video.

**Try it now: [driftbed.github.io](https://driftbed.github.io)**

Driftbed adds natural, evolving environmental background to a user-supplied audio or video file. It runs entirely in the browser, does not upload the source file, and produces both the mixed media and the exact noise contribution used in the mix.

## What it does

- Generates naturalistic ambient beds without looping a recording.
- Changes acoustic regimes gradually so the background does not feel static.
- Uses deterministic seeds so the same recipe can reproduce the same background.
- Provides environments such as quiet rooms, indoor low frequency, ventilation, and distant urban activity.
- Lets you control relative level, pattern variety, scene pace, and spectral detail.
- Exports merged audio as WAV and merged video as WebM in Chromium-based browsers.
- Exports a separately previewable/downloadable noise-only track.
- For audio, adds deterministic source-spectrum-following stochastic layers. A soft harmonic/transient analysis and deterministic nonnegative matrix factorization discover latent spectral-temporal components, while preserving the measured source power partition. These are acoustic feature layers, not claimed semantic voice, instrument, or music stems.
- Uses one backend-neutral processing-engine API. Automatic mode probes the committed Wasm core and safely falls back to the JavaScript reference path until the full Wasm DSP pipeline passes parity gates.

## Privacy

The web app processes the selected file locally with browser APIs. The source media is not uploaded to a server.

## Use the hosted app

1. Open [driftbed.github.io](https://driftbed.github.io).
2. Drop in an audio or video file.
3. Choose an environment and adjust the background level.
4. Optionally change the seed and variety controls.
5. Select **Generate outputs**.
6. Preview or download the merged media and the noise-only track.

For the same output recipe version, seed, environment, duration, sample rate, and control values, the generated raw background is reproducible. Audio recipes record the preserved environment synthesizer version, source-spectrum noise version, component-model version, resolved backend, ABI version, and numeric-contract version separately. The source file still affects the component model and final source-relative gain plan.

## Install on a phone

Driftbed is a Progressive Web App and can be installed without an app store.

- **iPhone or iPad:** Open [driftbed.github.io](https://driftbed.github.io) in Safari, tap **Share**, choose **Add to Home Screen**, turn on **Open as Web App**, then tap **Add**.
- **Android:** Open the site in a supported browser such as Chrome. Use the in-page **Install app** button when it appears, or choose **Install app** / **Add to Home screen** from the browser menu.

The service worker caches the application shell so the installed interface can relaunch during a temporary network outage. It does not cache user-selected media or generated output files.

## Run locally

Requirements: Node.js 20 or newer. No package installation is required.

```bash
npm start
```

Then open [http://127.0.0.1:8080](http://127.0.0.1:8080).

Run the test suite with:

```bash
npm test
```

The video path uses `HTMLVideoElement.captureStream()` and `MediaRecorder`, so current Chromium-based browsers are recommended for video export. Audio support follows the browser's `decodeAudioData()` support.

### Wasm development status

The repository includes a pinned Rust toolchain and a committed `wasm/driftbed_core.wasm` artifact. The current artifact validates the shared ABI, numeric contract, deterministic self-test, and scalar PCM boundary, but it intentionally does not claim the complete DSP pipeline. Automatic mode therefore preserves the JavaScript reference backend. Use the **WebAssembly (experimental)** setting only when testing the staged core; it reports a visible error instead of silently changing output semantics.

The build contract is documented in [`rust/BUILD.md`](rust/BUILD.md). The Wasm binary is built without third-party crates and is cached by the service worker for installed/offline launches.

## How it works

The synthesis engine combines deterministic layers:

1. A timeline of weighted acoustic regimes, smoothly crossfaded over the media duration.
2. An independently seeded spectral field whose components have their own frequency, magnitude, phase, stereo offset, and slow drift.
3. For offline audio, a multi-component source-spectrum layer: a 24-band, 20 ms analysis timeline estimates source power and stereo covariance; soft time/frequency median masks separate sustained, transient, and diffuse structure; deterministic KL-NMF discovers four sustained latent templates; and exact ratio masks partition measured source power among those components. Each component has independent filtered carriers, component-level modulation, temporal behavior, and stereo covariance.

The environmental synthesizer remains algorithm v3, preserving its golden PCM contract. Audio output recipe v5 combines normalized environmental and multi-component source-spectrum layers by an explicit power share before the existing source-relative gain plan. The result remains controlled and reproducible beneath speech, music, video, or other foreground media. The current realtime video path remains on the validated environment-only path until an equivalent streaming integration is tested there.

## Repository layout

- `index.html` and `styles.css` — hosted browser interface
- `manifest.webmanifest`, `sw.js`, and `icons/` — install metadata, offline app shell, and mobile icons
- `src/` — deterministic synthesis, loudness planning, audio decoding, WAV encoding, and video export
- `tests/` — Node.js tests for determinism, composition, smoothness, loudness, and encoding
- `docs/` — architecture and algorithm mapping
- `tools/` — local static server and analysis utilities

The repository intentionally contains only the application and its authored documentation. Supplied reference recordings and source materials are not required to run the app and are not included here.

## License

Driftbed is released under the [Apache License 2.0](LICENSE). The Driftbed name and branding are not granted as part of that license.
