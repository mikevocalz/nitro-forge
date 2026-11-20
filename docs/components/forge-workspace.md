---
name: "ForgeWorkspace"
namespace: "@nitro-forge"
subpath: "@/components/forge/index"
tier: 1
docs: "handwritten"
platforms: ["ios", "android", "web"]
category: "shell"
tokens: ["--border-width-hairline", "--border-width-strong", "--color-accent", "--color-border", "--color-icon-on-active", "--color-on-primary", "--color-primary-tint", "--color-surface-base", "--color-surface-raised", "--color-surface-sunken", "--color-text", "--color-text-muted", "--font-weight-medium", "--font-weight-semibold", "--radius-card", "--radius-control", "--shadow-float-md", "--shadow-float-sm", "--spacing-canvas-header", "--spacing-canvas-rail", "--spacing-canvas-toolbar", "--spacing-element", "--spacing-fixed-element", "--spacing-fixed-stack", "--spacing-fixed-status", "--spacing-group", "--spacing-header", "--spacing-inset", "--spacing-rail", "--spacing-stack", "--spacing-status", "--spacing-target", "--spacing-toolbar", "--text-body", "--text-label", "--text-micro", "--z-chrome"]
registryDependencies: ["@nitro-forge/forge-document-stage", "@nitro-forge/forge-icon", "@nitro-forge/persona-turret", "@nitro-forge/quill-text-editor", "@nitro-forge/studio-gesture", "@nitro-forge/studio-theme", "@nitro-forge/studio-ui-provider", "@nyc-tron/DragGrabHandle"]
a11yStatus: "reviewed-fail"
---

# ForgeWorkspace

## Purpose

**Prerequisite.** Needs `StudioUIProvider`: install `studio-ui-provider` and `nyc-tron-host` first, and wrap the app once. Every studio component throws without it (install-order.md step 7).

Needs `@nitro-forge/studio-layout` first (step 3). Private workspace package with no tarball. Distribution waits on the versioning scheme (decision 3).

Shared inner editor chrome for every studio: header with title and Save, a toolbar with Undo, Redo and a Workspace menu, three dock zones (left, right, bottom) plus floating panels, a panel rail, a compact bottom bar and a status line. Layout state sits in one vanilla Zustand store per instance. Presets hold layout only, never document data.

## Install

- Package: `@nitro-forge/forge-workspace` (registry item)
- Import: `import { ForgeWorkspace, createStudioWorkspaceStore, ForgeDocumentStage } from '@/components/forge/index';`
- Peers: `react`, `react-native`, `react-native-gesture-handler` >=3.4 <4, `zustand` 5.1.0; `react-native-reanimated` >=4.7.1 <5 only through persona-turret on native
- Requires: `@nitro-forge/studio-ui-provider`; `@nitro-forge/studio-theme`; `@nitro-forge/forge-document-stage`; `@nitro-forge/forge-icon`; `@nitro-forge/persona-turret`; `@nitro-forge/quill-text-editor`; `@nitro-forge/studio-gesture`; `@nyc-tron/DragGrabHandle`; `@nitro-forge/studio-layout` (step 3 of docs/agent-native/install-order.md; shadcn cannot install it); NYC-Tron parts reached through the provider: Menu, SegmentedControl, TabBar, Button, IconButton, KeyValueList, FieldGroup, ErrorMessage, Toolbar, List, ListItem
- Command: `npx shadcn@latest add @nitro-forge/forge-workspace`
- Installs: `zustand@5.1.0` (the CLI adds them when they are absent)
- Files: `components/forge/index.tsx`, `components/forge/model.ts`

## Props

Extends: Also exports `createStudioWorkspaceStore`, `ForgeDocumentStage`, `QuillTextEditor`, `PANEL_IDS` (`outline`, `properties`, `actions`, `history`), `MIN_STAGE_WIDTH` 320, `MIN_STAGE_HEIGHT` 240.

