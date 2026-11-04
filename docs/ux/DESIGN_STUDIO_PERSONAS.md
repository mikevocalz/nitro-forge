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
| Persona persistence (Zustand plus MMKV) | **DEFER** | No MMKV dependency exists in the repo; FORGE_2046_DESIGN_SYSTEM.md:37 places persistence behind a host port. User personas serialize through `exportPersona`; the host store lands with the turret UI. |
| Turret state machine | **BUILD** (done) | `turret.ts`: one reducer for every host. Drag and arrows peek, release, Enter or ⌘-digit commit, Escape or a cancelled gesture drops the peek. Effects tell the host when to play the detent haptic, the end-stop cue and the announcement. Change/commit split taken from the rotary references in `design/references/mobbin-studio-switch-web.md`. |
| Turret hosts (iOS, Android, web, XR) | **BUILD** next | Render the three Forge directions on the turret, then native hosts. Blocked locally on node_modules for anything that renders. |

## What is verified

- `node --experimental-strip-types --test src/persona.test.ts src/turret.test.ts src/instrument-system.test.ts`
  in `packages/studio-workspace`: all pass, 2026-11-04.
- `persona.ts`, `turret.ts` and their tests typecheck under the base config's
  strict flags with TypeScript 6.0.3 borrowed from another checkout. The repo
  pins 7.0.2; its own `tsc --noEmit` has not run.
- Not run: `tsc --noEmit` (node_modules is empty while pnpm 12's release-age
  policy rejects the current lockfile), Rust tests, any UI, device or
  accessibility check. Nothing in this slice renders yet.
