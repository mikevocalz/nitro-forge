---
name: "ForgeDirections"
namespace: "@nitro-forge"
subpath: "@/components/forge/forge-directions"
tier: 1
docs: "handwritten"
platforms: []
category: "forge"
tokens: ["--color-chrome-accent", "--color-chrome-body", "--color-chrome-chip-edge", "--color-chrome-chip-ring", "--color-chrome-disabled-ink", "--color-chrome-edge", "--color-chrome-muted", "--color-chrome-press", "--color-chrome-rule", "--color-chrome-selected", "--color-chrome-selected-muted", "--color-chrome-text", "--color-chrome-well", "--color-instrument-atelier-accent", "--color-instrument-atelier-accent-halo", "--color-instrument-atelier-bezel-0", "--color-instrument-atelier-bezel-1", "--color-instrument-atelier-face-0", "--color-instrument-atelier-face-1", "--color-instrument-atelier-face-text", "--color-instrument-atelier-knurl", "--color-instrument-atelier-lathe", "--color-instrument-atelier-muted", "--color-instrument-atelier-notch", "--color-instrument-atelier-panel", "--color-instrument-atelier-panel-edge", "--color-instrument-atelier-panel-solid", "--color-instrument-atelier-text", "--color-instrument-optics-accent", "--color-instrument-optics-accent-halo", "--color-instrument-optics-bezel-0", "--color-instrument-optics-bezel-1", "--color-instrument-optics-bezel-2", "--color-instrument-optics-bezel-3", "--color-instrument-optics-face-0", "--color-instrument-optics-face-1", "--color-instrument-optics-face-text", "--color-instrument-optics-knurl", "--color-instrument-optics-lathe", "--color-instrument-optics-muted", "--color-instrument-optics-notch", "--color-instrument-optics-panel", "--color-instrument-optics-panel-edge", "--color-instrument-optics-panel-solid", "--color-instrument-optics-text", "--color-instrument-workbench-accent", "--color-instrument-workbench-accent-halo", "--color-instrument-workbench-bezel-0", "--color-instrument-workbench-bezel-1", "--color-instrument-workbench-face-0", "--color-instrument-workbench-face-1", "--color-instrument-workbench-face-text", "--color-instrument-workbench-knurl", "--color-instrument-workbench-lathe", "--color-instrument-workbench-muted", "--color-instrument-workbench-notch", "--color-instrument-workbench-panel", "--color-instrument-workbench-panel-edge", "--color-instrument-workbench-panel-solid", "--color-instrument-workbench-text", "--color-lab-ground", "--color-lab-mat", "--color-lab-paper", "--color-lab-paper-ink", "--shadow-chrome-depth", "--shadow-instrument-atelier-dial", "--shadow-instrument-atelier-panel", "--shadow-instrument-optics-dial", "--shadow-instrument-optics-panel", "--shadow-instrument-workbench-dial", "--shadow-instrument-workbench-panel"]
registryDependencies: ["@nitro-forge/studio-theme"]
a11yStatus: "reviewed-pass"
---

# ForgeDirections

## Purpose

**Prerequisite.** No StudioUIProvider is needed.

Three material directions for the Prism chrome and persona turret (workbench, optics, atelier), the Workbench chrome palette, helpers that turn a palette into the NYC-Tron semantic variables, WCAG contrast helpers and turret geometry. Audit B counts 149 hex literals here (regex-based). Not a component.

## Install

- Package: `@nitro-forge/forge-directions` (registry item)
- Import: `import { forgeDirections, chromePalette, nycTronTokens } from '@/components/forge/forge-directions';`
- Peers: none
- Requires: `@nitro-forge/studio-theme`
- Command: `npx shadcn@latest add @nitro-forge/forge-directions`
- Installs: none (the CLI adds them when they are absent)
- Files: `components/forge/forge-directions.ts`

## Props

| Name | Type | Default | Required | Description |
|---|---|---|---|---|
| `forgeDirections`, `FORGE_DIRECTION_IDS`, `DEFAULT_TURRET_DIRECTION` |  | `"workbench"` |  |  |
| `workbenchChrome`, `chromePalette(scheme)`, `directionPalette(direction, scheme)` |  |  |  | Palettes as `WorkspaceColors`. |
| `nycTronTokens(scheme)`, `nycTronTokensFor(colors, selected?)` |  |  |  | Variables for a `TokenScope`. |
| `luminance`, `contrastRatio` |  |  |  | WCAG. |
| `systemColor(name)`, `glassAllowed`, `detentDurationMs`, `forgeFeedbackMotion`, `turretGeometry`, `prismFillSwatches`, `labCanvas` |  |  |  |  |

## Variants

### direction

| Value | Effect |
|---|---|
| workbench | Graphite or white ceramic; no glass. |
| optics | Glass: blur 18, saturate 1.4. |
| atelier | Ceramic with two shadow planes. |

## States

| State | How it is set | What the code does |
|---|---|---|
| Glass | direction has glass and neither Reduce Transparency nor More Contrast | Allowed (`glassAllowed`). |
| Forced colors | `systemColor` | Emits `var(--forge-system-<name>, <name>)`. |

### Motion

Detent travel and feedback timings: see persona-turret.

## A11y

- Not applicable. Non-visual; contrast helpers support checks.
- Review status: reviewed-pass, reviewed, no failures found in the source read. Nothing was rendered, so no item is verified (decision 34).

## Example

```tsx example=forge-directions
import { nycTronTokens } from '@/components/forge/forge-directions';

export const vars = nycTronTokens('dark');
```

## Do/Don't

### Do

- Feed `nycTronTokens(scheme)` to `TokenScope` so NYC-Tron parts match the panel.
- Check new palettes with `contrastRatio`.

### Don't

- Do not merge the three direction palettes; each is a separate token tier (decision 20).
- Do not treat `labCanvas` as app chrome; it backs lab pages.

### Notes

- Defines the instrument tier (53 tokens), chrome tier (14) and lab tier (4) in tokens.map.json, all value-preserving and not yet in source.
