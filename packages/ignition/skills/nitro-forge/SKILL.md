---
name: nitro-forge
description: Install and use the Nitro Forge studio components (workspace chrome, persona turret, Prism editor, theme, StudioUIProvider, icons) through the @nitro-forge shadcn registry, drive the 12 Rust engines through @nitro-forge/ignition, and import the editor controls from @nitro-forge/editor-controls. Use when adding a Forge item, wiring StudioUIProvider, opening or editing an engine document, importing an editor control, rebranding the accent, checking a token, or deciding why an engine, ignition or editor-controls cannot be installed with shadcn.
---

# Nitro Forge

Nitro Forge is a set of document studios on one Rust engine. The `@nitro-forge` registry ships the studio UI as source files. The engines, `@nitro-forge/ignition`, `@nitro-forge/studio-layout` and `@nitro-forge/editor-controls` are not in it. General controls such as Button and TabBar come from the `@nyc-tron` registry, which owns them. The editor controls (layers, timeline, spreadsheet, color and the rest) belong to Forge and come from `@nitro-forge/editor-controls`.

## Provider prerequisite: do this first

Every studio component throws "No substitute UI is installed" at first render unless the app is wrapped once in `StudioUIProvider`. Install the provider and a host before any component:

```bash
npx shadcn@4.23.0 add @nitro-forge/studio-ui-provider @nitro-forge/nyc-tron-host
```

Then fill the 27 slots with `nycTronStudioUI()` from the installed `nyc-tron-host` file and wrap the root layout:

```tsx
<StudioUIProvider components={studioUI}>{/* app */}</StudioUIProvider>
```

The host needs the `@nyc-tron` controls and three host parts (`Select`, `NativePopover`, `NativeActionMenu` from `@nyc-tron/expo-controls`). The wiring is app code, so shadcn cannot do it. The working example is `apps/example/src/studio-ui.tsx` in the repo.

Items that need the provider are marked `meta.needsProvider: true` in `r/<item>.json`. Items that do not: `studio-gesture`, `persona-model`, `instrument-system`, `workspace-utilities`, `studio-theme`, `forge-directions`, `forge-icon`, `forge-icon-button`, `brand-theme`.

## Install order

Nine steps, numbered 0 to 8. A registry add covers step 4 and step 8, plus the file part of steps 5, 6 and 7.

| Step | What | `shadcn add` |
|---|---|---|
| 0 | Toolchain: Node >=24.3.0, pnpm 12.18.0, Rust, Xcode or Android NDK with `cargo-ndk` | no |
| 1 | `@nitro-forge/ignition` native host | no (decision 4) |
| 2 | An engine package, for example `@nitro-forge/tally` | no (decision 3) |
| 3 | `@nitro-forge/studio-layout` and `@nitro-forge/editor-controls` | no (decision 3) |
| 4 | `@nitro-forge/icons` as item `forge-icon` | yes |
| 5 | NYC-Tron tarballs from `tooling/nyc-tron.json` | packages no, wrapper items yes |
| 6 | Theme CSS from `studio-theme` | files yes, the generator and CSS import no |
| 7 | `StudioUIProvider` and host | files yes, wiring no |
| 8 | Studio components | yes |

Steps 1 to 3 cannot be reproduced outside this monorepo today. No tag, release or tarball exists for them, nothing is on npm, and `compatibility.v1.json` records distribution as not run. Stop and ask rather than invent a release URL. The commands for steps 0 to 3, 5 and 6 are in `docs/agent-native/install-order.md`. They were read from the repo and were not run on the machine that wrote this skill.

Items that name a prerequisite shadcn cannot install list it in `meta.prerequisites` and in the `docs` text the CLI prints after an add. `prism-editor` needs `@nitro-forge/ignition` (it imports `base64ToBytes` and `bytesToBase64`). `prism-editor` also needs `@nitro-forge/editor-controls` for its layers panel. `forge-workspace`, `forge-document-stage` and `workspace-utilities` need `@nitro-forge/studio-layout`, and so does everything that depends on them.

