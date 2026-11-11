# P10 RAW decoder product admission

2026-11-08. Product-admission record for the photo-engine RAW decode
boundary. Evaluated against `docs/ENGINE_OPS.md` (photo-engine section),
`docs/ARCHITECTURE.md` §2 (engine contract),
`reports/P10-raw-decoder-decision.md` (source evaluation),
`reports/P10-nf-raw-provider.md` (implemented crate status),
`reports/P10-libraw-isolated-decode-source.md` +
`evidence/P10-raw-prism-proof.json` (macOS decode→Prism proof), the
host-service precedent in `reports/P15-pdf-backend-decision.md` /
`reports/P15-folio-render-admission.md`, and the encoder-provider
boundary in `reports/P-encoder-provider-decision.md`. This record admits
the *boundary design and decoder route*; it promotes no phase or
acceptance field, ships no new dependency beyond what `rust/nf-raw`
already carries, and claims no platform beyond macOS arm64. Docs-only:
no builds, tests or device runs were performed for this record.

## Current state

`photo-engine` (`packages/photo/rust`, `#![forbid(unsafe_code)]`)
persists catalog state only: immutable host-claimed original
descriptors (`sha256`, `asset_ref`, `byte_length`, camera metadata,
rating, labels), version identities, a bounded non-destructive develop
recipe (schema 1: `exposure_ev`, `contrast`, `rgb_gain`,
`temperature_kelvin`/`tint` white balance), and `processPreview` — a
`binary_input_ops` op that accepts packed straight-alpha sRGB RGBA8
(≤1,048,576 px, ≤4096/side, exact `w×h×4`) bound by
`original_id`/`original_sha256`/`expected_develop` identity checks so
stale host-supplied previews are rejected. Undo/NFD1 snapshots contain
no pixels and no RAW bytes. There is **no product RAW decode**: nothing
in the shipped path turns camera-original bytes into the RGBA8 that
`processPreview` consumes.

`rust/nf-raw` exists in the workspace (member since the w1 slice): a
safe-Rust `probe`/`decode_preview` API over LibRaw 0.22.3 pinned by
SHA-256 tarball, unsafe confined to `raw_shim.cpp`/`ffi.rs`, with the
prototype caps (64 MiB input, 40 MP RAW, 256 MiB decoder budget,
`max_pixels` ≤ 1,048,576 output). Verified only on macOS arm64:
8/8 `cargo test -p nf-raw --include-ignored` against the CC0 Pentax
K-7 DNG fixture; iOS/Android/visionOS/Quest/PICO/Linux/Windows/WASM
are **not built**. The isolated proof
(`P10-raw-prism-proof.json`) additionally shows decoded preview → real
Prism raster → undo/redo → NFD snapshot on the same host.

Ledger impact: `components.json` rows F-04…F-16 (RAWDevelopPanel,
ExposureAndWhiteBalance, ToneAndPresence, EightBandColorMixer,
LensCorrectionPanel, LocalMaskBrush, LinearRadialGradientMask,
LuminanceColorRangeMask, BeforeAfterCompare, PresetFilmstrip,
BatchExportPanel, PhotoVersionHistoryBrowser, CleanupAndRetouchPanel)
are `completion:"blocked"`. The RAW-decode admission below removes
**one** blocker — the bytes→pixels path. It does not unblock rows whose
remaining gaps are independent: F-07 (HSL range filter in Prism), F-09–F-11
(Prism mask model), F-12 (before/after snapshots — actually satisfiable
once decode exists, via two `processPreview` calls), F-13 (preset apply
op), F-14 (image encoder + metadata strip — the P-encoder decision's
`prism:png` admission covers PNG bytes but not watermark/metadata
privacy), F-15 (N-10 version snapshots — partially satisfiable once
decode exists), F-16 (heal/clone op, absent). Each row still needs its
own acceptance audit; this decision changes none of those fields.

## The boundary question