| Name | Type | Default | Required | Description |
|---|---|---|---|---|
| studioId | `Studio` | none | yes | Which studio; `"prism"` selects the canvas layout. |
| title | `string` | none | yes | Small header label. |
| documentTitle | `string` | none | yes | Document name in the header. |
| state | `unknown` | none | yes | Engine state handed to the default stage. |
| rows | `WorkspaceRow[]` | none | yes | `{label, value}` rows for the Document and Properties panels. |
| actions | `WorkspaceAction[]` | none | yes | `{title, run}` commands for the Commands panel. |
| onUndo, onRedo, onSave, onRefresh | `() => Promise<unknown> \| unknown` | none | yes | Document commands. Each runs through one guarded `perform`. |
| headerLeading, headerTrailing, leadingActions | `ReactNode` | none | no | Header and toolbar slots. |
| children | `ReactNode` | `ForgeDocumentStage` | no | Replaces the stage (native canvas, editor). |
| themeOverrides | `Partial<WorkspaceColors>` | none | no | Merged over the palette. |
| density | `WorkspaceDensity` | `"standard"` | no | compact, standard, comfortable. |
| onDensityChange | `(d: WorkspaceDensity) => void` | none | no | Without it the density entries are left out of the Workspace menu. |
| theme | `"dark" \| "light"` | system color scheme | no | Light only when the value is `"light"`. |
| busy | `boolean` | falsy | no | Blocks `perform` and disables actions. |
| error | `string \| null` | none | no | Shown in the status line through `ErrorMessage`. |
| loadPreset, persistPreset | `() => Promise<string \| null>`, `(raw) => Promise<void>` | none | no | Host storage ports for layout presets. |
| blockedRegions | `readonly Rect[]` | none | no | Screen rects a dock drop may not use. |

## Variants

### studioId

| Value | Effect |
|---|---|
| `"prism"` | Canvas layout: `prismThemes` palette, a right-hand `Studio panels` rail instead of the left rail, no header or toolbar bottom border, `canvasHeader`, `canvasToolbar` and `canvasRail` sizes, floating status bar. |
| other studios | `workspaceThemes` palette, left rail on non-compact widths. |

### density

| Value | Effect |
|---|---|
| `compact` | Space and size scale down (target stays 44). |
| `standard` | Default. |
| `comfortable` | Space and size scale up (target 48). |

## States

| State | How it is set | What the code does |
|---|---|---|
| Busy | `busy`, or an operation in flight | Ignores a second `perform`; buttons disabled. |
| Error | `error` prop or store error | Status line shows `ErrorMessage` (night surface). |
| Status | store `status` | Plain text with `accessibilityLiveRegion="polite"`. |
| Compact | outer width under 700 | Left and right docks collapse; bottom bar of panel buttons replaces the rail. |
| Arranging | Workspace menu "Arrange panels" | Panels show drag handles and a Dock position control; "Done arranging" returns. |
| Dragging | drag handle | `dock-preview` overlay and a "Cancel move" button; Escape cancels. |
| Preset errors | failed `loadPreset`, empty restore | "Could not load workspace preset", "Save a layout first". |
| Prism header overflow | width under 380 x text scale with `headerTrailing` | Trailing controls move to their own row (`workspace-host-controls`). |

### Motion

No animation authored here. Reads `AccessibilityInfo` reduce motion (initial true until the first read resolves) and passes it to `ForgeIcon`.

## A11y

- Dock tabs: `TabBar` with `aria-label="<dock> dock panels"`.
- Dock position: `SegmentedControl` with `aria-label="Dock position for <panel>"`.
- Icon buttons carry `aria-label`; toggle buttons pass `accessibilityState.selected`.
- Drag handle label: "Drag <panel> to a dock edge". Escape cancels a drag.
- Prism rail labelled "Studio panels".
- Button target size is `scale.size.target` (44, 48 comfortable).
- Review status: reviewed-fail, reviewed, failures found in the source read. Nothing was rendered, so no item is verified (decision 34).
- Failing: N01 1.4.3: light muted #687287 on base 4.43:1 for 9 to 11 pt header, status and rail text (index.tsx:190,196)
- Failing: N07 4.1.3: status line uses accessibilityLiveRegion, Android and web only; iOS silent (index.tsx:272)

## Example

```tsx example=forge-workspace
import { ForgeWorkspace } from '@/components/forge/index';

export function Demo() {
  return (
    <ForgeWorkspace studioId="quill" title="Quill" documentTitle="Untitled" state={null}
      rows={[]} actions={[]} onUndo={() => {}} onRedo={() => {}} onSave={() => {}} onRefresh={() => {}} />
  );
}
```

## Do/Don't

### Do

- Pass one stable engine document; the host owns it (`state`, `onSave`).
- Supply `loadPreset` and `persistPreset` together so Save layout and Restore layout work.
- Pass a native canvas as `children` for editing; the default stage is a projection.
- Give `density` a user setting, not a window-width guess.

### Don't

- Do not put document data in a preset; `persistPreset` receives layout only.
- Do not mount it without `StudioUIProvider`; every slot throws.
- Do not read `reducedMotion` as final on first render; it starts true until the OS value arrives.
- Do not set `studioId="prism"` and expect the left rail.

### Notes

- UNVERIFIED: the class `bg-ink-800` on selected buttons is defined nowhere in this repo.
