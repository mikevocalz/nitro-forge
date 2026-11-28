# @nitro-forge/draft

2D drafting documents: points, segments, circles and arcs with snapping,
constraints, layers, hatches, dimensions, blocks and paper-space sheets,
solved by a Rust engine and rendered through Prism.

**Status:** deferred. Not in the v1 release set:
[RELEASE_TRAIN.md](../../docs/release/RELEASE_TRAIN.md) names Ignition and the
seven engines only, so v1 releases attach no tarball for this package. The
source, the Rust engine and the tests stay in this repository. No studio app
opens it, and it has no native target acceptance.

## Install

There is no release tarball. Inside this repository, add it as a workspace
dependency:

```json
{ "dependencies": { "@nitro-forge/draft": "workspace:*" } }
```

It depends on [`@nitro-forge/ignition`](../ignition/README.md), whose peer
dependencies are `react-native-nitro-modules` and `nitro-core` at
`1.0.0-alpha.nightly.136.gdb81de61bd32`. Draft declares no peer dependencies of
its own.

## Usage

<!-- readme-example -->
```ts
import { createNitroHost } from "@nitro-forge/ignition";
import { DraftDocument } from "@nitro-forge/draft";

const host = createNitroHost();
const drawing = await DraftDocument.open(host, "mm");
const a = (await drawing.addPoint(0, 0)).data.point_id;
const b = (await drawing.addPoint(100, 0)).data.point_id;
await drawing.addSegment(a, b);

const bytes = await drawing.save(); // NFD1 snapshot
await drawing.close();

const reopened = await DraftDocument.openSnapshot(host, bytes);
const segments = async () => Object.keys((await reopened.describe()).data.segments).length;
console.log(await segments()); // 1
const c = (await reopened.addPoint(100, 50)).data.point_id;
await reopened.addSegment(b, c);
await reopened.undo();
console.log(await segments()); // 1
await reopened.redo();
console.log(await segments()); // 2

const snap = await reopened.querySnap(99.8, 0.1, 1); // tolerance in world units
console.log(snap.data.candidate !== null); // true
await reopened.close();
await host.dispose();
```

Every method maps to one engine op and resolves to `{ data, events }`. A
rejected call throws `EngineError` and leaves the document unchanged; geometry
that is inconsistent or out of bounds is never published. Units are metadata
only: the engine does not convert between them.

Constraints solve as a linear stage plus a bounded nonlinear pass. What it does
not do: no expression-driven CAD and no 3D, and circles and arcs display through
at most four cubic spans, an approximation for display rather than precision
plotting. The exact solver, snap and profile semantics are in
ENGINE_OPS.md.

This example runs in CI: `tests/readme-example.e2e.test.ts` runs it against the
Rust engine through `nf-cli`, with `createNitroHost()` replaced by `CliHost`.

## Entry points

| Import | Use it for |
| --- | --- |
| `@nitro-forge/draft` | `DraftDocument` and the geometry, constraint, snap and sheet types. |

## Reference

- Ops, payloads and limits: [ENGINE_OPS.md, draft-engine](../../docs/ENGINE_OPS.md#draft-engine--draftenginenew-bounded-2d-slice)
- Threading, undo, snapshot envelope and error codes: [ARCHITECTURE.md](../../docs/ARCHITECTURE.md)
