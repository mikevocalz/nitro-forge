# F1 paired native upgrade trial

Base is corrected #89 head `f31135574a7f77362583fe8134d0cded3a86358e`.
This is a stacked **trial**, not a final compatibility hold, native success,
release approval or F1 pass. Historical de1e36b freshness/generation records are
unchanged. The trial's exact changed inputs and dirty-working-tree identity are
bound by SHA256 in `dated-freshness.json`; complete final-head CI is still needed.

## Actual source and graph

Stage Skia3.10.1/WebGPU0.21.4 together: both published packages require the same
Dawn158.0.0. Retain all four Graphite platform binary packages (Android, Apple
iOS/macOS/tvOS), with Dawn at158.0.0. Rebase only the existing SwiftPM Dawn-path
canonicalization fix against each actual latest Package.swift: resolve pnpm
symlinks to one physical package identity. The host boundary now checks actual
versions and the same real Dawn path, not merely two equal version strings.

Adopt upstream SVG15.16.1 Package.swift and swiftpmConfig RNSVG; remove only the
old15.16.0 new-file patch and its registry entry. Upstream retains Fabric/RN88
defines, C++20, Metal resource copies and autolinker-relative ReactNative and
React-GeneratedCode dependencies. Its library minimum is iOS15.1; the app's own
platform/window/orientation configuration is unchanged. No platform was excluded
or silently removed to obtain a build. Existing actual source/archive identities
are preserved in the parent routine slice's `native-hold-source.json`.

The suite app did not directly declare CommunityCLI. Published RN0.88.1 cli.js
explicitly resolves that package from the project directory under pnpm (actual
source/blob identity in `rn0881-cli-source.json`). Add the official RN0.88.1
template's coherent CLI/platform trio20.2.0 as development dependencies, matching
the existing standalone native example. No global hoist or implicit external CLI
is used; the justified20.2 hold against unrelated21 latest remains explicit.

The new dated review covers **32 manifests, three workspace files,286 declared
uses,73 registry names and all three owned lockfiles**, with zero unclassified
uses. Native leaf versions matching latest is not native acceptance. Existing
CLI, Nitro v1 channel, Metro and vendor decisions remain source-bound. Root's
old de1e36b32/281/two-lock packet does not describe this expanded graph.

Root active packages/snapshots773→915: eight native/Dawn-family replacements
and142 additional declared CLI/transitive packages. Every new non-native package
is reachable from the declared CLI roots. Metadata for every retained package
is exactly unchanged. Complete canonical named dependency-edge comparison passes:
the only additional existing snapshot semantic changes are the RN community CLI
plugin's now-resolved optional CLI peer and YAML's change from optional-only to
required in that CLI closure. All other edge differences are the enumerated native
versions and peer identities. The full raw snapshot/addition list is retained.
All150 new/replacement archive SHA512 fields match the actual immutable-version
registry metadata, not guessed checksums. This is metadata verification; native
binary downloads/build/link/run are CI work.

Both existing isolated locks (native-cadence716 entries and Persona28 entries)
are byte-identical to the corrected parent; each has a separate bootstrap YAML
document, and all documents were parsed. Parent root bootstrap15-entry document
is unchanged. Full graph scripts/results and registry identities are retained.

Actual final bounded lockfile-only commands returned0 with200MB guard above the
10,000,000,000-byte floor; minimum final observed free12,032,200,704bytes. No
node_modules install, native rebuild, generator or bootstrap ran locally. Earlier
intermediate native-pair-only lock operations are not presented as the final graph.

## Actual suite-native CI, pending execution

Existing Cadence/audio jobs do not compile the suite app consuming this pair.
New `f1-native-pair.yml` instead builds **apps/example** on Android and the
existing owner-provided xcode-27 runner, from frozen root inputs. It checks actual
host/autolink identities, builds the Rust archives with the selected RN NDK or
Apple targets, runs the established Expo prebuild and RN SwiftPM path, preserves
`-IDEPackageEnablePrebuilts=NO`, and retains actual logs/commands/source identities
plus any produced APK/app. App brand/config plugins remain in control; no native
files are hand-edited. Actionlint is told about the existing xcode-27 label.

No conditional exclusion of Persona or other app modules is added. Persona has
generated specs and a source-linked API but its missing native project wiring
may be a preexisting integration boundary; report any real failure with its exact
stage/source rather than attributing it to Dawn or declaring a platform implemented
from generated code alone. The parent's strict generation gate checks ignored and
untracked additions as well as deletions/byte changes.

Local source checks:30 Node tests, actionlint/YAML parse, node syntax and diff
checks pass. Actual Android/iOS/SPM compilation is **NOT RUN locally** and pending
this PR's CI. Native startup, graphics/Metal rendering, Persona implementation,
React19.3.1 versus RN renderer19.3.0 compatibility and physical devices are not
proved by compilation. No React/RN/Nitro pin, renderer guard, app window,
orientation, public API, acceptance array, validator or advisory ignore changed.
Independent R2 must review the exact candidate and actual native output before
an adoption/hold decision. Full original22/current workflow reconciliation and
F1 signoff remain outstanding; F6 must reconcile the final reviewed graph.