Engines are synchronous, single-threaded, `Send`-only, I/O-free state
machines. RAW decode is native parsing/demosaicing of untrusted camera
files with multi-hundred-MiB working sets and no meaningful cancellation
granularity below stage boundaries. It therefore **cannot** live inside
`photo-engine::apply`, and the NFD1 snapshot must never carry decoded
pixels or decoder state. The only conforming shape — already proven by
the P15 folio-render precedent and the P-encoder provider decision — is
a **host-side provider**: a non-engine crate owned by the host worker,
fed original bytes by value, returning bounded RGBA8 + metadata, whose
output crosses into the engine through the existing
`processPreview`/`nf_v1_apply_binary` binary boundary. The catalog keeps
`asset_ref`/`sha256` identity; the host owns the durable asset store
that resolves `asset_ref` to bytes.

Candidate *locations* for decode:

| Location | Fit | Verdict |
|---|---|---|
| Inside `photo-engine` | Violates I/O-free/sync/`Send` contract; would put native pixels in engine state | Rejected |
| `rust/nf-raw` host crate + `processPreview` boundary | Already built, proven macOS arm64, exact pixel contract match, unsafe isolated like `nf-sys` | **Admitted** |
| New Nitro HybridObject module | Adds FFI surface + generated-API churn for zero contract gain over the binary op | Rejected for v1; revisit only if hosts need in-process calls at scale |
| Platform-native OS decoders (ImageIO/Android) | See decoder table — no public RAW decode API on either | Rejected |

## Decoder candidates

| Candidate | License | Coverage | Build matrix | Verdict |
|---|---|---|---|---|
| **LibRaw 0.22.3** via `nf-raw` | **LGPL-2.1-only OR CDDL-1.0** — we elect CDDL (§below) | Broadest consumer RAW + DNG; `open_buffer` memory input; dcraw-quality demosaic levels; proven on a real DNG here | macOS arm64 **proven**; iOS/Android/visionOS/Quest/PICO/Linux/Windows unverified; WASM plausible via wasm builds, unproven | **Primary — admitted** |
| rawler 0.8.0 (pure Rust, dnglab) | **LGPL-2.1-only** — verified 2026-11-08 against crates.io/docs.rs: license field is `LGPL-2.1`, single license, no CDDL/MIT alternative | ~20 formats; parse + metadata + pixels, but **no production develop pipeline** (demosaic traits exist, no develop-quality output); heavier dep tree (rayon, jxl-oxide, image, zerocopy…) | Trivially cross-compiles incl. WASM; MSRV 1.89, edition 2024 | **Deferred fallback only**, and only after the same LGPL closure review — it does *not* solve the licensing problem LibRaw-CDDL solves |
| dcraw / dcraw_emu | GPL-2.0 | — | — | Disqualified (GPL contamination of a distributed product) |
| darktable / rawspeed | GPL-3.0 / coupled | — | — | Disqualified or impractical |
| Adobe DNG SDK | Adobe terms, DNG-only, bilinear demosaic | Weak fit | Per-platform C++ | Rejected: coverage too narrow for the catalog's camera-RAW scope |
| Platform-native: iOS ImageIO/CoreImage, Android `BitmapFactory`/`MediaCodec` | OS APIs — no redistribution burden | **Neither exposes public Bayer/camera-RAW decode.** iOS RAW rendering is Photos-app-internal; Android has no RAW decode API. Only DNG-via-other-means might appear, divergently | N implementations, N test matrices, no uniform output contract | Rejected: no uniform decode contract exists to admit |
| `image`/`zune-*` crates | MIT/Apache | No Bayer RAW (JPEG/PNG/TIFF only) | Trivial | Useful later for *non-RAW* preview/export formats (e.g. F-14 JPEG path), not this decision |

## License analysis — why LibRaw's dual license is the deciding factor

The product ships as per-platform artifacts and tarballs, so
"dynamic linking so users can relink" is not available: whatever decoder
we ship is **statically inside** the distributed binary. That makes the
license election load-bearing:

- **CDDL-1.0** is file-level copyleft, not library-level: it permits
  combining CDDL-licensed files (LibRaw objects) into a proprietary
  work, provided the CDDL text, copyright notices and the covered
  source/modifications are made available to recipients of the binary.
  Cost = notice bundling + source-offer mechanics (§THIRD_PARTY_NOTICES
  below). This is the route `nf-raw` already elected and documented in
  `rust/nf-raw/THIRD_PARTY_NOTICES.md`.
