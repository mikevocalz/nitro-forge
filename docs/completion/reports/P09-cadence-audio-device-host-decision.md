# Cadence audio device host decision

2026-11-12. Source-evaluation record; admits no dependency and promotes no
phase or acceptance field. Evaluated against `docs/ENGINE_OPS.md`
(cadence-engine section), `docs/completion/PLAN.md` rows E-01..E-41 (P09),
the decoder-provider precedent in `reports/P03-player-provenance.md` and
`reports/P02-P03-wave2-backlog.md`, and the encoder-provider decision in
`reports/P-encoder-provider-decision.md`. Docs-only: no builds, tests or
device runs were performed.

## Consumers and what each needs

Engines are synchronous, single-threaded, I/O-free `Send`-only state
machines. cadence-engine today ships real offline DSP — PCM render
(`render`, `renderStems`, f32le stereo), the full mixer (tracks, buses,
sends, inserts, automation), `meter`, BS.1770 `loudness`, `spectrogram`,
and `detectBeats` — verified by 70 cargo + 45 vitest tests. What it does
**not** have is any device I/O: no capture, no playback routing, no
latency measurement, and no MIDI output path (notes carry `channel` but
nothing emits MIDI events; `render` synthesizes them internally with a
sine oscillator). Every E-* audio row that needs a live device is
therefore blocked on a host-side audio device provider, exactly like
decoding (P03) and encoding (P-encoder-provider) were host concerns.

| Consumer | Phase / rows | Has today | Needs | Platform targets |
|---|---|---|---|---|
| Playback transport / monitoring | E-01 NativeAudioTransport, E-27 TempoAndMetronome, E-07 InputMonitorToggle | `render` PCM for arbitrary tick ranges at arbitrary `sample_rate` (8000..192000 per `meter`; render bounded ≤10 min @48 kHz); metronome mixes only on explicit opt-in | Stream rendered PCM to an output device in real time; device enumeration; monitor route | iOS, Android, macOS, Windows, WASM/web |
| Live recording / capture | E-04 LiveRecordingWaveform, E-06 RecordingArmButton, E-29 LoopPunchRecording, E-38 take bin | Nothing — no ingest op exists | Capture input PCM on the audio callback; PCM-to-disk/host buffer. **Co-blocker:** cadence has no audio-clip ingest op (E-09/E-10 absent) — captured PCM has nowhere to land in the document | Same matrix |
| Device selection | E-08 DeviceAndChannelPicker | Nothing | Enumerate input/output devices and channels per platform | Same matrix |
| Real-time metering | E-16 RealtimePeakMeter, E-17 LoudnessMeter (offline half built) | `meter`/`loudness` over ranges | Live peak/RMS taps on the render path during playback/record | Same matrix |
| Latency calibration | E-32 LatencyCalibrationPanel, E-31 AudioVideoSync | Nothing | Round-trip latency measurement and per-device reported latency | Same matrix |
| Beat/onset analysis of live or recorded audio | E-35 BeatDetectionMarkerLane | `detectBeats` op (spectral-flux onsets + tempo estimate) — PLAN row is stale, the op exists | Feed captured/live PCM through the op; host schedules the read | Same matrix |
| MIDI output to external instruments | none listed (no E-* row) | Note `channel` field only | CoreMIDI / Android MIDI / Web MIDI event stream | Native + web; separate decision, see below |
| Surround/multichannel | E-33 SurroundPanView | render is stereo-only (`channels:2`) | **Engine precondition fails** — needs a channels>2 render path first | Out of scope here |

## Candidates

