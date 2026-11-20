# Agent-native phase 1.1: who consumes the suite, and what it costs them

Status: desk research on the repo at branch `agent-native-20261119`. No interviews, no surveys, no recorded agent sessions. Every statement below comes from a file in this repo or from the two audits behind it, and each estimate says so. Section 5 lists what this document cannot tell you.

## 0. Method and limits

- Token figures are estimates: file bytes divided by 4 (`wc -c` on the clone, 2026-11-19). Code and tables usually tokenize worse than prose, so treat the figures as lower bounds. No tokenizer was run.
- "Steps an agent takes today" are reconstructed from repo structure: which file points to which, and what is missing. They are not observations of real sessions.
- Task ranking is a judgment about likely frequency and cost. It is not telemetry.
- Section ranges for `docs/ENGINE_OPS.md` (2,437 lines, 462,350 bytes) are estimated by line share of the file.
- Audit sources: `audit/forge-a.md` (cadence, folio, icons, ignition, pitch, root) and `audit/forge-b.md` (prism, quill, splice, tally, studio-layout, studio-workspace, apps). Where this document re-measured something, it says so.

## 1. Who consumes the suite

### 1.1 Human developer building a studio

Situation: has the monorepo or tarballs, wants a Prism/Quill/Tally-style app on iOS, Android or web. Works from `README.md`, `AGENTS.md` and the packages.

What the repo gives them:
- A root README that lists seven products and a layout section that predates most packages (section 3.1).
- `AGENTS.md` (contributor rules, commands, NYC-Tron ownership rule) and `docs/ARCHITECTURE.md`.
- One working reference app, `apps/example` (Expo 58, RN 0.88.1), and a web harness, `apps/studio-preview` (Vite plus react-native-web).
- No registry, no `components.json`, no `llms.txt`, no `SKILL.md`, no stories, no per-component pages (audit A section 7, audit B section 6).

Constraints they hit: distribution is GitHub release tarballs at version `0.0.0`, not npm (`compatibility.v1.json`, `distribution: github-release-tarballs`). `studio-layout` and `studio-workspace` are `private: true`.

### 1.2 LLM agents (Claude Code, Cursor, Codex)

Situation: dropped into the repo or a consuming app with a one-line request ("add a Tally studio", "make the toolbar match our brand"). No memory of earlier sessions. Cost is context tokens and round trips, and the failure mode is a confident wrong answer.

What differs from the human:
- Reads files whole. The two largest docs, `docs/ENGINE_OPS.md` and `docs/ROSTER.md`, are about 115.6k and 59.1k estimated tokens, so reading either whole is a bad default.
- Cannot ask "which of these three docs is current?". It needs one entry point that says.
- Obeys `AGENTS.md` if it finds it. Cursor, Codex and Claude Code all look for an agents file at the repo root, so the existing file is the one reliably loaded surface (this is a convention claim from common tool behavior, not verified against current versions; see gap G5).
- Hits runtime-only contracts hardest. A human sees the red screen and reads the message. An agent has to infer the cause from a stack trace.

Agent-specific rules already in the repo that the registry must respect (`AGENTS.md`): NYC-Tron UI is the single owner of reusable controls; never claim verification that was not run; op names live in `docs/ENGINE_OPS.md`; apply no-ai-slop to docs.

### 1.3 Rebranding persona

Situation: a company or internal team ships one of the studios under its own name and look. Today's mechanism is `apps/example/brands/*.json`, validated by `tooling/brand/brand.schema.json` and applied by the Expo plugin `tooling/brand/plugin.cjs`.

What the mechanism covers, from `apps/example/brands/folio.json` and the schema: `id`, `productName`, `shortName`, `engine`, `slug`, `scheme`, `ios.bundleIdentifier`, `android.package`, and five icon paths. The schema description says a rebrand leaves `engine` and `icons` alone. There are 8 brand files: cadence, folio, pitch, prism, quill, splice, suite, tally.

What it does not cover: colour, radius, type, density. Those live in `packages/studio-workspace/src/theme.ts` and `forge-directions.ts`, and only Prism has its own palette (`prismThemes`). The per-studio accent hex values exist only in `tooling/brand/icon-family.mjs` (launcher icons), not in the app theme. A rebrander who wants "our purple" has no single file to edit and no JSON field to set (audit A section 3, audit B section 3).

