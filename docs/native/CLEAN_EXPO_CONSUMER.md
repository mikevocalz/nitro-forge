# Clean Expo consumer candidate

F6 implementation work; native compatibility and gate acceptance are not
established by the source checks. No publication or tag operation is part
of this pipeline.

The owner approved the seven v1 studios on 2026-11-13: Prism, Cadence,
Splice, Folio, Pitch, Tally and Quill. Photo, Motion, Design, Draft and Scene
adapters are explicitly deferred in
`tooling/release/package-inventory.json`. Their native engine registrations
remain intact. Ignition is their shared integration package.

The owner also approved an optionless Ignition Expo plugin, explicit
caller-owned SwiftPM opt-in, and one Ignition archive containing the
prebuilt Apple and Android payloads. The consumer never compiles Rust.

## Public configuration and lifecycle

Install the exact candidate's eight archives and the supported runtime
graph recorded in candidate.json. The plugin is discovered as the root
`app.plugin.cjs` file and has an additive exact-filename export. Its typed
signature is `ConfigPlugin<void>`. It returns the same configuration object
after validation, without spawning processes or acquiring native resources.

```json
{
  "expo": {
    "name": "Forge Consumer Smoke",
    "slug": "forge-consumer-smoke",
    "orientation": "default",
    "platforms": ["ios", "android"],
    "newArchEnabled": true,
    "experiments": { "swiftPackageManager": true },
    "plugins": ["@nitro-forge/ignition"]
  }
}
```

Add the app's own identifiers. On macOS run ordinary Expo prebuild with
installation enabled. The pinned Expo CLI reads the SwiftPM flag before
mods and invokes RN's setup using Expo autolinking. `--no-install` skips
that setup and is not an iOS integration pass. The plugin never injects a
second SwiftPM hook or changes a caller's window/orientation contract.

If the flag, New Architecture, exact supported dependency versions or
packaged native assets are missing, config evaluation throws an actionable
Error. For example, adding plugin options throws rather than silently
ignoring them; a missing binary throws rather than building Rust. No cleanup
is required after plugin evaluation because it owns no resources.

Document operations use the ordinary native host and public adapter:

```ts
import { createNitroHost } from '@nitro-forge/ignition';
import { CadenceDocument } from '@nitro-forge/cadence';

const host = createNitroHost();
try {
  const document = await CadenceDocument.open(host, 120);
  try {
    await document.setTempo(137);
    const bytes = await document.save();
    // Persist bytes through the app's document/file service before closing.
  } finally { await document.close(); }
} finally { await host.dispose(); }
```

Rejected malformed restore must leave the current document unchanged.
The fixture exercises this error path separately. Reopen creates a fresh
host/document from disk; it does not assume that undo history survives a
snapshot restore. A fresh edit after reopening supplies the undo test.

## Candidate producer and immutable handoff

The workflow builds all currently declared architectures, validates native
fragments, and assembles exactly eight `pnpm pack` archives once. Internal
CI versions use `1.0.0-f6.<run>.<attempt>`; these are staging identifiers,
not an approved public release version. Native fragments must match the
exact source commit and Nitro pin. Source and packed C ABI headers must
agree. Producer staging rejects symlinks and unresolved local dependencies.

Apple uses device arm64 plus universal arm64/x86_64 simulator slices in
ForgeRust.xcframework. Android retains armeabi-v7a, arm64-v8a, x86 and
x86_64 archives. No ABI has been silently removed. XCFramework metadata,
lipo and NDK object headers are checked by the platform producers. These
are artifact checks, not runtime support signatures for every architecture.

The archive allowlists include TypeScript exports, private generated JS,
native adapters/headers, generated Nitro glue, discovery metadata,
SwiftPM/CMake files and platform payloads. Source build scripts and tests
are absent from the installed archive. Native source is compiled against
the consumer's pinned RN/Nitro; Rust is already prebuilt.

candidate.json records source/version/archive hashes, every packed file's
hash, native fragment manifest hashes and the explicit deferrals.
SHA256SUMS covers all eight archives. Source staging versions/dependency
rewrites do not modify the working package versions. A failed producer
leaves INCOMPLETE.txt and cannot be consumed as a complete candidate.

