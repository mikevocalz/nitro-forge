---
name: "StudioTheme"
namespace: "@nitro-forge"
subpath: "@/components/forge/theme"
tier: 1
docs: "handwritten"
platforms: ["ios", "android", "web"]
category: "primitive"
tokens: ["--color-accent", "--color-border", "--color-danger", "--color-focus", "--color-info", "--color-on-danger", "--color-on-primary", "--color-paper", "--color-paper-text", "--color-paper-text-muted", "--color-primary", "--color-primary-tint", "--color-success", "--color-surface-base", "--color-surface-raised", "--color-surface-sunken", "--color-text", "--color-text-muted", "--font-editorial", "--font-mono-plain", "--radius-card", "--radius-control", "--radius-md", "--spacing-canvas", "--spacing-canvas-header", "--spacing-canvas-rail", "--spacing-canvas-toolbar", "--spacing-element", "--spacing-group", "--spacing-header", "--spacing-inset", "--spacing-page", "--spacing-rail", "--spacing-section", "--spacing-stack", "--spacing-status", "--spacing-target", "--spacing-toolbar", "--text-body", "--text-display", "--text-label", "--text-manuscript", "--text-micro", "--text-title"]
registryDependencies: []
a11yStatus: "reviewed-fail"
---

# StudioTheme

## Purpose

**Prerequisite.** No StudioUIProvider is needed.

The token source and its two generated stylesheets. `theme.ts` defines `workspaceThemes` (dark, light; 13 colour keys), `workspaceScale`, three densities, `workspaceStatus` and the Prism override `prismThemes`. `build-theme.mjs` writes `theme.css` (Tailwind v4 `@theme`) and `theme.native.css` (Uniwind variants). Tokens, not a component.

## Install

- Package: `@nitro-forge/studio-theme` (registry item)
- Import: `import { workspaceThemes, workspaceScale, resolveWorkspaceScale } from '@/components/forge/theme';`
- Peers: none at runtime
- Requires: Generator step: `pnpm --filter @nitro-forge/studio-workspace build:theme` (needs a Node with type stripping; root requires >=24.3.0)
- Command: `npx shadcn@4.23.0 add @nitro-forge/studio-theme`
- Installs: none (the CLI adds them when they are absent)
- Files: `components/forge/theme.ts`, `components/forge/theme.css`, `components/forge/theme.native.css`

## Props

| Name | Type | Default | Required | Description |
|---|---|---|---|---|
| `workspaceThemes` | `{dark, light}` x 13 keys |  |  | base raised deep line text muted accent ink soft paper paperInk paperMuted error. |
| `workspaceScale` | space, radius, type, font, size |  |  |  |
| `resolveWorkspaceScale(density)` | `WorkspaceDensityScale` | `"standard"` | no | Throws `RangeError` on an unknown density. |
| `workspaceStatus` | `{dark, light}` info, success, onError |  |  |  |
| `prismThemes` | canvas studio override |  |  | Replaces 9 keys. |

## Variants

### scheme

| Value | Effect |
|---|---|
| dark, light | Web: `[data-theme="light"]` block and `.dark` block (the NightScope class). Native: `@variant light` and `@variant dark`. |

### density

| Value | Effect |
|---|---|
| compact, standard, comfortable | Changes `space` and `size` only; never `type` or `radius`. |

## States

none in code.

### Motion

No motion tokens exist in `theme.ts`. tokens.map.json proposes 36 motion tokens from icons, interaction policy and turret constants.

## A11y

- Not applicable. Contrast pairs for the Workbench chrome are checked in `forge-directions.test.ts` (not run here, UNVERIFIED).
- Review status: reviewed-fail, reviewed, failures found in the source read. Nothing was rendered, so no item is verified (decision 34).
- Failing: N01 1.4.3: light muted 4.43:1 on base, 4.01:1 on deep (theme.ts:7)
- Failing: N02 1.4.3: paperMuted 3.98:1 on paper (theme.ts:6-7)
- Failing: N06 1.4.11: --color-border 1.2 to 1.54:1 where it is the only edge (theme.ts:6-7)

## Example

```tsx example=studio-theme
import { resolveWorkspaceScale } from '@/components/forge/theme';

export const gap = resolveWorkspaceScale('comfortable').space.group;
```

## Do/Don't

### Do

- Regenerate CSS with `build:theme` after editing `theme.ts`.
- Rebrand with the three accent keys (`accent`, `ink`, `soft`) per scheme only (decision 23).

### Don't

- Do not unify the icon accent `#6859E8` with `#6950D1`; that changes pixels (decisions 5, 20).
- Do not hand-edit `theme.css`; the header says it is generated.

### Notes

- Defines rather than reads. The generated CSS declares 32 custom properties today. tokens.map.json proposes 234 tokens in 19 tiers (instrument 53, motion 36, stage-colour 20, semantic-colour 18, size 15, space 14, chrome 14, type 12, icon-colour 9, icon-size 7, fixed-literal 7, layer 6, shadow 5, radius 4, document-colour 4, lab 4, icon-stroke 2, opacity 2, border 2); status counts: new-value-preserving 185, existing-ts-new-css 21, existing-nyc-tron 15, new-forge-extension 5, reserved-value-undefined-in-repo 4, existing-css-renamed 2, existing-css-keep (AGENTS.md rounded-sm 4px) 1, existing-ts-new-css (value equals title) 1. The `tokens` array in the front matter lists only the semantic roles `theme.ts` feeds.
