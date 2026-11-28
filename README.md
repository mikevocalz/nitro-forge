# Nitro-Forge

Native document engines for React Native. Each engine is a pure-Rust crate
behind the shared **Ignition** contract. Apps reach the engines through one
Nitro module; tests and tools reach the same engines through the `nf-cli`
JSON-lines host.

## Packages

The v1 release set is `@nitro-forge/ignition` and seven engines
([RELEASE_TRAIN.md](docs/release/RELEASE_TRAIN.md)):

| Package | What it edits |
| --- | --- |
| [`@nitro-forge/ignition`](packages/ignition/README.md) | Hosts, `DocumentHandle`, errors and the Nitro module spec every engine uses. |
| [`@nitro-forge/prism`](packages/prism/README.md) | Layered images: raster, shape and path layers, masks, brushes. |
| [`@nitro-forge/cadence`](packages/cadence/README.md) | Music projects: MIDI and audio tracks, mixing, offline render to PCM. |
| [`@nitro-forge/splice`](packages/splice/README.md) | Video edit timelines and the render plan an encoder consumes. |
| [`@nitro-forge/folio`](packages/folio/README.md) | PDF files: pages, annotations, forms, encryption. |
| [`@nitro-forge/pitch`](packages/pitch/README.md) | Slide decks: layouts, themes, objects, animations. |
| [`@nitro-forge/tally`](packages/tally/README.md) | Spreadsheets: formulas, sheets, XLSX and CSV. |
| [`@nitro-forge/quill`](packages/quill/README.md) | Rich text: styles, lists, tables, comments, DOCX. |

Deferred: kept in this repository and tested, but not in the v1 release set, so
v1 releases attach no tarball for them.

| Package | What it edits |
| --- | --- |
| [`@nitro-forge/photo`](packages/photo/README.md) | Photo catalogs and non-destructive develop recipes. |
| [`@nitro-forge/motion`](packages/motion/README.md) | 2D motion graphics compositions. |
| [`@nitro-forge/design`](packages/design/README.md) | Interface design frames, layout, components, prototypes. |
| [`@nitro-forge/draft`](packages/draft/README.md) | 2D drafting with snapping and constraints. |
| [`@nitro-forge/scene`](packages/scene/README.md) | 3D scene graphs (no rasterization). |
| [`@nitro-forge/telemetry`](packages/telemetry/README.md) | Consent-gated timings and failure traces for engine calls. |

Private workspace packages, not released on their own:

| Package | Role |
| --- | --- |
| [`@nitro-forge/editor-controls`](packages/editor-controls/README.md) | The editor controls (audio, timeline, spreadsheet, canvas, color, office and the rest), built on NYC-Tron UI primitives. |
| [`@nitro-forge/studio-workspace`](packages/studio-workspace/README.md) | Studio editor chrome on React Native and React Native Web. |
| `@nitro-forge/studio-layout` | The validated panel layout model behind the studio workspace. |
| [`@nitro-forge/icons`](packages/icons/README.md) | Outline and filled icons for the engines. |
| [`@nitro-forge/adaptive-layout`](packages/adaptive-layout/README.md) | Fold and hinge pane geometry. |
| [`@nitro-forge/audio-ui`](packages/audio-ui/README.md), [`@nitro-forge/media-ui`](packages/media-ui/README.md) | Audio recording and playback; media playback and waveform controls. |
| [`@nitro-forge/native-signal`](packages/native-signal/README.md), `@nitro-forge/spatial-ink` | Native waveform analysis; spatial pen input. |
| [`@nitro-forge/collaboration-server`](packages/collaboration-server/README.md) | Node revision service for `@nitro-forge/ignition/collaboration-http`. |
| [`@nitro-forge/agpl-speed-curve`](packages/agpl-speed-curve/README.md) | Experimental AGPL-3.0-or-later speed-curve adapter, kept isolated. |

## Apps

| App | What it is |
| --- | --- |
| `apps/example` | The Expo suite app. Its brand manifests (`apps/example/brands`) build the suite and one studio per engine: Prism, Cadence, Splice, Folio, Pitch, Tally and Quill. |
| `apps/forge-audio-lab`, `apps/forge-media-lab` | Expo labs for the audio and media controls. |
| [`apps/studio-preview`](apps/studio-preview/README.md) | Browser harness that renders the studio workspace against the real engines through `nf-cli`. |
| `apps/console` | Command-line workflow demo that drives every engine through `nf-cli`. |

## Layout

```
rust/
  ignition-core/   Engine trait, commands, errors, journal, NFD1 snapshot
                   envelope, session registry, JSON-lines protocol
  nf-cli/          stdin/stdout host binary (tests and tooling)
  nf-sys/          C ABI that the Nitro-generated bridge calls
  folio-render/, scene-render/, splice-render/, raw-decode/, nf-raw/, nf-color/
                   host-side services; not engines
packages/<engine>/
  src/             typed TypeScript API
  rust/            the engine crate
  tests/           vitest suites against the real engine via nf-cli
docs/
  ARCHITECTURE.md  ratified contracts: threading, ownership, undo, envelopes
  ENGINE_OPS.md    authoritative op names and payloads per engine
  ROSTER.md        what has been verified and what has not
```

## Quick start

Requires Node 24.3 or later, pnpm 12.18.0 and a Rust toolchain.

```bash
pnpm install
cargo build --locked -p nf-cli                    # every engine behind one JSON-lines host; the tests spawn it
pnpm --filter @nitro-forge/editor-controls build  # declarations some packages typecheck against
pnpm -r test                                      # vitest suites against the real Rust engines
pnpm -r typecheck
cargo test --locked --workspace                   # engine, contract and FFI tests
pnpm --filter @nitro-forge/console demo
```

`pnpm test:readme-examples` checks that every package README's usage example
still runs.

## Using a package

```ts
import { createNitroHost } from "@nitro-forge/ignition";
import { TallyDocument } from "@nitro-forge/tally";

const host = createNitroHost(); // the Nitro module; needs a native build
const sheet = await TallyDocument.open(host);
await sheet.setCell("A1", "=SUM(1,2,3)");
const bytes = await sheet.save(); // NFD1 snapshot
await sheet.close();
await host.dispose();
```

`createNitroHost()` always uses the native module. In Node, construct a
`CliHost` from `@nitro-forge/ignition/cli` instead; it spawns `nf-cli`.

Every document supports `open`/`create`, edits, `save()`, reopening with
`openSnapshot`, `undo()`/`redo()` and `close()`. Engines run offline and never
need an AI provider. Each package README has a complete example that CI runs.

## Install

Forge is distributed as GitHub Release tarballs, never through npm. No release
has been cut yet; see any package README for the install form, and
[RELEASE_TRAIN.md](docs/release/RELEASE_TRAIN.md) for the release procedure.

## Status

[docs/ROSTER.md](docs/ROSTER.md) records what is verified and what is pending
(native packaging, on-device UI, performance budgets).
[docs/release/v1-readiness.json](docs/release/v1-readiness.json) tracks the v1
gates. Changes are listed in [CHANGELOG.md](CHANGELOG.md).

## Contributing and security

See [CONTRIBUTING.md](CONTRIBUTING.md) and [SECURITY.md](SECURITY.md).
