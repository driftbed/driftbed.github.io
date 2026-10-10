# Wasm core build

The current Wasm artifact is the ABI and scalar-kernel foundation for Driftbed. It is deliberately not advertised as the complete DSP backend until its output is parity-tested against the JavaScript implementation.

Build with the pinned toolchain and no third-party crates:

```sh
rustc rust/src/lib.rs \
  --crate-type=cdylib \
  --target=wasm32-unknown-unknown \
  -C opt-level=3 \
  -C lto=fat \
  -C codegen-units=1 \
  -C panic=abort \
  -C strip=symbols \
  -o wasm/driftbed_core.wasm
```

Capability bit `0` identifies the validated ABI/scalar foundation. Capability bit `1` is reserved for the complete Wasm DSP pipeline and must remain unset until the browser parity gates pass.
