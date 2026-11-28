# @nitro-forge/prism

Layered image documents for React Native: raster, shape and path layers,
masks, selections, brushes and compositing, run by a Rust engine on the device.

**Status:** in the v1 release set (`@nitro-forge/ignition` and the seven
engines named in [RELEASE_TRAIN.md](../../docs/release/RELEASE_TRAIN.md)).
v1 is not released yet; gate status is in
[v1-readiness.json](../../docs/release/v1-readiness.json).

## Install

Forge is not published to npm. Each release attaches one tarball per package
to its [GitHub Release](https://github.com/mikevocalz/nitro-forge/releases),
with a `SHA256SUMS` file. No release exists yet, so `<version>` below is a
placeholder: replace it with the release version after the first release.

```bash
BASE=https://github.com/mikevocalz/nitro-forge/releases/download/v<version>
pnpm add "$BASE/nitro-forge-ignition-<version>.tgz" "$BASE/nitro-forge-prism-<version>.tgz" \
  react-native-nitro-modules@1.0.0-alpha.nightly.136.gdb81de61bd32 \
  nitro-core@1.0.0-alpha.nightly.136.gdb81de61bd32
```

The two Nitro packages are peer dependencies of `@nitro-forge/ignition`; Prism
itself declares none. Prism depends on `@nitro-forge/ignition`, which is not on
npm either, so point that dependency at the same tarball in
`pnpm-workspace.yaml`:

```yaml
overrides:
  "@nitro-forge/ignition": https://github.com/mikevocalz/nitro-forge/releases/download/v<version>/nitro-forge-ignition-<version>.tgz
```

Check each tarball against the release's `SHA256SUMS` before you commit the
lockfile. The engine runs inside the Ignition Nitro module, so the app needs a
native development build; Expo Go cannot load it.

## Usage

<!-- readme-example -->
```ts
import { createNitroHost } from "@nitro-forge/ignition";
import { PrismDocument } from "@nitro-forge/prism";

type Layers = { layers: { id: number; opacity: number }[] };

const host = createNitroHost();
const image = await PrismDocument.open(host, 64, 64);
const layer = (await image.addRasterLayer("Paint")).data.layer_id;
await image.fillLayer(layer, [255, 0, 0, 255]);
await image.setLayerOpacity(layer, 0.5);

const bytes = await image.save(); // NFD1 snapshot
await image.close();

const reopened = await PrismDocument.openSnapshot(host, bytes);
const opacity = async () =>
  (await reopened.describe<Layers>()).data.layers.find((l) => l.id === layer)?.opacity;
console.log(await opacity()); // 0.5
await reopened.setLayerOpacity(layer, 1);
await reopened.undo();
console.log(await opacity()); // 0.5
await reopened.redo();
console.log(await opacity()); // 1

const flat = await reopened.flatten(); // composited RGBA as base64
console.log(flat.data.width, flat.data.height); // 64 64
await reopened.close();
await host.dispose();
```

Every method maps to one engine op and resolves to `{ data, events }`. A
rejected call throws `EngineError` and leaves the document unchanged. Colors
are `[r, g, b, a]` with 0–255 channels. `encodePng()` returns PNG bytes as
base64; the app decides where they go.

This example runs in CI: `tests/readme-example.e2e.test.ts` runs it against the
Rust engine through `nf-cli`, with `createNitroHost()` replaced by `CliHost`.

## Entry points

| Import | Use it for |
| --- | --- |
| `@nitro-forge/prism` | `PrismDocument`, the `OPS` name table and the document types (layers, paths, masks, brushes). |
| `@nitro-forge/prism/canvas-cluster` | `PrismCanvasAdapter`: reads the canvas, selection and artboard state the canvas controls draw, and maps their gestures to ops. |
| `@nitro-forge/prism/color-cluster` | `bindPrismColors`: color picker, foreground/background chips and recent swatches, one `setColors` per Apply. |

None of these import React or a UI package.

## Reference

- Ops and payloads: [ENGINE_OPS.md, prism-engine](../../docs/ENGINE_OPS.md#prism-engine--prismenginenewwidth-u32-height-u32)
- Threading, undo, snapshot envelope and error codes: [ARCHITECTURE.md](../../docs/ARCHITECTURE.md)
- Third-party code: [THIRD_PARTY_NOTICES.md](THIRD_PARTY_NOTICES.md)
