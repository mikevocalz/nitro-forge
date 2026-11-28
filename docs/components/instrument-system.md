---
name: "InstrumentSystem"
namespace: "@nitro-forge"
subpath: "@/components/forge/instrument-system"
tier: 1
docs: "handwritten"
platforms: []
category: "forge"
tokens: ["--duration-cancel", "--duration-commit", "--duration-detent", "--duration-error", "--duration-hover", "--duration-panel-dock", "--duration-popover", "--duration-press", "--duration-selection"]
registryDependencies: []
a11yStatus: "reviewed-pass"
---

# InstrumentSystem

## Purpose

**Prerequisite.** No StudioUIProvider is needed.

Non-visual policy: 18 instrument blueprints with input modalities and edit boundaries, precision scrubbing math, timebase and ruler tick helpers, per-event motion budgets, hit-target sizes and an overlay placement planner. The planner never renders. Not a component; this page lists the API.

## Install

- Package: `@nitro-forge/instrument-system` (registry item)
- Import: `import { forgeInstrumentBlueprints, forgeMotionProfile, planForgeOverlay } from '@/components/forge/instrument-system';`  (the original line carried a note; see Notes)
- Peers: none
- Requires: none
- Command: `npx shadcn@4.23.0 add @nitro-forge/instrument-system`
- Installs: none (the CLI adds them when they are absent)
- Files: `components/forge/instrument-system.ts`, `components/forge/interaction-policy.ts`

## Props

| Name | Type | Default | Required | Description |
|---|---|---|---|---|
| `forgeInstrumentBlueprints`, `instrumentsForStudio` |  |  |  | 18 blueprints. |
| `scrubPrecision`, `scrubModeForOffset`, `beginPrecisionGesture`, `advancePrecisionGesture`, `snapTypedPrecision` |  |  |  | Fine, normal, coarse modes. |
| `nearestTimeUnit`, `timeAtUnit`, `temporalRulerTicks` |  |  |  | Timebase helpers. |
| `forgeMotionProfile(event, {reducedMotion, highContrast})` |  |  |  | In `interaction-policy.ts`. |
| `forgeHitTarget(input, density)` |  |  |  | 48 for touch, pen, controller or presentation, else 44. |
| `planForgeOverlay(query)` |  |  |  | Sheet or anchored plan; throws `RangeError` on bad geometry. |

## Variants

### motion event

| Value | Effect |
|---|---|
| hover | 70 ms |
| press | 90 ms, scale 0.985 |
| selection | 120 ms |
| popover | 150 ms, scale 0.98, travel 5 |
| panel-dock | 190 ms, travel 8 |
| detent | 65 ms linear |
| commit | 110 ms |
| cancel | 85 ms |
| error | 140 ms |

### overlay plan

| Value | Effect |
|---|---|
| sheet | reason compact, occluded or insufficient-space |
| anchored | side above or below, scrollable if clipped |

## States

| State | How it is set | What the code does |
|---|---|---|
| Reduced motion | `reducedMotion: true` | Duration 0, easing instant, no travel or scale. |

### Motion

Durations are a design budget; the file says they are not a measured claim. Eases `--ease-standard` and `--ease-emphasized` are struck (decision 25): no file defines the curves.

## A11y

- Not applicable. Hit-target policy: `forgeHitTarget` returns at least 44.
- Review status: reviewed-pass, reviewed, no failures found in the source read. Nothing was rendered, so no item is verified (decision 34).

## Example

```tsx example=instrument-system
import { forgeMotionProfile } from '@/components/forge/interaction-policy';

export const press = forgeMotionProfile('press', { reducedMotion: false });
```

## Do/Don't

### Do

- Pass a measured pane that excludes the hinge to `planForgeOverlay`.
- Pass `reducedMotion` from the OS setting to `forgeMotionProfile`.

### Don't

- Do not persist screen coordinates from a plan.
- Do not claim measured latency from these durations.