The owner authorized the original-code MIT grant on 2026-11-13, using
“Copyright (c) 2026 Nitro Forge contributors”. Root LICENSE contains the
[canonical MIT terms](https://opensource.org/license/mit); every adapter
and Ignition archive receives that exact file and MIT metadata explicitly.
The staging location never relies on a packer finding a parent license.
This grant preserves separate third-party and per-directory terms, including
the private AGPL component, which remains outside this package inventory.

Licensing materials are required even for internal candidates. Before
packing, `collect-native-licenses.mjs` obtains locked resolved Cargo metadata
and traverses only the nf-sys normal/build closure. The all-target graph is
a conservative superset, not a claim that every listed component is linked
on every platform. It excludes unrelated workspace renderer roots and
dev-only dependencies. Preserve existing package notices, actual registry
license/copyright/notice files, exact source .crate archives and checksums,
source-file hashes, original-code source identities and Rust toolchain
notices. Keep generated Nitro attribution and its pinned upstream MIT text
separate from Forge's original-code attribution.

Each native producer records its actual post-build registry source inventory
and file hashes before upload. Assembly verifies the Cargo.lock SHA256 of
each unmodified `.crate`, rejects unsafe archive paths/types, extracts into
fresh scratch and compares every source byte against both producer records
and its local metadata source tree. Only Cargo-generated `.cargo-ok` and
`.cargo-checksum.json` bookkeeping files are excluded. Missing producer
records, changed/extra source files or absent actual notices block packing;
a later runner's independently extracted cache is insufficient by itself.
The installed package checks the same two producer inventories against its
shipped verified source hash records.

Official rust-installer keeps its root MIT/Apache/COPYRIGHT texts in a
non-installed archive overlay; minimal rustup installations may omit them.
When absent from the producing sysroot, collection obtains these three texts
only from the actual compiler's full immutable rust-lang/rust source commit,
recording source URL and content hash. Both producing runners' verbose compiler
identities must match that commit and release. Generated standard-library
COPYRIGHT-library.html remains required from the actual installed toolchain;
existing compiler notices/materials are still retained. No missing text is
waived, no latest-tag license is substituted and no license alternative is
elected. See the [official distribution implementation](https://github.com/rust-lang/rust/blob/0ef1bc386059596dada8fb65b50425aab2ea637a/src/bootstrap/src/utils/tarball.rs).

The packet preserves declared license expressions verbatim and makes no
new alternative-license election or permissive classification. Unknown
license declarations, missing source identities/materials or changed hashes
block packaging. Actual packed members and installed bytes are checked
again, including the resolved graph and material closure. Full release
legal acceptance and publication authorization remain separate; they cannot
excuse missing materials in an internal candidate.

## Clean consumer stages

Native compile uses ordinary Release configurations so the resulting iOS
Simulator app and Android APK contain an embedded JS/Hermes bundle and can
launch without a local Metro/dependency installation. No generated native
project or signing settings are manually edited. Android uses the Expo
template's existing debug signing for this acceptance fixture; these are not
publication builds. Artifact validation records the actual application ID,
binary architectures, embedded bundle hash, archive hash, installed lock and
candidate manifest identity. Android signature verification is retained too.
Generated/merged native manifests and metadata are retained for inspection.
Creating these artifacts leaves runtime acceptance `NOT RUN`; actual launch,
seven-studio durable workflows and independent visible review remain required.

CI then installs those exact Release apps on its own available iOS Simulator
and Android emulator and uses pinned official Maestro OS touches. Two unchanged
complete seven-studio flows require exact action results, durable save/new-host
and process-relaunch reopen, fresh undo/redo and malformed-restore atomicity.
Actual JUnit, native accessibility trees, screenshots and OS sandbox NFD files
are retained. Android separately proves the actual 320 px/mdpi picker geometry;
iOS records its actual viewport without a 320 px claim. Installed package and
Fabric renderer versions/hashes are recorded with the candidate/lock/app hashes.
Local Argent or local runtime installation is not required. This implementation
is unexecuted until CI reaches it, and even successful runs require independent
source/runtime/visual review before F6 acceptance. See
[the exact driver/evidence contract](../../tooling/release/native-ui/README.md).

`consumer-smoke.mjs` requires an existing candidate manifest, exact expected
source commit and an output directory outside the checkout. No package
build/source/workspace fallback exists. It verifies archive hashes and
content inventories, rejects archive links/traversal, creates a new Expo
app from the acceptance fixture, and installs the candidate archives.

Preparation copies the verified archives into each consumer's artifacts/
directory, rechecks their hashes, and uses identical relative file: specifiers.
The first install records its dependency graph; both native jobs reuse that
lock with frozen installation across Linux/macOS roots. Installed Forge realpaths must stay inside
the consumer and every packed file must retain its bytes. The installed
Expo resolver checks bare and exact-filename plugin discovery. Metro source
maps require one copy of each runtime and each of the eight archive
packages. The all-studio bundle does not certify undeclared third-party
exports; concrete export files are checked separately before installation.

The workflow distinguishes archive verification, install, plugin resolution,
typecheck/bundle, normal prebuild and native compilation. Native setup must
not change the pinned package manifest or lock. The iOS compile retains the
existing documented Expo macros workaround; no new workaround is guessed.
Logs and receipts are retained when a stage fails for diagnosis.

The fixture deliberately uses Tron's unstyled native controls with explicit
light appearance, native inline styles and square outlined action buttons.
It imports no stylesheet and has no Metro CSS input to diverge from it.
This isolates native engine behavior; it makes no studio-design claim.
The fixture uses real typed adapters, stores
serializable UI state in Zustand and retains native resources in refs.
For each studio the visible controls cover:

1. Open/create, then a deterministic typed edit and authoritative state read.
2. Save NFD1 bytes to an app-owned document file and read the bytes back.
3. Close/dispose, then reopen from disk using a new host/document and compare
   authoritative state with its persisted expected-state record.
4. Repeat reopen after app termination/relaunch to prove durable persistence.
5. Make a fresh edit, undo and redo, checking exact engine state each time.
6. Reject malformed restore and confirm the open document remains unchanged.

Each action reports its own result and stable test ID. Until actual
simulator/emulator install/launch and visible actions have been captured and
independently reviewed, runtime results remain NOT RUN. A green compile job
is not an F6 pass. The gate acceptance, statuses and validator are unchanged.

## Validation scope

Node regressions cover plugin errors/config preservation and archive
identity, tampering, path isolation, symlink rejection, exact inventory and
unresolved workspace dependencies. They use synthetic files only to test
rejection boundaries; they cannot prove a native library's behavior.
No local full dependency install or native build is required for those tests.
Tooling checks enforce the owner's 10 GB floor before bounded work; this is
10,000,000,000 bytes, not 10 GiB.

PNPM 12 requires resolution/layout settings in `pnpm-workspace.yaml`; the
consumer puts all eight portable archive overrides, isolated node linker and
disabled global virtual store there. Before installation it queries the actual
pinned CLI's effective values and rejects ignored/different configuration. The
active YAML and observed non-auth configuration are retained and hashed through
native runtime evidence. This prevents a transitive adapter from looking up
an unpublished Ignition candidate in the registry; no registry/source fallback
or authentication workaround is allowed. See [PNPM settings](https://pnpm.io/settings)
and [the config reader](https://pnpm.io/cli/config).

First Linux dependency resolution explicitly uses `--no-frozen-lockfile`.
Package-manager bootstrap/config commands can create a manager-only lock,
so existence/size is not used to infer a completed app graph. Native jobs
explicitly reuse the successful Linux graph with `--frozen-lockfile`, and
repeated successful installs remain frozen. The recorded effective config
states first-resolution versus frozen-reuse mode. An actual PNPM regression
covers the retained manager-only lock, initial app resolution and rejected
manifest changes under frozen reuse; it calls no engine/native/UI API.

The external app explicitly declares `expo-constants@58.0.16`, the same version observed in the original resolved Expo 58.0.24 graph. Expo's generated SwiftPM app-config phase resolves that package from the app root at build time. Isolated PNPM does not expose a transitive dependency at that root. Verification now checks its direct installed version and exact metadata path before native compilation; the linker remains isolated and generated native scripts are unchanged.

The fixture awaits both asynchronous Expo File writes before reading the NFD1 bytes or expected-state JSON. SDK 58 `File.write` returns a Promise; creation alone does not make a dispatched write durable. The original Android first-pass failure is retained separately from the iOS app-config resolution failure. Neither is converted into native acceptance by these source corrections.

The original corrected runtime run at71afec2 built both Release apps. iPhone Duo/iOS27.2 launched and passed the actual picker; an extra unqualified simctl screenshot was ambiguous between its two displays. Geometry now uses the unique planned PNG emitted by the executed XCTest picker, copied byte-for-byte with hash checks, and scopes AX bounds/option nodes to the uniquely named fixture application. Its zero-bounds system/status-bar sibling does not define the app viewport. Wrong-display aspect, missing/duplicate app identity and off-screen options still fail. No device, window, orientation, architecture or screenshot pixels are altered.

The same run's Android first full flow passed Prism, Cadence, Splice, Folio and Pitch before Tally's fresh addSheet undo failed the unchanged full-state equality check. Source inspection finds that describe includes next_sheet, addSheet increments it, and the sheet-removal inverse does not restore it. This is retained as a contract question, not hidden by switching mutations or excluding allocator fields. Diagnostics now include a bounded exact difference excerpt. No engine undo behavior or comparator is changed; full F6 remains incomplete pending this result's disposition and actual corrected native/visual review.