| Candidate | License | Coverage | Build matrix | Verdict |
|---|---|---|---|---|
| Platform-native audio I/O: AVAudioEngine/AudioUnit (Apple), AAudio/AudioTrack+OpenSL (Android), WASAPI (Windows), Web AudioWorklet + AudioWorkletNode (web/WASM) | OS APIs — no redistribution or license burden; Web AudioWorklet is a browser API | Hardware-rate I/O, device enumeration, per-platform latency queries, MIDI via CoreMIDI/Android MIDI/Web MIDI where needed | Per-platform native code — but NYC-Tron `platform-services` already owns per-platform media surfaces (`MediaDecoder`, `platform.web.ts`); audio I/O is the symmetric sibling | **Primary for all targets** |
| cpal (RustAudio) | MIT OR Apache-2.0, permissive | Cross-platform Rust audio I/O: CoreAudio (macOS/iOS), WASAPI+ASIO (Windows), ALSA/JACK (Linux), AAudio on Android (0.15+); **no WASM support** — web requires a separate path regardless | Trivial for a Rust host; cannot serve the React Native runtime where engines run via Nitro | **Fallback / test tier** — backs an `nf-cli`-style host or desktop Rust host; not the product path |
| Web AudioWorklet standalone (no native layer) | Browser API | Web/WASM only; PCM via `AudioWorkletProcessor`, device pickers via `enumerateDevices`, MIDI via Web MIDI | Web only | Folded into the platform-native row above as the web implementation |
| Pure-Rust DSP+I/O crates beyond cpal (e.g. `oboe`-style thin wrappers, `windows`/`coreaudio` crates) | Mostly MIT/Apache | Redundant with cpal on desktop; no iOS/Android story of their own | — | Rejected: cpal already is this layer where a Rust host exists |

## Decision

**Shared host-side audio device provider, owned by NYC-Tron
`platform-services` as the sibling of `MediaDecoder`** — not inside any
engine and not a Forge-side crate. This mirrors the decoder precedent
(P03) and the encoder decision: one typed host contract (device
enumeration, stream open/close, bounded PCM chunk delivery, latency
query, `AbortSignal`-style cancellation), per-platform native
implementations, and an AudioWorklet implementation for web/WASM.
Engines and `packages/cadence` consume it unchanged; the E-* rows clear
only when real device bytes flow.

- **Native (iOS/Android/macOS/Windows):** AVAudioEngine (iOS/macOS),
  AAudio with AudioTrack fallback (Android), WASAPI shared mode
  (Windows). Hardware-rate I/O, zero license burden.
- **Web/WASM:** AudioWorkletNode rendering from pre-rendered PCM chunks;
  `enumerateDevices` for E-08; Web MIDI only if MIDI-out scope is
  admitted later.
- **Rust-host tier:** cpal is the admitted fallback for `nf-cli`-class
  hosts and any future Rust-native host, giving engine tests a real
  device path without touching the product runtime. No WASM claim.
- **Engine contract unchanged:** cadence stays pure — `render` remains
  the only PCM producer, snapshots remain `NFD1`, no engine op is added
  by this decision.

### Real-time architecture (the load-bearing constraint)

The engine is synchronous, single-threaded and I/O-free, so the audio
callback **must never call into it**. The design is a
producer/consumer split:

1. **Playback:** the host thread renders lookahead windows (e.g.
   100–500 ms of ticks→PCM via `render` at the negotiated sample rate)
   ahead of the playhead and pushes interleaved f32le stereo into a
   **lock-free SPSC ring buffer** (fixed-capacity, overwrite-on-overflow
   with a drop counter the host polls). The platform callback only pops
   frames — no allocation, no locks, no engine calls. Underruns surface
   as reported gaps, never as callback stalls.
