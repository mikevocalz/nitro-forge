# @nitro-forge/splice

Video edit timelines for React Native: sources, tracks, clips, speed ramps,
transitions and markers, edited by a Rust engine on the device. The engine
produces an ordered render plan; it does not decode or encode video.

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
pnpm add "$BASE/nitro-forge-ignition-<version>.tgz" "$BASE/nitro-forge-splice-<version>.tgz" \
  react-native-nitro-modules@1.0.0-alpha.nightly.136.gdb81de61bd32 \
  nitro-core@1.0.0-alpha.nightly.136.gdb81de61bd32
```

The two Nitro packages are peer dependencies of `@nitro-forge/ignition`;
Splice itself declares none. Splice depends on `@nitro-forge/ignition`, which
is not on npm either, so point that dependency at the same tarball in
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
import { SpliceDocument } from "@nitro-forge/splice";

const host = createNitroHost();
const edit = await SpliceDocument.open(host, 30); // 30 fps
const source = (await edit.addSource(10, "take1.mp4")).data.source_id; // 10 s of media
const track = (await edit.addTrack("video")).data.track_id;
const clip = (await edit.addClip({ track, source, in_s: 0, out_s: 8 })).data.clip_id;
const { right_id: secondHalf } = (await edit.splitClip(clip, 4)).data;
console.log((await edit.duration()).data.seconds); // 8

const bytes = await edit.save(); // NFD1 snapshot
await edit.close();

const reopened = await SpliceDocument.openSnapshot(host, bytes);
await reopened.setSpeed(secondHalf, 2); // the second half now plays in 2 s
console.log((await reopened.duration()).data.seconds); // 6
await reopened.undo();
console.log((await reopened.duration()).data.seconds); // 8
await reopened.redo();
console.log((await reopened.duration()).data.seconds); // 6
await reopened.close();
await host.dispose();
```

Every method maps to one engine op and resolves to `{ data, events }`. A
rejected call throws `EngineError` and leaves the document unchanged. Times are
seconds. `renderPlan()` returns the ordered plan an encoder would consume;
`batch(ops)` applies several edits as one undo step.

This example runs in CI: `tests/readme-example.e2e.test.ts` runs it against the
Rust engine through `nf-cli`, with `createNitroHost()` replaced by `CliHost`.

## Entry points

| Import | Use it for |
| --- | --- |
| `@nitro-forge/splice` | `SpliceDocument`, the `OPS` name table, transition kinds and the timeline types. |
| `@nitro-forge/splice/timeline-cluster` | `timelineView` and the edit bindings for the timeline controls: reads in whole frames, writes in seconds, two-op gestures (a head trim) as one batch. Features without an engine backend are listed in `SPLICE_DEFERRED`. |
| `@nitro-forge/splice/transfer` | Render-plan JSON export for the file export sheet. Encoded video export has no backend yet. |

None of these import React or a UI package.

## Reference

- Ops and payloads: [ENGINE_OPS.md, splice-engine](../../docs/ENGINE_OPS.md#splice-engine--spliceenginenew)
- Threading, undo, snapshot envelope and error codes: [ARCHITECTURE.md](../../docs/ARCHITECTURE.md)
