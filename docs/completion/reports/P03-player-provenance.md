# P03-S1 player artifact provenance analysis

2026-11-11. Read-only analysis of `tooling/react-native-video-v1/`.
No files modified; scratch work in /tmp.

## Inventory and pins

- Upstream: `react-native-video` commit `321b868085e49669a6fe1aa1cfb58e64d63d326f` (7.0.0-beta.12).
- Generator/runtime: `nitrogen`, `react-native-nitro-modules`, `nitro-core` = `1.0.0-alpha.nightly.120.g33ef045b96c0`.
- NYC-Tron: `v0.1.0-alpha.4` (`0554d190`) supplies the media decoder — NOT part of this artifact.
- Host: RN 0.88.x New Architecture, React 19.3.x.
- `.1` tarball `experimental-build-v1.tgz` SHA256 `0758b714…0bb44`;
  byte-identical duplicate `react-native-video-7.0.0-beta.12-nitrov1-experimental.1.tgz`.
  `.0` and `.1` are genuinely different builds (136 differing paths).

## Verification performed

- Recovered `.1` patch (`46759510…4ff5`) `git apply --check` against
  clean upstream `321b868`: **applies cleanly** (72 diff entries).
- Applied patch to `git archive` of upstream and diffed vs extracted
  tarball: **every non-generated, non-lib file matches byte-for-byte**,
  including the contested `NowPlayingInfoCenterManager.swift`.
- Generated outputs spot-verified in the pinned-toolchain worktree:
  `VideoPlayer.cjs`, `JHybridVideoPlayerSpec.cpp`,
  `HybridVideoPlayerSpecSwift.cpp`, `Package.swift`, podspec,
  `lib/module/index.js` all match the tarball.
- Tarball contains real native code: iOS Swift (core/hybrids/Fabric
  view), Android Kotlin + C++/JNI, Nitrogen generated dirs for
  apple-c++/swift and android-kotlin/c++, shared JS `.cjs` bindings.
- `initializeOnCreation:false` deferred-init contract present natively
  (iOS HybridVideoPlayer.swift:25, Android HybridVideoPlayer.kt:319).

## NOT done (gating proof still open)

- Full clean regeneration (`nitrogen` + `bob build` + `npm pack`) and
  packed-output diff vs tarball — PROVENANCE's 733/734 claim consistent
  but unexecuted.
- No native compile of iOS/Android targets anywhere in the chain.
- MIGRATION.md documents known Swift 6 Sendable/actor-isolation
  blockers (`PluginsRegistry.swift`, `VideoManager.swift`,
  `NowPlayingInfoCenterManager.swift`).

## forge-integration-candidate.patch status

- Applies cleanly at pinned `b649c7ea`; does NOT apply at HEAD (57
  commits of drift).
- Its content already exists in the forge-complete working tree as
  **uncommitted changes** (7 modified files + untracked media-ui video
  sources, PlayerAcceptance files, tooling tarballs, evidence file).
  Reconcile before any commit — do not lose or double-apply.

## Verdict

The `.1` artifact's provenance is **defensible at source level** and can
be admitted as an opt-in, checksum-pinned local tarball — candidate
status only, not production-approved. Minimal path to fully defensible:

1. Keep tarball pinned by SHA256 + PROVENANCE/README (done).
2. Execute README reproduction once with the recovered `.1` patch;
   diff packed output vs tarball.
3. Compile iOS/Android native targets + pass PlayerAcceptance lifecycle
   gates before any default-dependency promotion.

## ABI surface NativeVideoMonitor requires (verified present)

JS: `VideoPlayer` class (configure/initialize/play/pause/seekTo/release,
events onPlaybackStateChange/onProgress/onError, clearAllEvents),
`VideoView` Fabric component, deferred-init honored.
Nitro specs: VideoPlayer HybridObject full method set, event emitter
subscriptions, source factories, view manager factory.
Decoder methods (`decodeFrame`/`decodeIndexedFrame`/`presentationIndex`)
come from `@nyc-tron/platform-services` — separate dependency; strict
indexed-frame path needs NYC-Tron newer than alpha.4.