## Commands

Verified against a local server with shadcn CLI 4.23.0, in an app whose `components.json` maps both namespaces:

```bash
npx shadcn@4.23.0 list @nitro-forge
npx shadcn@4.23.0 view @nitro-forge/persona-composer
npx shadcn@4.23.0 add @nitro-forge/persona-composer
npx shadcn@4.23.0 mcp
```

`components.json` at the repo root points the two namespaces at `https://raw.githubusercontent.com/mikevocalz/<repo>/<ref>/r/{name}.json`. `<ref>` is `nitroForgeRef` (`master`) for `@nitro-forge` and `nycTronRef` (`main`) for `@nyc-tron`, both in `tooling/registry/config.json`. They are moving branches, not release tags, until the owner cuts tags: what an install fetches changes with each push, and the `@nyc-tron` items resolve only once NYC-Tron's `r/` is on its `main` branch. To pin, run `node tooling/registry/set-ref.mjs <nitroForgeRef> [nycTronRef]`; it rewrites the config and regenerates every generated file. The install proof against a local server accepted `text/plain` responses, which is what raw.githubusercontent.com serves. A live fetch from raw GitHub has not been done. `.mcp.json` runs `npx shadcn@latest mcp` because the mission specifies it. Pin it to `shadcn@4.23.0`, the version the registry is built with, if you want a reproducible tool version.

Item names keep slashes: `@nyc-tron/shell/PrecisionScrubber`. The `@nyc-tron` item names are the export keys after `./components/`. Forge items depend on 21 of them. `check-imports` reads NYC-Tron's built `registry.json` on every run and fails on any that is missing. A dependency under the old editor-control path is invalid, and `validate-registry` rejects it.

Installed files land in `components/forge/` (icons in `components/forge/icons/`). Imports between them are relative. Imports of NYC-Tron files are written as `@/components/nyc-tron/ui/components/<key>`, which is where the `@nyc-tron` items install (their `files[].target` is `@components/nyc-tron/ui/components/<key>.tsx`, and `@components` expands to your `components` alias).

## Editor controls

`@nitro-forge/editor-controls` holds the editor controls: audio and MIDI, timeline, spreadsheet, canvas and layers, color, photo, motion, vector, office and PDF. They moved unchanged from NYC-Tron UI (`packages/ui/src/components/forge/`) in #95. They take controlled values and callbacks; the engine packages supply persistence and undo.

Import a control by its path. The package has 450 exports, one per file:

```ts
import { LayerStack } from '@nitro-forge/editor-controls/layers/LayerStack';
import { moveLayer, validateLayers } from '@nitro-forge/editor-controls/layers/layer-model';
```

Never import `@nyc-tron/ui/components/forge/*`. NYC-Tron `v1.0.0-rc.2` still ships those files, but Forge does not use them. `node tooling/verify-nyc-tron-pin.mjs` fails on any such import and names the file and line. The old path `forge/<path>` is now `@nitro-forge/editor-controls/<path>`, except three precision helpers that NYC-Tron kept: `@nyc-tron/ui/components/shell/precision`, `shell/precision-scrubber-model` and `shell/PrecisionScrubber`. `packages/editor-controls/README.md` has the mapping and the rc.2 export patch.

It is a private workspace package with no tarball. A package in this monorepo adds `"@nitro-forge/editor-controls": "workspace:*"`. There is no way to install it outside the repo today.

## Engines

Each engine is a package with a document facade (`TallyDocument`, `PrismDocument`, ...) over `@nitro-forge/ignition`. Every facade has `open` (or `create` for folio), `openSnapshot`, `save`, `undo`, `redo` and `close`, plus engine ops. In an app the host is `createNitroHost()` from `@nitro-forge/ignition`. In Node it is `new CliHost()` from `@nitro-forge/ignition/cli`, which spawns `target/debug/nf-cli` (build it with `cargo build --locked -p nf-cli`, or set `NF_CLI`).

