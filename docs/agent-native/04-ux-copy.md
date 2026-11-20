# Agent-native phase 1.4: UX copy for the Nitro Forge registry

Status: copy written from `03-design-handoff.md`, `install-order.md`, `01-user-research.md`, decisions 1-4 and 28-32, and `packages/studio-workspace/src/ui.tsx`. Nothing was built, installed or run against the real `shadcn` CLI. The retrieval numbers come from a BM25 proxy, not from `shadcn search`.

The reader is an LLM agent. It runs `shadcn search @nitro-forge <query>` and sees only `title` and `description`. A description therefore has to carry two facts: what studio concern the item covers (chrome, provider, theme, icon, persona, policy) and what must exist first. The component throws without the provider, so an agent that never reads the description finds out at first render.

Machine-readable copy is in `copy.json` (17 items). Queries are in `retrieval-queries.json`. The check is `node docs/agent-native/retrieval-eval.mjs`.

## 1. Titles and descriptions (17 admitted items)

Rules used: 140 characters at most, facts only, no adjectives that cannot be checked, concern named first as a prefix word (`Workspace chrome`, `Provider`, `Theme`, `Icon`, `Persona`, `Helpers, not UI`), prerequisites last. `studio-layout` and `@nitro-forge/ignition` are not registry items (decisions 3 and 4), so the description names them and `install-order.md` holds the commands.

| Item | Title | Description | Chars |
|---|---|---|---|
| forge-workspace | Forge Workspace | Workspace chrome: header, undo/redo toolbar, docks, floating panels, status line. Needs StudioUIProvider, @nyc-tron controls, studio-layout. | 140 |
| forge-document-stage | Forge Document Stage | Workspace chrome: read-only stage of live engine state (text, cells, slides, tracks, shapes). Needs StudioUIProvider and studio-layout. | 135 |
| quill-text-editor | Quill Text Editor | Writing surface: draft applied as one edit, conflict on outside change. Needs StudioUIProvider and a Quill document with apply and reload. | 138 |
| prism-editor | Prism Editor | Vector canvas editor: shape tools, layers panel, transforms, personas. Needs @nitro-forge/ignition first, StudioUIProvider, @nyc-tron. | 134 |
| prism-canvas | Prism Canvas | Artboard: transparency checker, selection outline, one-finger drag to move bounds. Needs StudioUIProvider and studio-gesture. | 125 |
| studio-gesture | Studio Gesture | Gesture primitive: one-finger pan recognizer, PanResponder on web, Gesture Handler on native. No provider needed. | 113 |
| persona-turret | Persona Turret | Persona switcher dial with four stops. Drag or arrows preview, Enter commits. Needs StudioUIProvider, studio-theme, forge-directions. | 133 |
| persona-composer | Persona Composer | Persona form: name it, order instruments, pick capabilities, save, export, import. Needs StudioUIProvider and a PersonaStore. | 125 |
| persona-model | Persona Model | Persona data, not UI: 4 personas, 11 capabilities, 7 surfaces, compose, import, export, per-document store. No provider needed. | 127 |
| instrument-system | Instrument System | Instrument policy, not UI: 18 blueprints, precision scrubbing math, ruler ticks, motion budgets, overlay planner. No provider needed. | 133 |
| workspace-utilities | Workspace Utilities | Helpers, not UI: APP_MANIFESTS (task line, glyph, category per studio), jsonProblem (JSON parse error as a sentence). Needs studio-layout. | 138 |
| studio-ui-provider | Studio UI Provider | Provider: StudioUIProvider supplies the 27 UI slots. Every studio component throws without it. Fill the slots with nyc-tron-host. | 129 |
| nyc-tron-host | NYC-Tron Host | Provider adapter: nycTronStudioUI() maps @nyc-tron controls onto the StudioUIProvider slots. Needs the @nyc-tron tarballs installed. | 132 |
| studio-theme | Studio Theme | Theme: dark and light tokens, densities, generated theme.css (Tailwind v4) and theme.native.css (Uniwind). build:theme regenerates both. | 136 |
| forge-directions | Forge Directions | Theme: workbench, optics and atelier palettes for Prism chrome and the persona turret, plus WCAG contrast helpers. Needs studio-theme. | 134 |
| forge-icon | Forge Icon | Icon: outline when idle, filled when selected. 47 glyphs drawn of 1,463 reserved ids; others render nothing. Needs react-native-svg. | 132 |
| forge-icon-button | Forge Icon Button | Icon: pressable ForgeIcon with a 44 by 44 hit target. Throws TypeError on a blank label. Needs forge-icon and react-native-svg. | 127 |

