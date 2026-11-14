# Installed native consumer workflows

This CI-only runner installs the already-built Release application from the
external eight-tarball consumer. It serves no Metro/workspace source, injects
no application/store JavaScript, and has no engine stub or CLI-host fallback.
Native engine work is invoked only by touches on the visible fixture controls.
The optionless plugin, native payloads, generated project and signing settings
are unchanged by this runner.

Official Maestro 2.12.1 is pinned to source revision
`67d8a677029261fa424a45a10d08eacd6aa0deed` and release ZIP SHA256
`54dbb0716425626604973cbb374c585ca30272375d9ce15177a1152765ddd9d7`.
The installer checks those bytes; the runner checks the actual CLI version.
[XCTest touches](https://github.com/mobile-dev-inc/Maestro/blob/67d8a677029261fa424a45a10d08eacd6aa0deed/maestro-ios-xctest-runner/maestro-driver-iosUITests/Routes/Handlers/TouchRouteHandler.swift)
and the [Android driver](https://github.com/mobile-dev-inc/Maestro/blob/67d8a677029261fa424a45a10d08eacd6aa0deed/maestro-client/src/main/java/maestro/drivers/AndroidDriver.kt)
operate through their native OS interfaces. This is independent of local
Argent availability; local Argent remains NOT RUN.

The installer and `ui-evidence.mjs` are unmodified copies of NYC-Tron's actual
native acceptance helpers at source
`95b830aa9abfa6762851377fae31bf5aabcb903d`. Their separate MIT notice is retained
in `NYC-Tron-LICENSE`, Copyright (c) 2026 NYC-Tron UI contributors. SHA256:
installer `4f129ab6ad0d076c387a4edc1ed3a3abea9875d6aefc630e76f4a8b4d541579e`;
evidence helpers `19fede9ceaff734caf33a6f28ee1df52c2206618baa992c0ef67140d605fa506`;
license `9f0b3f26b53590a83dedb17168ead23fcff30809c02d0354869776fed8a51f35`.
No upstream attribution is replaced by Forge's original-code notice. Maestro
is an ephemeral CI tool, not a Forge package dependency or packed payload.

## Required behavior and evidence

One complete flow covers Prism, Cadence, Splice, Folio, Pitch, Tally and Quill.
For each, it selects the real studio option; opens; edits; saves exact NFD1
bytes; closes; reopens on a fresh host; makes a new edit; undoes/redoes that
edit; rejects malformed restore without changing state; closes; terminates
and launches the actual process without clearing data; and reopens the saved
document. Every action must show its exact studio/action/detail PASS and
expected open/closed state. A generic PASS cannot satisfy another action.

The same complete flow bytes run twice consecutively. Each invocation must
produce one executed successful JUnit case without errors/skips, every
planned screenshot, and actual native accessibility trees. There is no
automatic retry or passing receipt after a failed launch/assertion. Raw first
failure, driver artifacts, screenshot/tree and OS logs are retained.

After each pass, fixture-owned NFD and expected-state files are copied from
the actual installed app's OS sandbox, checked for envelope/studio/byte-count
agreement and hashed. Android uses the CI Google APIs userdebug image's root
read access; it does not seed/alter app data. Denied access is a failure, not
a reason to invent files or relax validation. iOS reads the actual app data
container returned by simctl. Only the named generated fixture files are read.
Pinned primary source confirms these locations: Expo FileSystem58.0.13 reads
AppContext's persistentFilesDirectory, and
[Expo Modules Core58.1.0 uses context.filesDir](https://unpkg.com/expo-modules-core@58.1.0/android/src/main/java/expo/modules/kotlin/services/AppDirectoriesService.kt).
[iOS AppContextConfig](https://unpkg.com/expo-modules-core@58.1.0/ios/Core/AppContextConfig.swift)
defaults to the user-domain Documents directory. The actual installed core
version is retained with the runtime graph; denied/missing OS files fail the
run rather than being inferred from these sources.

Android runs a real 320 × 800 pixel, mdpi emulator viewport, preserving application
configuration/orientation. The native screenshot must actually be 320 pixels
wide; all seven native option bounds must be in that viewport. The full flows
touch all seven options. iOS uses its actual available CI simulator viewport
and records accessibility points separately from Retina screenshot pixels;
it is not described as 320 px without such a viewport.

Successful execution writes `runtime-proof.json` with exact source, candidate
manifest, installed graph/renderer versions, lock, application and embedded
bundle hashes, driver identity, viewport geometry, two JUnit passes and OS
file hashes. Independent source/runtime/visual review remains PENDING. CI
does not mark F6 passed or assert wider product styling/design compliance.

## Invocation

CI supplies an already-built `runtime-app` directory, actual available iOS
Simulator or owned Android emulator, and the verified Maestro binary:

```sh
MAESTRO_BIN=/verified/maestro/bin/maestro node tooling/release/native-ui/run.mjs --platform ios --artifact-root /external/runtime-app --source <executed-merge-sha> --output /fresh/runtime-proof
```

Use `--platform android` on the owned CI emulator for Android. This command
does not install local SDKs, runtimes, JS dependencies or build applications.
`forge-consumer-*-runtime` artifacts keep the smaller UI/file/graph receipts
separate from compiled app archives for bounded independent review.
