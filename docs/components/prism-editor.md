---
name: "PrismEditor"
namespace: "@nitro-forge"
subpath: "@/components/forge/prism-editor"
tier: 1
docs: "handwritten"
platforms: ["ios", "android", "web"]
category: "forge"
tokens: ["--border-width-hairline", "--border-width-strong", "--color-accent", "--color-danger", "--color-paper-text", "--color-scrim", "--color-surface-sunken", "--color-text", "--color-text-muted", "--font-weight-semibold", "--opacity-scrim", "--radius-card", "--radius-control", "--spacing-canvas-rail", "--spacing-element", "--spacing-fixed-element", "--spacing-fixed-inset", "--spacing-fixed-stack", "--spacing-fixed-target", "--spacing-fixed-toolbar", "--spacing-group", "--spacing-inset", "--spacing-stack", "--spacing-target", "--swatch-amber", "--swatch-rose", "--swatch-teal", "--swatch-violet", "--text-label", "--text-micro", "--z-chrome", "--z-fill-bar", "--z-layer-row", "--z-overlay", "--z-panel", "--z-toast"]
registryDependencies: ["@nitro-forge/forge-directions", "@nitro-forge/forge-icon", "@nitro-forge/persona-model", "@nitro-forge/persona-turret", "@nitro-forge/prism-canvas", "@nitro-forge/studio-gesture", "@nitro-forge/studio-theme", "@nitro-forge/studio-ui-provider", "@nyc-tron/shell/MenuButton", "@nyc-tron/shell/PrecisionScrubber"]
a11yStatus: "reviewed-fail"
---

# PrismEditor

## Purpose

**Prerequisite.** Needs `StudioUIProvider`: install `studio-ui-provider` and `nyc-tron-host` first, and wrap the app once. Every studio component throws without it (install-order.md step 7).

Needs `@nitro-forge/editor-controls` first (step 3). Private workspace package (packages/editor-controls) with no tarball. The editor controls moved there from NYC-Tron UI in #95. Do not take them from @nyc-tron/forge/*.

Needs `@nitro-forge/ignition` first (step 1). Native host. shadcn copies files and cannot run nitrogen, pod install or CMake (decision 4).

Needs `@nitro-forge/studio-layout` first (step 3). Private workspace package with no tarball. Distribution waits on the versioning scheme (decision 3).

