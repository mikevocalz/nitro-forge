# splice-render

Host-side deterministic timeline compositor and audio mixer for **Splice**.
This is **not** an `ignition_core::Engine`: no `EngineKind`, no
`Command`/`Journal`, no `NFD1` snapshot, no document mutations. It is a
sibling host provider in the `folio-render` / `nf-raw` / `nf-color`
family, admitted by `docs/completion/reports/P08-splice-compositor-decision.md`.

## What it does

Consumes the splice engine's `renderPlan` output (`{tracks, transitions}`)
plus host-resolved decoded media and returns bounded, deterministic
output for the encoder provider (`MediaEncoder`) and preview surfaces:

- **Video composite** — clip stacking in `renderPlan` track order
  (bottom → top; audio tracks carry no picture), `track_active`
  visibility, per-clip `fit`/`fill` fit-to-frame (a host render
  parameter, not engine state), constant-`speed` and `speed_keys`
  retime by inverting the media-time integral `∫ dt/speed(t)` at each
  output timestamp, nearest-source-frame selection (no frame blending —
  that is effects-tier work).
- **Transitions** — the eight kinds evaluated parametrically inside
  their `start_s..end_s` windows: `cross_dissolve` (incoming clip alpha
  ramps 0→1 over the outgoing clip — identical to a symmetric dissolve
  for opaque sources), `dip_to_black`/`dip_to_white` (dissolve plus a
  whole-frame dip toward the color at `q = sin(π·p)`), `wipe_left`/
  `wipe_right` (hard-edge reveal), `push_left`/`push_right` (geometric
  translate), `cross_fade` on audio (equal-power sin/cos gain ramps).
- **Audio mix** — per-clip `gain_db` (`10^(db/20)`) and `pan` (balance
  law: −1 left only, +1 right only, 0 unity both, linear taper),
  `cross_fade` equal-power ramps, mixed to interleaved stereo f32 at a
  caller-chosen rate with per-output-sample linear-interpolation
  resampling through the same retime function.
