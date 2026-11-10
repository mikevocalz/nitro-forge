# Advanced GUI native processing source admission

2026-11-05. Source research and integration design only. No processing code copied.
Companion UI implementation: https://github.com/mikevocalz/NYC-Tron-UI/pull/26
Cross-platform acceptance: https://github.com/mikevocalz/nitro-forge/pull/45

## Reusable source candidates

| Source | License reviewed | Use | Integration constraints |
| --- | --- | --- | --- |
| [googlefonts/fontations](https://github.com/googlefonts/fontations) | MIT OR Apache-2.0 | Variable fonts and font metadata | Shared Rust font queries via bounded FFI; Expo v2 supplies OS font discovery. Native/WASM shaping and rasterization must match the app renderer. |
| [google/ink](https://github.com/google/ink) | Apache-2.0 | Pressure, tilt, orientation and twist | Use C++ input model/ink core through reviewed bridge; Expo v2 owns device lifecycle, not per-sample React renders. Preserve Muse SDK and platform prediction sources. |
| [AcademySoftwareFoundation/OpenColorIO](https://github.com/AcademySoftwareFoundation/OpenColorIO) | BSD-3-Clause | Color transforms and HDR proofing | Issue #42 already plans OpenColorIO; extend it. C++ processor through existing Forge bridge; explicit CPU/GPU/WASM strategy. OS display capability detection is additional work; bundled configs/LUTs need separate provenance. |
| [automerge/automerge](https://github.com/automerge/automerge) | MIT | Conflict/history and collaboration | Evaluate behind Forge document authority, not a second UI-owned document. Requires schema/undo reconciliation and migration design before adoption. |
| [sindresorhus/p-queue](https://github.com/sindresorhus/p-queue) | MIT | Bounded job scheduling | Reuse queue policy selectively; native worker lifecycle, persistence and encoder cancellation are additional work. Promise concurrency is not native parallel processing. |

advanced-gui-native-sources.json records each source file and license blob hash, and the
`main` commit at which both blobs were re-checked on 2026-11-05 (`verifiedAtCommit`; URLs
are pinned to it). Only the single listed file and the root license were reviewed. Review
the selected files' dependency closure before importing or linking code.
Retain copyright, license text, NOTICE where present and modification notices.
Do not assume fonts, LUTs, test fixtures or example assets share the code license.

## Workstream acceptance

1. Font metadata: expose axes, ranges/defaults, hidden flags and localized labels from
   bounded untrusted font bytes. Keep font discovery/permissions in the OS adapter.
   Use one shaping/rasterization authority; metadata alone is not rich-text editing.
2. Ink: preserve timestamps, pressure/tilt/orientation/twist and unavailable fields,
   native cancellation, predicted versus committed samples and calibration profiles.
   Existing Muse, Board and pointer workstreams remain owners; no second stroke history.
3. Color: deterministic color configuration, processor lifetime, CPU reference and GPU
   comparison, HDR/display capability query, invalid ICC/LUT handling and explicit output
   transforms. OpenColorIO is not an OS HDR detector or automatic WASM backend.
4. Recovery: evaluate Automerge only behind an explicit engine schema/reconciliation
   boundary. NFD1 snapshots, engine undo and save/reopen stay authoritative. Do not
   retrofit a CRDT mirror into every UI control. Prove merge semantics before adoption.
5. Jobs: use bounded queue policy, progress from real work, cancellation acknowledgement,
   persistent export checkpoints and background/resume. p-queue does not create native
   worker threads or make interrupted encoder jobs resumable.

## Remaining gaps needing original code

- Resource relinking: stable asset IDs/content hashes, user-approved native file handles,
  missing-media/font detection, proxy/original relationship, validation before atomic relink.
  Superlist clipboard/file transfer (NYC-Tron PR #26 source map) is a reference for transfer mechanics, not a complete
  project dependency/relink engine.
- Numeric expressions: a bounded parser for arithmetic and known units, exact dimension
  validation and transactional commit. No eval/Function or unrestricted expression engine.
  No source package admitted in this PR.
- Unified command registry: selection-aware availability, checked/busy state, cancellation,
  one action route for native menu/palette/toolbar/shortcuts; native UI remains NYC-Tron.
- Toolbar personalization, accessible graph keyboard edits, recovery dialog and job monitor
  remain NYC-Tron visual surfaces; Forge only supplies acknowledged data and commands.

## Expo Modules v2 / native bridge plan

Expo v2 Swift/Kotlin adapters own OS services and lifecycle on compatible Expo58 hosts.
Keep Rust/C++ processing in reviewed C ABI/Nitro v1 adapters; preserve synchronous,
I/O-free Rust engines and asynchronous host boundaries. Never claim a framework rewrite
erases source licensing or creates cross-platform behavior.

Every workstream requires its own iOS/iPadOS, Android/Duo, web, macOS, Windows, visionOS,
Meta Quest and PICO evidence rows. Desktop uses supported native host adapters rather
than assumed Expo support. Web requires actual WASM/worker or equivalent processing.
XR input and compositor support need actual headset tests. Spark (Expo SDK 55 / RN 0.83,
see the PR #38 handoff) must not load Expo58-only modules. All status starts NOT RUN until evidence exists.

## Reviewed context and status

Forge master AGENTS.md, docs/ARCHITECTURE.md, docs/ENGINE_OPS.md and docs/ROSTER.md set the
ownership and transaction rules kept here. Extend open PRs #40, #43 and #44 and open
issues #41 (AudioKit/FilmCraft media ports) and #42 (MetalPetal/OpenColorIO/Prism) rather
than duplicating them.
No dependencies installed, native wrappers compiled, benchmarks or device tests run.
This draft records source evidence and concrete integration boundaries, not finished ports.
