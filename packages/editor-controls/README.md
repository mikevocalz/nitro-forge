# @nitro-forge/editor-controls

The editor controls for the Nitro Forge apps: audio and MIDI, timeline,
spreadsheet, canvas and layers, color, photo, motion, vector, office, PDF and
the rest. They take controlled values and callbacks. They do not own
persistence, file I/O, engine state or undo; the Forge engine adapters
(`@nitro-forge/cadence`, `@nitro-forge/tally`, ...) supply those.

The controls build on the general UI of
[NYC-Tron UI](https://github.com/mikevocalz/NYC-Tron-UI) (`@nyc-tron/ui`):
buttons, selects, gestures, local stores, styles and shell inputs. Forge
installs NYC-Tron from the release pinned in `tooling/nyc-tron.json`. NYC-Tron
never imports this package.

## Where the code came from

On 2026-11-28 the owner decided that NYC-Tron UI ships only general app UI and
that Forge owns its editor controls. The controls were moved, without code
changes, from NYC-Tron UI commit `5a1ea4db`, path
`packages/ui/src/components/forge/`. A file at `forge/<path>` there is at
`src/<path>` here, and the export `./<path>` here is the old
`@nyc-tron/ui/components/forge/<path>`. The package has 450 exports.

NYC-Tron relocated seven helpers that its own shell uses instead of moving
them. Three of them were editor-control subpaths, and they now come from
NYC-Tron:

| Old import | New import |
| --- | --- |
| `@nyc-tron/ui/components/forge/inputs/precision` | `@nyc-tron/ui/components/shell/precision` |
| `@nyc-tron/ui/components/forge/inputs/precision-scrubber-model` | `@nyc-tron/ui/components/shell/precision-scrubber-model` |
| `@nyc-tron/ui/components/forge/inputs/PrecisionScrubber` | `@nyc-tron/ui/components/shell/PrecisionScrubber` |
| `@nyc-tron/ui/components/forge/<path>` (everything else) | `@nitro-forge/editor-controls/<path>` |

A package that imports the controls adds
`"@nitro-forge/editor-controls": "workspace:*"` to its `package.json`.
`node tooling/verify-nyc-tron-pin.mjs` fails on any remaining
`@nyc-tron/ui/components/forge/*` import and names the file and line.

Inside `src/`, NYC-Tron primitives are imported as
`@nyc-tron/ui/components/<path>` and the package's own files by relative
paths with `.ts`/`.tsx` extensions.

## The rc.2 export bridge

NYC-Tron `v1.0.0-rc.2` still contains the old `forge/` files, but its export
map lacks 20 subpaths that the controls import: the seven relocated helpers
(`components/feedback/announce`, `components/forms/toggle-a11y`,
`components/forms/SettingSwitch`, `components/gestures/canvas-gesture-relations`
and the three `components/shell/precision*` files) and 13 general primitives
(`components/gestures/*`, `components/local-store`, `components/useLocalStore`,
`components/shell/useOwnedAction`, `components/styles`).

`patches/@nyc-tron__ui@1.0.0-rc.2.patch`, applied through
`patchedDependencies` in `pnpm-workspace.yaml` and
`examples/native-cadence/pnpm-workspace.yaml`, adds those 20 entries. Each
points at a `dist/` file that rc.2 already ships, the same module that rc.2's
own shell loads, so the app holds one copy. The patch changes only
`package.json` and only adds export entries. `tooling/verify-nyc-tron-pin.mjs`
checks this: the patch must be for the pinned version, its file must exist and
match the lockfile hash, it may add only whole export-map entries pointing
into `dist/`, and each target must exist in the installed release.

Delete the patch, both `patchedDependencies` entries and this section when
`tooling/nyc-tron.json` moves to the next NYC-Tron release, which exports
these subpaths itself. Then run `pnpm install` in the root and in
`examples/native-cadence`.

## Types and compiler flags

The sources compile under Forge's base flags, `exactOptionalPropertyTypes`
and `noUncheckedIndexedAccess` included. NYC-Tron UI declares optional props
without `| undefined`, so a value that may be `undefined` goes to a NYC-Tron
component through `exact()` in `src/exact-optional.ts`, which drops the
`undefined` keys.

The sources import each other with `.ts` and `.tsx` extensions, which
`tsconfig.json` allows with `allowImportingTsExtensions` and Forge's base
config does not. So consumers don't type-check these sources directly: the
exports' `types` conditions point at declarations in `dist/`, built by:

```sh
pnpm --filter @nitro-forge/editor-controls build   # tsc -p tsconfig.build.json
```

`dist/` is not committed. `turbo run typecheck` builds it first through
`^build`. Run the command above before typechecking a consumer package on its
own; the CI workflows that do that run it after install. Bundlers (Metro and
Vite) load `src/` through the `react-native` and `default` conditions, so
nothing needs building to run an app.

On web, `apps/studio-preview/vite.config.ts` routes this package's
`react-native` imports to the same `className` binding it uses for NYC-Tron.
Apps that use the controls add `packages/editor-controls/src` to their
Tailwind `@source` list so the controls' classes are generated.

## Scripts

```sh
pnpm --filter @nitro-forge/editor-controls build              # declarations into dist/
pnpm --filter @nitro-forge/editor-controls typecheck          # sources and examples/native-instruments
pnpm --filter @nitro-forge/editor-controls typecheck:examples # examples only
pnpm --filter @nitro-forge/editor-controls test               # node --test suites in tests/
```

## Licenses

The package is MIT (`LICENSE`, NYC-Tron UI's license text). 23 files are ports
from ArtCraft projects (ProCraft, FilmCraft, GridCraft, WordCraft and PdfCraft,
each MIT or Apache-2.0). Each keeps its original header, and the license and
NOTICE texts are in `licenses/`. `THIRD_PARTY_NOTICES.md` lists every ported
file and its upstream source. Keep the headers and those files when moving or
editing ported code.
