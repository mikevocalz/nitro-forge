# Splice compositor / render backend decision

2026-11-11. Source-evaluation record; admits no dependency, promotes no
phase or acceptance field, and changes no engine op. Evaluated against
`docs/ENGINE_OPS.md` (splice section), `docs/ARCHITECTURE.md` (engine
contract), `docs/completion/PLAN.md` rows D-03/D-16/D-17/D-28/D-29/D-31/
D-38/D-42/C-24, `packages/splice/src/timeline-cluster.ts`
(`SPLICE_DEFERRED`), the host-provider precedents in
`reports/P10-raw-decoder-decision.md`, `reports/P10-nf-raw-provider.md`,
`reports/P15-folio-render-admission.md`, `reports/P07-icc-color-management-decision.md`
and `reports/P-encoder-provider-decision.md`, and the decoder/encoder
contracts now in NYC-Tron `platform-services`
(`@nyc-tron/platform-services/media` `MediaDecoder`, merged
`c9c9efc`-era `encoder/`). Docs-only: no builds, tests or device runs
were performed.

## What Splice already provides

The engine is complete for assembly and emits everything a compositor
needs. `renderPlan` returns per-track clip refs in time order carrying
`source_id`, `in_s`/`out_s`, constant `speed` **or** the full
`speed_keys` curve (media-anchored `{t_s, speed}` samples the host
integrates for retime), resolved `timeline_end_s` footprints,
`track_active` (hidden/muted/solo already resolved), per-clip mix
`gain_db`/`pan`, and per-track transition windows (`kind`,
`left_clip_id`/`right_clip_id`, `cut_s`, `start_s`/`end_s`,
`duration_s`). Transition kinds are fixed: `cross_dissolve`,
`dip_to_black`, `dip_to_white`, `wipe_left`, `wipe_right`, `push_left`,
`push_right` on video/overlay; `cross_fade` on audio. `duration` gives
the program length; `timeline` gives the full structure.

Two honest gaps bound the design:

- **No pixels enter the engine.** Decoded frames and PCM are ephemeral
  host media. `renderPlan` carries source ids, not frames; the engine
  never resolves media (same contract as Motion slice H media layers,
  which store opaque `source_id` references and render transparent
  until the transport supplies pixels).
- **No effects or masks exist in the model.** `SPLICE_DEFERRED`
  `effectTracks` (D-31/D-38) and `stickerTracks` (D-43) have no ops;
  there are no mask/matte fields on clips or tracks. A compositor can
  only composite what `renderPlan` describes: stacked clips, the eight
  transition kinds, and the audio mix fields.

## Consumers and what each needs

Engines are synchronous, single-threaded, I/O-free `Send`-only state
machines; nothing inside `splice-engine` may decode, composite on GPU,
or touch files. Every consumer below therefore needs a **host-side**
frame/PCM producer. The media boundary is already decided on both
sides: `MediaDecoder` (probe / `decodeFrame`-class bounded RGBA /
`decodeAudio` PCM ≤ 60 s spans / presentation index) supplies inputs,
and `MediaEncoder` (bounded RGBA8 frame files + interleaved f32/s16 PCM
→ faststart H.264+AAC MP4) consumes outputs.

| Consumer | Rows | Needs | Status driver |
|---|---|---|---|
| ProgramMonitor preview | D-03 | One composited RGBA frame per playhead time at output resolution; transitions must blend live | Needs compositor + decoder + a display surface |
| RenderCacheIndicator / cache | D-28 | Deterministic frame identity so rendered frames can be cached/reused | Needs compositor; cache key = (snapshot identity, time, size) |
| ExportMonitor | D-29 | Sequential composited RGBA frames → `MediaEncoder` video track; mixed PCM → AAC track | Encoder provider exists (c9c9efc, unverified); compositor is the remaining co-blocker |
| Filmstrip thumbnails | D-16 | Sparse composited frames at reduced resolution | Same compositor, smaller bounds |
| Waveform / audio peaks | D-17 | PCM decoded + gain/pan/mute/solo mixed to peaks | Needs the audio leg of the compositor (or a peaks-only slice) |
| Video scopes | C-24 | Composited frames fed to scope compute | Same frame path as D-03 |
| Effects/adjustment stack | D-31, D-38 | Blur/color pixel ops, per-clip effects | **Out of v1 scope** — no effect ops exist in the engine; needs its own admission first |
| Stickers/overlay assets | D-43 | Still-image overlay sources | Needs an asset-source decision; overlay *tracks* already composite |
| Source monitor / PiP / scrub decode | D-02, D-30, D-05 | Single-source decode, not timeline composite | Decoder-only rows; compositor not required |

Net: the compositor unblocks the ~8 rows that need composited pixels
(D-03, D-16, D-17 audio leg, D-28, D-29 with encoder, C-24, and the
visual half of D-31); the remaining D-* video rows stay blocked on
decoder surface, effects ops, or asset sources — not on this choice.