- **LGPL-2.1** would require the user-relinkable-object story or a
  written legal position per distribution; it is the fallback only if
  CDDL sign-off fails, and it re-opens the exact question this
  admission exists to close.
- **rawler is LGPL-2.1-only** (verified, not dual-licensed). Admitting
  it as primary would import the same LGPL closure burden *without*
  LibRaw's CDDL escape hatch, on a younger codebase with a non-SemVer
  API history and no develop pipeline. It stays a fallback for targets
  where the C++ build matrix genuinely fails (WASM is the realistic
  case), subject to its own LGPL review.

## Decision

**Admit `rust/nf-raw` — LibRaw 0.22.3 consumed via the CDDL-1.0
election — as the product RAW decode provider for P10**, behind the
host-side boundary already implemented and proven on macOS arm64.
No engine change, no new op, no snapshot-format change.

Boundary contract (already the crate's public API; this admission makes
it the supported path):

```
host asset store (owns bytes, keyed by asset_ref)
  → nf_raw::probe(bytes)                      → RawInfo {make,model,format,w,h}
  → nf_raw::decode_preview(bytes, max_pixels, &AtomicBool)
                                        → owned RGBA8 (w×h×4, alpha 255) + RawInfo
  → host builds Command.input for photo-engine `processPreview`
     {version_id, original_id, original_sha256, expected_develop,
      format:"rgba8", width, height, pixels_b64 | binary sidecar}
  → engine validates identity/recipe/size, runs bounded sRGB develop
    (exposure/contrast/rgb_gain/Kelvin-tint WB), journals, emits
    document:changed; late/stale results reject by identity mismatch
```

Rules the boundary enforces:

- **Bytes cross by value, once.** Original bytes enter the provider
  call; decoded pixels enter the engine call. Neither side retains the
  other's buffers; nothing decoded enters NFD1 or `describe` output.
- **Identity-bound publication.** `processPreview` already rejects on
  `original_sha256`/`expected_develop`/`version_id` mismatch, so a
  decode job started before a recipe edit or original swap cannot
  publish stale pixels. Jobs are additionally tagged by
  `(original_id, sha256)` at dispatch and dropped on mismatch —
  cancellation and staleness are host-side, cooperative via
  `AtomicBool` → LibRaw progress callback → `RawError::Cancelled`.
- **Bounded everything.** 64 MiB input / 40 MP / 256 MiB decoder
  budget / ≤1,048,576 px / ≤4096 side — the prototype caps, which are
  exactly the `processPreview` budget. Reject, never truncate.
- **Single worker.** LibRaw state is not `Send`-shareable across
  concurrent decodes in one process without isolation; the provider
  runs decode jobs serially on one exclusive worker thread (the
  folio-render single-document-handle precedent). Probe may run
  concurrently — it holds no decoder state — but v1 keeps it on the
  same worker for simplicity.
- **Preview, not develop.** `decode_preview` output is a bounded sRGB
  preview suitable for catalog thumbnails and `processPreview` input.
  It is explicitly *not* a color-managed develop pipeline; ICC,
  lens corrections, masks and tone curves are separate deferred work
  regardless of decoder choice.

## What stays deferred

- **Platform builds.** iOS (XCFramework/device+sim slices, no OpenMP),
  Android (NDK .so), visionOS, Quest/PICO, Linux, Windows: all
  NOT-BUILT. Admission covers the crate design and macOS-verified
  code path only; each target needs its own reproducible build +
  Nitro consumer proof before any platform acceptance claim — same
  posture as folio-render's NOT-RUN matrix.
- **WASM/web.** No proven LibRaw wasm path; rawler is the designated
  fallback pending its LGPL review and a real develop-quality gap
  analysis (rawler currently supplies pixels, not a develop pipeline —
  either backend still only feeds `processPreview`).
- **Full-quality develop.** LibRaw `dcraw_process`/half-size preview is
  a decode starting point. ICC profiles, lens profiles, highlight
  recovery, masks/retouch (F-09–F-11, F-16) and batch export (F-14)
  remain their own admissions.
- **Durable asset store.** `asset_ref` resolution, retention, and
  original-bytes lifecycle are host concerns; the catalog never sees
  bytes. No store is admitted here.
