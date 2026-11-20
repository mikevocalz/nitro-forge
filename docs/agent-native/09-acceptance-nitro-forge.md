# Acceptance run: Nitro Forge

Date: 2026-11-20. One run per condition. The numbers are single measurements and noisy.

## Task given to both agents

Build a studio workspace screen: mount the required UI provider, show a toolbar with the library's icon button, a document stage area, and apply a brand accent colour override, using only library components and theming conventions.

## Conditions

| | Before | After |
|---|---|---|
| Information | A plain checkout of `master` before this branch: README, AGENTS.md, docs/, packages/. | An empty app, `llms.txt` (Forge and NYC-Tron), and the shadcn CLI against both built registries. |
| Installs | None. | One `shadcn add` of 6 items (studio-ui-provider, nyc-tron-host, forge-icon-button, forge-document-stage, brand-theme, studio-theme). Wrote 58 files, with NYC-Tron dependencies resolved across namespaces. |

Method: fresh subagents; figures come from the harness's per-agent usage report. "Total tokens" includes the system prompt and all tool results read.

## Measured

| | Before | After | Change |
|---|---|---|---|
| Total subagent tokens | 176,792 | 171,628 | -2.9% |
| Tool calls | 17 | 14 | -3 |
| Wall time | 115 s | 106 s | -9 s |

## What the numbers do not show

- The token difference is inside noise. Do not read it as a saving.
- Before: no documented consumer install exists. The agent concluded the practical route is to place the app under `apps/` in the monorepo. It also found `OWN_UI_INTEGRATION.md` saying alpha.3 while `tooling/nyc-tron.json` says rc.2, and used one literal hex pair for the brand accent.
- After: installed through the registry, wrote no raw colours (accent comes from the shipped `brand.theme.json` via `brandThemeOverrides`), and verified props from the docs. Independently re-checked: 58 installed files, 6 of 6 local `@/components/forge/*` imports resolve, no raw colours or numbers in the screen.
- Prerequisites the registry cannot install, as the after agent reported them: the `@nyc-tron/expo-controls` GitHub tarball, an unreleased `@nitro-forge/studio-layout` (so `forge-workspace` was skipped), Uniwind or Tailwind plus theme CSS in `global.css`, and `resolveJsonModule`. These are the intended boundary of what a file-copy registry can do, and the docs list them.

## Limits of this test

Same as the NYC-Tron run: localhost-served registries and `llms.txt` (URLs rewritten), CLI instead of MCP, shimmed npm, nothing type-checked or rendered. Transcript parsed after the run: 14 tool calls, 0 touching library checkouts or audit files.

## Artefacts

`acceptance-forge/`: `before-StudioScreen.tsx`, `before-INSTALL.md`, `after-StudioScreen.tsx`, `after-INSTALL.md`.
