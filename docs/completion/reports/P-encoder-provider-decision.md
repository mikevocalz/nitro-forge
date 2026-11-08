# Encoder provider decision

2026-11-11. Source-evaluation record; admits no dependency and promotes no
phase or acceptance field. Evaluated against `docs/ENGINE_OPS.md`,
`packages/ignition/src/transfer.ts` (`TRANSFER_DEFERRED`), the decoder
contract precedent in `reports/P03-player-provenance.md` /
`reports/P02-P03-wave2-backlog.md`, and the dependency-decision format of
`reports/P10-raw-decoder-decision.md` and `reports/P15-pdf-backend-decision.md`.
Docs-only: no builds, tests or device runs were performed.

## Consumers and what each needs

Engines are synchronous, single-threaded, I/O-free `Send`-only state
machines. Every frame/PCM producer below emits **raw pixels or samples
only** — no engine owns an encoder, a container, or a codec. Encoding is
therefore a host-side provider concern, surfaced through the transfer
contract (`transfer.ts`) or a long-task host op, exactly like the P10 RAW
decoder boundary.

| Consumer | Phase / rows | Produces today | Needs | Platform targets |
|---|---|---|---|---|
| Motion J2 encoded export | P11 / G-15 RenderQueuePanel | `renderQueueFrame` steps durable queue jobs to raw RGBA frames via ephemeral Prism (`docs/ENGINE_OPS.md` motion J1; `reports/P11-motion-backlog.md`: "J2 encoded export blocked — no encoder provider exists") | Video-only encode + MP4 container; no audio; long-task cancel/progress via `TaskContext` | iOS, Android, macOS, Windows, WASM/web |
| Prism timelapse exporter | P06 / B-32 TimelapsePlaybackExporter | History replay + Prism raster frames; no encoder in any engine (`components.json`, `PLAN.md`) | Same video-only frame→MP4 path as Motion J2; shares the provider | Same matrix |
| Splice export monitor | P08 / D-29 ExportMonitor | `renderPlan` data for a compositor/encoder; `SPLICE_DEFERRED.encoder = ["D-29"]` (`packages/splice/src/timeline-cluster.ts`) | Full program encode: composited video **plus audio mix** (audio tracks exist) → MP4 with AAC; also blocked on the separate compositor/render-cache gap — the encoder alone does not unblock D-29 | Same matrix |
| Pitch pptx export | P14 / `TRANSFER_DEFERRED["pitch:pptx"]` | Deck model only; `pitch has no export op` | **Not a media encoder.** OOXML ZIP container — precedent is Quill's in-engine `exportDocx` (real ZIP via the admitted `zip` crate, `packages/quill/rust/src/docx.rs`). Needs an engine op admission decision, not this provider | Wherever the engine runs (pure Rust → all targets) |
| Cadence audio export | P09 / A-30 | `packages/cadence/src/transfer.ts` already writes bounded 48 kHz f32 stereo RIFF/WAVE around `render` PCM | **Solved for WAV.** Compressed audio (AAC/Opus) export would need an audio encoder — no current requirement; flag only | n/a today |
| Adjacent non-media | P10 / `TRANSFER_DEFERRED["prism:png"]` | Prism `flatten` returns raw RGBA only | PNG encoding (flate2/`png`, MIT/Apache-class) — separate small admission, not a media encoder | All targets |

## Candidates

| Candidate | License | Coverage | Build matrix | Verdict |
|---|---|---|---|---|
| Platform-native encoders: AVAssetWriter/VideoToolbox (Apple), MediaCodec + MediaMuxer (Android), Media Foundation (Windows) | OS APIs — no redistribution or license burden | Hardware H.264/HEVC/AV1 and AAC per device; quality/speed best-in-class | Per-platform native code — but NYC-Tron `platform-services` already owns the per-platform decoder (`decoder.ts`, AVAssetReader / MediaExtractor+MediaCodec); an encoder is the symmetric sibling | **Primary for native targets** |
| WebCodecs `VideoEncoder`/`AudioEncoder` + mediabunny muxer | WebCodecs is a browser API; mediabunny is **MPL-2.0** (weak file-level copyleft — consumable unmodified; NYC-Tron already uses it for decode in `platform.web.ts`/`webcodecs-frame.web.ts`) | H.264/HEVC/VP9/AV1 + AAC/Opus/FLAC encode; muxes MP4/MOV/WebM/MKV/WAV/MP3 | Web/WASM only — no WebCodecs in React Native; needs the same admission + release pin as the decoder's web path | **Primary for web/WASM** |
| FFmpeg (`ffmpeg-next`) | LGPL-2.1+ **only** with a compliant `--disable-gpl` build; GPL build contaminates the distributed product | Every codec/container incl. ProRes, all desktop/mobile, WASM via ffmpeg.wasm | Heavy: C toolchain per target, per-target configure audit, ~30 MB WASM payload | Fallback where native and WebCodecs cannot serve; likely unnecessary if the two primaries cover the matrix |
| Pure-Rust codec + muxer stack: rav1e (AV1, BSD/MIT dual) or openh264 (H.264, BSD-2) + mp4e / muxide / oxideav-mp4 (MIT/Apache) | Permissive | AV1/H.264 software encode; MP4 mux incl. audio tracks where the codec exists | Trivial cross-compile incl. WASM; CPU cost of software 1080p encode is the real cost | **Fallback / test tier**; no mature pure-Rust AAC encoder exists, so it cannot carry the Splice audio path alone |
| GStreamer | LGPL-2.1+ | Everything, via plugins | C API, plugin matrix per target, poor WASM story, large runtime | Rejected: build-matrix cost buys nothing over the two primaries |
| x264 | GPL-2.0 | H.264 | — | Disqualified (GPL contamination) |
| fdk-aac / platform AAC alternatives | Fraunhofer FDK license — needs the repo's license-closure review before any admission | AAC-LC encode | C library per target | Unverified; only relevant if a pure-Rust/uniform AAC path is ever required |

