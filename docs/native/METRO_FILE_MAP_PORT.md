# Expo 58 / Metro 0.87.2 file-map compatibility port

This is a local, version-pinned compatibility patch, not an Expo-endorsed pairing.
It targets `@expo/metro-file-map@58.0.5`; upstream Metro packages stay at 0.87.2.
Expo's CLI still uses and verifies its own branded FileMap. There is no CLI
assertion bypass, no runtime monkeypatch, and no no-op API shim. Expo's scoped,
on-demand fallback TreeFS remains unchanged.

## Provenance and behavior

The dynamic-root registry and serialized crawl/change queue are ported from
`metro-file-map@0.87.2/src/index.js`. Watcher.js and the watcher backend subsystem
are ported together from that same published version, with lifecycle hardening.
Source release: https://github.com/react/metro/releases/tag/v0.87.2
Published Metro gitHead: `90ef3971c2bf6e6786ab99b79b7f0358f1261d38`.

Both packages are MIT-licensed. The package LICENSE is retained and copied files
retain/add Meta copyright and license attribution. Npm archive SHA-512 integrity
was verified during reconstruction; the exact digests are recorded below.

- Metro 0.87.2: `sha512-zXB6o7Oj/xVGOhHQ+dz8BIAjZqjv1S1v/sJIqqRus8XiZISNspO3DmnKWssW0Gh2XO+Sq4TAjkIuYQnBJ+lnjA==`
- Expo 58.0.5: `sha512-Y2w8qKklLffZie28In4WF6f6e8nIJOhU0mZ5UaQdCiITVQm2a5teNdIDudEPkBsh8ItlvyHZt9n42PN2onRbkQ==`

Adaptations:

- Real filesystem symlinks are canonicalized, including roots outside the lazy
  tree. Missing or non-directory roots fail explicitly.
- Concurrent duplicate roots share readiness; nested roots reuse parent readiness.
  Failed registrations are removed and retryable.
- Watchers start before Node crawls. Watchman receives initial crawl clocks.
  Dynamic roots are watched before crawling, with crawls and changes serialized.
- Startup failures/timeouts clean partial watchers. Close during startup cancels
  readiness and cleans late resources. Roots are deduplicated after failed
  recrawls, and events after end are ignored.
- Dynamic content is recrawled on new process registration; Expo's static-root
  snapshot filter stays unchanged.
- Startup health cookies work with periodic health checks disabled.

The example also needs explicit watchFolders for its own workspace and the linked
canonical UI workspace (derived from STUDIO_UI_ROOT at packages/ui). This makes
pnpm symlink targets and assets visible without watching the common parent. The
additional workspace costs a crawl; native singleton resolution must stay intact.
This patch does not itself change host configuration.

## Verification and reconstruction status

Run after the normal package manager applies the pinned patch:

    node --test apps/example/tooling/metro-dynamic-roots.test.cjs apps/example/tooling/metro-watcher-lifecycle.test.cjs
    node apps/example/tooling/verify-metro-stack.cjs

Eight tests cover real directory/symlink roots, both on-demand modes, crawling,
create/change/delete events, concurrent additions, failed crawl rollback/retry,
startup failure cleanup, close/start races and stopped event delivery.

Before the execution environment was replaced, all eight tests passed and actual
iOS/Android Expo JS exports passed, including Uniwind-integrated reruns. Those
reruns emitted six Uniwind mixed-unit calc diagnostics. Expo web got past startup
but failed at Solito's next/image dependency. These are historical results, not
fresh verification of reconstructed files.

The files were reconstructed from the verified npm archives and retained code
history on November 4, 2026. After legitimate normal and frozen installs, all eight runtime tests passed
again. Fresh iOS4525-module, Android4504-module and web3828-module exports pass;
the canonical KeyValueList fix removes the mixed-unit diagnostics, and the host
now declares the Next peer. Real native-style transforms report zero errors.
Watchman service, macOS native watching, native compilation and devices were not
validated. JS export does not establish native readiness.

## Installation

Register patches/@expo__metro-file-map@58.0.5.patch under patchedDependencies and
let pnpm generate the lockfile normally. Do not invent patch hashes, weaken
release-age policy, or add exemptions. Reading pristine source archives for this
port was not an installation or execution of fresh dependencies. The latest-host
candidate's independent installation-age gate remains in force.
