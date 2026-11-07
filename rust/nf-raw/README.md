# nf-raw — host-side RAW provider

Provider crate for the P10 photo pipeline, per
`docs/completion/reports/P10-raw-decoder-decision.md`. It wraps **LibRaw
0.22.3** (CDDL-1.0 route) and returns owned, bounded RGBA8 sRGB previews
that a host can feed to `photo-engine`'s `processPreview` binary op. It is
**not** an engine: it does no document I/O, stores no catalog state, and is
outside `packages/photo/rust` (which stays `#![forbid(unsafe_code)]`). All
native code lives in `src/raw_shim.cpp`; unsafe Rust is confined to the FFI
boundary in `src/ffi.rs` and `src/lib.rs`.

## API

```rust
pub fn probe(bytes: &[u8]) -> Result<RawInfo, RawError>;
pub fn decode_preview(
    bytes: &[u8],
    max_pixels: u64,          // 1..=1_048_576 (engine processPreview budget)
    cancel: &AtomicBool,      // cooperative cancellation
) -> Result<RawPreview, RawError>;
```

- `RawInfo { make, model, format, width, height }` — `width`/`height` are
  raw sensor dimensions; `format` is a coarse `"dng"`/`"raw"` class.
- `RawPreview { rgba, width, height, info }` — packed straight-alpha sRGB
  RGBA8, `width*height*4` bytes, alpha always 255.
- `RawError`: `InvalidInput`, `LimitExceeded`, `Probe`, `Unsupported`,
  `Decode`, `Cancelled`, `Oom` (LibRaw failures carry `code` +
  `libraw_strerror` message).

Limits (prototype caps, enforced in the shim): 64 MiB input, 40 MP raw,
256 MiB LibRaw raw-memory budget, ≤4096 px/side, ≤`max_pixels` output.

## Building LibRaw

`build.rs` resolves the pinned source (version 0.22.3, tarball SHA-256
`789f3c33466210a1a0907f747a97c715d21bbf4af712f257fcbbd90111b227e4`, same pin
as `tooling/raw-prototype/manifest.json`):

1. `NF_RAW_LIBRAW_DIR=/path/to/LibRaw-0.22.3` — use a pre-fetched extracted
   tree (must be writable unless `lib/libraw_r.a` is already built). This
   override skips the tarball SHA-256 pin, so `build.rs` asserts the tree's
   `libraw/libraw_version.h` reports exactly 0.22.3; any other version
   fails the build. The tree is still compiled and linked in place — treat
   the path as trusted input.
2. Otherwise the tarball is downloaded from `libraw.org` into `OUT_DIR`,
   hash-verified, extracted with `tar`, and built there via
   `make -f Makefile.dist lib/libraw_r.a` (clang/clang++, `-DUSE_ZLIB`, no
   OpenMP, no optional codec integrations).

Requires `make`, `clang`/`clang++` (or a C++17 toolchain `cc` finds), `ar`,
`ranlib`, `tar`, `curl`, and `sha256sum`/`shasum` on PATH.

## Cancellation

`decode_preview`'s `AtomicBool` is polled by a LibRaw progress callback
(`set_progress_handler`). Returning nonzero makes LibRaw throw
`LIBRAW_EXCEPTION_CANCELLED_BY_CALLBACK`, surfacing as
`RawError::Cancelled`. Callbacks fire at stage boundaries — identify,
load_raw start/end, bad-pixels/dark-frame, demosaic (per-tile in AHD),
median/highlight/convert/scale-colors, fuji-rotate/stretch — **not** inside
every decoder inner loop, so a single long decode pass cannot be interrupted
mid-call; the flag is also checked between `open_buffer`/`unpack`/
`dcraw_process`/`make_mem_image` stages. Verified on the real fixture:
a pre-set flag returns `Cancelled` during identify.

## Threading

`probe`/`decode_preview` are synchronous and blocking. Run them on an
exclusive worker thread (the future Nitro TaskControl integration point);
never on the UI thread. One `LibRaw` instance per call; no shared state.

## Platform status

| Target | Status |
|---|---|
| macOS arm64 | **Proven** — real LibRaw 0.22.3 decode of the CC0 Pentax K-7 DNG fixture (see below) |
| iOS device/simulator | Not built. Needs: LibRaw cross-compile per SDK+arch (or XCFramework with device+sim slices), no OpenMP, minimum-target flags, bitcode off; then a real Nitro consumer build. |
| Android | Not built. Needs NDK toolchain (clang++), `APP_PLATFORM`/API-level flags, no OpenMP (`-fopenmp` must stay off — LibRaw builds without it), per-ABI static libs packaged via jniLibs or cargo-ndk. |
| visionOS / Quest / PICO | Not built. Same C++ cross-compile requirements as iOS/Android per SDK; XR targets additionally need their vendor SDK/NDK recipes verified. |
| WASM / web | Not built. rawler 0.8.0 is the documented fallback for this tier (see decision record); LibRaw-via-wasm is plausible but unproven. |
| Linux desktop | Not built. `build.rs` emits `stdc++` and now invokes `sha256sum` correctly, but the Makefile.dist recipe is untested there. |
| Windows | **Unsupported.** MSVC has no `libc++`/`libstdc++` to link by name and `build.rs` emits no C++ stdlib hint for it; the Makefile.dist recipe is POSIX-only. |

## Fixture / tests

`cargo test -p nf-raw` runs validation/error-path unit tests (no RAW
needed). The real-decode test is `#[ignore]`d and locates a fixture via
`NF_RAW_TEST_FIXTURE` because the reference sample (Pentax K-7 12-bit DNG,
CC0-1.0, 19.85 MB, sha256 `f441c366…92386`) is intentionally **not
committed** — see `tooling/raw-prototype/manifest.json` for provenance.

```
NF_RAW_LIBRAW_DIR=/tmp/nf-raw-proof/LibRaw-0.22.3 \
NF_RAW_TEST_FIXTURE=/tmp/nf-raw-proof/pentax-k7.dng \
cargo test -p nf-raw -- --include-ignored
```

Observed on macOS arm64: probe → Pentax K-7, 4736×3136, `dng`; decode →
1254×836 RGBA8 (1,048,344 px, all alpha 255, non-uniform pixels); pre-set
cancel → `RawError::Cancelled`.

## License / provenance

This crate statically links LibRaw 0.22.3 (`libraw_r.a`, CDDL-1.0 election —
see `THIRD_PARTY_NOTICES.md` and `tooling/raw-prototype/manifest.json` for
the pinned source, hash, and license texts' locations in the extracted tree).

## Not in this slice

No wiring into photo-engine ops, TS APIs, Nitro modules, or the durable
host asset store. LibRaw's built-in processing is a decode/preview starting
point — not production develop quality (no ICC/proofing, lens profiles,
masks). See `docs/completion/reports/P10-nf-raw-provider.md`.
