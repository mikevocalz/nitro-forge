# Speech/ASR backend decision

2026-11-11. Source-evaluation record; admits no dependency, no engine op
and promotes no phase or acceptance field. Evaluated against
`docs/ENGINE_OPS.md`, `docs/COMPONENT_MASTER_INVENTORY.md`, the ledger
rows in `docs/completion/PLAN.md`, the encoder-provider precedent in
`reports/P-encoder-provider-decision.md`, the decoder boundary in
`reports/P10-raw-decoder-decision.md`, and the N-18 telemetry consent
surface in `reports/P02.md` / `reports/P02-P03-wave2-backlog.md`.
Docs-only: no builds, tests or device runs were performed.

## Context

Engines are synchronous, single-threaded, I/O-free `Send`-only state
machines. `apply` must be atomic and deterministic; snapshots are the
NFD1 envelope; mutating ops journal undo entries. ASR is inherently
nondeterministic, streaming, I/O-bound and permission-gated — it can
never run inside `Engine::apply`. The decision therefore splits every
consumer into **engine-side** (deterministic document model and ops,
fed only by host-supplied text) and **host-side** (recognition service,
owned outside the engines, exactly like the decoder/encoder providers).

Ledger state at evaluation time:

| Row | Component | Phase | Status | Recorded blocker |
|---|---|---|---|---|
| D-33 | `AutoCaptionTranscriptTimeline` | P08 | ABSENT | ASR backend not chosen; on-device ASR service (absent) |
| D-34 | `CaptionWordTimingHandles` | P08 | ABSENT | none; D-33 transcript model |
| H-22 | `DictationSessionPanel` | P12 | ABSENT | none; OS dictation via IME bridge |
| E-37 | `SpeechTranscriptTakeReview` | P09 | ABSENT | none; ASR (absent) |
| H-21 | `DocumentReadAloudTransport` | P12 | DONE | device gates only; OS TTS — **not an ASR consumer** |
| K-18 | `PDFReadAloudTransport` | P15 | BUILT-UI | DEFER `renderPage`; OS TTS — **not ASR-blocked**; folio `pageText` exists |
| E-34 | `VoiceIsolationPanel` | P09 | ABSENT | speech *separation* model — a different DSP problem, not ASR; stays blocked regardless |

H-21 and K-18 are TTS/read-aloud rows, not speech-recognition rows; this
decision does not gate them (K-18 remains gated on folio `renderPage`).
E-34 needs a source-separation model, which is out of scope here.

## Consumers and what each needs

| Consumer | Needs from ASR | Needs engine-side |
|---|---|---|
| D-33 `AutoCaptionTranscriptTimeline` (CapCraft transcript-to-caption blocks, editable text, speaker labels, playback sync) | Transcript segments `{start_s, end_s, text, speaker?}` for a media timeline; partial/streaming results while recording or importing | **New splice transcript/caption model** — none exists today (`docs/ENGINE_OPS.md` splice ops cover tracks/clips/transitions/markers/loop only). Proposed admission: caption cues as a clip-attached or timeline-level collection with `{start_s,end_s,text,speaker?,confidence?}` records, journaled/undoable, snapshot-covered, plus `addCaptionCue`/`updateCaptionCue`/`removeCaptionCue`/`listCaptionCues` ops in the existing bounded-collection style |
| D-34 `CaptionWordTimingHandles` | Word-level timings inside a segment | Same model needs a `words:[{text,start_s,end_s}]` optional field or a `words_b64`-style payload; admission decision rides with D-33 |
| H-22 `DictationSessionPanel` (WordCraft speech-to-text with permission/record state, review, editing, undo) | Streaming partial text while the user dictates; final text on stop | **Already exists**: `quill` `insertText`/`replaceRange`/`applyStyle` and its undo journal cover insertion, review-editing and undo. Dictation *session* state (recording, permission, partial hypothesis) is host view state — it must not enter the document. Interim "live" preview should be host-rendered; only committed text crosses into the engine |
| E-37 `SpeechTranscriptTakeReview` (review recognized speech against recorded takes with speaker/timing corrections) | Same transcript segments plus recorded-take audio reference | Depends on the forge #37 recorder (capture path, E-01/E-04/E-38 adjacent) and the same splice transcript model; take linkage is a host-side association — engine stores the transcript, the host stores take↔segment mapping |

