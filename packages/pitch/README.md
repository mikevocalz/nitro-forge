# @nitro-forge/pitch

Slide decks for React Native: slides, layouts, themes, text, shapes, tables,
charts and timed animations, edited by a Rust engine on the device.

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
pnpm add "$BASE/nitro-forge-ignition-<version>.tgz" "$BASE/nitro-forge-pitch-<version>.tgz" \
  react-native-nitro-modules@1.0.0-alpha.nightly.136.gdb81de61bd32 \
  nitro-core@1.0.0-alpha.nightly.136.gdb81de61bd32
```

The two Nitro packages are peer dependencies of `@nitro-forge/ignition`; Pitch
itself declares none. Pitch depends on `@nitro-forge/ignition`, which is not on
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
import { PitchDocument } from "@nitro-forge/pitch";

const host = createNitroHost();
const deck = await PitchDocument.open(host, "Q4 review"); // starts with one slide
const slide = (await deck.addSlide("titleBody")).data.slide_id;
const title = (await deck.addText(slide, 100, 60, 400, 60, "Revenue", 44)).data.object_id;
await deck.addAnimation(slide, title, "fadeIn", 0, 1); // starts at 0 s, lasts 1 s

const bytes = await deck.save(); // NFD1 snapshot
await deck.close();

const reopened = await PitchDocument.openSnapshot(host, bytes);
console.log((await reopened.deck()).data.slide_count); // 2
await reopened.addSlide("title");
await reopened.undo();
console.log((await reopened.deck()).data.slide_count); // 2
await reopened.redo();
console.log((await reopened.deck()).data.slide_count); // 3

const frame = await reopened.slideAt(slide, 2); // the slide 2 s into its timeline
console.log(frame.data.objects.find((o) => o.id === title)?.opacity); // 1
await reopened.close();
await host.dispose();
```

Every method maps to one engine op and resolves to `{ data, events }`. A
rejected call throws `EngineError` and leaves the document unchanged. A deck
always keeps at least one slide.

This example runs in CI: `tests/readme-example.e2e.test.ts` runs it against the
Rust engine through `nf-cli`, with `createNitroHost()` replaced by `CliHost`.

## Entry points

| Import | Use it for |
| --- | --- |
| `@nitro-forge/pitch` | `PitchDocument`, the `OPS` name table and the deck types. |
| `@nitro-forge/pitch/office-cluster` | Callbacks for the slide filmstrip, slide sorter, slide canvas and animation pane. Operations the engine lacks are listed in `PITCH_DEFERRED_OPS` and get no callback. |

Neither imports React or a UI package.

## Reference

- Ops and payloads: [ENGINE_OPS.md, pitch-engine](../../docs/ENGINE_OPS.md#pitch-engine--pitchenginenew)
- Threading, undo, snapshot envelope and error codes: [ARCHITECTURE.md](../../docs/ARCHITECTURE.md)
