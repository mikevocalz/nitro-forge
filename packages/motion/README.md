# @nitro-forge/motion

2D motion graphics documents: shape, raster and nested-composition layers with
keyframed transforms, parenting, blend modes, mattes and CPU effects, rendered
to RGBA frames by a Rust engine through Prism.

**Status:** deferred. Not in the v1 release set:
[RELEASE_TRAIN.md](../../docs/release/RELEASE_TRAIN.md) names Ignition and the
seven engines only, so v1 releases attach no tarball for this package. The
source, the Rust engine and the tests stay in this repository. Registration in
`nf-cli` and the native factory is not an app rollout or native binary
validation.

## Install

There is no release tarball. Inside this repository, add it as a workspace
dependency:

```json
{ "dependencies": { "@nitro-forge/motion": "workspace:*" } }
```

It depends on [`@nitro-forge/ignition`](../ignition/README.md), whose peer
dependencies are `react-native-nitro-modules` and `nitro-core` at
`1.0.0-alpha.nightly.136.gdb81de61bd32`. Motion declares no peer dependencies of
its own.

## Usage

<!-- readme-example -->
```ts
import { createNitroHost } from "@nitro-forge/ignition";
import { MotionDocument } from "@nitro-forge/motion";

const host = createNitroHost();
const comp = await MotionDocument.open(host, { title: "Intro", width: 320, height: 180, duration_s: 2 });
await comp.addShapeLayer({ kind: "rect", x: 20, y: 20, w: 80, h: 40, fill: [0, 128, 255, 255] }, "Box");

const bytes = await comp.save(); // NFD1 snapshot
await comp.close();

const reopened = await MotionDocument.openSnapshot(host, bytes);
const layers = async () => (await reopened.describe()).data.layers.length;
console.log(await layers()); // 1
await reopened.addShapeLayer({ kind: "ellipse", x: 200, y: 60, w: 60, h: 60, fill: [255, 255, 255, 255] });
await reopened.undo();
console.log(await layers()); // 1
await reopened.redo();
console.log(await layers()); // 2

const frame = await reopened.renderFrame(0.5); // RGBA at t = 0.5 s
console.log(frame.data.width, frame.data.height); // 320 180
await reopened.close();
await host.dispose();
```

Every method maps to one engine op and resolves to `{ data, events }`. A
rejected call throws `EngineError` and leaves the document unchanged. Raster
assets are packed `rgba8-straight-srgb` bytes; decoding image files is the
host's job.

Limits include a 16 MiB serialized-state cap, at most 128 layers and 16
compositions, and one-megapixel frames. Media decoding, GPU effects and encoded
render output are not supported. The full list is in ENGINE_OPS.md.

This example runs in CI: `tests/readme-example.e2e.test.ts` runs it against the
Rust engine through `nf-cli`, with `createNitroHost()` replaced by `CliHost`.

## Entry points

| Import | Use it for |
| --- | --- |
| `@nitro-forge/motion` | `MotionDocument` and the layer, keyframe, effect and composition types. |

## Reference

- Ops, payloads and limits: [ENGINE_OPS.md, motion-engine](../../docs/ENGINE_OPS.md#motion-engine--motionenginenew-bounded-2d-slice)
- Threading, undo, snapshot envelope and error codes: [ARCHITECTURE.md](../../docs/ARCHITECTURE.md)
