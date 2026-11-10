# Installed Ignition on Qt hosts

This change connects the current `@nitro-forge/ignition` package to a Qt native
host through its installed package metadata. It preserves the eleven existing
Rust engines, generated Nitro classes, and public `createNitroHost()` API.
NYC-Tron remains the owner of reusable controls. Nitro Forge remains an optional
application dependency; no Forge package belongs in the React Native or OS base.

The matching generic host implementation is in
[React Native QNX PR #112](https://github.com/mikevocalz/react-native-qnx/pull/112).
The shared-control routes and full capability map are in
[NYC-Tron PR #58](https://github.com/mikevocalz/NYC-Tron-UI/pull/58).

## What was missing

The current package had only Apple/Android registration and its generated
JavaScript constructors imported the mobile `react-native-nitro-modules`
installer. The older QNX C++ fixture consumed an unmerged `ignition-native`
package and `ignition-v1-lab` paths. A native Rust fixture could run while an
installed application's ordinary Forge import still failed to register a class.

The installed package now supplies these pieces:

| Layer | Current implementation |
| --- | --- |
| Native package lookup | Exported `package.json` and `./native` CMake entry; static `rnqnxNative` metadata for QNX and Marathon |
| Shared Rust session | `NitroForge::RustSession`, built from the same current C++ owner and target-supplied `nf-sys` archive |
| Worker ordering | `NitroForge::SerialQueue`, the existing per-document FIFO |
| Native classes | `NitroForge::Nitro` compiles the same generated Factory, Document, Task, and MediaCache class descriptions and implementations |
| Constructor registration | Idempotent `nitroforge::native::registerNitroForgeClasses()` calls generated registration before the app bundle |
| JavaScript import | `qnx`/`marathon` conditions on `#forge-factory` and `./nitro` select `nitro-core` directly; Apple/Android continue using generated mobile constructors |
| React Native host | Generic discovery follows the selected app's installed production dependencies, checks native version/dispatcher requirements, links their targets and generates registration |

The `#nitro/*` alias remains owned by Nitrogen and points to generated output.
The separate `#forge-factory` alias preserves regeneration while allowing the
public host factory to select its installed platform runtime. Nitrogen 120
regeneration passes for all four classes without changing generated sources.

The generated Apple and Android C++ class description files are byte-identical.
The portable target reuses that generated C++ without compiling Apple installers,
Swift, Objective-C, JNI, or Android package code. The packed-consumer test checks
this equality so a future generator divergence cannot silently change the
portable source strategy.

## Exact Nitro profiles

Ignition's generator and existing mobile build remain pinned to
`1.0.0-alpha.nightly.120.g33ef045b96c0`. The current React Native QNX host uses
`1.0.0-alpha.nightly.105.g69d365fc9b18`.

Comparing the installed native source trees found the same HybridClass,
HybridClassRegistry, Promise, Dispatcher, ArrayBuffer and native implementation
files. Differences were the version macro, Swift enum annotations, and the
inline JSI array allocation helper. This justified testing compilation against
the host's single alpha105 core; it did not justify loading an alpha120 binary
into an alpha105 runtime.

The package accepts alpha105 **only** with the explicit
`rnqnx-qt-alpha105` source compatibility profile and its real Qt JavaScript
dispatcher. Both native classes and the bundle use that one core. Other versions
and missing runtime/dispatcher profiles fail during CMake configuration.
The two exact versions in peer dependencies describe the two source profiles.
The default mobile route is validated only with its matching alpha120 mobile
runtime; the alpha105 peer allowance exists for the Qt dependency graph.
The mobile installer is optional for a Qt application because its host performs
installation before evaluating JavaScript.

## Building an application

Use a React Native QNX revision with generic installed native-package discovery
and the QNX/Marathon Metro package conditions. Install Ignition and the host's
exact `nitro-core` version as application dependencies. A strict peer install of
the packed Ignition and alpha105 core succeeds with only those two packages;
the Qt path does not load the mobile installer.

Build `nf-sys` explicitly for the consumer operating system and architecture.
Supply the resulting absolute archive path through
`NITRO_FORGE_RUST_ARCHIVE`, as a CMake definition or environment variable.
The installed source package does not contain a universal Rust binary and does
not download or substitute an archive during configuration.

The existing `project prepare-native` command records discovered packages in
the app's generated `native-app.json`. `project build-native` selects the
matching native platform installer, enables the Qt dispatcher when needed, and
makes an owned build-local core copy before applying reviewed compatibility
patches. The installed dependency is not patched. Marathon applications install
`MarathonPlatformInfo`; QNX applications install `QnxPlatformInfo`.

For a native-only consumer:

```bash
cargo build --locked -p nf-sys
node tooling/native/installed-ignition/verify.mjs \
  --rust-archive "$PWD/target/debug/libnf_sys.a"
```

This packs Ignition with npm, resolves the installed native export, builds a
separate C++ consumer, and runs real engine operations through the linked archive.
The same check is included in the existing Ignition integration workflow.

## Verified scope

The November 10 Linux x86-64 host checks used Qt 6.11.1, the RN 0.88.1 JSI
headers, Hermes source `9a115f15785851f4ff2747ebb090ddd066fc8ad2`, Metro 0.87.1,
and the exact alpha105 source profile described above.

- A packed C++ consumer created and reopened all eleven engines, then exercised
  Tally edits, undo/redo, binary snapshots, cancellation, FIFO draining and close.
- Real Metro resolved the packed public Forge API for both QNX and Marathon.
  `#forge-factory` and the public `./nitro` entry selected
  `portable/ForgeFactory.cjs`, using the installed
  alpha105 core, with no mobile Nitro installer and no resolver warnings.
- Those Metro bundles executed through real Hermes and the RN Qt task
  queue/dispatcher. The scenario imports `createNitroHost()` and
  `createNativeForgeFactory()`, opens/initializes/snapshots/reopens all eleven
  engines, checks FIFO/undo/redo, tasks and ArrayBuffer results, media cache,
  native error rejection, and rejection after close.
- Separate QNX-host-preview and Marathon adapter binaries verify their own
  native platform class is registered and the other platform's class is absent.

Receipts bind the package archive, manifest, Metro bundle and native executable
hashes; the portable record is
[`evidence/ignition-qt-2026-11-10.json`](evidence/ignition-qt-2026-11-10.json).
The tested Ignition archive SHA-256 is
`27d1d99c29d313fe78a8b24f13185ba5fde96904127b04050c2e3db9a81a1351`.

These are installed-package and Qt/Hermes engine receipts on Linux. They do not
establish QNX device execution, Marathon Wayland session behavior, React/Fabric
rendering of the studio, accessibility, or acceptance of every one of the 341
UI contracts. Native media, input hardware, and other optional services retain
their separate capability and target acceptance gates.