The suite is also the persona's constraint: `docs/ux/FORGE_2046_DESIGN_SYSTEM.md` says to configure semantic tokens in Studio and never hard-code a different visual foundation per app. The persona needs to change brand without breaking cohesion.

Who rebrands is unknown (internal team, licensee, community). See gap G3.

## 2. Top 10 tasks, ranked

Ranking logic: tasks every consumer does first rank highest, then tasks that touch the most files. Token figures are bytes/4 over the files named; "whole" figures assume the agent reads the file in full.

| # | Task | Who | Est. tokens to read |
|---|---|---|---|
| 1 | Orient: what is in this repo, what exists | agent, human | about 5.2k, partly wrong |
| 2 | Wire a studio into an app (install and mount) | agent, human | about 15.0k, order not stated anywhere |
| 3 | Call or extend an engine op | agent, human | about 15.1k with section reads; about 130.7k if ENGINE_OPS read whole |
| 4 | Bind an engine to an NYC-Tron component cluster | agent, human | about 12.6k |
| 5 | Rebrand a studio | rebrander, agent | about 13.2k |
| 6 | Add or change a studio UI piece without hard-coding values | agent, human | about 11.7k |
| 7 | Use an icon | agent, human | about 2.8k, or 9.6k if catalog and glyphs are read |
| 8 | Supply or swap the UI host (`StudioUIProvider`) | agent, human | about 4.3k plus unmeasured option files |
| 9 | Verify a change and report what is verified | agent | about 59.1k if `ROSTER.md` read whole |
| 10 | Add an import or export format | agent, human | about 4.4k |

### Task 1: Orient

Steps today: read `README.md`, then `AGENTS.md`, then `docs/ARCHITECTURE.md`, then list `packages/`.
Files: `README.md` (2,296 B, 574 tokens), `AGENTS.md` (3,678 B, 920), `docs/ARCHITECTURE.md` (14,741 B, 3,685). Total about 5.2k.
Problem: README and AGENTS both say seven products. `ENGINE_KINDS` in `packages/ignition/src/types.ts` lists 12 (prism, cadence, splice, folio, pitch, tally, quill, photo, motion, design, draft, scene), `STUDIOS` in `packages/studio-layout/src/index.ts` lists 11, and `packages/` holds 24 directories. An agent that trusts the README plans for 7.

### Task 2: Wire a studio into an app

Steps today: no document gives them. An agent reconstructs them from `package.json` files, `apps/studio-preview`, and `apps/example`. The order the code requires (audit B section 5):
1. `@nitro-forge/ignition` (host, native module, nitrogen output)
2. the engine package (for example `@nitro-forge/tally`)
3. `@nitro-forge/studio-layout`
4. `@nitro-forge/icons`
5. the `@nyc-tron/*` release tarballs pinned in `tooling/nyc-tron.json` (GitHub releases, not npm)
6. studio-workspace theme CSS (`theme.css` for web, `theme.native.css` for Uniwind)
7. `StudioUIProvider` with `nycTronStudioUI(host)`, then the components

Files: `AGENTS.md` 920, `README.md` 574, `packages/studio-workspace/README.md` (3,708 B, 927), `ui.tsx` (12,175 B, 3,044), `nyc-tron-host.tsx` (4,821 B, 1,205), `theme.ts` (4,061 B, 1,015), `index.tsx` (26,793 B, 6,698), `tooling/nyc-tron.json` (2,562 B, 641). Total about 15.0k, a floor: it leaves out ignition's native setup and the example app's `package.json`.
Problem: seven ordered steps, none documented as a sequence. Skipping step 7 fails at first render (section 3.4).

### Task 3: Call or extend an engine op

