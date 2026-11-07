# P10 nf-raw provider crate — first slice status

2026-11-08 (worktree `forge-w1-photo`, branch `codex/w1-photo-raw-provider`).
Implements the host-side RAW provider sketched in
`P10-raw-decoder-decision.md`: LibRaw 0.22.3 via the CDDL route, outside
`photo-engine`, producing the exact `processPreview` pixel contract.

## What exists now

- New crate `rust/nf-raw` (package `nf-raw`), added to workspace members.
  Location rationale: `packages/*/rust` holds `*-engine` crates; `rust/`
  holds host infrastructure (`ignition-core`, `nf-cli`, `nf-sys`). A
  non-engine native provider belongs with the host infra, not inside the
  engine package boundary.
- Safe Rust API: `probe(&[u8]) -> Result<RawInfo>` and
  `decode_preview(&[u8], max_pixels, &AtomicBool) -> Result<RawPreview>`
  returning owned `Vec<u8>` RGBA8 + `{make, model, format, width, height}`
  metadata. Typed `RawError`: `InvalidInput`, `LimitExceeded`, `Probe`,
  `Unsupported`, `Decode`, `Cancelled`, `Oom`.
- `build.rs` fetches the pinned LibRaw 0.22.3 tarball (SHA-256
  `789f3c33…227e4`, same pin as `tooling/raw-prototype/manifest.json`),
  verifies the hash, extracts, and builds `lib/libraw_r.a` via
  `Makefile.dist` (no OpenMP, no optional codecs, system zlib). Override
  with `NF_RAW_LIBRAW_DIR` for offline/prebuilt source trees.
- `src/raw_shim.cpp` + `src/ffi.rs` + `src/nf_raw.h`: the only unsafe code.
  Same posture as `rust/nf-sys`; `photo-engine` untouched.

## Verified on macOS arm64 (this machine)

`NF_RAW_LIBRAW_DIR=<extracted LibRaw-0.22.3>` +
`NF_RAW_TEST_FIXTURE=<pentax-k7.dng>` → `cargo test -p nf-raw
--include-ignored`: 8/8 pass.

- probe: make `Pentax`, model `K-7`, format `dng`, 4736×3136 raw.
- decode_preview: **1254×836 RGBA8** (1,048,344 px ≤ 1,048,576 cap, ≤4096
  side, all alpha 255, non-uniform pixels). Note: LibRaw `half_size` output
  was 2342×1561 = 3.66 MP, over the engine budget, and LibRaw has no
  quarter-size mode — the shim area-downscales the RGB bitmap to fit
  `max_pixels`. This is a deliberate preview-resolution choice, not a
  develop-quality claim.
- Cancellation: pre-set `AtomicBool` → `RawError::Cancelled` via LibRaw
  progress callback during identify.

## Honest limits / not done

- iOS, Android, visionOS, Quest, PICO, WASM, Linux, Windows: **not built**.
  Per-target requirements are listed in `rust/nf-raw/README.md`
  (XCFramework/NDK/no-OpenMP recipes still to be written and proven).
- Cancellation is cooperative at LibRaw callback stage boundaries; decoder
  inner loops without callback coverage cannot cancel mid-call.
- Fixture (20 MB CC0 DNG) and LibRaw source are not committed; the fixture
  test is `#[ignore]`d behind `NF_RAW_TEST_FIXTURE`.
- No wiring into photo-engine ops, TS, Nitro modules, or host asset store —
  provider crate only, per slice scope.