`retrieval-eval.mjs` prints `OVER 140` and exits non-zero if any description exceeds 140.

Decisions behind the wording:

- **Coverage numbers stay honest.** `forge-icon` says 47 drawn of 1,463 reserved. The handoff says not to advertise 1,463 as available.
- **No platform claims.** The handoff's `platforms` front matter is unreliable (`quill-text-editor` lists only `android` because of one font branch; `prism-canvas` lists `web` but runs on native through `studio-gesture`). The descriptions say nothing about platform except where the code does (`studio-gesture`).
- **Non-visual items say so.** `persona-model`, `instrument-system` and `workspace-utilities` start with "not UI" so an agent searching for a component does not install them by mistake.
- **`prism-editor` carries the ignition prerequisite** (decision 31). `install-order.md` steps 0 and 1 hold the command.
- **`workspace-utilities` needs `studio-layout`** for the `Studio` type (`03-design-handoff.md` line 1116). `forge-workspace` and `forge-document-stage` need it for the dock model and `Studio` type.

## 2. Copy for `llms.txt` (not registry items)

These do not appear in `shadcn search`. They are for `llms.txt` and the docs served from raw.githubusercontent.com (decision 28).

**Four deferred binding adapters** (`quill-office-binding`, `tally-sheet-binding`, `splice-timeline-binding`, `prism-canvas-binding`). Each is a view-model that connects an NYC-Tron control cluster to a Nitro Forge engine: Quill to the rich text ribbon, Tally to sheet tabs and the grid, Splice to timeline controls, Prism to alignment, paint and boolean operations. They are not installable with `shadcn add`. Each imports its engine facade (`@nitro-forge/quill`, `tally`, `splice`, `prism`), which needs the Rust engine through `@nitro-forge/ignition`, and Forge ships those packages as GitHub release tarballs at version 0.0.0, not through the registry (decisions 3 and 30). A registry copy would leave an unresolved import. They return when the tarball versioning scheme is decided.

**Eight engine packages** (`cadence`, `folio`, `pitch`, `prism`, `quill`, `splice`, `tally`, `studio-layout`). Each is a TypeScript facade over a Rust engine, built on the native host `@nitro-forge/ignition`: audio (cadence), PDF documents (folio), slides (pitch), vector graphics (prism), text (quill), video (splice) and spreadsheets (tally). `studio-layout` is the exception, pure TypeScript with the dock model and the `Studio` type. None is in the registry. They ship through GitHub release tarballs, and no tag or release exists yet, so a project outside the Forge monorepo cannot install them today. `install-order.md` lists the steps for a project inside it. The one-line purposes for cadence, folio, pitch and splice come from decision 3 and the example app and are UNVERIFIED against each package's README, which was not read for this pass.

Also for `llms.txt`: `@nitro-forge/ignition` is a prerequisite install (four C++ HybridObjects, podspec, CMake, Nitrogen output). A registry add cannot run Nitrogen, `pod install` or CMake (decision 4).

## 3. Retrieval check

`retrieval-queries.json` holds 25 queries written before the copy and not edited after the first run: 20 with an expected item, 5 with none. The script is dependency-free BM25 over title and description, with the same tokenizer for both. "Before" is the first sentence of each item's Purpose in the handoff, with the item id as title.

| | recall@3 | recall@5 | Prerequisites stated (14 checks) |
|---|---|---|---|
| Before | 95.0% | 95.0% | 1 of 14 |
| After | 100.0% | 100.0% | 14 of 14 |

