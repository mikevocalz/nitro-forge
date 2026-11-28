# @nitro-forge/scene

3D scene documents: a node graph of groups, meshes, cameras and lights with
TRS transforms, PBR materials and built-in primitives, held by a Rust engine
that answers bounds and pick queries. It does not rasterize.

**Status:** deferred. Not in the v1 release set:
[RELEASE_TRAIN.md](../../docs/release/RELEASE_TRAIN.md) names Ignition and the
seven engines only, so v1 releases attach no tarball for this package. The
source, the Rust engine and the tests stay in this repository. Node-material
graphs, UV packing, glTF/OBJ import, shadows, image-based lighting,
transparency, a studio app and native target acceptance are deferred.

## Install

There is no release tarball. Inside this repository, add it as a workspace
dependency:

```json
{ "dependencies": { "@nitro-forge/scene": "workspace:*" } }
```

It depends on [`@nitro-forge/ignition`](../ignition/README.md), whose peer
dependencies are `react-native-nitro-modules` and `nitro-core` at
`1.0.0-alpha.nightly.136.gdb81de61bd32`. Scene declares no peer dependencies of
its own.

## Usage

<!-- readme-example -->
```ts
import { createNitroHost } from "@nitro-forge/ignition";
import { SceneDocument } from "@nitro-forge/scene";

const host = createNitroHost();
const scene = await SceneDocument.open(host, "Demo");
const material = (await scene.addMaterial()).data.material_id; // meshes need a material
const cube = (await scene.addMeshPrimitive({ kind: "box", size: [2, 2, 2], material })).data.mesh_id;
const node = (await scene.addNode({ kind: "mesh", mesh: cube, name: "Cube" })).data.node_id;

const bytes = await scene.save(); // NFD1 snapshot
await scene.close();

const reopened = await SceneDocument.openSnapshot(host, bytes);
const maxX = async () => (await reopened.bounds()).data.bounds?.max[0];
console.log(await maxX()); // 1
await reopened.setTransform(node, { translation: [5, 0, 0] });
await reopened.undo();
console.log(await maxX()); // 1
await reopened.redo();
console.log(await maxX()); // 6

const hit = await reopened.pick([5, 0, 10], [0, 0, -1]); // ray from +Z toward the cube
console.log(hit.data.hit !== null); // true
await reopened.close();
await host.dispose();
```

Every method maps to one engine op and resolves to `{ data, events }`. A
rejected call throws `EngineError` and leaves the document unchanged. The world
is right-handed with +Y up; rotations are Euler degrees.

`renderFrame(request)` returns a scene description (world-space meshes,
materials, the resolved camera and lights) for the host to pass to the
`scene-render` service, which draws it.

This example runs in CI: `tests/readme-example.e2e.test.ts` runs it against the
Rust engine through `nf-cli`, with `createNitroHost()` replaced by `CliHost`.

## Entry points

| Import | Use it for |
| --- | --- |
| `@nitro-forge/scene` | `SceneDocument` and the node, mesh, material, camera, light and render-description types. |

## Reference

- Ops, payloads and limits: [ENGINE_OPS.md, scene-engine](../../docs/ENGINE_OPS.md#scene-engine--sceneenginenew-bounded-3d-scene-graph)
- The render service: [ENGINE_OPS.md, scene-render](../../docs/ENGINE_OPS.md#scene-render-service--host-side-not-an-engine)
- Threading, undo, snapshot envelope and error codes: [ARCHITECTURE.md](../../docs/ARCHITECTURE.md)