```ts
import { createNitroHost } from '@nitro-forge/ignition';
import { TallyDocument } from '@nitro-forge/tally';

const host = createNitroHost();
const doc = await TallyDocument.open(host);
await doc.setCell('A1', '10');
await doc.setCell('A2', '20');
const sum = await doc.setCell('A3', '=A1+A2'); // sum.data.computed === 30
const bytes = await doc.save();
await doc.close();

const again = await TallyDocument.openSnapshot(host, bytes);
await again.setCell('A1', '15');
await again.undo(); // A3 is 30 again
await again.redo(); // A3 is 35
await again.close();
```

Op names and payloads are in `docs/ENGINE_OPS.md`; use only ops listed there. Each page in `docs/engines/` has a full example for its engine. `corepack pnpm test:docs-examples` runs every one against the real engines through nf-cli, and checks that each op it uses is in `ENGINE_OPS.md` and the package source.

## Rebrand contract

A brand sets three keys per scheme in `brand.theme.json`: `accent`, `ink` and `soft`. Together they feed `--color-primary`, `--color-accent`, `--color-focus`, `--color-on-primary` and `--color-primary-tint`. That is 6 values.

```json
{
  "dark": { "accent": "#66B9FF", "ink": "#081D2F", "soft": "#173C59" },
  "light": { "accent": "#086CB8", "ink": "#FFFFFF", "soft": "#D6EAFB" },
  "defaultDensity": "standard"
}
```

Install `brand-theme` for the schema and the checker. `brandThemeProblems(file)` returns the locked keys it finds, colours that are not six hex digits and a `defaultDensity` outside `compact`, `standard`, `comfortable`. `checkBrandTheme(file)` always returns six entries and never throws: it measures `ink` on `accent` (4.5:1), `accent` as a focus ring on the raised surface (3:1) and `text` on `soft` (4.5:1), and an incomplete file gives entries with `pass: false`, `ratio: null` and a `problem`.

A brand reaches the UI through two channels. Apply both.

| Channel | Call | Reaches | Does not reach |
|---|---|---|---|
| CSS variables | `brandCssVariables(theme, scheme)` on a `[data-brand]` block, `:root` or a `TokenScope` | NYC-Tron controls (Button, TabBar, SegmentedControl, Select, Banner) and Tailwind utilities reading `--color-primary`, `--color-accent`, `--color-focus`, `--color-on-primary`, `--color-primary-tint` | Colours Forge reads in JavaScript |
| JS overrides | `brandThemeOverrides(theme, scheme)` as `themeOverrides` on `ForgeWorkspace` | Workspace header, rail label, studio glyphs and the soft chip behind them | The CSS variables |

`PersonaTurret` (reads `colors.accent`) and `PersonaComposer` (reads `colors.accent` and `colors.soft`) take their own `colors` prop, which `ForgeWorkspace` does not fill, so pass the same overrides there. `PrismEditor`, `QuillTextEditor`, `ForgeDocumentStage` and the default `ForgeIcon` palette are reached by neither channel today. Installing `brand-theme` and applying only the CSS variables recolours the controls and leaves the workspace header, glyphs and turret on the old accent. The file is separate from `tooling/brand/brand.schema.json`, which stays closed and feeds the Expo plugin (decision 24).

Deferred: the six neutral keys (`base`, `raised`, `deep`, `line`, `text`, `muted`) wait for an owner-supplied contrast check (decision 23). Struck: any radius override, because chrome keeps 4 px. Locked: status colours, `paper*`, every scale and hit target.

## Token rules

