# Phase 6: native runtime, media and desktop audit

Worktrees: `forge-phase6` (`codex/phase6-native-runtime`) and `tron-phase6` (`codex/phase6-native-media`) under `/Users/mikevocalz/recovered-work/2026-11-05`. These continue phases 1–5. Original repositories and interrupted clones remain preserved.

## Delivered

Forge adds generated Nitro nightly-120 document binary/task APIs, an owned bounded LRU byte cache, and additive Rust C ABI without changing the existing v1 result layout. Accepted work retains input/session/task ownership and FIFO ordering through close. Cancellation never waits for the document lock; running read-only work checks at safe checkpoints. Cadence retains the phase-4 mixer/DSP implementation, including continuous effects. All old JSON/base64 callers remain supported. Details and bounds are in ARCHITECTURE.md and ENGINE_OPS.md.

NYC-Tron adds the recovered iOS AVFoundation decoder, its real Expo v2 registration, conditional media export and web fallback. Native decode runs on an owned serial worker; frame/PCM files live in a 256 MiB cache with old-file eviction. PCM output is streamed into a file; each request has duration/rate/channel/size bounds. The web fallback handles the no-seek event at frame zero, bounds source bytes and readiness waits, and distinguishes seek target from native presentation time. WebAudio still decodes the whole source internally, so web audio accepts sources up to 60 seconds/64 MiB; browser-internal allocations are not claimed bounded or streaming. Android has no decoder implementation and honestly reports unavailable.

The controlled AudioInterruptionRecoveryDialog requires explicit host resume/stop/restart/keep/discard callbacks. It disables resume until the host confirms readiness and keeps failures visible. Its per-instance state uses Zustand. It does not auto-resume playback or fabricate a recovered recording. Existing playback ownership and window/orientation contracts are preserved.

## Executed evidence

- Rust workspace: 340 tests pass, including raw Prism input/output, NFD binary output, cancellation leaving snapshots unchanged, progress monotonicity and task/legacy DSP byte equality.
- Forge workspace: 446 package tests pass, one existing native test skipped; all workspace types pass.
- C++ linked to the real Rust archive: session round-trip, raw snapshot, cancelled mutation, retained task-control ownership, cache LRU/copy/bounds checks pass. Existing FIFO/destruction/scheduler failure test passes.
- Factory/document/cache/task implementations compile against the actual generated Nitro headers and pinned RN headers with warnings as errors. Code generation succeeds for all four resources. This is native compilation evidence, not a Nitro JS runtime/device run.
- NYC-Tron: 716 source/model/render tests, workspace build/types and package export verifier pass. Thirteen unpublished local tarballs pass export/license checks in `phase6-local-packs`; alpha.3 names are inherited and do not replace released assets.
- Chromium: full 435 tests pass, including real generated WebM decoding (32x24 JPEG at zero and mono 16 kHz PCM), explicit recovery decisions and four light/dark phone/tablet captures. Focused final recovery lane also checks a rejected host resume.
- Actual Expo prebuild, CocoaPods install and Xcode 27.1 Debug iOS simulator app build pass, including NYCTronMediaDecoderModule in generated ExpoModulesProvider. Existing haptics/documents/playback registrations remain. System CocoaPods was broken; isolated CocoaPods 1.16.2 gems were used outside the repo, with project dependencies unchanged.

Logs are `phase6-*.log` beside the worktrees. iOS sources were compiled and linked; decoder runtime, audio interruption behavior, screen readers and physical foldables/headsets were not exercised. No established app dimensions, orientation or Android manifest entries changed.

## Desktop review of PR #57

Reviewed head `45039126e67e434faa6691d8878a8c474cab87bc`, independently checked out at `review-phase6-windows`: native worker admission/FIFO/destruction, document token ownership, React promise boundary, snapshot codec bounds, WindowsHost open/close/dispose handling and MSBuild integration. No new source defect was found in these reviewed paths. This is not a merge approval or a claim of exhaustive platform acceptance.

GitHub run [42123987667](https://github.com/mikevocalz/nitro-forge/actions/runs/42123987667) has seven successful jobs: TypeScript contract, Linux/Windows x64/Windows ARM64 native builds and three cross-target reopen jobs. Those jobs compile/test the common worker and codec; they do not run a complete RNW app. PR #57 remains draft/open. Its RNW 0.85 application build/runtime with the documented toolset is still a gate. The PR uses the separate ignition-v1-lab session stack and has not been merged into the phase-6 canonical adapter.

QNX SDK/device acceptance remains unavailable. The locked dependency graph's `getrandom` target_os compatibility and QNX native/JS owner completion/teardown must be validated on the actual target. Neither the Windows results nor this macOS audit establishes QNX support. No GitHub review/comment was posted.

## Remaining boundaries

N-13 is locally implemented for available engine tasks, with cooperative rather than universal cancellation; Expo decoder cancellation is absent. N-14 caches derived bytes but does not create thumbnails/waveforms or persist documents. N-16 uses owned copies, not zero-copy. N-19 remains PARTIAL across platforms because Android decoding and native runtime acceptance are missing. N-20 is host-controlled UI; OS recording recovery persistence remains host responsibility. Production pins remain published alpha.3; these phase branches are pushed but no release or merge is performed. The broader absent/deferred 341-row backlog is outside this interrupted-source recovery scope.
