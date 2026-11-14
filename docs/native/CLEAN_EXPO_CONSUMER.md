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

The packet preserves declared license expressions verbatim and makes no
new alternative-license election or permissive classification. Unknown
license declarations, missing source identities/materials or changed hashes
block packaging. Actual packed members and installed bytes are checked
again, including the resolved graph and material closure. Full release
legal acceptance and publication authorization remain separate; they cannot
excuse missing materials in an internal candidate.

## Clean consumer stages

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