- **Render cache (D-28)** — host-side, keyed by
  `(snapshot, media, inputs_digest, time_s, width, height, fit,
  provider_version)`. `inputs_digest` is an FNV-1a hash of the
  canonical JSON of the `plan` and `sources` payloads, so different
  plans or decoded inputs can never share a cached frame even when no
  salts are supplied. `snapshot`/`media` are optional caller-supplied
  salts for forcing misses (e.g. a new logical edit over identical
  bytes); they are length-prefixed in the key, so `|` or `:` inside a
  salt cannot collide across field boundaries. The cache evicts
  least-recently-used first (hits refresh an entry's position).

## Wire shape (dual, like folio-render)

Library: `splice_render::RenderService` (`handle_frame(&FrameRequest)`).
Binary `splice-render`: JSON-lines on stdin/stdout, one
`{"id","handle","op","payload"}` per line → `{"id","ok","data"|"error"}`.

Ops:

| op | payload | data |
|---|---|---|
| `renderFrame` | `{width,height,time_s,fit?,plan,sources,snapshot?,media?}` | `{width,height,time_s,bytes_b64,cached}` |
| `renderRange` | `{width,height,fps,start_s?,duration_s,fit?,plan,sources,snapshot?,media?}` | `{job,frames,width,height,fps,start_s,end_s}` |
| `nextFrame` | `{job}` | `{index,time_s,width,height,bytes_b64,cached,done}` or `{done:true}` |
| `dropJob` | `{job}` | `{dropped}` |
| `mixAudio` | `{plan,start_s?,duration_s,sample_rate?,sources}` | `{sample_rate,channels:2,frames,duration_s,bytes_b64}` |
| `clearCache` | `{}` | `{cleared:true}` |
| `describe` | `{}` | service info + bounds |

### Payload shapes

`plan` is the splice engine's `renderPlan` result verbatim:
`{tracks: [[clip refs]], transitions: [[per track]]}`; clip refs carry
`clip_id, track_id, track_kind, track_active, source_id,
timeline_start_s, timeline_end_s, in_s, out_s, speed, speed_keys,
gain_db, pan`; transitions carry `kind, left_clip_id, right_clip_id,
cut_s, start_s, end_s, duration_s`.

Video `sources`: `{"<source_id>": {width, height, frames: [{t_s,
bytes_b64}]}}` — RGBA8 stills (`bytes_b64` = `w*h*4` bytes), `t_s` the
media time each still represents. The provider picks the nearest `t_s`
to the computed media time.

Audio `sources`: `{"<source_id>": {sample_rate, channels: 1|2,
media_start_s, media_end_s, pcm_b64}}` — little-endian interleaved f32
PCM covering `[media_start_s, media_end_s)` at `sample_rate`. Coverage
must include transition head/tail handles; a shortfall is an honest
`decode-failed` (`NotFound`) error.

`mixAudio` output `bytes_b64` is little-endian interleaved **stereo**
f32 at the requested `sample_rate` (default 48000, range 8000–96000).

## Determinism

Fixed operation order, bilinear/nearest sampling only, no platform SIMD
math, no threading, no wall-clock or address-dependent behavior. The
same inputs produce byte-identical output **on a given build and
platform**; render-cache keys and test fixtures are stable.
Floating-point math is IEEE-754 with a fixed operation order, but
libm transcendental results (`sin`, `cos`, `ln`, `exp`, `powf`) may
differ by ulps across OSes/architectures — byte-identity across
platforms is not guaranteed.

## Bounds (fail-closed)

Canvas ≤ 1920×1080; source frames ≤ 4096 px/side and ≤ 64 MiB decoded;
≤ 64 sources, ≤ 256 MiB decoded RGBA per call; ≤ 4096 plan
clips/transitions; ≤ 60 s per `renderRange`/`mixAudio` call; ≤ 30 fps,
≤ 1800 frames per job; ≤ 4 live jobs; PCM sources ≤ 128 MiB each;
cache ≤ 64 entries / 256 MiB; JSON-lines frames ≤ 256 MiB. Oversized or
malformed input is rejected before allocation where possible.

Large exports should use the library API in-process or chunk
`renderRange`/`mixAudio` calls per ≤60 s span; the JSON-lines service
exists for tests and small/non-Rust consumers.

## Honesty notes

- No engine op, snapshot field, or `ENGINE_OPS.md` entry changes; no
  pixels enter the engine. `SPLICE_DEFERRED` rows clear only when real
  frames flow end-to-end.
- `renderPlan` does not carry per-source media type; a video clip
  referencing an unsupplied source is a `decode-failed` error, matching
  the decoder error-propagation contract.
- Retime uses nearest-source-frame selection; frame blending under
  retime is deferred with effects (decision record open point 4).
- The audio mix assumes decoder PCM at a single program rate with
  resampling at ingest; the provider does per-sample linear
  interpolation only — no SRC filtering.
- Media-time handling is asymmetric by design: video media time beyond
  the supplied stills clamps to the nearest edge frame (nearest-frame
  selection), while audio PCM outside its declared
  `[media_start_s, media_end_s)` span — including transition
  head/tail handles — is an honest `decode-failed` (`NotFound`)
  error. Hosts must supply enough decoded media for the plan's full
  footprint.
- Bilinear sampling interpolates all four straight-alpha channels, so
  RGB values inside fully transparent texels can bleed into
  semi-transparent edges. Decoders that store premultiplied or
  color-bleed-free alpha should be preferred for overlay-heavy
  content.
- Worst-case live-job memory is ~2 GiB: up to 4 concurrent
  `renderRange` jobs × (≤256 MiB decoded video RGBA + ≤256 MiB PCM)
  plus plan overhead. Hosts rendering many sources should drop jobs
  promptly (`dropJob`) rather than rely on the cap.
- `fps` is only required to be finite and > 0 up to the 30 fps cap; a
  value so small that `duration_s * fps` rounds to zero yields a
  single frame, and the `end_s` reported by `renderRange` in that case
  (`start_s + frames / fps`) is cosmetic, not a media bound.
- Software 1080p30 composite cost is unmeasured (decision record
  "Honest limitations"); the ≤1080p/≤30 fps v1 bound must be proven on
  the slowest supported target before admission claims. The provider
  interface is designed so a GPU backend can replace the raster core
  without changing consumers.

## Tests

`cargo test -p splice-render` — synthetic RGBA8/PCM fixtures covering
every transition kind, constant and keyframed retime, gain/pan/
cross-fade mix levels, cache hit/miss, `renderRange` streaming, and
hostile bounds. No external media or native libraries required.