## Candidates

| Candidate | License/build cost | Fit with contracts | Verdict |
|---|---|---|---|
| **Forge host provider crate `rust/splice-render`** (pure-Rust deterministic software raster; `renderPlan` + decoded RGBA/PCM in → composited RGBA + mixed PCM out; JSON-lines service like `folio-render` plus a library API) | No new third-party raster dep needed at v1: the required ops are alpha-over compositing, eight parametric transition shapes, speed-curve retime sampling, and gain/pan mixing — all implementable in a few hundred lines of safe Rust. `TaskContext`-style checkpoints per row-band keep frames interruptible | Exactly the `nf-raw`/`nf-color`/`folio-render` boundary: not an engine, no `EngineKind`, no `NFD1`, bounded I/O-free-ish host service fed bytes by the caller; testable through the same JSON-lines harness pattern as `nf-cli`/`folio-render` in `cargo test` + vitest | **Recommended** |
| Engine-side software raster inside `splice-engine` (new `renderFrame`-class ops) | Zero new crates possible, but the engine would have to receive decoded frames as op payloads — megabytes of ephemeral pixels journaled into undo entries and counted against the 16 MiB serialized-state cap | Violates the established boundary: media pixels are host resources, not document state. Motion could afford an in-engine compositor because its renderer *is* another engine (Prism); Splice has no layer/effects model, so there is nothing for engine-side raster to compose that `renderPlan` doesn't already describe | Rejected for v1; revisit only if effects ops land and an in-engine raster becomes necessary |
| `wgpu`/GPU compositor (host-side service or platform view) | Per-platform shader/toolchain surface; nondeterministic float ordering risks breaking the byte-identical-frame property tests rely on; export still needs CPU readback for `MediaEncoder` RGBA files | Not forbidden host-side (engines can't do GPU; a service can), but v1 needs correctness and determinism at bounded sizes first. GPU is a preview-performance optimization, not a correctness requirement | Deferred — documented upgrade path behind the same provider interface, not v1 |
| Host compositor inside NYC-Tron `platform-services` (Swift/Metal, Kotlin/Surface, WebGL) | Triples the implementation across three native stacks; platform-services owns codecs and OS surfaces, not document-level timeline semantics; cannot be exercised by Forge's cargo/vitest engine suites | Splits splice's track/clip/transition evaluation away from the engine that owns it, inviting drift between `renderPlan` semantics and the compositor | Rejected as primary; platform-services remains the correct owner of decode/encode only |
| Pull a general raster crate (`vello`, `image`, `tiny-skia`) for compositing | `tiny-skia`/`vello` CPU paths exist but solve a superset (paths, gradients, masks) the splice model cannot yet express; license review cost for zero v1 coverage | Premature dependency admission; the repo admits crates per demonstrated need (P10/P15/P07 precedent) | Rejected at v1; admit only when effects/masks ops exist |

## Decision

**A Forge-side host provider crate `rust/splice-render` — a
non-engine render service in the `folio-render`/`nf-raw`/`nf-color`
family — owns timeline compositing and the audio mix.** It consumes
`renderPlan` output plus host-resolved decoded frames/PCM and returns
bounded, deterministic RGBA8 (straight alpha, sRGB — the same pixel
contract as `MediaEncoder` video sources, Motion `rgba8-straight-srgb`
assets, and `nf-raw` previews) and interleaved f32 PCM. No engine op,
snapshot field, or `ENGINE_OPS.md` entry changes; `SPLICE_DEFERRED`
entries clear only when real frames flow end-to-end.

Scope of v1, honestly bounded:

- **Video composite:** stack video tracks bottom-to-top with overlay
  tracks above (renderPlan track order is stack order); per-clip
  fit-to-frame policy (host-defined `fit`/`fill`, documented, not
  engine state); `track_active` visibility; constant-`speed` and
  `speed_keys` retime by inverting the media-time integral at each
  output frame timestamp (nearest-source-frame selection — frame
  blending for retime is deferred with effects); the eight visual
  transition kinds evaluated parametrically inside their
  `start_s..end_s` windows (dissolve = alpha cross-fade; dips =
  fade-through-color; wipes = hard-edge reveal; pushes = geometric
  translate).
- **Audio mix:** `gain_db`/`pan` per clip plus track mute/solo (already
  resolved into `track_active`), mixed to interleaved f32 at the
  encoder's accepted rates; `cross_fade` transitions applied as
  equal-power gain ramps across their windows. This is the first real
  consumer of the mix fields the engine has stored since the
  `setClipMix` slice.
- **Determinism:** fixed operation order, no platform SIMD math,
  documented sampling policy — the same byte-identical-across-hosts
  property `renderFrame`/`renderQueueFrame` already guarantee for
  Motion, so render-cache keys and test fixtures are stable.
- **Bounds:** fail-closed caps in the `folio-render` style — max
  output edge (recommend ≤ 4096, matching `MAX_FRAME_EDGE` and encoder
  limits), max sources/clips per frame, per-call byte budgets,
  cooperative cancellation between row bands.
- **Render cache (D-28):** v1 cache lives host-side, keyed by
  (document snapshot hash, output time, width/height, provider
  version). The motion `renderQueueFrame` pattern — journaled,
  undoable, one-frame-per-`apply` stepping — is the documented
  precedent **if** an in-engine splice render queue is later admitted;
  for v1 the queue is host job state, since queue progress over
  ephemeral media is not document state. An `ENGINE_OPS.md` admission
  for splice queue ops is an open decision point, not assumed.

Per-consumer consequence: D-03/D-16/C-24 get live preview frames once a
display surface binds the provider output; D-17 gets peaks from the
audio leg (or a peaks-only slice of the same mixer); D-28 gets its
cache; D-29 unblocks fully when `MediaEncoder` consumes the frame/PCM
streams — the encoder decision's stated co-blocker is resolved by this
record. D-31's visual half (overlay compositing) is covered; its
effects half (D-38) still needs effect ops in the engine first.
D-43 stickers still need an asset-source decision.

## Open decision points (require user input)

1. **Provider ownership/repo boundary.** Recommended: `rust/splice-render`
   inside Forge (matches `folio-render`/`nf-raw`/`nf-color`; testable
   by cargo + vitest without a NYC-Tron release). Alternative: NYC-Tron
   platform-services — rejected above on ownership grounds, but
   re-confirm because decode/encode already live there and a release
   pin update would be incremental.
2. **Wire shape.** Library-crate API consumed by the TS host vs the
   `folio-render` JSON-lines service. Recommend both: library for
   in-process hosts, thin `main.rs` service for `nf-cli`-style tests
   and non-Rust consumers — same dual shape as folio-render.
3. **v1 resolution/fps ceiling.** Recommend ≤1920×1080 canvas,
   ≤30 fps output, ≤60 s per `renderRange` call (mirroring
   `MAX_DECODE_DURATION_US`); export loops the call per GOP. Confirm
   against the D-03 preview target.
4. **Retime/speed-keys sampling.** Nearest decoded frame per output
   timestamp is recommended for v1 (decoder returns stills);
   frame blending under retime and optical-flow-style interpolation
   are effects-tier work — confirm acceptance doesn't require
   interpolated retime.
5. **In-engine render queue admission.** Whether splice later gets
   `renderQueue`-class ops (motion J1 precedent: journaled,
   undoable, one frame per apply) or stays host-job-only. v1 assumes
   host-side; an engine admission is a separate `ENGINE_OPS.md`
   decision.
6. **Audio scope of v1.** Recommend shipping the mix leg in v1 — the
   encoder accepts A/V and D-29 needs it; staging video-only first
   would strand `gain_db`/`pan`/`cross_fade` as write-only metadata a
   second time.
7. **Color pipeline.** Frames are sRGBA/sRGB per the encoder and
   Motion contracts; `nf-color` (moxcms) exists for ICC work. Decide
   whether v1 tags output as sRGB-only (recommended — matches every
   existing pixel contract) or reserves a color-space field for
   wide-gamut sources.
8. **Effects/masks sequencing.** D-38 needs engine ops (per-clip
   effect list, mask/matte storage) before any compositor can honor
   them; record the dependency so the effects admission doesn't
   silently assume a compositor capability that doesn't exist.

## Honest limitations

- Docs-only evaluation: no compositor was built, benchmarked or run.
  Software 1080p30 composite cost (per-pixel alpha-over plus transition
  geometry) is unmeasured; the ≤1080p/≤30 fps v1 bound is a guess that
  must be proven on the slowest supported target before admission
  claims. If it fails, the provider interface is designed so a GPU
  backend can replace the raster core without changing consumers.
- `MediaDecoder` and `MediaEncoder` are source-reviewed but
  device-unverified (platform-services `platformEvidence:
  unverified`); this decision inherits that risk — end-to-end D-29
  cannot be claimed until both run on real targets.
- Transition semantics (wipe edge softness, push easing, dissolve
  curve) are defined parametrically here but have no reference
  implementation to match; acceptance needs a visual baseline.
- `renderPlan` does not carry per-source media type beyond track
  kind — an overlay clip referencing an audio-only source, or a
  missing/unprobeable source file, is a host-side error path the
  provider must define (recommend: honest per-frame `decode-failed`
  propagation, matching decoder error codes).
- The audio mix assumes decoder PCM at a single program rate with
  resampling at ingest; `MediaDecoder.decodeAudio` already bounds spans
  and rates, but mix SRC quality and A/V drift over long programs are
  unverified.
- Claims that "no compositor exists" rest on `SPLICE_DEFERRED`,
  PLAN.md rows, and report statements; a confirming source read of
  `packages/splice` and the media-ui video cluster is warranted before
  dispatch.
