# @nitro-forge/ignition

The shared layer under every Forge engine: the host that talks to the Rust
engines, the document handle, errors, and the Nitro module spec.

Most apps use Ignition only to create a host and pass it to an engine package
such as [`@nitro-forge/tally`](../tally/README.md). Use `DocumentHandle`
directly when you need an op the typed API does not wrap.

**Status:** in the v1 release set (`@nitro-forge/ignition` and the seven
engines named in [RELEASE_TRAIN.md](../../docs/release/RELEASE_TRAIN.md)).
v1 is not released yet; gate status is in
[v1-readiness.json](../../docs/release/v1-readiness.json). The release train
lists the Nitro native bridge and tarball contents as open work.

## Install

Forge is not published to npm. Each release attaches one tarball per package
to its [GitHub Release](https://github.com/mikevocalz/nitro-forge/releases),
with a `SHA256SUMS` file. No release exists yet, so `<version>` below is a
placeholder: replace it with the release version after the first release.

```bash
BASE=https://github.com/mikevocalz/nitro-forge/releases/download/v<version>
pnpm add "$BASE/nitro-forge-ignition-<version>.tgz" \
  react-native-nitro-modules@1.0.0-alpha.nightly.136.gdb81de61bd32 \
  nitro-core@1.0.0-alpha.nightly.136.gdb81de61bd32
```

Peer dependencies: `react-native-nitro-modules` and `nitro-core`, both pinned
to `1.0.0-alpha.nightly.136.gdb81de61bd32`. Every engine package depends on
Ignition. Because Ignition is not on npm, add it to `pnpm-workspace.yaml` as an
override when you install an engine package:

```yaml
overrides:
  "@nitro-forge/ignition": https://github.com/mikevocalz/nitro-forge/releases/download/v<version>/nitro-forge-ignition-<version>.tgz
```

Check each tarball against the release's `SHA256SUMS` before you commit the
lockfile. The app needs a native development build; Expo Go cannot load the
Nitro module.

## Usage

<!-- readme-example -->
```ts
import { createNitroHost, DocumentHandle, EngineError } from "@nitro-forge/ignition";

const host = createNitroHost();
const sheet = await DocumentHandle.openInitialized(host, "tally", (doc) => doc.apply("new", {}));
const cell = await sheet.apply<{ computed: number }>("setCell", { addr: "A1", value: "=6*7" });
console.log(cell.data.computed); // 42

const bytes = await sheet.snapshot(); // NFD1 envelope
await sheet.close();

const reopened = await DocumentHandle.openSnapshot(host, "tally", bytes);
await reopened.apply("setCell", { addr: "A1", value: "1" });
console.log(await reopened.undo()); // true
console.log((await reopened.apply<{ computed: number }>("getCell", { addr: "A1" })).data.computed); // 42
console.log(await reopened.redo()); // true

try {
  await reopened.apply("setCell", { addr: "not a cell", value: "x" });
} catch (error) {
  if (error instanceof EngineError) console.log(error.code); // validation
}
await reopened.close();
await host.dispose();
```

`apply(op, payload)` sends one command and resolves to `{ data, events }`. Op
names and payloads are the ones in [ENGINE_OPS.md](../../docs/ENGINE_OPS.md).
Every engine also takes `__batch` through `applyBatch(commands)`: up to 64
commands that commit as one undo step or not at all. A failed command throws
`EngineError` with a `code` (`invalid_command`, `not_found`, `validation`, and
the rest of `ErrorCode`) and leaves the document as it was.

This example runs in CI: `tests/readme-example.e2e.test.ts` runs it against the
Rust engine through `nf-cli`, with `createNitroHost()` replaced by `CliHost`.

### Hosts

An `EngineHost` carries commands to the engines. There are two:

- `createNitroHost()` returns a `NitroHost` that drives the engines in-process
  through the Nitro module. Use it in the app.
- `CliHost` from `@nitro-forge/ignition/cli` spawns the `nf-cli` binary and
  speaks JSON lines to it. It is Node-only and is what the package test suites
  and `apps/console` use. Build the binary with `cargo build --locked -p nf-cli`;
  `CliHost` looks for `target/debug/nf-cli`, or the path in `NF_CLI`.

Both run the same Rust engine code, so a flow that passes under `CliHost`
exercises the same engine logic as the app. They do not test the native bridge.

## Entry points

| Import | Use it for |
| --- | --- |
| `@nitro-forge/ignition` | `createNitroHost`, `NitroHost`, `DocumentHandle`, `EngineError`, `ENGINE_KINDS`, base64 helpers and the shared types. |
| `@nitro-forge/ignition/cli` | **Node only.** `CliHost`, the `nf-cli` transport for tests and tooling. Never bundle it into an app. |
| `@nitro-forge/ignition/nitro` | The Nitro HybridObject spec (`ForgeFactory`) that nitrogen generates the native bindings from. |
| `@nitro-forge/ignition/v1-host` | `ForgeV1EngineHost` and `registerForgeV1Factory`, which adapt a native-owned Nitro v1 document factory to `EngineHost`. |
| `@nitro-forge/ignition/workspace` | `WorkspaceSession`: one open document shared by several editing modes, with per-mode layouts and presets in an app-supplied store. |
| `@nitro-forge/ignition/workspace-ui` | View and callback bindings for a workspace mode and preset switcher. |
| `@nitro-forge/ignition/transfer` | `runExport`/`runImport` and the `.nfd` snapshot format, for a file import/export sheet. Returns bytes; the app writes them. |
| `@nitro-forge/ignition/transfer-ui` | Bindings that drive the export sheet's formats, status and destination (files, share, download). |
| `@nitro-forge/ignition/autosave` | `DocumentAutosave` and `createCheckpointStore`: periodic checkpoints to app-supplied storage, with validation on reopen. |
| `@nitro-forge/ignition/transactions` | `UndoTransactionCoordinator`: preview a gesture locally, then commit it as one batch and one undo step. |
| `@nitro-forge/ignition/collaboration` | `DocumentCollaboration`: one authoritative session synced to a revision store with compare-and-swap. |
| `@nitro-forge/ignition/collaboration-http` | `createHttpCollaborationTransport`, an HTTP revision transport. The app supplies authentication through its `fetch`. |
| `@nitro-forge/ignition/collaboration-checkpoint` | Recovery checkpoints for a collaboration session in private app storage. |

Only `./cli` imports Node built-ins. No entry point imports React.

## Reference

- Engine contract, threading, ownership, undo, the NFD1 envelope and error codes: [ARCHITECTURE.md](../../docs/ARCHITECTURE.md)
- Universal ops (`new`, `describe`, `__batch`) and every engine's ops: [ENGINE_OPS.md](../../docs/ENGINE_OPS.md#engine-op-surface--authoritative)