A Prism canvas editor over real engine commands: bounded PNG composite of the engine render, shape tools, four fill chips, transform actions, a layers panel (`LayerStack` from `@nitro-forge/editor-controls`, with NYC-Tron's `PrecisionScrubber` for opacity) and a persona panel. Selection and panel state are local. Every edit is one engine op, so one undo step.

## Install

- Package: `@nitro-forge/prism-editor` (registry item)
- Import: `import { PrismEditor } from '@/components/forge/prism-editor';`
- Peers: `react` >=19, `react-native` >=0.81, `react-native-svg` 15.16.0, `zustand` 5.1.0
- Requires: `@nitro-forge/studio-ui-provider`; `@nitro-forge/studio-theme`; `@nitro-forge/forge-directions`; `@nitro-forge/forge-icon`; `@nitro-forge/persona-model`; `@nitro-forge/persona-turret`; `@nitro-forge/prism-canvas`; `@nitro-forge/studio-gesture`; `@nyc-tron/shell/MenuButton`; `@nyc-tron/shell/PrecisionScrubber`; `@nitro-forge/editor-controls` (step 3 of docs/agent-native/install-order.md; shadcn cannot install it); `@nitro-forge/ignition` (step 1 of docs/agent-native/install-order.md; shadcn cannot install it); `@nitro-forge/studio-layout` (step 3 of docs/agent-native/install-order.md; shadcn cannot install it); the file imports `base64ToBytes` and `bytesToBase64` from the package index; Prism engine document supplying `apply` and `reload` (engine facade, deferred); the `layer-model` type from `@nitro-forge/editor-controls`
- Command: `npx shadcn@4.23.0 add @nitro-forge/prism-editor`
- Installs: `zustand@5.1.0` (the CLI adds them when they are absent)
- Files: `components/forge/prism-editor.tsx`, `components/forge/prism-layers.ts`, `components/forge/prism-layer-label.ts`, `components/forge/prism-layout.ts`, `components/forge/prism-transform.ts`, `components/forge/prism-blend.ts`, `components/forge/rgba-png.ts`

## Props

| Name | Type | Default | Required | Description |
|---|---|---|---|---|
| state | `unknown` | none | yes | Prism state `{width, height, layers}`. |
| apply | `(op, payload?) => Promise<unknown>` | none | yes | Engine command port. |
| reload | `() => Promise<void>` | none | yes |  |
| documentIdentity | `unknown` | none | no | Rejects work finished after the document was replaced. |
| applyOwnsRefresh | `boolean` | falsy | no | The apply owner already refreshes state. |
| renderCanvasOverlay | `(viewport) => ReactNode` | none | no | Host overlay on the exact measured artboard. |
| theme | `"dark" \| "light"` | `"dark"` | no |  |
| density | `WorkspaceDensity` | `"standard"` | no |  |
| direction | `ForgeDirectionId` | `"workbench"` | no | Material comparison only. |
| busy | `boolean` | falsy | no |  |
| selectedLayerId, onSelectLayer | `number \| null`, `(id) => void` | local selection | no | Host-owned focus shared with inspectors. |
| personas | `PersonaStore` | own store | no |  |
| onPersonaEffect | `(effect: TurretEffect) => void` | none | no | Haptics hook. |
| onOpenPersonas, onComposePersona | `() => void` | none | no | Host-presented persona panel and composer. |

## Variants

### direction

| Value | Effect |
|---|---|
| `workbench` | Graphite or white ceramic chrome (default). |
| `optics` | Glass chrome; glass only if allowed by render prefs. |
| `atelier` | Ceramic with two shadow planes. |

### width

| Value | Effect |
|---|---|
| under 600 | Persona panel is a bottom sheet over a scrim. |

## States

| State | How it is set | What the code does |
|---|---|---|
| Empty | no layers | EmptyState "No layers", action "Add rectangle". |
| Rendering / busy | local store | Controls disabled. |
| Error, preview error | engine rejects, preview over `MAX_PREVIEW_PIXELS` 1,048,576 | Message shown. |
| Layers open | Layers button | Panel width 280 (`PRISM_LAYERS_PANEL_WIDTH`); docking threshold 1100 (`PRISM_DOCKED_LAYERS_MIN_WIDTH`), side of the threshold not traced. |
| Forced colors (web) | forced-colors media | Chips keep colour (`forcedColorAdjust: none`); accent becomes system Highlight. |

### Motion

No authored animation here; see persona-turret.

## A11y

- Persona trigger: `accessibilityRole="button"`, `accessibilityLabel="Persona: <label>"`, `accessibilityHint="Opens the persona turret"`, `aria-expanded`.
- Persona panel: `role="dialog"`, `aria-label="Personas"`, modal on the sheet.
- Fill chips: `accessibilityRole="button"`, label "Choose <colour> fill", `accessibilityState.selected`.
- Composite `Image` label "Prism canvas composite"; tool rail "Creation tools".
- Icon buttons carry `aria-label`.
- Review status: reviewed-fail, reviewed, failures found in the source read. Nothing was rendered, so no item is verified (decision 34).
- Failing: N05 1.4.11: light fill chips amber 1.98:1, rose 2.62:1, hairline 2.08:1 (prism-editor.tsx:444)

## Example

```tsx example=prism-editor
import { PrismEditor } from '@/components/forge/prism-editor';

export const Demo = () => (
  <PrismEditor state={null} apply={async () => ({ data: null })} reload={async () => {}} />
);
```

## Do/Don't

### Do

- Wire `apply` to the engine so each edit is one undo step.
- Pass `selectedLayerId` and `onSelectLayer` when an inspector shares focus.
- Use `renderCanvasOverlay` to draw on the measured artboard.

### Don't

- Do not change `direction` to change document content; it changes material only.
- Do not feed previews above `MAX_PREVIEW_PIXELS`; validation rejects them.

### Notes

- The Prism engine package is not imported here. `state` and `apply` are props, so any host can feed the editor. The only native-adjacent import is the ignition index.