Steps today: read the engine's `src/index.ts` (typed `OPS` table and document class), then the engine's section of `docs/ENGINE_OPS.md`, which `AGENTS.md` names as authoritative, then the Rust crate.
Files for folio: `packages/folio/src/index.ts` (31,552 B, 7,888 tokens), `office-cluster.ts` (12,103 B, 3,026), the folio section of ENGINE_OPS (lines 1507-1575, about 3.3k estimated by line share), `AGENTS.md` 920. About 15.1k. An agent that reads ENGINE_OPS whole adds about 115.6k.
Problem: no per-engine README (section 3.2). The seven engine entry files together are 236,620 B, about 59.2k tokens.

### Task 4: Bind an engine to an NYC-Tron cluster

Steps today: read the engine's cluster adapter, find which `@nyc-tron/ui` component it feeds, check the contract file.
Files for cadence: `src/index.ts` 4,967 tokens, `mixer-cluster.ts` (9,579 B, 2,395), `editor-adapter.ts` (9,004 B, 2,251), `instrument-adapter.ts` (3,407 B, 852), plus `nyc-tron-host.tsx` 1,205 and `AGENTS.md` 920. About 12.6k, excluding `contracts/audio-cluster.ts` (not measured).
Problem: the adapters return props and callbacks for components that live in another repo. The component list for each adapter is in comments and in `contracts/*.ts`, not in a doc. The `AGENTS.md` rule ("Never recreate the knob, graph, crop overlay...") is the only guard against an agent copying a control into Forge.

### Task 5: Rebrand a studio

Steps today: copy a brand JSON, edit names and identifiers, swap icon art, run `tooling/brand/rebrand-check.mjs`. For colour: edit `theme.ts`, regenerate CSS with `build-theme.mjs`, optionally edit `forge-directions.ts`.
Files: brand JSON 176, schema 543, `brand.cjs` 1,338, `plugin.cjs` 859, `rebrand-check.mjs` 3,034, `theme.ts` 1,015, `theme.css` 682, `forge-directions.ts` (15,167 B, 3,792), `icon-family.mjs` 1,746. About 13.2k.
Problem: the JSON schema is `additionalProperties: false` and has no colour fields (audit A section 3), so an agent asked to "set the brand colour" has to choose between three unconnected places: `theme.ts`, `forge-directions.ts` (149 hex literals), and `icons/src/tokens.js`.

### Task 6: Add or change a UI piece without hard-coding values

Steps today: read the theme, find the scale, write styles. No typed layout primitives exist (no Stack, Spacer, Divider, text variants; audit B section 8), so the agent writes `fontSize` and `padding` numbers by hand.
Files: `ui.tsx` 3,044, `theme.ts` 1,015, `theme.css` 682, `forge-directions.ts` 3,792, `stage.tsx` (12,738 B, 3,185). About 11.7k.
Evidence that this is where drift starts: audit B counts 387 hex and 251 numeric style literals in `packages/studio-workspace/src` (330 of the hex are in token files; about 57 are in component files), led by `stage.tsx` (42 hex, 68 numeric) and `prism-editor.tsx` (5 hex, 69 numeric). Counts are regex-based.

### Task 7: Use an icon

Steps today: read `packages/icons/README.md`, then `ForgeIcon.js`, then look up an id in `catalog.js`.
Files: README (3,452 B, 863), `ForgeIcon.js` (5,065 B, 1,266), `tokens.js` 202, `state.js` 449: about 2.8k. Adding `glyphs.js` (8,860 B, 2,215) and `catalog.js` (18,552 B, 4,638) brings it to about 9.6k.
Problem: the catalog lists 1,463 ids and 47 have artwork (3.2%). An agent that finds an id in the catalog will assume it renders. The README says the rest is design backlog, but an agent that skips the README does not learn that. Decision 8 in `decisions.md` requires registry text to say 47 drawn, 1,463 reserved.

### Task 8: Supply or swap the UI host

Steps today: read `StudioUIComponents` in `ui.tsx`, implement every slot, pass it to `StudioUIProvider`.
Files: `ui.tsx` 3,044, `nyc-tron-host.tsx` 1,205, plus `nyc-tron-options.ts` (not measured). About 4.3k plus.
Problem: 27 slots (24 required, 3 optional: `Popover`, `NativeDropdown`, `TokenScope`; counted from `ui.tsx` lines 69-101 in this pass). Only the TypeScript interface lists them. Note that `AGENTS.md` makes NYC-Tron the owner of the controls, so "swap" here means a different host mapping, not a Forge copy of the controls.

