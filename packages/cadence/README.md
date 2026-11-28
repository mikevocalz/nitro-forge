# @nitro-forge/cadence

Music projects for React Native: MIDI and audio tracks, clips, notes, buses,
inserts and automation, rendered offline to PCM by a Rust engine on the device.

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
pnpm add "$BASE/nitro-forge-ignition-<version>.tgz" "$BASE/nitro-forge-cadence-<version>.tgz" \
  react-native-nitro-modules@1.0.0-alpha.nightly.136.gdb81de61bd32 \
  nitro-core@1.0.0-alpha.nightly.136.gdb81de61bd32
```

The two Nitro packages are peer dependencies of `@nitro-forge/ignition`;
Cadence itself declares none. Cadence depends on `@nitro-forge/ignition`, which
is not on npm either, so point that dependency at the same tarball in
`pnpm-workspace.yaml`:

```yaml
overrides:
  "@nitro-forge/ignition": https://github.com/mikevocalz/nitro-forge/releases/download/v<version>/nitro-forge-ignition-<version>.tgz
```

Check each tarball against the release's `SHA256SUMS` before you commit the
lockfile. The engine runs inside the Ignition Nitro module, so the app needs a
native development build; Expo Go cannot load it. Cadence renders PCM; playing
it through the device's audio output is the app's job.

## Usage

<!-- readme-example -->
```ts
import { createNitroHost } from "@nitro-forge/ignition";
import { CadenceDocument } from "@nitro-forge/cadence";

const host = createNitroHost();
const song = await CadenceDocument.open(host, 120); // 120 BPM, 960 ticks per beat
const track = (await song.addTrack("midi", "Keys")).data.track_id;
const clip = (await song.addClip(track, 0, 960)).data.clip_id;
await song.addNote(clip, 69, 0, 960); // A4 for one beat

const bytes = await song.save(); // NFD1 snapshot
await song.close();

const reopened = await CadenceDocument.openSnapshot(host, bytes);
console.log((await reopened.project()).data.track_count); // 1
await reopened.setTempo(90);
await reopened.undo();
console.log((await reopened.project()).data.tempo_bpm); // 120
await reopened.redo();
console.log((await reopened.project()).data.tempo_bpm); // 90

const { frames, samples } = await reopened.render(0, 960, 48000); // stereo f32
console.log(samples.length === frames * 2); // true
await reopened.close();
await host.dispose();
```

Every method maps to one engine op and resolves to `{ data, events }`. A
rejected call throws `EngineError` and leaves the document unchanged. Positions
and lengths are in ticks at 960 per quarter note, so clips follow tempo changes.

This example runs in CI: `tests/readme-example.e2e.test.ts` runs it against the
Rust engine through `nf-cli`, with `createNitroHost()` replaced by `CliHost`.

## Entry points

| Import | Use it for |
| --- | --- |
| `@nitro-forge/cadence` | `CadenceDocument`, the `OPS` name table and the project types. |
| `@nitro-forge/cadence/instrument-adapter` | Knob bindings (`min`, `max`, `step`, `onCommit`) for a track's gain and pan, shaped for both the React Native `InstrumentKnob` and the native `ArcKnob`. |
| `@nitro-forge/cadence/instrument-session` | `CadenceInstrumentSession`: one track's instrument state, re-read from the engine after each write. |
| `@nitro-forge/cadence/editor-adapter` | Mixer, tempo/metronome, piano roll, velocity lane and step sequencer callbacks. Each callback is one op and one undo step. |
| `@nitro-forge/cadence/mixer-cluster` | `CadenceMixerAdapter` and helpers that read channels, routes and insert slots for the mixing console. |
| `@nitro-forge/cadence/transfer` | WAV export format for the file export sheet, rendered in one bounded engine call. |

None of these import React or a UI package.

## Reference

- Ops and payloads: [ENGINE_OPS.md, cadence-engine](../../docs/ENGINE_OPS.md#cadence-engine--cadenceenginenew)
- Threading, undo, snapshot envelope and error codes: [ARCHITECTURE.md](../../docs/ARCHITECTURE.md)