The retrieval gain is one query. The corpus is 17 items with distinct concerns, so most queries were answerable from the handoff text alone. The real gain is the prerequisite check, which looks for `StudioUIProvider`, `studio-layout`, `ignition`, `@nyc-tron`, `react-native-svg` and `forge-icon` in the text the agent sees. The only miss before was q17 ("turn a JSON parse error into a readable sentence"), because the first sentence of `workspace-utilities` omitted `jsonProblem`. Words in the descriptions that match the queries are the item's actual function words (`jsonProblem`, `pan recognizer`, `WCAG`), not words added to match a query.

BM25 is a proxy. `shadcn search` does its own matching, and an agent may use embeddings. A high score here shows the words are present, not that another engine ranks them.

### Queries that cannot honestly be satisfied

| ID | Query | Reason | Top false lead |
|---|---|---|---|
| q21 | spreadsheet grid with formulas | `tally-sheet-binding` is deferred (decision 30) | none |
| q22 | video timeline editor with clips | `splice-timeline-binding` is deferred | prism-editor, quill-text-editor (weak) |
| q23 | install the rust engine native module | `ignition` is a prerequisite install, not an item (decision 4) | forge-document-stage (weak) |
| q24 | primary button with loading spinner | Button lives in `@nyc-tron` (decision 1) | forge-icon-button |
| q25 | date picker | no such component in the admitted set | none |

Two of these (q23, q24) return a false lead. The corrective is `llms.txt` plus the errors in section 4, not stuffing the descriptions with "timeline" or "button". An agent that searches `@nitro-forge` for a Button should be told in `llms.txt`: controls live in `@nyc-tron`.

## 4. CLI and error copy

Each message: what happened, what to do, the command. Two lines. These are proposed wording for the registry docs, `llms.txt` and any wrapper CLI. The `shadcn` CLI's own errors are not ours to change, and no source file below is edited.

**Provider not mounted.** Source today (`packages/studio-workspace/src/ui.tsx`, line 108):

```
Studio requires StudioUIProvider with your application UI components. No substitute UI is installed.
```

It names the cause and says no fallback exists, but it gives no fix and no command. Proposed:

```
A studio component rendered outside StudioUIProvider. There is no fallback UI.
Wrap your root layout in <StudioUIProvider components={nycTronStudioUI({...})}>; npx shadcn@latest add @nitro-forge/nyc-tron-host
```

**@nyc-tron missing.**

```
nyc-tron-host imports @nyc-tron/ui, which is a GitHub release tarball and not on npm.
Add the pinned URL from tooling/nyc-tron.json: pnpm add https://github.com/mikevocalz/NYC-Tron-UI/releases/download/v1.0.0-rc.2/nyc-tron-ui-1.0.0-rc.2.tgz
```

The URL pattern is from `install-order.md` step 5. The `pnpm add` form with a bare URL is UNVERIFIED on this machine.

**ignition missing.**

```
prism-editor imports @nitro-forge/ignition, a native module that shadcn cannot copy. No tarball or release exists yet outside the Forge monorepo.
Inside the monorepo: pnpm --filter @nitro-forge/ignition codegen, then bash packages/ignition/scripts/build-apple.sh (steps 0-1 of install-order.md).
```

**Wrong namespace.**

```
@nitro-forge/Button not found. Controls (Button, Card, Toolbar) live in @nyc-tron; @nitro-forge holds studio chrome, providers, theme and icons.
Run: npx shadcn@latest add @nyc-tron/Button
```

Reverse case: `@nyc-tron/forge-workspace not found. Studio chrome lives in @nitro-forge. Run: npx shadcn@latest add @nitro-forge/forge-workspace`.

**Unsupported platform.**

```
@nitro-forge/ignition needs iOS 16 or newer and Android minSdkVersion 29 (the example app's value; the Android script builds API 24).
Raise both in app.json through expo-build-properties, then rerun the native build.
```

The iOS floor is from `Package.swift` and `IPHONEOS_DEPLOYMENT_TARGET=16.0`. Whether a lower Android API works is UNVERIFIED. Intel iOS simulators are also unsettled: the script builds an x86_64 slice and the integration doc says it does not.

Not yet written, no source to base them on: a message for a missing `react-native-svg` patch, and for a pnpm or Node version below the pin (Node >=24.3.0, pnpm 12.18.0).