2. **Recording:** the callback copies input PCM into a second SPSC ring
   buffer; the host thread drains it in bounded chunks for waveform
   taps (E-04/E-16), disk capture (forge #35/#37 path), and — once an
   ingest op is admitted — document clips. Punch/loop logic (E-29) is
   host scheduling over the same buffer, not engine state.
3. **Sample rate:** negotiate the device's native rate and render at
   that rate (the engine accepts any rate in range); resample host-side
   only when the UI meter path demands 48 kHz. No engine change either
   way.
4. **Latency:** the provider reports hardware+buffer latency per stream
   (AVAudioEngine IO buffer duration, AAudio frames-per-burst, WASAPI
   engine latency, AudioWorklet quantum+output latency). E-32 measures
   round-trip by loopback; per-device values feed the ledger as
   evidence rather than claims.

## What this enables (ledger evidence)

- **E-01/E-27/E-07:** real playback of engine-rendered PCM through a
  chosen device, with metronome and monitor routes — transport becomes
  demonstrable on hardware, not just WAV export (A-30 already solved).
- **E-04/E-06/E-16:** live waveform and peak metering from the capture
  ring buffer; arm state stays UI-side until a cadence track-arm op is
  admitted (separate engine question).
- **E-08:** device/channel enumeration from the provider contract.
- **E-29/E-31/E-32:** punch recording, A/V shared-clock sync, and
  measured latency — all host-side once the provider exists, modulo the
  ingest-op co-blocker for E-29.
- **E-35:** `detectBeats` is already implemented; the provider supplies
  the live/recorded PCM input it currently lacks.
- **Not unblocked:** E-09/E-10 (no audio-clip ingest op — needs an
  `ENGINE_OPS.md` admission), E-33 (stereo-only render), MIDI-out rows
  (no op and no scope decision), E-36/E-37 (content/ASR, unrelated).

## Open decision points (require user input)

1. **Provider ownership/repo boundary.** Recommended: NYC-Tron
   platform-services (matches decoder and encoder ownership; requires a
   NYC-Tron release + Forge pin update, same gating as
   `presentationIndexV1` and the encoder provider). Alternative:
   Forge-side provider — rejected unless the cross-repo release cadence
   proves unworkable.
2. **Recording ingest op.** Captured PCM needs a document landing zone:
   either a new cadence op (audio clip/buffer ingest — an
   `ENGINE_OPS.md` admission for the user) or a host-side take store
   outside the document (matches the forge #35/#37 capture framing).
   Decide before E-04/E-29 acceptance claims.
3. **MIDI output scope.** CoreMIDI / Android MIDI / Web MIDI would let
   cadence play external instruments, but no E-* row requires it and no
   engine op emits note events on a schedule. Recommend deferring;
   record explicitly so it is not silently assumed.
4. **Lookahead/window sizing and underrun policy.** 100–500 ms is the
   starting envelope; the acceptance bar for "no audible glitch" on the
   lowest-tier target device is undefined — needs a device-test plan.
5. **Sample-rate policy.** Render at device native rate (recommended)
   vs fixed 48 kHz + resample; affects meter/loudness consistency and
   WASM tier cost.
6. **WASM/web tier timing.** AudioWorklet covers web, but admission and
   the NYC-Tron release pin are Wave-4 packaging dependencies; confirm
   web audio I/O is in scope for the first device-host milestone or
   deferred with the rest of the web tier.
7. **Linux/desktop coverage.** cpal covers ALSA/JACK for a Rust host;
   there is no named native provider target for desktop Linux in the
   current app matrix — scope explicitly before P18 acceptance.

## Honest limitations

- Docs-only evaluation: no audio stack was built, benchmarked or run on
  any device. Platform latency figures, callback quantum guarantees, and
  Android AAudio-vs-AudioTrack behavior are asserted at API-contract
  level and must be proven per target before admission claims.
- cpal facts (MIT OR Apache-2.0, RustAudio maintenance, AAudio support
  in 0.15+, no WASM target) were read from public registry/repository
  metadata at research time; admission still requires the repo's
  file-level license-closure review, same as P10/P15.
- "No device I/O exists" rests on `docs/ENGINE_OPS.md`, `PLAN.md` E-*
  rows, and the absence of any audio crate in the workspace manifests; a
  confirming source read is warranted before dispatch.
- The ring-buffer design is a recommendation, not a measured result;
  lock-free correctness under callback preemption and the drop-counter
  semantics need a prototype before the E-16 real-time meter claims
  real-time accuracy.
