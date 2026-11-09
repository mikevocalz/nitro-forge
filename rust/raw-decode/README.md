# raw-decode

Host-side RAW probe/decode-preview service for **Photo**, exposing
`nf_raw::probe` / `nf_raw::decode_preview` (LibRaw 0.22.3, CDDL-1.0
election) over the same JSON-lines wire shape as `nf-cli`,
`folio-render` and `splice-render`.

This is **not** an `ignition_core::Engine`: no `EngineKind`, no
`Command`/`Journal`, no `NFD1` snapshot, no document mutations, no
asset-store ownership. It is the admitted host-side decode boundary from
`docs/completion/reports/P10-raw-product-admission.md`:

```
host asset store (owns bytes, keyed by asset_ref)
  → raw-decode probe / decodePreview   (this service, one LibRaw worker)
  → bounded RGBA8 (≤1,048,576 px, ≤4096/side, alpha 255)
  → PhotoDocument.processPreview       (engine re-validates identity + recipe)
```

Decoded pixels and RAW bytes never enter engine state, snapshots or
`describe` output; the catalog keeps `asset_ref`/`sha256` identity only.

## Wire shape

Library: `raw_decode::RawDecodeService` (`handle_frame(&FrameRequest)`).
Binary `raw-decode`: JSON-lines on stdin/stdout, one
`{"id","handle","op","payload"}` per line → `{"id","ok","data"|"error"}`.

| op | payload | data |
|---|---|---|
| `probe` | `{bytes_b64}` | `{job}` |
| `decodePreview` | `{bytes_b64, max_pixels?}` | `{job}` |
| `jobStatus` | `{job}` | `{job,state:"running"}` or terminal `{state:"done"|"failed"|"cancelled", kind, info?, width?, height?, format?, bytes_b64?, error?}` — terminal polls are one-shot |
| `cancelJob` | `{job}` | `{job,cancelled:true}` |
| `describe` | `{}` | service/backend/version/platform/ops/bounds |

Both `probe` and `decodePreview` are asynchronous: they enqueue work on
the service's **single dedicated LibRaw worker thread** (LibRaw decoder
state is not `Send`-shareable across concurrent decodes — the admission's
single-worker rule) and return a job id immediately, so `jobStatus` and
`cancelJob` frames are never blocked behind a decode.
`cancelJob` sets the cooperative `AtomicBool` the LibRaw progress
callback polls at stage boundaries (`RawError::Cancelled`); decoder
inner loops without callback coverage cannot cancel mid-call.

`decodePreview` output is packed straight-alpha sRGB RGBA8,
`width*height*4` bytes — exactly the `processPreview` input contract.
`max_pixels` defaults to 1,048,576 (the engine budget) and must be in
`1..=1_048_576`; nf-raw area-downscales to fit. This is a **preview**,
not a color-managed develop render: no ICC, lens corrections, masks or
tone curves anywhere in the path.

## Bounds (fail-closed)

- RAW input ≤ 64 MiB decoded (`nf_raw::MAX_INPUT_BYTES`), re-checked
  before enqueue; empty input rejected.
- Preview `max_pixels` ∈ `1..=1_048_576`; output ≤ 4096 px/side (nf-raw
  enforces; reject, never truncate).
- ≤ 8 live jobs, ≤ 256 MiB total queued input bytes.
- JSON-lines frames ≤ 128 MiB raw (a max-size input is ~89.5 MiB of
  base64); oversized frames get an `out_of_bounds` error frame.
- LibRaw budgets inherited from nf-raw: 40 MP RAW, 256 MiB decoder
  memory.

## Build & platform status

```bash
cargo build -p raw-decode   # builds nf-raw's pinned LibRaw 0.22.3 too
cargo test -p raw-decode    # hostile-input + job-lifecycle tests
NF_RAW_TEST_FIXTURE=/path/to/pentax-k7.dng \
  cargo test -p raw-decode -- --ignored   # real-DNG fixture test
```

**Verified on macOS arm64 only.** iOS, Android, visionOS, Quest, PICO,
Linux, Windows and WASM are **NOT built** — see `rust/nf-raw/README.md`
for per-target LibRaw build requirements. `NF_RAW_LIBRAW_DIR` overrides
the pinned-source fetch for offline builds (see `rust/nf-raw/build.rs`).

## TS consumer

`@nitro-forge/photo` exports `RawDecodeService` (spawn/JSON-lines
adapter, `RAW_DECODE` env override, default `target/debug/raw-decode`)
and `processDecodedPreview(doc, service, bytes, request)` — the
docs-admitted chain `decode_preview → processPreview`. Node-only; never
bundled for RN. See `packages/photo/tests/raw.e2e.test.ts`.

## Licensing

This crate adds no third-party dependency beyond `nf-raw` (which
statically links LibRaw 0.22.3 under the **CDDL-1.0** election — see
`rust/nf-raw/THIRD_PARTY_NOTICES.md`) plus workspace `ignition-core`,
`serde`, `serde_json`. Any shipped binary containing this service also
contains `libraw_r.a` and inherits the CDDL notice + covered-source
obligations described in `P10-raw-product-admission.md` §THIRD_PARTY_
NOTICES — bundle `LICENSE.CDDL`/`COPYRIGHT` from the pinned LibRaw tree
per platform package, same mechanism as folio-render's `licenses/` dir.
