---
name: "ForgeDocumentStage"
namespace: "@nitro-forge"
subpath: "@/components/forge/stage"
tier: 1
docs: "handwritten"
platforms: []
category: "display"
tokens: ["--border-width-hairline", "--color-stage-caption", "--color-stage-cell-text", "--color-stage-clip-audio", "--color-stage-clip-video", "--color-stage-empty-hint", "--color-stage-fill-fallback", "--color-stage-grid-head", "--color-stage-grid-head-text", "--color-stage-grid-line", "--color-stage-heading", "--color-stage-on-clip", "--color-stage-paper", "--color-stage-paper-text", "--color-stage-paper-text-muted", "--color-stage-paper-title", "--color-stage-quote-rule", "--color-stage-slide-text", "--color-stage-track", "--color-stage-track-border", "--color-stage-track-label", "--font-weight-medium", "--radius-control", "--radius-paper", "--spacing-fixed-canvas", "--spacing-fixed-element", "--spacing-fixed-inset", "--spacing-fixed-section", "--spacing-fixed-stack", "--text-body", "--text-label", "--text-micro"]
registryDependencies: ["@nitro-forge/forge-directions", "@nitro-forge/studio-ui-provider"]
a11yStatus: "reviewed-fail"
---

# ForgeDocumentStage

## Purpose

**Prerequisite.** Needs `StudioUIProvider`: install `studio-ui-provider` and `nyc-tron-host` first, and wrap the app once. Every studio component throws without it (install-order.md step 7).

Needs `@nitro-forge/studio-layout` first (step 3). Private workspace package with no tarball. Distribution waits on the versioning scheme (decision 3).

Default read-only stage. It projects live engine state per studio: quill text and styles, tally cells, pitch slide objects, prism shape layers, cadence and splice tracks and clips, photo originals and versions, motion layers, design nodes, draft counts, and a PDF page overview as the fallback. It does not paint, composite or play.

## Install

- Package: `@nitro-forge/forge-document-stage` (registry item)
- Import: `import { ForgeDocumentStage } from '@/components/forge/index';`
- Peers: `react` >=19, `react-native` >=0.81
- Requires: `@nitro-forge/studio-ui-provider`; `@nitro-forge/forge-directions`; `@nitro-forge/studio-layout` (step 3 of docs/agent-native/install-order.md; shadcn cannot install it)
- Command: `npx shadcn@4.23.0 add @nitro-forge/forge-document-stage`
- Installs: none (the CLI adds them when they are absent)
- Files: `components/forge/stage.tsx`

## Props

| Name | Type | Default | Required | Description |
|---|---|---|---|---|
| studioId | `Studio` | none | yes | Picks the projection branch. |
| state | `unknown` | none | yes | Engine `describe` output; falsy shows "Opening document…". |
| theme | `"dark" \| "light"` | `"dark"` | no | Caption and heading colour. |

## Variants

### studioId

| Value | Effect |
|---|---|
| quill, tally, pitch, prism, photo, motion, design, draft | One branch each. |
| cadence, splice | Shared timeline branch with ticks (cadence) or seconds (splice). |
| other (folio) | PDF overview fallback. |

## States

| State | How it is set | What the code does |
|---|---|---|
| Opening | `state` falsy | "Opening document…". |
| Empty | no content in the document | Per-studio hint, for example "No tracks yet. Add a track in Commands.". |
| Projection | state present | Each branch ends with a caption saying what the host must supply (raster compositing, PDF painting, original bytes). |

### Motion

None.

## A11y

- The file sets no role, label or state. It renders `ScrollView testID="stage-<studioId>"`.
- Review status: reviewed-fail, reviewed, failures found in the source read. Nothing was rendered, so no item is verified (decision 34).
- Failing: N03 1.4.3: #798373 on #f7f5ed 3.63:1 and #637161 on #e5e9dd 4.19:1, both 12 pt (stage.tsx:30,40)
- Failing: N13 1.3.1: Tally grid is Text cells with no table, row or cell roles (stage.tsx:30-31)

## Example

```tsx example=forge-document-stage
import { ForgeDocumentStage } from '@/components/forge/index';

export const Demo = () => <ForgeDocumentStage studioId="quill" state={null} />;
```

## Do/Don't

### Do

- Use it as the fallback stage while a native canvas is not ready (`studioId`, `state`).
- Treat its olive palette as `--color-stage-*` tokens, kept separate by value (decision 27).

### Don't

- Do not expect pixels from it: prism and folio branches are projections only.
- Do not fold its colours into `--color-paper`; that changes pixels (decision 27).