- **TS/host wiring.** No `packages/photo` API change, no Nitro module,
  no UI. `PhotoDocument.processPreview` already accepts caller-supplied
  pixels; a host-side `decodeOriginal(asset_ref)` helper that chains
  `nf-raw` → `processPreview` is the natural next slice but is not part
  of this admission.
- **Ledger fields.** No `components.json`/`PLAN.md` row changes;
  F-04…F-16 stay `blocked` until their per-row audits run.

## THIRD_PARTY_NOTICES implications

`rust/nf-raw/THIRD_PARTY_NOTICES.md` already records the CDDL election,
the pinned tarball SHA-256, the license texts' location in the fetched
source tree, and the `cc` build-dep notice. This admission adds these
obligations at *product distribution* time:

1. Any shipped binary containing `libraw_r.a` must reproduce the
   CDDL-1.0 text and LibRaw copyright notices, and the covered source
   (or a written offer / source archive pointer) must be available to
   recipients — file-level, per the CDDL §3 obligations. Practically:
   bundle `LICENSE.CDDL` + `COPYRIGHT` from the pinned LibRaw-0.22.3
   tree into each platform package's notices (the same mechanism
   folio-render uses for pdfium's `licenses/` dir, per
   `P15-folio-render-admission.md` §6).
2. The LGPL texts ship in-tree but are *not* the elected license;
   notices should state the CDDL election explicitly so downstream
   reviewers do not treat the crate as LGPL.
3. `photo-engine` itself gains no dependency and needs no notice
   update. If a future slice admits rawler or other decode deps, each
   gets its own crate-level notices file under the same rules.
4. Optional LibRaw codec integrations (JPEG, DNG SDK, RawSpeed, LCMS,
   OpenMP) remain unadmitted; enabling any of them is a separate
   license + build review.

## Open decision points (require user input)

1. **CDDL source-offer mechanics.** Where does the "covered source
   available" obligation land for tarball/App Store distribution —
   vendored source archive per release, or a hosted source offer?
   Needs a release-engineering answer before first shipped binary.
2. **rawler fallback trigger.** Admit rawler for WASM only when a web
   RAW target is scheduled, or pre-admit now? Pre-admission buys
   optionality but imports an LGPL-only review for a path with no
   consumer yet.
3. **Worker topology.** Single serial decode worker is recommended;
   confirm whether catalog import (N originals) needs a bounded queue
   with priority (visible thumbnails first) or whether serial
   first-come-first-served meets acceptance.
4. **Preview resolution policy.** `nf-raw` currently area-downscales to
   fit `max_pixels` (LibRaw half-size exceeded the 1 MP budget on the
   K-7 fixture). Decide whether catalog thumbnails want a smaller fixed
   budget (e.g. 512 px) distinct from the `processPreview` 1 MP cap.
5. **Asset-store ownership.** Which host layer owns `asset_ref`
   resolution and byte retention (console app? platform-services?) —
   the catalog contract assumes it exists but nothing implements it.

## Honest limitations

- This record admits a *design and an already-implemented crate*, not
  a shipped feature. Only macOS arm64 has executed decode +
  engine-roundtrip proof; every other platform is NOT-RUN.
- LibRaw coverage is broad but not universal; camera support claims
  rest on upstream's decoder tables plus one DNG fixture — no camera
  matrix has been run.
- `decode_preview` output quality (half-size/dcraw-process path,
  area-downscaled to budget) is a *preview*, not a develop render;
  color accuracy is unverified (no ICC anywhere in the path).
- Cooperative cancellation covers LibRaw callback stage boundaries;
  decoder inner loops without callback coverage cannot cancel
  mid-call (documented in `P10-nf-raw-provider.md`).
- The CDDL election is an engineering proposal consistent with the
  crate's existing notices file; final legal sign-off on file-level
  license closure for shipped binaries is still outstanding, same as
  the P10 source decision flagged.
- rawler license/maintenance facts were verified against crates.io and
  docs.rs metadata on 2026-11-08 (v0.8.0, LGPL-2.1, dnglab); crate
  internals were not audited.
- "Blocked" ledger analysis is from `components.json` fields and
  `PLAN.md` dependency strings; per-row acceptance audits may reveal
  additional co-blockers beyond those named above.
