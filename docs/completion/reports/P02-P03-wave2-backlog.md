# P02/P03 Wave 2 dispatch backlog

2026-11-08 (source scoping; read-only). Backed by `MEGAPLAN.md` Wave 2,
`P02-P11-IMPLEMENTATION-MAP.md`, `reports/P02.md`, `reports/P03.md`,
`N11-collaboration.md`, `docs/ARCHITECTURE.md`, `docs/ENGINE_OPS.md`,
`components.json` N-10–N-21 rows and direct source inspection of
`packages/ignition`, `packages/media-ui`, `rust/ignition-core`,
`rust/nf-sys`, `rust/nf-cli`, `apps/*`, `examples/native-cadence`,
`tooling/react-native-video-v1` and NYC-Tron
`platform-services/src/media` + native decoder sources. No tests, builds
or device runs were performed for this scoping; "exists" means source is
present, not that acceptance is proven. No slice is marked complete.

## Cross-cutting rules for every slice

- **P02/P03 are infrastructure phases, not engine phases.** Almost all
  remaining work is TS host contracts, Nitro/C++ native plumbing,
  NYC-Tron platform packages, or native Swift/Kotlin/ObjC — not new
  `Engine::apply` ops. `docs/ENGINE_OPS.md` only needs updating if a
  slice adds engine ops. New host contracts belong in
  `docs/ARCHITECTURE.md` and the owning package README.
- **Checkpoint/native identity tags are append-only.** `ENGINE_TAGS` in
  `packages/ignition/src/autosave.ts:7-9` maps all 11 kinds. NFC1/NCC1
  records embed these tags; never renumber. New host contract versions
  need explicit new tags/magic.
- **Experimental player provenance is unresolved.** The selected
  `react-native-video@7.0.0-beta.12-nitrov1-experimental.1` artifact is
  a recovered `.1` tarball whose `.0`-labeled source patch does not
  reproduce it. No slice may promote it to a default dependency until
  the `.1` source delta is reviewed, regenerated with pinned Nitrogen
  nightly-120, repacked, and compared.
- **NYC-Tron release gating.** `media-ui`, `audio-ui` and labs pin
  `v0.1.0-alpha.4`. The decoder's `presentationIndexV1`/
  `decodeIndexedFrameV1` methods exist only in unreleased NYC-Tron
  source; consumer activation requires a NYC-Tron release + pin update —
  a Wave 4 packaging dependency.
- **Honesty rules.** Focused checks per slice; workspace test/typecheck
  per wave; runtime evidence via existing native harnesses; ROSTER and
  reports record only executed checks. Android runtime remains
  opportunistic pending disk.

## What already exists (verified in source)

### P02 infrastructure

| Capability | Source | State |
|---|---|---|
| EngineHost/NitroHost + `createNativeForgeFactory` | `packages/ignition/src/host.ts` | exists; native JSI probe passed iOS+Android |
| `ForgeV1EngineHost` compat | `packages/ignition/src/v1-host.ts` | exists |
| Document lifecycle close-on-failure | `document.ts` wrappers | exists |
| NFC1 checkpoint store + `DocumentAutosave` | `packages/ignition/src/autosave.ts` | exists; 11 kinds tagged; 20 recovery tests pass |
| NCC1 collaboration checkpoint store | `collaboration-checkpoint.ts` | exists; CRC32, 256 MiB bound |
| `DocumentCollaboration` revision-CAS owner | `collaboration.ts` | exists; 9 tests via nf-cli |
| HTTP transport + revision polling | `collaboration-http.ts` | exists; loopback fixture only |
| `packages/collaboration-server` (SQLite WAL CAS) | `packages/collaboration-server/` | exists; loopback, fixture auth only |
| `UndoTransactionCoordinator` + `__batch` | `transactions.ts`, `batch.rs` | exists; all 7 original engines |
| File import/export bytes contract | `transfer.ts`, `transfer-ui.ts` | exists; only `.nfd` real; `TRANSFER_DEFERRED` lists prism:png, splice:video, pitch:pptx, metadata |
| Native tasks/media cache/binary ABI | `cpp/NitroForgeV1/*`, `nf_v1.h`, `ffi_binary.rs` | exists; iOS+Android JSI probe passed |
| Telemetry package | `packages/telemetry` | exists; consent Off/Local/diagnostics proven natively; no product UI, no sink |
| Native file/share/picker | NYC-Tron `platform-services/documents` + `transfer-ui.ts` | exists; iOS+Android picker/share/relaunch pass; Android recipient delivery unverified |
| Playback lifecycle policy | NYC-Tron `platform-services/playback` (N-17) | exists in NYC-Tron; device interruption run pending |
| LongTaskScheduler/MediaCache/BinaryTransport | cpp headers | exist; iOS+Android services probe passed |

### P03 decoder/playback

| Capability | Source | State |
|---|---|---|
| `MediaDecoder` contract | `tron-complete/.../media/decoder.ts` | exists; validated bounds, error codes, AbortSignal |
| Native iOS decoder (AVAssetReader) + Android (MediaExtractor/MediaCodec) | platform-services ios/android | exists; H.264/AAC fixture passed both simulators; presentation-index added later |
| Web decoder (WebCodecs + mediabunny) | `platform.web.ts` etc. | exists in NYC-Tron; not admitted for Forge claims |
| `createFrameSession` | `packages/media-ui/src/video/frameSession.ts` | exists; 14 vitest cases pass |
| `NativeVideoMonitor` | `packages/media-ui/src/video/NativeVideoMonitor.tsx` | exists as **uncommitted opt-in candidate**; no runtime evidence |
| Nitro-v1 `react-native-video` port | `tooling/react-native-video-v1/` | experimental `.1` artifact preserved; static checks only |
| Player acceptance harness | `examples/native-cadence/PlayerAcceptance.tsx` | exists; Android capture partial, iOS player unproven |
| Audio preview/playback session owner | `packages/audio-ui/*` | exists; uses NYC-Tron playback session |

