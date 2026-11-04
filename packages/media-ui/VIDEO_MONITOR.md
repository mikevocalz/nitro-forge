# Selected video adapter: react-native-video on Nitro v1

The user selected **react-native-video 7.0.0-beta.12**, requires **Nitro v1**,
and explicitly rejected Expo Video. The previous Expo-backed experiment has
been removed, including dependency declarations. No older Nitro runtime or
alternative decoder was installed.

## Current behavior

`NativeVideoMonitor` displays an explicit unavailable status on every platform.
It loads no media and has no play/seek controls, fabricated frames or timers.
Its existing props and separate transport/state utilities are retained for the
replacement. `VIDEO_PLAYBACK_CAPABILITY.status` is `blocked`.

Web support exists upstream in react-native-video beta.12, but this draft has
not yet packaged an isolated web adapter without linking the incompatible native
backend. The previous browser backend was Expo Video and was removed too.
There is currently **no working playback backend** in this draft. A historical
successful Expo native build is not evidence for the selected replacement.

## Verified compatibility blocker

Audited November 4, 2026:

- The registry beta tag is still `7.0.0-beta.12` (stable is `6.19.3`).
- beta.12 declares Nitro `>=0.35.0`; it does not opt into v1 prereleases.
- Its native `playerFactory.ts` eagerly calls
  `NitroModules.createHybridObject('VideoPlayerFactory')`.
- Published `nitro-core@1.0.0-alpha.nightly.120.g33ef045b96c0` exposes
  `getHybridClass` instead, with no `createHybridObject` in its proxy API.
- beta.12 also ships v0 interface-style specs, old autolinking config, and
  generated Swift/Kotlin/C++ bindings. Changing only a package version, a peer
  range or one JS call is not a complete migration.

The read-only probe `scripts/check-video-v1-contract.mjs` reproduces the missing
factory API against extracted upstream packages. Its expected exit status is 1
for these exact versions. This is a concrete API blocker, not a tested claim
that a maintained port is impossible. No official released v1-compatible video
adapter was found in the checked registry or upstream PR search.

## Port implementation scope

1. Preserve beta.12's MIT license. Migrate its four `.nitro.ts` spec families
   (player, source, event emitter and view manager), factory registration and
   config to v1 classes/decorators with one exact matching runtime/core/generator.
2. Regenerate bindings and adapt native Swift/Kotlin implementations, construction,
   Promise/error handling, listener ownership and release paths. Validate native
   view registration and Pods/Gradle with the same v1 version, not mixed runtimes.
3. Restore the shared Forge adapter using real load/progress/error/seek/end events.
   Guard source changes/unmount, avoid stale event writes, and retain separate
   requested versus reported playback time. Playback time is not pixel proof.
4. Validate web platform resolution independently, then iOS/Android compile/link,
   playback, repeated disposal, interruptions, seeks and local/remote sources.
   Quest/immersive surfaces require their own tests. Native compilation alone
   does not establish actual playback or frame-exact seeking.

Splice remains the Rust edit/undo/timeline authority. Preview is not a compositor
or render-plan encoder. The patch removes the rejected backend and starts the
compatibility probe; it does **not** claim that the native v1 port is finished.

Sources:
- [Pinned video package](https://github.com/TheWidlarzGroup/react-native-video/blob/321b868085e49669a6fe1aa1cfb58e64d63d326f/packages/react-native-video/package.json)
- [Pinned factory](https://github.com/TheWidlarzGroup/react-native-video/blob/321b868085e49669a6fe1aa1cfb58e64d63d326f/packages/react-native-video/src/core/utils/playerFactory.ts)
- [Nitro v1 proxy](https://github.com/margelo/nitro/blob/v1.0.0-alpha.nightly.120.g33ef045b96c0/packages/nitro-core/js/src/NitroModulesProxy.ts)

## Verification for backend removal

- Media UI TypeScript and the media-lab application TypeScript: PASS.
- 27 pure unit/source-policy tests: PASS. These are not player rendering tests.
- Compatibility probe with official beta.12 and nightly120 source packages:
  expected BLOCKED (exit 1), independently reviewed.
- The rebased branch preserves concurrent seek/timebase fixes and pinned CI.
  Dependency removal is reconciled against that newer lockfile.
- No native v1 decoder or device playback was tested. Shell builds, if green,
  prove only that the unavailable-state UI compiles.
- Metro web export of the unavailable-state media shell: PASS (261 modules).
  This is bundle evidence only, not browser interaction or media playback.
