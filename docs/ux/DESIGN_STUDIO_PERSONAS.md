# Design studio personas

Forge 2046 secondary prompt: Vector, Pixel, Layout and Sketch personas inside
the design studio. Started 2026-11-04 on
`feat/forge-2046-design-studio-personas-2026-11-04`, stacked on PR #32.
Affinity by Canva is a behavior reference only; no Affinity chrome, icons,
layouts or file format enter this branch.

## Which package is the design studio

Found by discovery, not assumed:

- `packages/prism` (`@nitro-forge/prism`, "prism document API") is the engine.
  `docs/ENGINE_OPS.md` defines prism-engine as raster layers plus rect and
  ellipse shape layers. `packages/studio-workspace/src/app-manifest.ts:5` maps
  prism to "Image & vector".
- The editor UI is `PrismEditor` in
  `packages/studio-workspace/src/prism-editor.tsx:40`, the only canvas editor.
- `packages/studio-layout` is dock geometry only (`src/index.ts:1`); its
  `STUDIOS` list (`src/index.ts:2-3`) is the one-studio-per-engine switch and
  stays untouched. `packages/folio` is the PDF engine.

No other studio package changes in this branch.

## Affinity evidence (clean room)

`design/research/affinity-studio-switch.md` records Affinity's studio switch
from public pages only, captured with Craft Anything 0.3.0 in clean-room mode
(62 records, all `clean_room: true`; index in
`design/research/affinity-evidence-index.tsv`). Affinity is not installed on
the research machine, so no app UI was studied. Screenshots and page text are
kept out of the repository.

What it changes for Forge:

- No public source says what survives a switch (selection, zoom, undo,
  layer focus) or how fast it is. Forge's continuity contract and the 120 ms
  budget are our own rules, not imitation.
- Affinity's release notes fix "document focus not changing when switching
  studios" on Windows and "persona switching" on Mac and Windows. Continuity
  regressions happen in shipping apps, which is why `persona-continuity` is a
  CI gate.
- Custom studios clone the current studio or start blank and export as files.
  The Persona Composer does the same with `composePersona` and
  `exportPersona`, with explicit suffixes on name conflicts.
- Per-surface gaps are listed publicly (Books, Batch, Data Merge, Scope and
  macros missing on iPad). Forge's manifests show the same kind of list on the
  turret itself.

## Decisions

| Item | Disposition | Reason |
|---|---|---|
| `PersonaSpec`, the four built-in personas, capability manifests, Persona Composer with export and import | **BUILD** (done) | `packages/studio-workspace/src/persona.ts`. Pure data over real instruments (`instrument-system.ts:28`) and real prism ops. Tested in `persona.test.ts`; CI in `.github/workflows/persona-continuity.yml`. |
| Shared document as a new `HybridDesignDoc` HybridObject | **STRIKE** | The prompt asks for one HybridObject that owns the layer graph and undo. That object already exists: the Rust prism engine behind the C++ `ForgeDocument` (`packages/ignition/src/specs/ForgeDocument.nitro.ts:40-55`: `apply`, `snapshot`, `restore`, `undo`, `redo`). AGENTS.md makes the engine authoritative for edits and the Journal for undo. A second HybridObject would be a parallel document and history store. The shared design document is the open prism session. Returns if a cross-engine document (prism plus pitch text, for example) is ever needed. |
| Undo across personas | **BUILD** (by construction) | Personas never hold document state, so the engine Journal undoes the last change whichever persona made it. Nothing to add. |
| Continuity: selection, viewport, color, brush | **BUILD** (contract done) | `ContinuityState` in `persona.ts`. `switchPersona` returns it by reference; the test walks every persona pair on every surface. Guides are not in the engine, so they are not in continuity yet (see below). |
| Vector paths, nodes and boolean ops | **DEFER** | Blocker: no path layer in prism. `Content` is `raster` or `shape` with kind `rect` or `ellipse` (ENGINE_OPS.md prism section). Needs a decision on the path layer payload (node list, curve type, fill rule) in ENGINE_OPS.md and the Rust engine together. The manifest shows "Paths and nodes: not in this build". |
| Layout pages, text frames, guides | **DEFER** | Blocker: prism has no page, text or guide content. Pitch has text objects (ENGINE_OPS.md, `kind:"text"`), but pulling them in means a cross-engine document, which the strike above rules out for now. Needs a decision on whether pages belong in prism or in a new engine. |
| Sketch strokes as editable vector sources | **DEFER** | Depends on the path layer above. Sketch today can paint raster via `drawPixels`; its manifest line for strokes reads "not in this build". |
| Data merge | **DEFER** | No engine op. Declared desktop and web only in the manifest. |
| Instrument rail in the editor | **DEFER** | A persona's `rail` is stored and ordered by the Composer, but no editor draws it: every entry in `forgeInstrumentBlueprints` has `releaseVerified: false`, and only Precision Scrubber exists as a component, not wired to a Prism op. Drawing the rail now would put dead controls on screen. The Composer marks each instrument "Not in this build" and says the rail order is kept until instruments ship. Returns when an instrument is verified against its engine boundary (decided 2026-11-05, found on an iPad Pro). |
| Persona persistence | **BUILD** (done) | `createPersonaStore` takes a host `PersonaStoragePort`. Web: browser storage (`apps/studio-preview/src/persona-storage.ts`). Native: a JSON file in the app document directory via Expo 58's `expo-file-system` 58.0.13 (`apps/example/src/persona/persona-file-storage.ts`). MMKV was the default choice, but react-native-mmkv 4.3.2 is built for Nitro 0.35 and this app runs Nitro v1. Unreadable files surface an error and keep the built-ins. |
| Turret state machine | **BUILD** (done) | `turret.ts`: one reducer for every host. Drag and arrows peek, release, Enter or ⌘-digit commit, Escape or a cancelled gesture drops the peek. Effects tell the host when to play the detent haptic, the end-stop cue and the announcement. Change/commit split taken from the rotary references in `design/references/mobbin-studio-switch-web.md`. |
| Turret hosts (iOS, Android, web, XR) | **BUILD** (done, device unverified) | Workbench direction picked over Optics and Atelier (design/DIRECTION.md). Web popover and phone sheet, native formSheet, foldable dock, Reanimated detent motion, platform haptics, Android Back cancel. XR panel not built: no XR host exists in this repo. Critique rounds 2 to 4 in design/; the remaining lines need device evidence. |

## What is verified

- `node --experimental-strip-types --test src/persona.test.ts src/turret.test.ts src/instrument-system.test.ts`
  in `packages/studio-workspace`: all pass, 2026-11-04.
- `persona.ts`, `turret.ts` and their tests typecheck under the base config's
  strict flags with TypeScript 6.0.3 borrowed from another checkout. The repo
  pins 7.0.2; its own `tsc --noEmit` has not run.
- Not run: `tsc --noEmit` (node_modules is empty while pnpm 12's release-age
  policy rejects the current lockfile), Rust tests, any UI, device or
  accessibility check. Nothing in this slice renders yet.