## Decision

**Shared host-side encoder provider, owned by NYC-Tron
`platform-services` as the sibling of `MediaDecoder`** — not inside any
engine and not a Forge-side FFI crate. This mirrors the decoder precedent
(P03): one typed host contract (`probe`/`encode` with bounded calls,
error codes, `AbortSignal` cancellation), per-platform native
implementations, and a WebCodecs implementation for web/WASM. Engines and
`transfer.ts` consume it unchanged; `TRANSFER_DEFERRED` entries clear only
when real bytes flow.

- **Native (iOS/Android/macOS/Windows):** AVAssetWriter/VideoToolbox,
  MediaCodec+MediaMuxer, Media Foundation respectively. Hardware encode,
  zero license burden.
- **Web/WASM:** WebCodecs + mediabunny (MPL-2.0 — already an NYC-Tron
  decoder dependency, so admission cost is incremental, not new).
- **v1 codec/container:** H.264 video + AAC audio in faststart MP4 —
  matches the admitted decoder matrix (H.264/AAC fixture is the only
  proven decode path) and maximizes playback compatibility. AV1/HEVC/MOV/
  WebM are later options, not v1 scope.
- **Pure-Rust muxer/crate path:** hold as fallback for Rust-side test
  fixtures and any target where both primaries fail; do not admit as the
  production path without a demonstrated gap.

Per-consumer consequence: Motion J2 and Prism B-32 need only the
video-only slice of the contract and are the natural first consumers once
the provider exists. Splice D-29 additionally needs the compositor (a
separate deferred gap) and the audio leg; sequence it after both. Pitch
`pitch:pptx` is **not encoder-blocked** — it needs an in-engine
`exportPptx` op decision following the Quill `exportDocx` precedent
(admitted `zip` crate, bounded state, `bytes_b64`/binary duality), which
is an `ENGINE_OPS.md` admission question for the user, not a provider
choice.

## Open decision points (require user input)

1. **Provider ownership/repo boundary.** Recommended: NYC-Tron
   platform-services (matches decoder ownership; requires a NYC-Tron
   release + Forge pin update, same gating as the decoder's
   `presentationIndexV1` methods). Alternative: a Forge-side provider
   crate — rejected unless the cross-repo release cadence proves
   unworkable.
2. **Audio scope of v1.** Motion/Prism timelapse are video-only; only
   Splice needs AAC. Decide whether the provider contract ships audio
   encode at v1 (recommended — retrofitting a second contract is worse)
   or stages video-only first.
3. **Codec/container v1 confirmation.** H.264+AAC MP4 faststart is
   recommended for decoder-matrix compatibility; confirm whether MOV or
   WebM exports are required acceptance targets.
4. **WASM/web admission timing.** WebCodecs+mediabunny covers web, but
   admission and the NYC-Tron release pin are Wave-4 packaging
   dependencies; confirm web export is in scope for the first encoder
   milestone or deferred with the rest of the web tier.
5. **Platform encoder fallback policy.** Hardware encoders vary by
   device; decide whether a software fallback (e.g. VideoToolbox/MediaCodec
   software modes, or the pure-Rust stack) is required for acceptance or
   whether "encoder unavailable" is an honest per-device rejection.
6. **Pitch export scope.** `pitch:pptx` stays in `TRANSFER_DEFERRED`
   until an `exportPptx` op is admitted; the fidelity bar (which slide
   features must round-trip through real PowerPoint) determines whether
   in-engine ZIP writing suffices or a heavier path is needed.
7. **Splice sequencing.** D-29 cannot be unblocked by this decision
   alone — the compositor/render cache is a co-blocker; record ordering
   explicitly in the P08 slice plan.

## Honest limitations

- Docs-only evaluation: no encoder was built, benchmarked or run on any
  target. Native encoder APIs are assessed at contract level; the
  RGBA→YUV feed path (CVPixelBuffer on Apple, ByteBuffer/surface on
  Android), bitrate/framerate caps, and cancellation semantics are
  unverified and must be proven per platform before admission claims.
- Crate versions, licenses and feature claims (mp4e, muxide,
  oxideav-mp4, rav1e, openh264, mediabunny) were read from public
  registry/repository metadata at research time; admission still
  requires the repo's file-level license-closure review, same as P10/P15.
- "No encoder exists" claims rest on `TRANSFER_DEFERRED`,
  `SPLICE_DEFERRED`, `docs/ENGINE_OPS.md` and report statements; a
  confirming source read is warranted before dispatch.
- Desktop Linux and the XR targets (Quest/PICO) have no named encoder
  candidate here; scope them explicitly before P18/P20 acceptance rather
  than assuming MediaCodec/Media Foundation coverage extends there.

## Addendum — 2026-11 (prism:png engine admission)

The "adjacent non-media" row above is resolved engine-side: Prism gained an
`encodePng` read op (`codex/w10-prism-png`) that returns deterministic
8-bit RGBA PNG bytes as `png_b64`/binary output — the same bytes-across-the-
boundary pattern as `flatten`'s `pixels_b64`, consistent with the I/O-free
engine contract (no file writes, no host codec). It uses the `png` crate
0.18.1 already in the workspace lock (MIT OR Apache-2.0; prism
THIRD_PARTY_NOTICES.md). `TRANSFER_DEFERRED["prism:png"]` is cleared; the
remaining gap is host-side registration of a png `ExportFormat` in the
transfer sheets, which this decision never covered. The media-encoder
provider decision above is unchanged — video/audio export still routes
through the host provider.
