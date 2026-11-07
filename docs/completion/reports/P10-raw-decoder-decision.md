# P10 RAW decoder dependency decision

2026-11-07. Source-evaluation record; admits no dependency and promotes no
phase or acceptance field. Evaluated against the photo engine contract in
`packages/photo/rust` and the admission rules in
`P10-P11-ENGINE-PREREQUISITES.md`.

## Interface the decoder must satisfy

`photo-engine` is `#![forbid(unsafe_code)]`, synchronous, I/O-free,
`Send`-only. It stores catalog state only (originals, versions, recipes);
no pixels or RAW bytes enter engine state or the NFD1 snapshot. The only
pixel path is `processPreview`: a `binary_input_ops` op that accepts
packed straight-alpha sRGB RGBA8 (≤1,048,576 px, ≤4096/side, exact
w×h×4 length) bound by `original_id`/`original_sha256`/`expected_develop`
identity checks, so stale host-supplied previews are rejected. Long ops
route through `apply_long` + `TaskContext` (atomic cancel + progress).
FFI binary input exists via `nf_v1_apply_binary` (256 MiB cap).

Conclusion: decode must happen host-side on a worker; the engine only
consumes bounded RGBA8 through the existing binary op.

## Candidates

| Candidate | License | Coverage | Build matrix | Verdict |
|---|---|---|---|---|
| LibRaw 0.22.3 (C++) | LGPL-2.1 **or CDDL-1.0**; CDDL permits proprietary static distribution | Broadest consumer RAW + DNG; `open_buffer` memory input; dcraw demosaic quality levels | macOS arm64 proven in this repo; iOS/Android/visionOS/Quest/PICO cross-builds unverified; WASM plausible via libraw-wasm | **Primary** |
| rawler 0.8.0 (pure Rust) | LGPL-2.1 — same proprietary-linking review as LibRaw-LGPL | ~20 formats; demosaic traits exist but no full develop pipeline | Trivially cross-compiles all targets | **Fallback** (WASM tier or where LibRaw cannot build) |
| dcraw/dcraw_emu | GPL-2.0 | — | — | Disqualified (GPL contamination) |
| darktable/rawspeed | GPL-3.0 / coupled | — | — | Disqualified or impractical |
| Adobe DNG SDK | Adobe terms, DNG-only, bilinear demosaic | — | — | Weak fit |
| `image`/`zune-*` | MIT/Apache | No Bayer RAW | trivial | Not RAW decoders; useful later for previews/exports |

## Decision

Primary: **LibRaw 0.22.3 via the CDDL route**, consumed by a host-side
provider crate outside `photo-engine` (new `nf-raw`-style boundary or a
C++ host wrapper; unsafe confined there, same pattern as `rust/nf-sys`).
Engine stays untouched. Decode produces bounded RGBA8 + metadata that
enters through `processPreview`/`nf_v1_apply_binary`; NFD1 snapshots
unchanged.

Fallback: **rawler 0.8.0** where LibRaw's C++ build matrix fails
(especially WASM/web tier), subject to the same LGPL legal review and its
non-SemVer API.

## Integration sketch

Host asset store → provider crate `probe(bytes)` / `decode_preview(bytes,
TaskContext)` → owned RGBA8 + metadata → `Command.input` to
`processPreview`. Cancellation wires `TaskContext::is_cancelled` into
LibRaw progress callbacks; on cancel drop the decoder (RAII) and suppress
publication. Limits adopt the prototype caps: 64 MiB input, 40 MP RAW,
256 MiB decoder memory, `MAX_BINARY_BYTES` outer bound.

## Open risks before admission

- iOS/Android/visionOS/Quest/PICO LibRaw builds unproven; need
  reproducible cross-builds, XCFramework/NDK packaging, no OpenMP, real
  Nitro consumer build per target.
- CDDL file-level license closure needs final sign-off; optional codecs
  (JPEG/DNG SDK/RawSpeed/LCMS/OpenMP) each need separate admission.
- LibRaw mid-`unpack`/`dcraw_process` cancellation cooperation must be
  tested against the pinned source.
- LibRaw's built-in processing is not production develop quality; ICC,
  lens profiles, masks remain separate work regardless.
