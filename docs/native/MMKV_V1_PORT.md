# Engine and Board persistence with MMKV v4 and Nitro v1

The native Cadence acceptance app uses the real `react-native-mmkv` 4.3.2
storage implementation with a reviewed binding port to this repository's
Nitro v1 nightly. The app owns the MMKV instance and passes its binary storage
methods to `@nitro-forge/board/offline/mmkv`. The portable Board adapter does
not import a native module or create a second Yjs document.

Ignition's separate `@nitro-forge/ignition/autosave/mmkv` export adapts the
same host-owned MMKV instance to `BinaryCheckpointStorage`. This connects the
existing `createCheckpointStore` and `DocumentAutosave` APIs for all eleven
engines without changing their NFC1/NFD1 envelopes:

```ts
import { createMMKVCheckpointStorage } from "@nitro-forge/ignition/autosave/mmkv";
import { createCheckpointStore, DocumentAutosave } from "@nitro-forge/ignition/autosave";

// `mmkv`, `document` and `host` already belong to the app.
const storage = createMMKVCheckpointStorage(mmkv, {
  scope: "organization-id/account-id",
  maxCheckpointBytes: 32 * 1024 * 1024,
});
const store = createCheckpointStore(storage);
const autosave = new DocumentAutosave(document, store, "document-id");
// Stop admitting edits, then finish the checkpoint before closing its engine.
await autosave.close();
await document.close();
const recovered = await DocumentAutosave.recover(host, document.kind, store, "document-id");
```

The storage adapter escapes scope and key separately, owns the exact input
view rather than its larger backing buffer, and copies each returned binary
value. Its byte budget includes the complete NFC1 record. Read/write failures
propagate, and the MMKV port must preserve the previous record if `set` rejects.
There is one synchronous MMKV replacement per checkpoint; no additional
document, state store, native instance or envelope is introduced.

## Why the binding port exists

Upstream 4.3.2 was generated against Nitro 0.35.9. Its
`NitroModules.createHybridObject`, `HybridObject(TAG)` and `loadHybridMethods`
contracts do not exist in the pinned Nitro v1 host. Its Apple integration also
uses CocoaPods; this host uses SwiftPM. Overriding the upstream peer version
alone is insufficient.

`examples/native-cadence/patches/react-native-mmkv@4.3.2.patch` converts the
three native specs to Nitro v1 classes and includes their generated outputs,
current C++ ArrayBuffer/callback ownership, Swift/Kotlin constructors and
registration, and an Apple SwiftPM manifest. The original storage operations,
MMKV core, encryption and recovery strategy remain upstream implementations.
The app keeps one physical Nitro core runtime. This is a repository-maintained
port, not a claim that the unmodified upstream package supports Nitro v1.

## Pinned inputs and licenses

| Input | Exact source |
| --- | --- |
| React Native MMKV | [npm 4.3.2](https://www.npmjs.com/package/react-native-mmkv/v/4.3.2); tarball SHA-512 `49OAyfkg0/TMWiWELZN6VuVQPZPhizwL4DTmp8b7B1md3dB/s3LH3mGfC3T+lp9W0y/rqxZMEnotLFTIbOAenQ==` |
| Nitro host, core and generator | `1.0.0-alpha.nightly.120.g33ef045b96c0` |
| Apple MMKVCore | [Tencent/MMKV v2.4.0](https://github.com/Tencent/MMKV/tree/v2.4.0), SwiftPM revision `23d652c17e8c2023bb50f1c92e862a2304eaa2a2` |
| Android core | Upstream 4.3.2's `io.github.zhongwuzw:mmkv:2.4.1` artifact |
| Yjs | `13.6.32` |
| Native random values | [Expo Crypto](https://docs.expo.dev/versions/latest/sdk/crypto/) `58.0.7` |

The patch retains the React Native MMKV MIT license and copyright notice.
Tencent's BSD 3-Clause core remains a pinned upstream dependency with its own
notices. The different Apple and Android core versions are the versions
selected by upstream 4.3.2; the port does not silently unify them.

Yjs's `lib0/random` dependency expects `getRandomValues`. The app's Metro
resolver supplies `yjs-random.native.ts`, which re-exports Expo's native
`getRandomValues`, only for that importer on iOS and Android. It does not
provide `crypto.subtle`, change global crypto, or use `Math.random` for Yjs
client IDs. Other WebCrypto consumers keep ordinary resolution.

This app exercises Board's portable offline exports. Its
`react-native.config.js` excludes the separate Board/Viro rendering modules
from native autolinking; this storage acceptance does not require or certify
an XR renderer.

## Checkpoint and failure behavior

The MMKV adapter stores checkpoint metadata and Yjs bytes in one scoped binary
value. New writes use envelope format 2: CRC32 covers metadata and payload,
excluding the checksum field itself. Existing format 1 records remain readable
and are upgraded only by a successful explicit save. The scoped key and public
`BoardCheckpoint` schema version remain unchanged. CRC32 detects accidental
corruption; it does not authenticate records.

A corrupt stored envelope is preserved and reported as
`CorruptCheckpointError`. The host must confirm the exact board identifier
before replacing it. A Yjs merge that throws after partially changing the live
document puts the session in `failed`; the host must close it and open a fresh
host-owned document from the retained checkpoint. Reinitializing the same
mutated document or treating a merge as rollback would be incorrect.

Queued remote bytes are owned before the queue runs. Close drains observed
local edits that arrive during its final write. Sync shares one request across
reentrant callers, acknowledges only the transmitted local revision, and
does not start a send after disposal.

## Repeatable verification

Use the package manager version pinned in `examples/native-cadence/package.json`:

```sh
cd examples/native-cadence
corepack pnpm install --frozen-lockfile
corepack pnpm typecheck
corepack pnpm exec expo export --platform android --output-dir /tmp/forge-android
corepack pnpm exec expo export --platform ios --output-dir /tmp/forge-ios
```

The source/core check consumes the installed patched package, verifies one
Nitro runtime, compiles the C++ bindings against the actual host headers, and
executes binary write/ownership/reopen checks against actual MMKVCore 2.4.0 in
two Linux subprocesses:

```sh
git clone --depth 1 --branch v2.4.0 https://github.com/Tencent/MMKV.git /tmp/forge-mmkv-core
node tooling/native/verify-mmkv-port.mjs /tmp/forge-mmkv-core
```

`.github/workflows/cadence-native-consumer.yml` retains this report and builds
the real iOS/Android consumer. Its runtime driver requires a first-process
`RESTART` receipt after saving two Yjs records and checkpoints for all eleven
engines, performs an OS-level stop and relaunch, then requires a different
process token. The final receipt includes six Board/MMKV checks for native
binary ownership, Yjs round trip, process reopen, account isolation, corruption
preservation and explicit recovery. A seventh MMKV check restores every engine
through `DocumentAutosave.recover` and compares its saved description. The same
receipt contains eight generated Forge task/cache checks, for fifteen total.
Missing native bindings fail; a JavaScript MMKV mock cannot pass.

Linux core checks, TypeScript, Metro bundles and native compilation are
separate evidence from executing the installed app. App restart acceptance
does not establish sudden power-loss durability, storage exhaustion handling,
or physical-device UX. Current executed platform evidence belongs in the
completion reports; this document describes the reproducible gate.
