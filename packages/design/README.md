# @nitro-forge/design

Interface design documents: frames, shapes and text in a node tree with
fixed, hug and fill sizing, row and column layout, components, variables and
prototype links, evaluated by a Rust engine and rendered through Prism.

**Status:** deferred. Not in the v1 release set:
[RELEASE_TRAIN.md](../../docs/release/RELEASE_TRAIN.md) names Ignition and the
seven engines only, so v1 releases attach no tarball for this package. The
source, the Rust engine and the tests stay in this repository. The engine is
registered in `nf-cli` and the native factory; no studio app opens it yet, and
native binaries need a rebuild to include it.

## Install

There is no release tarball. Inside this repository, add it as a workspace
dependency:

```json
{ "dependencies": { "@nitro-forge/design": "workspace:*" } }
```

It depends on [`@nitro-forge/ignition`](../ignition/README.md), whose peer
dependencies are `react-native-nitro-modules` and `nitro-core` at
`1.0.0-alpha.nightly.136.gdb81de61bd32`. Design declares no peer dependencies of
its own.

## Usage

<!-- readme-example -->
```ts
import { createNitroHost } from "@nitro-forge/ignition";
import { DesignDocument } from "@nitro-forge/design";

const ROOT = 1; // the root canvas frame

const host = createNitroHost();
const design = await DesignDocument.open(host, { title: "Card", width: 400, height: 300 });
const card = (await design.addFrame(ROOT, { name: "Card", width: 240, height: 120 })).data.node_id;
await design.addShape(card, "rect", { name: "Badge", width: 40, height: 40, fill: [255, 0, 0, 255] });

const bytes = await design.save(); // NFD1 snapshot
await design.close();

const reopened = await DesignDocument.openSnapshot(host, bytes);
const count = async () => Object.keys((await reopened.describe()).data.nodes).length;
console.log(await count()); // 3
await reopened.addShape(card, "ellipse", { width: 20, height: 20 });
await reopened.undo();
console.log(await count()); // 3
await reopened.redo();
console.log(await count()); // 4

const frame = await reopened.renderFrame(); // RGBA of the root canvas
console.log(frame.data.width, frame.data.height); // 400 300
await reopened.close();
await host.dispose();
```

Every method maps to one engine op and resolves to `{ data, events }`. A
rejected call throws `EngineError` and leaves the document unchanged.

What it does not do: no clipping, image fills, groups or layers; text nodes are
layout boxes without glyphs; prototype playback is owned by the host. The full
list of limits and overflow and locking rules is in ENGINE_OPS.md.

This example runs in CI: `tests/readme-example.e2e.test.ts` runs it against the
Rust engine through `nf-cli`, with `createNitroHost()` replaced by `CliHost`.

## Entry points

| Import | Use it for |
| --- | --- |
| `@nitro-forge/design` | `DesignDocument`, the `OPS` name table and the node, layout, variable and prototype types. |

## Reference

- Ops, payloads and limits: [ENGINE_OPS.md, design-engine](../../docs/ENGINE_OPS.md#design-engine--designenginenew-fixed-frame-layout-slice)
- Threading, undo, snapshot envelope and error codes: [ARCHITECTURE.md](../../docs/ARCHITECTURE.md)