- Use the CSS variables from `studio-theme`, for example `--color-surface-raised`, not a hex value. `docs/agent-native/tokens.map.json` lists 234 proposed tokens with their dark and light values.
- Every token carries the exact value of the literal it replaces, so tokenizing changes no pixel. Spacing keys are unit multiples (`space.2`, `space.1.5`), the same numbering as Tailwind.
- Colour drift stays as separate tokens: icon accent `#6859E8` against workspace accent `#6950D1`, Prism blue against the launcher purple, stage paper `#F7F5ED` against `#FFFEFC`. Unifying them changes pixels and is the owner's call (decisions 5, 20, 26, 27).
- Do not add a hex literal, a numeric style literal, a numeric JSX size prop, a Tailwind arbitrary value or a `fs(x + n)` offset to a file under `packages/`. `tooling/codemod/check-no-hardcoded.mjs` enforces exactly that list (its header is the definition). It is not a claim that no number remains: SVG geometry, data arrays, native Kotlin and Swift, `apps/` and tests are out of its scope, and 85 findings in 59 lines are allowlisted in `tooling/codemod/allowlist.json`, each with a reason.
- Registry files are generated. Import specifiers are rewritten only in `r/*.json` (decision 39). The repo source keeps `@nyc-tron/ui/components/...` imports.

## Accessibility status

Values are `reviewed-pass`, `reviewed-fail` and `unverified`. Nothing was rendered, so no item is `verified`. Of the 17 admitted items, 6 are reviewed-pass, 10 are reviewed-fail and 1 (`nyc-tron-host`) is unverified. The failures are listed per item in `meta.a11yFailures` and in each page's A11y section. Examples: light muted text on base at 4.43:1 in `forge-workspace`; a ghost label at 1.11:1 in `prism-canvas`; status changes only colour in `forge-icon`.

## Icons

`forge-icon` ships 47 drawn glyphs. 42 of the 1,463 catalog ids resolve to one, and 6 drawn glyphs are not catalog ids. A name with no glyph renders nothing. Never describe the catalog as 1,463 available icons.

## Not in the registry, and why

- Four binding adapters (`quill-office-binding`, `tally-sheet-binding`, `splice-timeline-binding`, `prism-canvas-binding`): each imports its engine facade, which a registry add cannot install (decision 30).
- Twelve engines (prism, cadence, splice, folio, pitch, tally, quill, photo, motion, design, draft, scene): they need the Rust binary through ignition. They are version 0.1.0 in the monorepo, and no tag, release or tarball has been cut (decision 3).
- `ignition`: shadcn cannot run nitrogen, pod install or CMake (decision 4).
- `studio-layout` and `editor-controls`: private workspace packages with no tarball.

`registry-excluded.json` holds each reason and the condition for returning. Engine and foundation pages are in `docs/engines/`.

## Rebuild after a source change

```bash
node tooling/registry/build.mjs
node tooling/registry/check-imports.mjs
node tooling/registry/validate-registry.mjs
node tooling/docs/build-docs.mjs
node tooling/docs/check-docs.mjs
corepack pnpm test:docs-examples
```

`build.mjs` runs `shadcn build` through `npx` unless `SHADCN_BIN` points at a local shadcn 4.23.0 binary. Never edit `r/`, `registry.json`, `docs/components/`, `docs/engines/`, `llms.txt` or `packages/ignition/skills/` by hand. CI fails when a rebuild changes them.

## Where to read more

- `llms.txt` for the page index and `llms-full.txt` for all pages in one file.
- `docs/components/<item>.md` for props, states, accessibility and examples.
- `docs/engines/<package>.md` for each engine, ignition, studio-layout and editor-controls.
- `docs/ENGINE_OPS.md` for op names and payloads.
- `docs/agent-native/install-order.md` and `docs/agent-native/02-design-system.md`.

This file is the source. `build-docs.mjs` copies it to `packages/ignition/skills/nitro-forge/SKILL.md`, and `skills.sh.json` points at that folder, so `npx skills add mikevocalz/nitro-forge --skill nitro-forge` installs it.