## Candidates

| Candidate | License | Coverage | Platforms | Verdict |
|---|---|---|---|---|
| Platform-native ASR: iOS/macOS `SFSpeechRecognizer` (+ `SFSpeechAudioBufferRecognitionRequest`), Android `SpeechRecognizer` API, Windows WinRT `SpeechRecognizer` | OS APIs — no redistribution or license burden | On-device capable on Apple (`requiresOnDeviceRecognition`) and Android (`EXTRA_PREFER_OFFLINE`); quality varies by locale/device; Windows supports on-device with downloaded speech packs | Native targets only — three+ implementations to own and test | **Primary for native targets** |
| Web `SpeechRecognition`/`webkitSpeechRecognition` | Browser API | Streaming partial results free; backend is browser/OS-dependent and frequently cloud-routed (Chrome sends audio to Google); no consistent offline mode | Web/WASM only — unavailable in React Native | **Primary for web**, with the caveat that "on-device" cannot be guaranteed; privacy posture must assume cloud routing unless the host verifies otherwise |
| NYC-Tron `platform-services` wrapper over the above | Same as above | One typed host contract (`start`/`partial`/`final`/`end`/`abort`, error codes, consent gate) with per-platform impls — the symmetric sibling of `MediaDecoder` and the pending encoder provider | All targets through one seam | **Recommended owner** — same boundary precedent as decoder/encoder |
| Cloud ASR: Deepgram, AssemblyAI, OpenAI Whisper API, Google/Azure Speech | Per-vendor terms; audio leaves device | Highest accuracy, speaker diarization, word timestamps, every locale | Everywhere incl. WASM | **Opt-in fallback only** — requires explicit consent, credentials, per-minute cost, and a network path; never the default |
| Pure-Rust on-device ASR: whisper.cpp bindings (`whisper-rs`), sherpa-onnx, `ort`+sherim models | MIT/Apache-class for bindings; model weights carry their own terms (Whisper weights MIT) | Real on-device ASR incl. WASM-capable ONNX runtimes | All targets incl. WASM | **Fallback / later option** — model size (tens–hundreds of MB), per-target build cost, and no streaming-partial parity yet; revisit if platform APIs prove insufficient on a target |
| Android/iOS OS dictation via IME for H-22 only | OS APIs | Zero new surface — the OS keyboard already dictates into any text field | Mobile only | **Acceptable v0 for H-22 on mobile** — but gives no review/segment model and no desktop story; use the provider for consistency |
| In-engine Rust ASR (any crate inside `Engine::apply`) | — | — | — | **Rejected**: violates the I/O-free, deterministic, `Send`-only engine contract; nondeterministic output would poison undo/snapshot determinism |

## Decision

**One host-side speech-recognition provider, owned by NYC-Tron
`platform-services` as the sibling of `MediaDecoder` and the encoder
provider — not inside any engine and not a Forge-side FFI crate.**

Contract shape (proposal, admission-gated like the decoder's
`presentationIndexV1` methods): a streaming recognizer session —
`start({locale?, onDeviceOnly?, hints?})` → `partial`/`final` transcript
events with optional word timings → `end`/`abort`, bounded audio intake,
error codes, and a consent precondition. Engines and TS packages consume
it unchanged; nothing ASR-related enters `Engine::apply`.

The engine/host split is the determinism guarantee:

- **Host-side (nondeterministic, never journaled):** microphone capture,
  permission prompts, recognition session, partial hypotheses, model
  downloads, network egress, consent state. Transcript text crosses the
  boundary exactly once, as data.
