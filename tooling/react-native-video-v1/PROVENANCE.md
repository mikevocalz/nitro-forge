# Recovered experimental .1 source

The selected `experimental-build-v1.tgz` identifies itself as `react-native-video@7.0.0-beta.12-nitrov1-experimental.1`. Its SHA-256 is `0758b71466e5b4e60705c3386516f2bd212cb4056a5f38547f0480465800bb44`.

`/Users/mikevocalz/recovered-work/2026-11-05/video-v1-port` remains at upstream commit `321b868085e49669a6fe1aa1cfb58e64d63d326f`, with dirty .1 source and generated/build outputs. The separate `video-v1-port-check` checkout is clean at that same upstream commit. No checkout or recovered archive was modified during recovery.

A byte comparison of all 734 regular files in the selected archive against the working package found 733 exact matches, including generated files and built JavaScript/declarations. The single mismatch is `ios/core/NowPlayingInfoCenterManager.swift`: the selected archive preserves main-thread wrapper closures around register/remove, static-info and playback-state operations; later working-tree changes remove them. The recovered patch deliberately takes this file from the selected archive. This is preservation of the artifact's source, not a native concurrency correctness claim.

The resulting `react-native-video-beta12-nitro-v1-experimental-1-recovered.patch` contains 73 source/configuration paths against upstream, including new source files and deleted obsolete helpers. Generated Nitrogen files, lib output and node_modules are excluded. Its SHA-256 is `4675951074d8a03d209121fc65f8b768f1e00005428bab4119c314402f664ff5`. The original .0 patch and all tarballs remain intact.

The patch was constructed and reverse/forward `git apply --check` verified in a temporary exact-upstream snapshot. Existing trailing whitespace is retained to preserve source bytes; git reports whitespace warnings. Those warnings are not application failures. No native compiler, generator, dependency installation or runtime test was run for recovery.

To reproduce the source candidate, create an isolated checkout at the pinned upstream commit and apply the recovered .1 patch. Follow the exact pinned generator/runtime and source-build steps in README.md, substituting this patch for the original .0 patch. The next required proof is to regenerate and rebuild in that isolated checkout, compare generated sources and packed files against the preserved archive, and explain any timestamps/toolchain nondeterminism. Byte-identical generated/build reproduction has not yet been established.

Before any default dependency change, independently review the full recovered patch, compile native targets and complete the player lifecycle acceptance gates. Keep opt-in acceptance-host manifest and lockfile changes together. This recovery changes no Forge dependency selection, lockfile, manifest metadata or app window contract.