## What's missing (mapped to user's remaining work)

- **Product recovery integration**: autosave/collaboration/transfer are
  exercised only by `examples/native-cadence` + vitest — no product host
  wires them into document lifecycle.
- **Player/decoder ownership**: Forge-side monitor is uncommitted
  opt-in; NYC-Tron decoder additions unreleased; no approved player
  artifact.
- **Frame presentation**: exact-PTS decode exists; presentation path
  (decoded frame → surface, seek→commit consistency, web) unproven.
- **Recording/device routing and delivery providers**: no device routing
  host (P09); transfer delivery providers beyond OS pickers absent.
- **Decoder/playback gaps**: codec matrix beyond H.264/AAC, VFR/B-frame
  consumer-side evidence, lifecycle/audio-focus policy, web monitor,
  encoder/export providers.

## P02 — ordered slices

1. **P02-S1 — Product recovery contract (TS, design-first).** Host
   binding for `DocumentAutosave`/NCC1/`DocumentCollaboration`; output:
   `DocumentRecoverySession` facade in `packages/ignition` + tests.
2. **P02-S2 — Adopt recovery in one reference host.** Wire S1 into
   `apps/example` (or studio-preview) for Cadence + one document engine.
   N-10 evidence.
3. **P02-S3 — Cancellation/resource-lifetime audit → engine checkpoints
   (pure Rust).** Audit every long op across all 11 engines; add
   cooperative checkpoints where missing. Parallel with S1/S2.
4. **P02-S4 — Transfer delivery providers.** Wire `transfer.ts` exports
   to NYC-Tron documents write/share in a real host; import→`restore`
   for `.nfd`. Android recipient verification disk-gated.
5. **P02-S5 — Collaboration scope decision (admission/user).**
   Revision-CAS snapshots vs CRDT merging (Yjs/Automerge admission);
   P16 presence out. Record in N11-collaboration.md/MEGAPLAN.
   **Decision-gated.**
6. **P02-S6 — N-13/N-14/N-16 platform acceptance.** Web/WASM host check,
   foldable/desktop hosts per Wave 3; mostly evidence runs.
7. **P02-S7 — N-18 telemetry product integration.** Consent UI exists in
   NYC-Tron; remaining: sink backend decision (admission), authenticated
   delivery. **Decision-gated.**
8. **P02-S8 — Keyboard/accessibility infrastructure.** Mostly Wave 3
   device evidence; gaps become small fixes.

## P03 — ordered slices

9. **P03-S1 — Player artifact admission (blocked).** Review recovered
   `.1` source patch, regenerate with pinned Nitrogen, rebuild tarball,
   compare; or select different approved player. Requires NYC-Tron
   release carrying decoder methods (Wave 4 pin).
10. **P03-S2 — Activate opt-in integration (TS).** Apply/reconcile
    `forge-integration-candidate.patch`; resolve manifest/lockfile
    deltas. Depends on S1.
11. **P03-S3 — Player runtime acceptance iOS+Android.** `PlayerAcceptance`
    cycles on fresh binaries; foreground/background, audio-focus,
    interruption cases. Android disk-gated.
12. **P03-S4 — Frame-accurate commit path validation.** `commitFrame`/
    `preview` through `NativeVideoMonitor` on real fixtures incl.
    VFR/B-frame; verify `actualTimeUs` == requested index PTS.
13. **P03-S5 — Lifecycle/presentation ownership.** Wire NYC-Tron
    playback session into monitor owner; web strategy decision.
14. **P03-S6 — Codec/error/bounds matrix.** Beyond H.264/AAC:
    unsupported/DRM/HDR rejection, out-of-range times, cache budget
    ownership boundary, `clearCache` semantics.
15. **P03-S7 — Consumer handoff contracts (TS, doc-sync).** Stable host
    contract for Splice/Pitch: presentation-index producer, FrameSession
    API, decoded-frame URI lifetime, transport interface. Document in
    ARCHITECTURE.md or media contract doc. Unblocks P08.

## ENGINE_OPS.md / registration gaps

- No engine-op gaps for P02/P03 proper. `TRANSFER_DEFERRED` items
  (prism:png, splice:video, pitch:pptx, metadata) belong to
  P05/P08/P14/P04 slices; each admitted op needs table + dispatch + OPS
  map + snapshot notes together.
- Host-contract registration: extend `docs/ARCHITECTURE.md` for the
  MediaDecoder/FrameSession/VideoPlayer ownership split once S2/S7 land;
  `packages/media-ui/README.md` claims are stale pending executed
  evidence; NFC1/NCC1 tags append-only.

## Honest limitations

- NYC-Tron decoder internals verified at TS contract level + file
  listing; Swift/Kotlin claims come from tron-complete reports.
- `forge-integration-candidate.patch` applicability to current HEAD
  untested.
- `.1` player tarball exported ABI unconfirmed without unpacking.
- Android runtime evidence disk-gated.
- "No product host wires autosave" rests on grep absence — worth a
  confirming read by the implementing subagent.

## Suggested dispatch order

- **Track A (P02):** S3 (Rust, independent) ∥ S1→S2 (TS host) → S4;
  S5/S7 decision-gated, escalate early; S6/S8 fold into Wave 3.
- **Track B (P03):** S1 critical-path blocker (provenance + NYC-Tron
  release) — start immediately, parallel with S5 web/lifecycle design
  and S6 fixture prep; S2→S3→S4 is the acceptance chain; S7 unblocks
  P08.