- **Engine-side (deterministic, journaled, snapshotted):** the
  *committed* transcript. For splice this requires a new caption/transcript
  op admission (`docs/ENGINE_OPS.md` change + engine + TS together, per
  the repo's op-sync rule). For quill, zero new ops — dictation commits
  through existing `insertText`/`replaceRange` with normal undo. Once
  text is an op payload, every engine guarantee (atomicity, undo,
  snapshot restore, `document:changed`) applies unchanged.

Platform mapping:

- **iOS/macOS:** `SFSpeechRecognizer` with `requiresOnDeviceRecognition`
  preferred; on-device fallback to server recognition only under explicit
  consent.
- **Android:** `SpeechRecognizer` with `EXTRA_PREFER_OFFLINE`; same
  consent rule for network fallback.
- **Web/WASM:** `SpeechRecognition` where available; document that the
  browser may route audio off-device, so web builds treat recognition as
  cloud-class for privacy purposes unless the host can verify otherwise.
- **Windows/Linux:** WinRT `SpeechRecognizer` on Windows; Linux has no
  uniform API — defer, same honesty rule as the encoder matrix.
- **Cloud providers:** later opt-in tier behind the same contract for
  accuracy/diarization needs (E-37 speaker labels); never default.

Privacy/consent: the existing N-18 telemetry consent (Off/Local/
diagnostics) covers telemetry only — it does **not** authorize audio
egress. This decision requires a separate, explicit speech-recognition
consent surface: default on-device-only; any path that may send audio to
a recognizer backend (platform server recognition, browser cloud
routing, or a cloud provider) must be disclosed and opt-in. No audio or
transcript text enters telemetry without the diagnostics consent.

Cost: platform-native paths are free (OS-bundled); cloud tier is
per-minute metered and credential-gated — excluded from v1.

## Rows this unblocks

- **D-33** — unblocked once (a) this provider exists and (b) the splice
  transcript/caption op set is admitted. The op admission is the
  remaining engine-side gate; it is an `ENGINE_OPS.md` decision, not a
  provider question.
- **D-34** — unblocked with D-33 once word timings are in the admitted
  model.
- **H-22** — unblocked for the dictation flow itself (provider + consent
  UI + IME-bridge fallback); no new engine ops needed.
- **E-37** — partially: the transcript-review half unblocks with D-33's
  model; the recorded-take half still needs the forge #37 capture path
  (E-01/E-04/E-38 adjacent rows), so E-37 stays blocked on capture, not
  ASR, after this decision.
- **H-21, K-18** — not ASR consumers; unaffected (K-18 stays gated on
  folio `renderPage`).
- **E-34** — unaffected; needs a speech-separation model, a separate
  decision.

## Open decision points (require user input)

1. **Provider ownership/repo boundary.** Recommended: NYC-Tron
   platform-services (matches decoder/encoder ownership; requires a
   NYC-Tron release + Forge `tooling/nyc-tron.json` pin update, same
   gating as prior provider admissions). Alternative: a Forge-side
   provider crate — rejected unless the NYC-Tron boundary proves
   unsuitable, for the same reasons recorded in the encoder decision.
2. **Splice transcript op admission.** Caption cues as timeline-level
   records vs clip-attached vs a dedicated overlay track kind; word
   timing representation; speaker labels as free text vs bounded enum.
   Needs an `ENGINE_OPS.md` admission pass before any engine work.
3. **Consent surface ownership.** Whether speech consent is a
   platform-services prompt, a Forge settings surface, or both; and
   whether web builds may offer on-device-only mode at all given
   browser routing opacity.
4. **Cloud tier timing.** Whether any consumer (likely E-37 diarization)
   justifies admitting a metered cloud provider in v1, or whether
   platform-native suffices for the first slice.
5. **Windows/Linux scope.** Confirm desktop coverage expectations before
   promising parity; the encoder decision hit the same open matrix.

## Honest limitations

- Docs-only evaluation: no recognizer was built, benchmarked or run on
  any target. `SFSpeechRecognizer`, Android `SpeechRecognizer`, and web
  `SpeechRecognition` are assessed at contract level; on-device
  availability per locale, partial-result latency, word-timestamp
  fidelity, and cancellation semantics are unverified and must be proven
  per platform before admission claims.
- The web `SpeechRecognition` privacy claim ("browser may route audio
  off-device") is a platform-behavior statement, not a verified audit;
  the consent UI must not promise on-device guarantees it cannot check.
- "No transcript/caption model exists" rests on `docs/ENGINE_OPS.md`
  splice/quill op tables and the ledger blocker text; a confirming source
  read of `packages/splice` is warranted before dispatch.
- Whisper/sherpa-onnx feasibility (model size, WASM runtime cost, license
  of weight files per locale) was not benchmarked; it is recorded as a
  fallback, not a plan.