### Task 9: Verify a change and report it truthfully

Steps today: read the `AGENTS.md` command block (`cargo test --workspace`, `pnpm -r test`, `pnpm -r typecheck`), then `docs/ROSTER.md` to see what counts as verified and update it.
Files: `ROSTER.md` (236,448 B, about 59.1k whole).
Problem: the truthfulness rule points at a 59k-token ledger. The registry's CI gates (item has a page, no raw values under `packages/`) will need the same one-line pointer.

### Task 10: Add an import or export format

Steps today: copy the pattern from an engine's `transfer.ts`, then wire `transfer-ui.ts` in ignition.
Files: `cadence/src/transfer.ts` (2,713 B, 678), `ignition/src/transfer.ts` (6,534 B, 1,634), `transfer-ui.ts` (2,671 B, 668), `docs/OFFICE_CLUSTER_INTEGRATION.md` (5,664 B, 1,416). About 4.4k. Cheapest of the ten because the pattern repeats and the files are small.

## 3. Where agents waste tokens today

All counts in this section are bytes/4 estimates unless stated as a count.

### 3.1 Stale root README: 7 products listed, 12 engines exist

- `README.md` and `AGENTS.md` say seven. `ENGINE_KINDS` has 12; `STUDIOS` has 11; `packages/` has 24 directories.
- The README layout block names `rust/ignition-core`, `nf-cli`, `nf-sys`, `packages/ignition`, the seven original engines, `apps/console` and `apps/example`. It omits photo, motion, design, draft and scene (5 engine packages), plus icons, studio-layout, studio-workspace and 14 other packages.
- Cost: the README is 574 tokens, so reading it is cheap. The cost is the wrong plan built from it, which the agent finds out only after reading `packages/`.

### 3.2 No README in 11 of 24 packages

- The brief expected 5. A re-count in this pass (`ls packages/*/README.md`, 13 present) found 11 without one: cadence, folio, ignition, pitch, prism, quill, spatial-ink, splice, studio-layout, tally, telemetry. Audit A names cadence, folio, pitch, ignition; audit B names prism, quill, splice, tally, studio-layout; spatial-ink and telemetry are additions from this count.
- Seven of the eleven are the engines an agent most often needs. Without a README the entry point is the 10k to 56k-byte `src/index.ts` (cadence 4,967 tokens up to quill 14,082).
- No `AGENTS.md`, `llms.txt`, `SKILL.md` or `*.stories.*` exists anywhere outside node_modules (audit A section 7, audit B section 6; only the root `AGENTS.md`).

### 3.3 No per-component docs

- Zero component pages, zero props tables outside `.d.ts` and TS interfaces, zero accessibility notes outside the icons README (audit A section 6, audit B section 6).
- Tests are the nearest thing to usage examples (`nyc-tron-consumer.test.ts` in quill, splice, tally, folio, cadence, pitch). An agent has to read tests to learn usage, at unmeasured cost.
- Studio-workspace has about 14 exported components and hooks (ForgeWorkspace, ForgeDocumentStage, PrismEditor, PrismCanvas, QuillTextEditor, PersonaTurret, PersonaComposer, TurretPointer, TurretRim, StudioGesture and more; audit B section 1). The README is 927 tokens for all of them.

### 3.4 `StudioUIProvider`: 27 slots, throws without a provider

- `ui.tsx` throws `Studio requires StudioUIProvider with your application UI components. No substitute UI is installed.` on first use of any wrapper (line 108).
- There is no zero-dependency component to try first. Audit B section 5: every studio-workspace component needs the provider and the `nycTronStudioUI` host.
- Slot list is in one TypeScript interface (3,044 tokens for the whole file). An agent that builds a custom host has to count 24 required slots from the type.
- The failure appears at render time. Nothing in `README.md` or `AGENTS.md` names the provider as step zero (the studio-workspace README is 927 tokens; this pass did not re-read it for the provider rule).

### 3.5 Undocumented install order

