# @nitro-forge/photo

Photo catalogs: originals, versions, ratings, labels and non-destructive
develop recipes, with bounded preview processing of decoded RGBA, run by a
Rust engine.

**Status:** deferred. Not in the v1 release set:
[RELEASE_TRAIN.md](../../docs/release/RELEASE_TRAIN.md) names Ignition and the
seven engines only, so v1 releases attach no tarball for this package. The
source, the Rust engine and the tests stay in this repository. Its checks do
not establish native consumer acceptance.

## Install

There is no release tarball. Inside this repository, add it as a workspace
dependency:

```json
{ "dependencies": { "@nitro-forge/photo": "workspace:*" } }
```

It depends on [`@nitro-forge/ignition`](../ignition/README.md), whose peer
dependencies are `react-native-nitro-modules` and `nitro-core` at
`1.0.0-alpha.nightly.136.gdb81de61bd32`. Photo declares no peer dependencies of
its own.

## Usage

<!-- readme-example -->
```ts
import { createNitroHost } from "@nitro-forge/ignition";
import { PhotoDocument } from "@nitro-forge/photo";

const host = createNitroHost();
const catalog = await PhotoDocument.open(host);
const { original_id } = (
  await catalog.addOriginal({
    sha256: "a".repeat(64), // the host computes and vouches for the file hash
    asset_ref: "library:IMG_0001", // the host's own id: letters, digits and ._:-
    byte_length: 24_000_000,
    camera_make: "Example",
    camera_model: "One",
  })
).data;
await catalog.setRating(original_id, 3);

const bytes = await catalog.save(); // NFD1 snapshot
await catalog.close();

const reopened = await PhotoDocument.openSnapshot(host, bytes);
const rating = async () => (await reopened.readOriginal(original_id)).data.original.rating;
console.log(await rating()); // 3
await reopened.setRating(original_id, 5);
await reopened.undo();
console.log(await rating()); // 3
await reopened.redo();
console.log(await rating()); // 5
await reopened.close();
await host.dispose();
```

Every method maps to one engine op and resolves to `{ data, events }`. A
rejected call throws `EngineError` and leaves the catalog unchanged.

The catalog stores what the host claims about each original; it does not read
files, decode them or verify their hashes. `setDevelop` stores exposure,
contrast, RGB gain and optional white balance per version, and
`processPreview` applies that recipe to packed sRGB RGBA8 up to one megapixel.
There is no RAW decoder in the engine, no ICC conversion and no lens
correction; the Kelvin control is an approximation, not color-managed white
balance.

This example runs in CI: `tests/readme-example.e2e.test.ts` runs it against the
Rust engine through `nf-cli`, with `createNitroHost()` replaced by `CliHost`.

## Entry points

| Import | Use it for |
| --- | --- |
| `@nitro-forge/photo` | `PhotoDocument`, the `OPS` name table and the catalog and develop types. |
| `@nitro-forge/photo/raw` | **Node only.** `RawDecodeService`, a client for the separate `raw-decode` process (LibRaw 0.22.3) that probes RAW files and decodes previews, and `processDecodedPreview`, which feeds a decoded preview to `processPreview`. It spawns a child process and is not an engine. |

## Reference

- Ops, payloads and limits: [ENGINE_OPS.md, photo-engine](../../docs/ENGINE_OPS.md#photo-engine--photoenginenew)
- Threading, undo, snapshot envelope and error codes: [ARCHITECTURE.md](../../docs/ARCHITECTURE.md)
- Develop preview source report: [P10](../../docs/completion/reports/P10-nondestructive-develop-preview-source.md)