- Seven steps (section 2, task 2), derived by audit B from `package.json` files. No file states them as a sequence.
- Step 5 is not an npm install: the `@nyc-tron/*` packages are release tarballs with sha256 pins in `tooling/nyc-tron.json`, and versions are `0.0.0`, so a registry-style install needs explicit instructions.
- Step 1 (ignition) includes native work (nitrogen, CMake, podspec `NitroForgeV1.podspec`, `Package.swift`). A source-copy registry item cannot perform it (decision 4 in `decisions.md`).

### 3.6 Large reference files with no index

| File | Bytes | Est. tokens | Section agents need |
|---|---|---|---|
| `docs/ENGINE_OPS.md` | 462,350 | 115,588 | one engine, about 70 to 250 lines |
| `docs/ROSTER.md` | 236,448 | 59,112 | one verification row |
| `docs/COMPONENT_MASTER_INVENTORY.md` | 57,880 | 14,470 | one component id |
| Seven engine `src/index.ts` files | 236,620 | 59,155 | one engine, 2,709 to 14,082 each |
| `packages/ignition/src/*.ts` (18 files) | 97,586 | 24,397 | one subsystem |

ENGINE_OPS has per-engine headings (`## folio-engine` at line 1507, `## cadence-engine` at 1273, and so on), so a range read works when the agent knows the heading. Nothing tells it to.

### 3.7 Three token sources that do not agree

- `packages/studio-workspace/src/theme.ts` (13 colour keys per scheme, scale), `packages/icons/src/tokens.js` (9 colours), `tooling/brand/icon-family.mjs` (per-studio accents), plus 149 hex literals in `forge-directions.ts`.
- Drift found by audit A: icon accent `#6859E8` vs studio-workspace light accent `#6950D1`; icon dark surface `#11131B` vs workspace `#15171D`. An agent asked to "use the accent" has no way to pick.
- Decision 5 defers unification (it would change pixels) and names each current value as its own token.

## 4. What this means for the registry (inputs, not decisions)

These follow from sections 2 and 3 and from `decisions.md`; they do not change it.
- Task 1 and task 2 get the largest gain from three files: a corrected root README, an `llms.txt` that lists packages and the install sequence, and a `SKILL.md` that starts with "mount `StudioUIProvider` first".
- Task 3 needs a per-engine page that links to the right ENGINE_OPS line range.
- Task 5 needs a documented answer to "where does colour live", ideally one token file the brand JSON can point at, with the schema extended in a reviewed change.
- Task 7 needs the 47 of 1,463 coverage statement beside the first line that mentions the catalog.
- Task 9 needs the verification rule restated in a short form that points at the right `ROSTER.md` row.

## 5. Research gaps

- G1. No real agent sessions were observed. The step lists and token totals are reconstructed. Next step: run Claude Code, Cursor and Codex against 3 to 5 of the tasks above in a clean clone, log files read and tokens used, and compare to section 2.
- G2. No human developer interviews or survey. The human persona is built from repo artefacts only. Unknown: who the first outside users are.
- G3. The rebrand persona is unvalidated: internal team, licensee or community is not known, and so is the amount of colour control they need. The only evidence is the brand schema and the example app.
- G4. Task frequency is a guess. The ranking has no usage data. Telemetry exists as a package (`packages/telemetry`) but this pass did not read it.
- G5. Which agent surfaces the registry should target first is untested: whether each tool reads `AGENTS.md`, `llms.txt`, or an installed skill, and in what order, needs checking against current tool documentation and against a real run.
- G6. The token estimate method (bytes/4) was not calibrated against a tokenizer. Code-heavy files are probably under-counted.
- G7. Things this pass did not read: `contracts/*.ts` sizes, `nyc-tron-options.ts`, `persona-*.tsx`, `apps/studio-preview/src/style.css`, the Rust crates, and `docs/ux/*` beyond the design-system file's size. Audit B notes the same limits for the import graph from studio-workspace to the engines.
- G8. Web and QNX/other host targets: `./web` in icons resolves to the same file as `./native`, and `docs/completion/components.json` lists many more platforms. Whether registry users need those is unknown.
- G9. Accessibility needs of the agent-authored UI were not studied; only the icons README and `forgeHitTarget` carry accessibility rules today.
