# Agent-native phase 1.3: design handoff for the Nitro Forge registry

Status: written from source at branch `agent-native-20261119` (base commit faa972f). No build, install, device run or screenshot was done. Every behaviour comes from a file in this repo. What code alone cannot settle is marked UNVERIFIED and counted in the register at the end.

## Reading notes

- **Template.** Each item below has the front matter keys and the eight sections of NYC-Tron's `docs/agent-native/doc-template.md` (Purpose, Install, Props, Variants, States, A11y, Example, Do/Don't). The item's front matter sits in a fenced `yaml` block under its heading so this file can hold all items; a generator can lift each block and its sections into one page per item. Motion, platform notes and dependencies that the template has no section for sit inside States, A11y and Install. Items with no front matter slot for something record it in prose.
- **Namespace.** Forge items use `namespace: "@nitro-forge"`. The template fixes `"@nyc-tron"`, so that value change is a template decision. The `subpath` is the import specifier the code exports today, or the source path when no `exports` entry exists.
- **Install.** Registry hosting is decided (decision 28: built `r/*.json` committed in the repo and served from `raw.githubusercontent.com/<owner>/<repo>/<ref>/r/{name}.json`; `<ref>` is a moving branch until the owner cuts a tag, decision 45). Install is `npx shadcn@latest add @nitro-forge/<item>`. The template's Install section currently has four labelled lines and no command (decision 29 adds it for NYC-Tron). Each Install block below has those four lines plus a `Command:` line. Registry id format is the item id; the template says the id format is not settled (UNVERIFIED).
- **Dependencies.** `registryDependencies` lists registry items only. NYC-Tron items use the export key after `./components/` (template rule), for example `shell/PrecisionScrubber`. Parts of NYC-Tron that Forge reaches through `StudioUIProvider` are not listed per item; they arrive through `nyc-tron-host`. `@nitro-forge/studio-layout`, `@nitro-forge/editor-controls` and `@nitro-forge/ignition` are not registry items (decisions 3 and 4). Items that need them say so in `Requires` and `install-order.md` gives the commands.
- **Tokens.** The `tokens` array uses the `name` field of `tokens.map.json` (CSS variable names, for example `--color-surface-base`), not the dotted form in the NYC-Tron template. The conversion between the two forms is not defined (UNVERIFIED). Each array lists what the item's source reads today (theme and scale keys, resolved through the `source` fields of `tokens.map.json`) plus tokens that map its literals. The code does not use the mapped tokens yet; the template says the same ("does not claim the codemod has run"). Drift between icon, stage, instrument and chrome palettes stays as separate tokens (decisions 5, 20, 26, 27).
- **Tier and docs.** All admitted items are `tier: 1` and `docs: "handwritten"`. The template ties tier to `tier1.json`, which lists NYC-Tron items only; the meaning for Forge items is not defined (UNVERIFIED).
- **Category.** The template's category enum has no slot for non-visual items (models, policy, tokens). They use `forge` or `primitive`; whether they get registry type `registry:lib` is open (UNVERIFIED).
- **Examples.** Each `example=` block is written to import from the real specifier. None was type-checked here because installs are not allowed. All are UNVERIFIED until CI runs `tsc --noEmit` on them.
- **A11y.** `a11yStatus` is `declared` where the file sets `accessibilityRole`, `accessibilityLabel`, `accessibilityState`, `role` or an `aria-*` prop, else `unverified`. No item is `verified`: no screen reader or device run exists in this pass.

## Summary

| Category | Items | Status |
|---|---|---|
| (a) Studio-workspace chrome | 11 | BUILD |
| (b) StudioUIProvider, host, theme and directions | 4 | BUILD |
| (c) Icons | 2 | BUILD |
| (d) Binding view-model adapters | 4 | DEFERRED (decision 3) |
| Total | 21 | 17 BUILD, 4 DEFERRED |

File coverage: all 39 non-test files in `packages/studio-workspace/src` (including `theme.css` and `theme.native.css`) belong to exactly one item; a script check confirmed the union equals the directory listing. The icons package files are split between `forge-icon` and `forge-icon-button`. The four adapters are described and deferred.

## The 27 StudioUIProvider slots

Source: `ui.tsx` (interface lines 69 to 101) and `nyc-tron-host.tsx` (mapping). 24 required, 3 optional. NYC-Tron names are import paths under `@nyc-tron/ui/components/`.

| # | Slot | Required | Forwards to | Wrapper behaviour |
|---|---|---|---|---|
| 1 | `View` | required | host primitive (`View`); `className` through Uniwind | host-supplied |
| 2 | `Text` | required | host primitive | host-supplied |
| 3 | `Pressable` | required | host primitive | host-supplied |
| 4 | `ScrollView` | required | host primitive | host-supplied |
| 5 | `TextInput` | required | host primitive | host-supplied |
| 6 | `Image` | required | host primitive | host-supplied |
| 7 | `Menu` | required | `ActionMenu` host part (`@nyc-tron/expo-controls/NativeActionMenu`) | label = `triggerLabel ?? title ?? "Actions"`; `placement` dropped |
| 8 | `Popover` | optional | `NativePopover` host part (`@nyc-tron/expo-controls/NativePopover`), type `overlays/AnchoredPopover` | label becomes `accessibleLabel: title`; `placement` ignored |
| 9 | `NativeDropdown` | optional | `GroupedSelect` host part (`@nyc-tron/expo-controls/Select`) via `studioDropdownGroups` | supporting text appended to option label |
| 10 | `Select` | required | `Select` host part (`@nyc-tron/expo-controls/Select`) | host-supplied |
| 11 | `SegmentedControl` | required | `SegmentedControl` | direct |
| 12 | `TabBar` | required | `TabBar` | direct |
| 13 | `NightScope` | required | `theme/NightScope` | direct |
| 14 | `TokenScope` | optional | host part (Uniwind `ScopedVariables` in the Expo host) | absent: native renders children; web renders a `display: contents` view |
| 15 | `DropZone` | required | `files/DropZone` | direct |
| 16 | `Card` | required | `Card` | forces `surface="raised"`; `night` wraps in `NightScope` |
| 17 | `Toolbar` | required | `Toolbar` | direct |
| 18 | `List` | required | `List` | direct |
| 19 | `ListItem` | required | `List` (`ListItem` export) | direct |
| 20 | `Button` | required | `Button` | `outline` becomes `secondary`; `tone` ignored; `selected` becomes `accessibilityState`; `cornerRadius`, `targetSize` become style |
| 21 | `IconButton` | required | `IconButton` | `targetSize` becomes `minWidth` and `minHeight` |
| 22 | `Banner` | required | `feedback/Banner` | direct |
| 23 | `Badge` | required | `feedback/Badge` | direct |
| 24 | `EmptyState` | required | `feedback/EmptyState` | direct |
| 25 | `KeyValueList` | required | `content/KeyValueList` | direct |
| 26 | `ErrorMessage` | required | `feedback/ErrorMessage` | direct |
| 27 | `FieldGroup` | required | `FieldGroup` (and `.Section`) | direct |

Slot props are the `Studio*Props` types in `ui.tsx`. Primitives take React Native props; `View` also takes `className`. `TokenScope` takes `variables: Record<"--${string}", string>` and `children`.

## (a) Studio-workspace chrome

### `@nitro-forge/forge-workspace`

```yaml
---
name: "ForgeWorkspace"
namespace: "@nitro-forge"
subpath: "@nitro-forge/studio-workspace"
tier: 1
docs: "handwritten"
platforms: ["ios", "android", "web"]
category: "shell"
tokens: ["--border-width-hairline", "--border-width-strong", "--color-accent", "--color-border", "--color-icon-on-active", "--color-on-primary", "--color-primary-tint", "--color-surface-base", "--color-surface-raised", "--color-surface-sunken", "--color-text", "--color-text-muted", "--font-weight-medium", "--font-weight-semibold", "--radius-card", "--radius-control", "--shadow-float-md", "--shadow-float-sm", "--spacing-canvas-header", "--spacing-canvas-rail", "--spacing-canvas-toolbar", "--spacing-element", "--spacing-fixed-element", "--spacing-fixed-stack", "--spacing-fixed-status", "--spacing-group", "--spacing-header", "--spacing-inset", "--spacing-rail", "--spacing-stack", "--spacing-status", "--spacing-target", "--spacing-toolbar", "--text-body", "--text-label", "--text-micro", "--z-chrome"]
registryDependencies: ["@nitro-forge/forge-icon", "@nitro-forge/persona-turret", "@nitro-forge/studio-theme", "@nitro-forge/studio-ui-provider", "@nyc-tron/DragGrabHandle", "@nyc-tron/gestures/GestureHandlerDrag", "@nyc-tron/gestures/PanResponderDrag"]
a11yStatus: "declared"
---
```

Source files (`packages/studio-workspace/src`): `index.tsx`, `model.ts`, `keyboard-event.ts`, `drag-transport.ts`, `drag-transport.native.ts`

#### Purpose

Shared inner editor chrome for every studio: header with title and Save, a toolbar with Undo, Redo and a Workspace menu, three dock zones (left, right, bottom) plus floating panels, a panel rail, a compact bottom bar and a status line. Layout state sits in one vanilla Zustand store per instance. Presets hold layout only, never document data.

#### Install

- Package: `@nitro-forge/forge-workspace` (registry item)
- Import: `import { ForgeWorkspace, createStudioWorkspaceStore, ForgeDocumentStage } from '@nitro-forge/studio-workspace';`
- Peers: `react`, `react-native`, `react-native-gesture-handler` >=3.4 <4, `zustand` 5.1.0; `react-native-reanimated` >=4.7.1 <5 only through persona-turret on native
- Requires: `@nitro-forge/forge-icon`; `@nitro-forge/persona-turret`; `@nitro-forge/studio-theme`; `@nitro-forge/studio-ui-provider`; `@nyc-tron/DragGrabHandle`; `@nyc-tron/gestures/GestureHandlerDrag`; `@nyc-tron/gestures/PanResponderDrag`; `@nitro-forge/studio-layout` (not a registry item, decision 3: install by workspace or tarball, install-order.md step 3); NYC-Tron parts reached through the provider: Menu, SegmentedControl, TabBar, Button, IconButton, KeyValueList, FieldGroup, ErrorMessage, Toolbar, List, ListItem
- Command: `npx shadcn@latest add @nitro-forge/forge-workspace`

#### Props

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

#### Variants

##### studioId

| Value | Effect |
|---|---|
| `"prism"` | Canvas layout: `prismThemes` palette, a right-hand `Studio panels` rail instead of the left rail, no header or toolbar bottom border, `canvasHeader`, `canvasToolbar` and `canvasRail` sizes, floating status bar. |
| other studios | `workspaceThemes` palette, left rail on non-compact widths. |

##### density

| Value | Effect |
|---|---|
| `compact` | Space and size scale down (target stays 44). |
| `standard` | Default. |
| `comfortable` | Space and size scale up (target 48). |

#### States

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

##### Motion

No animation authored here. Reads `AccessibilityInfo` reduce motion (initial true until the first read resolves) and passes it to `ForgeIcon`.

#### A11y

- Dock tabs: `TabBar` with `aria-label="<dock> dock panels"`.
- Dock position: `SegmentedControl` with `aria-label="Dock position for <panel>"`.
- Icon buttons carry `aria-label`; toggle buttons pass `accessibilityState.selected`.
- Drag handle label: "Drag <panel> to a dock edge". Escape cancels a drag.
- Prism rail labelled "Studio panels".
- Button target size is `scale.size.target` (44, 48 comfortable).
- Platforms in source: ios, android, web

#### Example

```tsx example=forge-workspace
import { ForgeWorkspace } from '@nitro-forge/studio-workspace';

export function Demo() {
  return (
    <ForgeWorkspace studioId="quill" title="Quill" documentTitle="Untitled" state={null}
      rows={[]} actions={[]} onUndo={() => {}} onRedo={() => {}} onSave={() => {}} onRefresh={() => {}} />
  );
}
```

#### Do/Don't

Do

- Pass one stable engine document; the host owns it (`state`, `onSave`).
- Supply `loadPreset` and `persistPreset` together so Save layout and Restore layout work.
- Pass a native canvas as `children` for editing; the default stage is a projection.
- Give `density` a user setting, not a window-width guess.

Don't

- Do not put document data in a preset; `persistPreset` receives layout only.
- Do not mount it without `StudioUIProvider`; every slot throws.
- Do not read `reducedMotion` as final on first render; it starts true until the OS value arrives.
- Do not set `studioId="prism"` and expect the left rail.

Notes

- UNVERIFIED: the class `bg-ink-800` on selected buttons is defined nowhere in this repo.

### `@nitro-forge/forge-document-stage`

```yaml
---
name: "ForgeDocumentStage"
namespace: "@nitro-forge"
subpath: "@nitro-forge/studio-workspace"
tier: 1
docs: "handwritten"
platforms: []
category: "display"
tokens: ["--border-width-hairline", "--color-stage-caption", "--color-stage-cell-text", "--color-stage-clip-audio", "--color-stage-clip-video", "--color-stage-empty-hint", "--color-stage-fill-fallback", "--color-stage-grid-head", "--color-stage-grid-head-text", "--color-stage-grid-line", "--color-stage-heading", "--color-stage-on-clip", "--color-stage-paper", "--color-stage-paper-text", "--color-stage-paper-text-muted", "--color-stage-paper-title", "--color-stage-quote-rule", "--color-stage-slide-text", "--color-stage-track", "--color-stage-track-border", "--color-stage-track-label", "--font-weight-medium", "--radius-control", "--radius-md", "--spacing-fixed-canvas", "--spacing-fixed-element", "--spacing-fixed-inset", "--spacing-fixed-section", "--spacing-fixed-stack", "--text-body", "--text-label", "--text-micro"]
registryDependencies: ["@nitro-forge/studio-theme", "@nitro-forge/studio-ui-provider"]
a11yStatus: "unverified"
---
```

Source files (`packages/studio-workspace/src`): `stage.tsx`

#### Purpose

Default read-only stage. It projects live engine state per studio: quill text and styles, tally cells, pitch slide objects, prism shape layers, cadence and splice tracks and clips, photo originals and versions, motion layers, design nodes, draft counts, and a PDF page overview as the fallback. It does not paint, composite or play.

#### Install

- Package: `@nitro-forge/forge-document-stage` (registry item)
- Import: `import { ForgeDocumentStage } from '@nitro-forge/studio-workspace';`
- Peers: `react` >=19, `react-native` >=0.81
- Requires: `@nitro-forge/studio-theme`; `@nitro-forge/studio-ui-provider`; `@nitro-forge/studio-layout` (not a registry item, decision 3: install by workspace or tarball, install-order.md step 3) for the `Studio` type
- Command: `npx shadcn@latest add @nitro-forge/forge-document-stage`

#### Props

| Name | Type | Default | Required | Description |
|---|---|---|---|---|
| studioId | `Studio` | none | yes | Picks the projection branch. |
| state | `unknown` | none | yes | Engine `describe` output; falsy shows "Opening document…". |
| theme | `"dark" \| "light"` | `"dark"` | no | Caption and heading colour. |

#### Variants

##### studioId

| Value | Effect |
|---|---|
| quill, tally, pitch, prism, photo, motion, design, draft | One branch each. |
| cadence, splice | Shared timeline branch with ticks (cadence) or seconds (splice). |
| other (folio) | PDF overview fallback. |

#### States

| State | How it is set | What the code does |
|---|---|---|
| Opening | `state` falsy | "Opening document…". |
| Empty | no content in the document | Per-studio hint, for example "No tracks yet. Add a track in Commands.". |
| Projection | state present | Each branch ends with a caption saying what the host must supply (raster compositing, PDF painting, original bytes). |

##### Motion

None.

#### A11y

- The file sets no role, label or state. It renders `ScrollView testID="stage-<studioId>"`.
- Platforms in source: none stated

#### Example

```tsx example=forge-document-stage
import { ForgeDocumentStage } from '@nitro-forge/studio-workspace';

export const Demo = () => <ForgeDocumentStage studioId="quill" state={null} />;
```

#### Do/Don't

Do

- Use it as the fallback stage while a native canvas is not ready (`studioId`, `state`).
- Treat its olive palette as `--color-stage-*` tokens, kept separate by value (decision 27).

Don't

- Do not expect pixels from it: prism and folio branches are projections only.
- Do not fold its colours into `--color-paper`; that changes pixels (decision 27).

### `@nitro-forge/quill-text-editor`

```yaml
---
name: "QuillTextEditor"
namespace: "@nitro-forge"
subpath: "@nitro-forge/studio-workspace"
tier: 1
docs: "handwritten"
platforms: ["android"]
category: "input"
tokens: ["--color-accent", "--color-paper", "--color-paper-text", "--color-paper-text-muted", "--color-text-muted", "--font-editorial", "--radius-control", "--radius-md", "--shadow-page", "--spacing-fixed-element", "--spacing-fixed-inset", "--spacing-fixed-page", "--spacing-group", "--spacing-target"]
registryDependencies: ["@nitro-forge/forge-icon", "@nitro-forge/studio-theme", "@nitro-forge/studio-ui-provider"]
a11yStatus: "declared"
---
```

Source files (`packages/studio-workspace/src`): `text-editor.tsx`, `text-diff.ts`

#### Purpose

A writing surface for Quill documents, supplied through the stage slot. It keeps a local draft in a Zustand store and writes one atomic `replaceRange` edit through `apply` on Apply text or `flush()`. An outside edit during a draft raises a conflict and keeps the draft.

#### Install

- Package: `@nitro-forge/quill-text-editor` (registry item)
- Import: `import { QuillTextEditor, type QuillTextEditorHandle } from '@nitro-forge/studio-workspace';`
- Peers: `react` >=19, `react-native` >=0.81, `zustand` 5.1.0
- Requires: `@nitro-forge/forge-icon`; `@nitro-forge/studio-theme`; `@nitro-forge/studio-ui-provider`; Quill engine document supplying `apply` and `reload` (engine facade, deferred)
- Command: `npx shadcn@latest add @nitro-forge/quill-text-editor`

#### Props

Extends: Ref handle `QuillTextEditorHandle`: `flush(): Promise<void>`, `isDirty(): boolean`.

| Name | Type | Default | Required | Description |
|---|---|---|---|---|
| state | `unknown` | none | yes | Quill `describe` data. |
| apply | `(op: string, payload?: unknown) => Promise<unknown>` | none | yes | Engine command port. |
| reload | `() => Promise<void>` | none | yes | Refresh host state after a write. |
| theme | `"dark" \| "light"` | `"dark"` | no | Selects `workspaceThemes`. |
| density | `WorkspaceDensity` | `"standard"` | no | Chrome only; never manuscript type or page geometry. |
| documentTitle | `string` | none | no | Declared in the interface; the file does not read it. |

#### Variants

##### width

| Value | Effect |
|---|---|
| under 600 | Smaller padding; manuscript 17 pt on 29 line height. |
| 600 and over | Manuscript 19 pt on 34 line height, max width 792. |

##### density

| Value | Effect |
|---|---|
| `comfortable` | Adds `min-h-12 min-w-12` to the button. |

#### States

| State | How it is set | What the code does |
|---|---|---|
| Clean | draft equals base | "Up to date"; Apply disabled. |
| Dirty | text differs | "Draft changes"; Apply primary. |
| Busy | `flush` running | "Applying…", button loading, input not editable. |
| Conflict | engine changed under the draft | Danger Banner and "Discard draft and load latest document"; Apply disabled. |
| Opening | `state` falsy | Input not editable; flush throws "The document is still opening". |

##### Motion

None authored; `ForgeIcon` always gets `reducedMotion`.

#### A11y

- TextInput `accessibilityLabel="Essay text"`.
- Apply button `aria-label="Apply essay text"`; discard button `aria-label="Discard draft and load latest document"`.
- Button target `scale.size.target`.
- Android uses the `serif` font; other platforms Georgia.
- Platforms in source: android

#### Example

```tsx example=quill-text-editor
import { useRef } from 'react';
import { QuillTextEditor, type QuillTextEditorHandle } from '@nitro-forge/studio-workspace';

export function Demo() {
  const ref = useRef<QuillTextEditorHandle>(null);
  return <QuillTextEditor ref={ref} state={null} apply={async () => ({ data: null })} reload={async () => {}} />;
}
```

#### Do/Don't

Do

- Call `ref.current.flush()` before save or export so the draft reaches the engine.
- Check `isDirty()` before opening another document over the draft.
- Pass `apply` that supports `describe` and `replaceRange`.

Don't

- Do not edit the engine behind the editor while a draft is open; it raises a conflict.
- Do not expect `density` to change manuscript type.

Notes

- `platforms` lists only `android` because that is the only platform the file names (`Platform.OS === "android"` font branch). The editor runs wherever React Native runs.

### `@nitro-forge/prism-editor`

```yaml
---
name: "PrismEditor"
namespace: "@nitro-forge"
subpath: "@nitro-forge/studio-workspace/prism"
tier: 1
docs: "handwritten"
platforms: ["ios", "android", "web"]
category: "forge"
tokens: ["--border-width-hairline", "--border-width-strong", "--color-accent", "--color-danger", "--color-paper-text", "--color-scrim", "--color-surface-sunken", "--color-text", "--color-text-muted", "--font-weight-semibold", "--opacity-scrim", "--radius-card", "--radius-control", "--spacing-canvas-rail", "--spacing-element", "--spacing-fixed-element", "--spacing-fixed-inset", "--spacing-fixed-stack", "--spacing-fixed-target", "--spacing-fixed-toolbar", "--spacing-group", "--spacing-inset", "--spacing-stack", "--spacing-target", "--swatch-amber", "--swatch-rose", "--swatch-teal", "--swatch-violet", "--text-label", "--text-micro", "--z-chrome", "--z-fill-bar", "--z-layer-row", "--z-overlay", "--z-panel", "--z-toast"]
registryDependencies: ["@nitro-forge/forge-directions", "@nitro-forge/forge-icon", "@nitro-forge/persona-model", "@nitro-forge/persona-turret", "@nitro-forge/prism-canvas", "@nitro-forge/studio-theme", "@nitro-forge/studio-ui-provider", "@nyc-tron/shell/PrecisionScrubber"]
a11yStatus: "declared"
---
```

Source files (`packages/studio-workspace/src`): `prism-editor.tsx`, `prism-layers.ts`, `prism-layer-label.ts`, `prism-layout.ts`, `prism-transform.ts`, `rgba-png.ts`

#### Purpose

A Prism canvas editor over real engine commands: bounded PNG composite of the engine render, shape tools, four fill chips, transform actions, a layers panel (`LayerStack` from `@nitro-forge/editor-controls`, with NYC-Tron's `PrecisionScrubber` for opacity) and a persona panel. Selection and panel state are local. Every edit is one engine op, so one undo step.

#### Install

- Package: `@nitro-forge/prism-editor` (registry item)
- Import: `import { PrismEditor } from '@nitro-forge/studio-workspace/prism';`
- Peers: `react` >=19, `react-native` >=0.81, `react-native-svg` 15.16.0, `zustand` 5.1.0
- Requires: `@nitro-forge/forge-directions`; `@nitro-forge/forge-icon`; `@nitro-forge/persona-model`; `@nitro-forge/persona-turret`; `@nitro-forge/prism-canvas`; `@nitro-forge/studio-theme`; `@nitro-forge/studio-ui-provider`; `@nyc-tron/shell/PrecisionScrubber`; `@nitro-forge/ignition` (not a registry item, decision 4: native prerequisite, install-order.md steps 0 to 1); the file imports `base64ToBytes` and `bytesToBase64` from the package index; Prism engine document supplying `apply` and `reload` (engine facade, deferred); the `layer-model` type from `@nitro-forge/editor-controls`
- Command: `npx shadcn@latest add @nitro-forge/prism-editor`

#### Props

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

#### Variants

##### direction

| Value | Effect |
|---|---|
| `workbench` | Graphite or white ceramic chrome (default). |
| `optics` | Glass chrome; glass only if allowed by render prefs. |
| `atelier` | Ceramic with two shadow planes. |

##### width

| Value | Effect |
|---|---|
| under 600 | Persona panel is a bottom sheet over a scrim. |

#### States

| State | How it is set | What the code does |
|---|---|---|
| Empty | no layers | EmptyState "No layers", action "Add rectangle". |
| Rendering / busy | local store | Controls disabled. |
| Error, preview error | engine rejects, preview over `MAX_PREVIEW_PIXELS` 1,048,576 | Message shown. |
| Layers open | Layers button | Panel width 280 (`PRISM_LAYERS_PANEL_WIDTH`); docking threshold 1100 (`PRISM_DOCKED_LAYERS_MIN_WIDTH`), side of the threshold not traced. |
| Forced colors (web) | forced-colors media | Chips keep colour (`forcedColorAdjust: none`); accent becomes system Highlight. |

##### Motion

No authored animation here; see persona-turret.

#### A11y

- Persona trigger: `accessibilityRole="button"`, `accessibilityLabel="Persona: <label>"`, `accessibilityHint="Opens the persona turret"`, `aria-expanded`.
- Persona panel: `role="dialog"`, `aria-label="Personas"`, modal on the sheet.
- Fill chips: `accessibilityRole="button"`, label "Choose <colour> fill", `accessibilityState.selected`.
- Composite `Image` label "Prism canvas composite"; tool rail "Creation tools".
- Icon buttons carry `aria-label`.
- Platforms in source: ios, android, web

#### Example

```tsx example=prism-editor
import { PrismEditor } from '@nitro-forge/studio-workspace/prism';

export const Demo = () => (
  <PrismEditor state={null} apply={async () => ({ data: null })} reload={async () => {}} />
);
```

#### Do/Don't

Do

- Wire `apply` to the engine so each edit is one undo step.
- Pass `selectedLayerId` and `onSelectLayer` when an inspector shares focus.
- Use `renderCanvasOverlay` to draw on the measured artboard.

Don't

- Do not change `direction` to change document content; it changes material only.
- Do not feed previews above `MAX_PREVIEW_PIXELS`; validation rejects them.

Notes

- The Prism engine package is not imported here. `state` and `apply` are props, so any host can feed the editor. The only native-adjacent import is the ignition index.

### `@nitro-forge/prism-canvas`

```yaml
---
name: "PrismCanvas"
namespace: "@nitro-forge"
subpath: "packages/studio-workspace/src/prism-canvas.tsx (no export entry)"
tier: 1
docs: "handwritten"
platforms: ["web"]
category: "forge"
tokens: ["--border-width-strong", "--color-artboard-checker-a", "--color-artboard-checker-b", "--color-on-overlay-chip", "--color-overlay-chip", "--shadow-artboard", "--spacing-fixed-stack"]
registryDependencies: ["@nitro-forge/studio-gesture", "@nitro-forge/studio-ui-provider"]
a11yStatus: "declared"
---
```

Source files (`packages/studio-workspace/src`): `prism-canvas.tsx`, `prism-canvas-model.ts`

#### Purpose

The Prism artboard: a transparency checker, the engine composite as children, an optional overlay, a selection outline, and one-finger move gestures that preview bounds and commit once on release.

#### Install

- Package: `@nitro-forge/prism-canvas` (registry item)
- Import: `import { PrismCanvas, ARTBOARD_CHECKER } from './prism-canvas';  // path inside the copied item`
- Peers: `react` >=19, `react-native` >=0.81, `react-native-svg` 15.16.0, `zustand` 5.1.0
- Requires: `@nitro-forge/studio-gesture`; `@nitro-forge/studio-ui-provider`
- Command: `npx shadcn@latest add @nitro-forge/prism-canvas`

#### Props

Extends: Exports `ARTBOARD_CHECKER` = `{size: 8, light: "#FFFFFF", dark: "#EDEFF3"}`.

| Name | Type | Default | Required | Description |
|---|---|---|---|---|
| document | `CanvasDocument` | none | yes | `{width, height, layers}`. |
| width, height | `number` | none | yes | Artboard size in points. |
| selectedId | `number \| null` | none | yes |  |
| disabled | `boolean` | none | yes | Cancels any gesture. |
| color | `string` | none | yes | Selection outline colour. |
| children | `ReactNode` | none | yes | The engine composite. |
| overlay | `ReactNode` | none | no | Replaces the built-in outline. |
| onSelect | `(id: number \| null) => void` | none | yes |  |
| onMoveShape | `(id, dx, dy) => void` | none | yes | Called once on release. |

#### Variants

none

#### States

| State | How it is set | What the code does |
|---|---|---|
| Selected | `selectedId` matches a layer | Outline `prism-selection-bounds`. |
| Moving | drag | Preview badge "Move preview · release to apply" and "Cancel move". |
| Disabled | `disabled` | Gestures ignored. |
| Reset | document, size or disabled changes | Any open gesture is cancelled. |

##### Motion

None. The preview is a static outline offset.

#### A11y

- Artboard label: "Prism artboard. Select layers or use Transform for accessible move actions."
- Escape cancels a gesture.
- Web: `touchAction: none`; scroll, resize and blur cancel the gesture because measured geometry goes stale.
- The cancel button is a provider `Button` with `aria-label="Cancel shape move"`.
- Platforms in source: web

#### Example

```tsx example=prism-canvas
import { PrismCanvas } from './prism-canvas';
import { View } from 'react-native';

export const Demo = () => (
  <PrismCanvas document={{ width: 800, height: 600, layers: [] }} width={400} height={300}
    selectedId={null} disabled={false} color="#086CB8" onSelect={() => {}} onMoveShape={() => {}}>
    <View />
  </PrismCanvas>
);
```

#### Do/Don't

Do

- Commit on `onMoveShape` only; it fires once per release.
- Pass `disabled` while the engine is busy.
- Use `overlay` to draw your own selection UI.

Don't

- Do not treat the move preview as document state.
- Do not rely on `platforms: ["web"]` meaning web only: the file branches on `Platform.OS === "web"` for listeners and runs on native through `studio-gesture`.

### `@nitro-forge/studio-gesture`

```yaml
---
name: "StudioGesture"
namespace: "@nitro-forge"
subpath: "packages/studio-workspace/src/studio-gesture.tsx (no export entry)"
tier: 1
docs: "handwritten"
platforms: ["ios", "android", "web"]
category: "primitive"
tokens: []
registryDependencies: []
a11yStatus: "unverified"
---
```

Source files (`packages/studio-workspace/src`): `studio-gesture.tsx`, `studio-gesture.native.tsx`, `studio-gesture-types.ts`

#### Purpose

One-finger gesture recogniser with a shared contract. Web uses `PanResponder`; native uses a Gesture Handler Pan raced against a Tap.

#### Install

- Package: `@nitro-forge/studio-gesture` (registry item)
- Import: `import { StudioGesture } from './studio-gesture';`
- Peers: `react` >=19, `react-native` >=0.81, `react-native-gesture-handler` >=3.4 <4 (native file)
- Requires: none
- Command: `npx shadcn@latest add @nitro-forge/studio-gesture`

#### Props

| Name | Type | Default | Required | Description |
|---|---|---|---|---|
| children | `ReactElement` | none | yes | One element; it receives the handlers. |
| onBegin | `(point) => void` | none | yes |  |
| onMove | `(point, touches) => void` | none | yes |  |
| onRelease | `(point) => void` | none | yes |  |
| onCancel | `() => void` | none | yes |  |
| disabled | `boolean` | falsy | no |  |

#### Variants

##### file

| Value | Effect |
|---|---|
| `studio-gesture.tsx` | Web `PanResponder`. |
| `studio-gesture.native.tsx` | Gesture Handler `Pan` (minDistance 0, maxPointers 1) raced with `Tap` (maxDistance 4). |

#### States

| State | How it is set | What the code does |
|---|---|---|
| Disabled | `disabled` | Gestures not enabled. |
| Second touch | more than one pointer | `onCancel`. |
| Pan loses to Tap | native race | Tap release still fires; the lost Pan does not cancel it. |

##### Motion

None.

#### A11y

- Sets no role, label or state; it clones handlers onto its child.
- Platforms in source: ios, android, web

#### Example

```tsx example=studio-gesture
import { View } from 'react-native';
import { StudioGesture } from './studio-gesture';

export const Demo = () => (
  <StudioGesture onBegin={() => {}} onMove={() => {}} onRelease={() => {}} onCancel={() => {}}><View /></StudioGesture>
);
```

#### Do/Don't

Do

- Give it a single child element (`children`).
- Handle `onCancel` to drop preview state.

Don't

- Do not wrap more than one child.
- Do not use it for multi-touch; `maxPointers(1)` and the second-touch cancel reject it.

### `@nitro-forge/persona-turret`

```yaml
---
name: "PersonaTurret"
namespace: "@nitro-forge"
subpath: "@nitro-forge/studio-workspace/turret"
tier: 1
docs: "handwritten"
platforms: ["ios", "android", "web"]
category: "forge"
tokens: ["--border-width-hairline", "--color-accent", "--font-weight-bold", "--radius-control", "--spacing-element", "--spacing-inset", "--spacing-stack", "--text-body", "--text-label", "--text-micro"]
registryDependencies: ["@nitro-forge/forge-directions", "@nitro-forge/persona-model", "@nitro-forge/studio-gesture", "@nitro-forge/studio-theme", "@nitro-forge/studio-ui-provider"]
a11yStatus: "declared"
---
```

Source files (`packages/studio-workspace/src`): `persona-turret.tsx`, `turret.ts`, `turret-motion.tsx`, `turret-motion.native.tsx`, `turret-motion-types.ts`

#### Purpose

The design studio persona switcher: a four-stop machined dial with a detent per persona. Drag or arrow keys preview, release or Enter commits, Escape cancels. Also exports the hooks `useStudioTextScale`, `useForgeRenderPrefs`, `useTurretShortcut` and `documentRtl`.

#### Install

- Package: `@nitro-forge/persona-turret` (registry item)
- Import: `import { PersonaTurret, useStudioTextScale } from '@nitro-forge/studio-workspace/turret';`
- Peers: `react` >=19, `react-native` >=0.81, `react-native-svg` 15.16.0, `zustand` 5.1.0, `react-native-reanimated` >=4.7.1 <5 (native motion file)
- Requires: `@nitro-forge/forge-directions`; `@nitro-forge/persona-model`; `@nitro-forge/studio-gesture`; `@nitro-forge/studio-theme`; `@nitro-forge/studio-ui-provider`
- Command: `npx shadcn@latest add @nitro-forge/persona-turret`

#### Props

Extends: Also exports `TURRET_SIZE`, `turretBoxWidth(textScale, count)`, `turretCopy`, `BUILT_IN_PERSONAS`.

| Name | Type | Default | Required | Description |
|---|---|---|---|---|
| personas | `readonly PersonaSpec[]` | none | yes |  |
| surface | `PersonaSurface` | none | yes | Stops are `personasOn(personas, surface)`. |
| activeId | `string` | none | yes | Committed persona. |
| onSwitch | `(personaId) => void` | none | yes | Once per committed switch; never touches the document. |
| onEffect | `(effect: TurretEffect) => void` | none | no | Haptics and sound hook. |
| onAnnounce | `(text) => void` | own node | no | Web host status node. |
| onDismiss | `() => void` | none | no | Escape with no preview open. |
| autoFocus | `boolean` | falsy | no |  |
| rtl | `boolean` | document or `I18nManager` | no |  |
| direction | `ForgeDirectionId` | `"workbench"` | no |  |
| scheme | `ForgeScheme` | `"dark"` | no |  |
| colors | `WorkspaceColors` | none | no | Only `accent` is used. |
| disabled | `boolean` | falsy | no |  |
| handle | `Ref<PersonaTurretHandle>` | none | no | `cancel()`, `focus()`. |

#### Variants

##### direction

| Value | Effect |
|---|---|
| `workbench` | Detent travel 120 ms, curve (0.22, 1, 0.36, 1). |
| `optics` | 200 ms, (0.16, 1, 0.3, 1). |
| `atelier` | 280 ms, (0.25, 1, 0.5, 1). |

#### States

| State | How it is set | What the code does |
|---|---|---|
| Peeking | drag or key | Indicator moves; commit on release, Enter or digit shortcut. |
| End stop | drag past first or last stop | Two-beat nudge, or an opacity pulse under Reduce Motion. |
| Disabled | `disabled` | "Persona switching waits for the engine to finish". |
| No stops | no persona runs on this surface | "No persona runs on this device". |

##### Motion

`forgeFeedbackMotion`: press 80 ms scale 0.96, end-stop beat 60 ms by 3 degrees, commit rim 200 ms peak opacity 0.9. Reduce Motion sets travel to 0 ms. Web uses a CSS transition and one Web Animation; native uses Reanimated on the UI thread.

#### A11y

- Container `accessibilityRole="radiogroup"`; each stop `accessibilityRole="radio"` with `accessibilityState.checked` and `aria-checked`.
- Ring `accessibilityRole="adjustable"`.
- Announcements: `AccessibilityInfo` on native, a hidden live region on web.
- Reads reduce motion, reduce transparency, contrast, forced colors, text scale; shortcut tags only for a fine pointer on web.
- Platforms in source: ios, android, web

#### Example

```tsx example=persona-turret
import { PersonaTurret, BUILT_IN_PERSONAS } from '@nitro-forge/studio-workspace/turret';

export const Demo = () => (
  <PersonaTurret personas={BUILT_IN_PERSONAS} surface="web" activeId="vector" onSwitch={() => {}} />
);
```

#### Do/Don't

Do

- Size the host panel with `turretBoxWidth(useStudioTextScale(), count)`.
- Call `handle.cancel()` on Android Back or a closing sheet.

Don't

- Do not let `onSwitch` mutate the document; personas hold none.
- Do not mount the native motion file without `react-native-reanimated`; the import is unconditional (UNVERIFIED by build).

### `@nitro-forge/persona-composer`

```yaml
---
name: "PersonaComposer"
namespace: "@nitro-forge"
subpath: "@nitro-forge/studio-workspace/composer"
tier: 1
docs: "handwritten"
platforms: ["ios", "android", "web"]
category: "forge"
tokens: ["--border-width-hairline", "--font-mono-plain", "--font-weight-bold", "--font-weight-semibold", "--radius-card", "--radius-control", "--shadow-segment-active", "--spacing-element", "--spacing-fixed-rail", "--spacing-fixed-status", "--spacing-group", "--spacing-inset", "--spacing-section", "--spacing-stack", "--spacing-target", "--text-body", "--text-label", "--text-title"]
registryDependencies: ["@nitro-forge/forge-icon", "@nitro-forge/instrument-system", "@nitro-forge/persona-model", "@nitro-forge/studio-theme", "@nitro-forge/studio-ui-provider", "@nyc-tron/DragGrabHandle"]
a11yStatus: "declared"
---
```

Source files (`packages/studio-workspace/src`): `persona-composer.tsx`, `persona-composer-model.ts`

#### Purpose

A form for naming a persona, ordering its instrument rail, choosing capabilities and surfaces, previewing the manifest for the current surface, then saving, exporting, importing or removing through a `PersonaStore`.

#### Install

- Package: `@nitro-forge/persona-composer` (registry item)
- Import: `import { PersonaComposer } from '@nitro-forge/studio-workspace/composer';`
- Peers: `react` >=19, `react-native` >=0.81, `react-native-svg` 15.16.0, `zustand` 5.1.0
- Requires: `@nitro-forge/forge-icon`; `@nitro-forge/instrument-system`; `@nitro-forge/persona-model`; `@nitro-forge/studio-theme`; `@nitro-forge/studio-ui-provider`; `@nyc-tron/DragGrabHandle`
- Command: `npx shadcn@latest add @nitro-forge/persona-composer`

#### Props

Extends: Also exports `ComposerGlyph` (`more`, `chevron-left`, `chevron-down`, `chevron-up`). Name limit `PERSONA_NAME_MAX` 40.

| Name | Type | Default | Required | Description |
|---|---|---|---|---|
| store | `PersonaStore` | none | yes | Every save, import and removal goes through it. |
| theme | `"dark" \| "light"` | `"dark"` | no | Dark wraps the body in `NightScope`. |
| colors | `WorkspaceColors` | `prismThemes[theme]` | no |  |
| onExportPersona | `(json, persona) => Promise<"copied" \| "shared">` | shows JSON in a field | no | Host copy or share. |

#### Variants

##### layout by width

| Value | Effect |
|---|---|
| wide | Width >= 1000 (`COMPOSER_WIDE`). |
| single | Between 600 and 1000. |
| phone | Under 600 (`COMPOSER_PHONE`); instrument and capability grids fold into disclosures. |

##### theme

| Value | Effect |
|---|---|
| `light` | Own segment classes on web (`LIGHT_SEGMENTS`). |

#### States

| State | How it is set | What the code does |
|---|---|---|
| Save blocked | `saveBlocker(draft)` | Reason shown. |
| Notice | save, import, export, remove | Banner tone success, danger or info. |
| Import open | Import button | Multiline field "Persona JSON to import". |
| Built-in | persona `builtIn` | Not removable or exportable; caption explains. |
| Reorder | drag, Move up, Move down | Live announcement of the new position. |

##### Motion

None authored.

#### A11y

- Name field `accessibilityLabel="Persona name"`; import and export fields labelled.
- Toggles: `accessibilityRole="button"` with `accessibilityState.selected` or `expanded`.
- Lists: `accessibilityRole="list"` with `listitem` rows; headings with `aria-level`.
- Reorder by Move up and Move down buttons (`aria-label="Move <name> up"`), screen reader and drag.
- Web live region; iOS and Android use `announceForAccessibility`.
- Platforms in source: ios, android, web

#### Example

```tsx example=persona-composer
import { PersonaComposer } from '@nitro-forge/studio-workspace/composer';
import { createPersonaStore } from '@nitro-forge/studio-workspace/personas';

const store = createPersonaStore({ surface: 'web' });
export const Demo = () => <PersonaComposer store={store} />;
```

#### Do/Don't

Do

- Pass `onExportPersona` to use the clipboard or share sheet.
- Use the store from the open document so saves persist with it.

Don't

- Do not offer remove or export for built-in personas; the store refuses them.
- Do not hide capabilities with `engine: "not-in-engine"`; the form keeps them selectable and tags them.

### `@nitro-forge/persona-model`

```yaml
---
name: "PersonaModel"
namespace: "@nitro-forge"
subpath: "@nitro-forge/studio-workspace/personas"
tier: 1
docs: "handwritten"
platforms: []
category: "forge"
tokens: []
registryDependencies: ["@nitro-forge/instrument-system"]
a11yStatus: "unverified"
---
```

Source files (`packages/studio-workspace/src`): `persona.ts`, `persona-store.ts`

#### Purpose

Non-visual persona model: 4 built-in personas (vector, pixel, layout, sketch), 11 capabilities (4 backed by Prism ops, 7 marked `not-in-engine`), 7 surfaces, compose, import, export, switch, and a per-document store with a host storage port. Not a component; the template covers components, so this page lists the API.

#### Install

- Package: `@nitro-forge/persona-model` (registry item)
- Import: `import { createPersonaStore } from '@nitro-forge/studio-workspace/personas';`
- Peers: `zustand` 5.1.0
- Requires: `@nitro-forge/instrument-system`
- Command: `npx shadcn@latest add @nitro-forge/persona-model`

#### Props

| Name | Type | Default | Required | Description |
|---|---|---|---|---|
| createPersonaStore(options) | `{surface, storage?, initialPersonaId?}` | none | yes | Returns a Zustand vanilla store. |
| PersonaStoragePort | `{load, save}` | none | no | Host durable storage (MMKV, file, browser). |
| actions | `switchTo`, `setSurface`, `setContinuity`, `compose`, `importJson`, `exportJson`, `remove`, `clearError` |  |  | On `PersonaStoreActions`. |
| `PERSONA_FORMAT` | `1` |  |  | Export format version. |

#### Variants

none

#### States

| State | How it is set | What the code does |
|---|---|---|
| Error | failed switch, compose, import, or unreadable saved personas | Plain-words string in store `error`. |

##### Motion

None.

#### A11y

- Not applicable. Non-visual.
- Platforms in source: none stated

#### Example

```tsx example=persona-model
import { createPersonaStore } from '@nitro-forge/studio-workspace/personas';

export const store = createPersonaStore({ surface: 'iphone' });
```

#### Do/Don't

Do

- Provide a `PersonaStoragePort` to keep user personas.
- Call `setSurface` when a fold opens or a display attaches.

Don't

- Do not store document data here; personas hold none.
- Do not choose the storage backend in the store; the host does.

### `@nitro-forge/instrument-system`

```yaml
---
name: "InstrumentSystem"
namespace: "@nitro-forge"
subpath: "@nitro-forge/studio-workspace/instruments"
tier: 1
docs: "handwritten"
platforms: []
category: "forge"
tokens: ["--duration-cancel", "--duration-commit", "--duration-detent", "--duration-error", "--duration-hover", "--duration-panel-dock", "--duration-popover", "--duration-press", "--duration-selection"]
registryDependencies: []
a11yStatus: "unverified"
---
```

Source files (`packages/studio-workspace/src`): `instrument-system.ts`, `interaction-policy.ts`

#### Purpose

Non-visual policy: 18 instrument blueprints with input modalities and edit boundaries, precision scrubbing math, timebase and ruler tick helpers, per-event motion budgets, hit-target sizes and an overlay placement planner. The planner never renders. Not a component; this page lists the API.

#### Install

- Package: `@nitro-forge/instrument-system` (registry item)
- Import: `import { forgeInstrumentBlueprints, forgeMotionProfile, planForgeOverlay } from '@nitro-forge/studio-workspace/instruments';  // forgeMotionProfile and planForgeOverlay live at @nitro-forge/studio-workspace/interaction`
- Peers: none
- Requires: none
- Command: `npx shadcn@latest add @nitro-forge/instrument-system`

#### Props

| Name | Type | Default | Required | Description |
|---|---|---|---|---|
| `forgeInstrumentBlueprints`, `instrumentsForStudio` |  |  |  | 18 blueprints. |
| `scrubPrecision`, `scrubModeForOffset`, `beginPrecisionGesture`, `advancePrecisionGesture`, `snapTypedPrecision` |  |  |  | Fine, normal, coarse modes. |
| `nearestTimeUnit`, `timeAtUnit`, `temporalRulerTicks` |  |  |  | Timebase helpers. |
| `forgeMotionProfile(event, {reducedMotion, highContrast})` |  |  |  | In `interaction-policy.ts`. |
| `forgeHitTarget(input, density)` |  |  |  | 48 for touch, pen, controller or presentation, else 44. |
| `planForgeOverlay(query)` |  |  |  | Sheet or anchored plan; throws `RangeError` on bad geometry. |

#### Variants

##### motion event

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

##### overlay plan

| Value | Effect |
|---|---|
| sheet | reason compact, occluded or insufficient-space |
| anchored | side above or below, scrollable if clipped |

#### States

| State | How it is set | What the code does |
|---|---|---|
| Reduced motion | `reducedMotion: true` | Duration 0, easing instant, no travel or scale. |

##### Motion

Durations are a design budget; the file says they are not a measured claim. Eases `--ease-standard` and `--ease-emphasized` are struck (decision 25): no file defines the curves.

#### A11y

- Not applicable. Hit-target policy: `forgeHitTarget` returns at least 44.
- Platforms in source: none stated

#### Example

```tsx example=instrument-system
import { forgeMotionProfile } from '@nitro-forge/studio-workspace/interaction';

export const press = forgeMotionProfile('press', { reducedMotion: false });
```

#### Do/Don't

Do

- Pass a measured pane that excludes the hinge to `planForgeOverlay`.
- Pass `reducedMotion` from the OS setting to `forgeMotionProfile`.

Don't

- Do not persist screen coordinates from a plan.
- Do not claim measured latency from these durations.

### `@nitro-forge/workspace-utilities`

```yaml
---
name: "WorkspaceUtilities"
namespace: "@nitro-forge"
subpath: "@nitro-forge/studio-workspace/apps"
tier: 1
docs: "handwritten"
platforms: []
category: "primitive"
tokens: []
registryDependencies: []
a11yStatus: "unverified"
---
```

Source files (`packages/studio-workspace/src`): `app-manifest.ts`, `json-problem.ts`

#### Purpose

`APP_MANIFESTS` gives each of the 11 studios a task line, detail, glyph id and category for launchers. `jsonProblem` and `jsonFaultOffset` turn a JSON parse failure into a plain sentence and an offset. Not components.

#### Install

- Package: `@nitro-forge/workspace-utilities` (registry item)
- Import: `import { APP_MANIFESTS } from '@nitro-forge/studio-workspace/apps';`
- Peers: none
- Requires: `@nitro-forge/studio-layout` (not a registry item, decision 3: install by workspace or tarball, install-order.md step 3) for the `Studio` type
- Command: `npx shadcn@latest add @nitro-forge/workspace-utilities`

#### Props

| Name | Type | Default | Required | Description |
|---|---|---|---|---|
| `APP_MANIFESTS` | `Record<Studio, {task, detail, glyph, category}>` |  |  | 11 studios. |
| `jsonProblem(text, error?)` | `string` |  |  | Plain-words parse failure. |
| `jsonFaultOffset(text)` | `number` |  |  | Offset of the fault. |

#### Variants

none

#### States

none in code.

##### Motion

None.

#### A11y

- Not applicable. Non-visual.
- Platforms in source: none stated

#### Example

```tsx example=workspace-utilities
import { APP_MANIFESTS } from '@nitro-forge/studio-workspace/apps';

export const label = APP_MANIFESTS.quill.task;
```

#### Do/Don't

Do

- Use `glyph` ids that exist in `glyphIds` (47 drawn).
- Use `jsonProblem` for import error messages.

Don't

- Do not assume a glyph id renders because it is in the catalog of 1,463 reserved ids.
- Do not add a studio without a manifest row; the record type requires one.

## (b) StudioUIProvider, host, theme and directions

### `@nitro-forge/studio-ui-provider`

```yaml
---
name: "StudioUiProvider"
namespace: "@nitro-forge"
subpath: "@nitro-forge/studio-workspace/ui"
tier: 1
docs: "handwritten"
platforms: ["ios", "android", "web"]
category: "shell"
tokens: []
registryDependencies: []
a11yStatus: "unverified"
---
```

Source files (`packages/studio-workspace/src`): `ui.tsx`

#### Purpose

The slot contract between Studio and the host UI. `StudioUIProvider` puts a `StudioUIComponents` object in context and each wrapper reads its slot and forwards props. With no provider any wrapper throws "Studio requires StudioUIProvider with your application UI components. No substitute UI is installed." No fallback UI exists.

#### Install

- Package: `@nitro-forge/studio-ui-provider` (registry item)
- Import: `import { StudioUIProvider, View, Text, Button /* and the other wrappers */ } from '@nitro-forge/studio-workspace/ui';`
- Peers: `react` >=19, `react-native` >=0.81
- Requires: A `StudioUIComponents` implementation (registry item `nyc-tron-host` builds one from NYC-Tron)
- Command: `npx shadcn@latest add @nitro-forge/studio-ui-provider`

#### Props

| Name | Type | Default | Required | Description |
|---|---|---|---|---|
| components | `StudioUIComponents` | none | yes | 27 slots; 24 required, 3 optional (Popover, NativeDropdown, TokenScope). Table in the Slots section above. |
| children | `ReactNode` | none | yes |  |
| slot props | `Studio*Props` types in `ui.tsx` |  |  | `tone` and `surface` are accepted for older call sites and ignored by the NYC-Tron host. |

#### Variants

##### Button `variant`

| Value | Effect |
|---|---|
| primary, outline, ghost | NYC-Tron host maps outline to secondary. |

##### Button `size`

| Value | Effect |
|---|---|
| sm, md |  |

##### Banner `tone`

| Value | Effect |
|---|---|
| info, danger, success, neutral |  |

##### Card, KeyValueList `surface`

| Value | Effect |
|---|---|
| page, night | night wraps in `NightScope`. |

##### Toolbar `density`

| Value | Effect |
|---|---|
| default, compact |  |

##### TabBar `semantics`

| Value | Effect |
|---|---|
| tabs, navigation |  |

#### States

| State | How it is set | What the code does |
|---|---|---|
| No provider | wrapper called outside the provider | Throws. |
| Optional slot absent | Popover or NativeDropdown not supplied | Throws a named error; no generic popup is substituted. |
| TokenScope absent | native | Children render unscoped. |
| TokenScope absent | web | `display: contents` view carries the variables. |

##### Motion

None.

#### A11y

- The wrappers set nothing; `aria-label` and similar props pass through to the host component.
- Platforms in source: ios, android, web

#### Example

```tsx example=studio-ui-provider
import { StudioUIProvider, type StudioUIComponents } from '@nitro-forge/studio-workspace/ui';

declare const studioUI: StudioUIComponents;
export const Root = ({ children }: { children: React.ReactNode }) => (
  <StudioUIProvider components={studioUI}>{children}</StudioUIProvider>
);
```

#### Do/Don't

Do

- Mount the provider once above every studio component (`components`).
- Supply `Popover` and `NativeDropdown` when you use Prism, which calls them.

Don't

- Do not expect a default UI; none is installed.
- Do not recreate controls in Forge; NYC-Tron owns them (decision 1).

### `@nitro-forge/nyc-tron-host`

```yaml
---
name: "NycTronHost"
namespace: "@nitro-forge"
subpath: "@nitro-forge/studio-workspace/nyc-tron-host"
tier: 1
docs: "handwritten"
platforms: []
category: "shell"
tokens: []
registryDependencies: ["@nitro-forge/studio-ui-provider", "@nyc-tron/Button", "@nyc-tron/Card", "@nyc-tron/FieldGroup", "@nyc-tron/IconButton", "@nyc-tron/List", "@nyc-tron/SegmentedControl", "@nyc-tron/Select", "@nyc-tron/TabBar", "@nyc-tron/Toolbar", "@nyc-tron/content/KeyValueList", "@nyc-tron/feedback/Badge", "@nyc-tron/feedback/Banner", "@nyc-tron/feedback/EmptyState", "@nyc-tron/feedback/ErrorMessage", "@nyc-tron/files/DropZone", "@nyc-tron/overlays/AnchoredPopover", "@nyc-tron/theme/NightScope"]
a11yStatus: "declared"
---
```

Source files (`packages/studio-workspace/src`): `nyc-tron-host.tsx`, `nyc-tron-options.ts`

#### Purpose

`nycTronStudioUI(host)` builds a `StudioUIComponents` from NYC-Tron UI. The host supplies only platform primitives and three platform parts. Button maps Forge `outline` to NYC-Tron `secondary`; Card forces `surface="raised"` and wraps `NightScope` for `surface="night"`; IconButton applies `targetSize` as min width and height.

#### Install

- Package: `@nitro-forge/nyc-tron-host` (registry item)
- Import: `import { nycTronStudioUI } from '@nitro-forge/studio-workspace/nyc-tron-host';`
- Peers: `react` >=19, `react-native` >=0.81
- Requires: `@nitro-forge/studio-ui-provider`; `@nyc-tron/Button`; `@nyc-tron/Card`; `@nyc-tron/FieldGroup`; `@nyc-tron/IconButton`; `@nyc-tron/List`; `@nyc-tron/SegmentedControl`; `@nyc-tron/Select`; `@nyc-tron/TabBar`; `@nyc-tron/Toolbar`; `@nyc-tron/content/KeyValueList`; `@nyc-tron/feedback/Badge`; `@nyc-tron/feedback/Banner`; `@nyc-tron/feedback/EmptyState`; `@nyc-tron/feedback/ErrorMessage`; `@nyc-tron/files/DropZone`; `@nyc-tron/overlays/AnchoredPopover`; `@nyc-tron/theme/NightScope`; `@nyc-tron/expo-controls` 1.0.0-rc.2 for Select, NativePopover, NativeActionMenu (host parts); `@nyc-tron/ui` 1.0.0-rc.2
- Command: `npx shadcn@latest add @nitro-forge/nyc-tron-host`

#### Props

Extends: Argument type `NycTronHostParts`. Returns the 27-slot object.

| Name | Type | Default | Required | Description |
|---|---|---|---|---|
| View, Text, Pressable, ScrollView, TextInput, Image | host primitives | none | yes |  |
| Select | host part | none | yes |  |
| TokenScope | host part | none | no |  |
| ActionMenu | `HostActionMenu` | none | yes | `@nyc-tron/expo-controls/NativeActionMenu` in the Expo host. |
| NativePopover | `ComponentType<PopoverProps>` | none | yes |  |
| GroupedSelect | `ComponentType<SelectProps>` | none | yes | Fed by `studioDropdownGroups`. |

#### Variants

none

#### States

| State | How it is set | What the code does |
|---|---|---|
| Menu title | NYC-Tron menus have no title row | Trigger label names the menu: `triggerLabel ?? title ?? "Actions"`. |
| Popover placement | prop `placement` | Ignored; NYC-Tron measures the usable region. |

##### Motion

None.

#### A11y

- Button passes `selected` as `accessibilityState.selected`.
- Menu and Popover derive `accessibilityLabel` from the trigger label and title.
- Platforms in source: none stated

#### Example

```tsx example=nyc-tron-host
import { View, Text, Pressable, ScrollView, TextInput, Image } from 'react-native';
import { Select } from '@nyc-tron/expo-controls/Select';
import { NativePopover } from '@nyc-tron/expo-controls/NativePopover';
import { NativeActionMenu } from '@nyc-tron/expo-controls/NativeActionMenu';
import { nycTronStudioUI } from '@nitro-forge/studio-workspace/nyc-tron-host';

export const studioUI = nycTronStudioUI({
  View, Text, Pressable, Image, Select, ActionMenu: NativeActionMenu, NativePopover, GroupedSelect: Select,
  ScrollView: ScrollView as never, TextInput: TextInput as never,
});
```

#### Do/Don't

Do

- Pass NYC-Tron `Select` for both `Select` and `GroupedSelect` as the Expo host does.
- Add a `TokenScope` (Uniwind `ScopedVariables`) on native so Prism panels can scope tokens.

Don't

- Do not add Forge copies of Button or Card; this file is the only mapping (decision 1).
- Do not rely on `tone`; the host ignores it and colour comes from theme tokens.

Notes

- UNVERIFIED: the web host `apps/studio-preview/src/studio-ui.tsx` was not read.

### `@nitro-forge/studio-theme`

```yaml
---
name: "StudioTheme"
namespace: "@nitro-forge"
subpath: "@nitro-forge/studio-workspace/theme"
tier: 1
docs: "handwritten"
platforms: ["ios", "android", "web"]
category: "primitive"
tokens: ["--color-accent", "--color-border", "--color-danger", "--color-focus", "--color-info", "--color-on-danger", "--color-on-primary", "--color-paper", "--color-paper-text", "--color-paper-text-muted", "--color-primary", "--color-primary-tint", "--color-success", "--color-surface-base", "--color-surface-raised", "--color-surface-sunken", "--color-text", "--color-text-muted", "--font-editorial", "--font-mono-plain", "--radius-card", "--radius-control", "--radius-md", "--spacing-canvas", "--spacing-canvas-header", "--spacing-canvas-rail", "--spacing-canvas-toolbar", "--spacing-element", "--spacing-group", "--spacing-header", "--spacing-inset", "--spacing-page", "--spacing-rail", "--spacing-section", "--spacing-stack", "--spacing-status", "--spacing-target", "--spacing-toolbar", "--text-body", "--text-display", "--text-label", "--text-manuscript", "--text-micro", "--text-title"]
registryDependencies: []
a11yStatus: "unverified"
---
```

Source files (`packages/studio-workspace/src`): `theme.ts`, `theme.css`, `theme.native.css`

#### Purpose

The token source and its two generated stylesheets. `theme.ts` defines `workspaceThemes` (dark, light; 13 colour keys), `workspaceScale`, three densities, `workspaceStatus` and the Prism override `prismThemes`. `build-theme.mjs` writes `theme.css` (Tailwind v4 `@theme`) and `theme.native.css` (Uniwind variants). Tokens, not a component.

#### Install

- Package: `@nitro-forge/studio-theme` (registry item)
- Import: `import { workspaceThemes, workspaceScale, resolveWorkspaceScale } from '@nitro-forge/studio-workspace/theme';`
- Peers: none at runtime
- Requires: Generator step: `pnpm --filter @nitro-forge/studio-workspace build:theme` (needs a Node with type stripping; root requires >=24.3.0)
- Command: `npx shadcn@latest add @nitro-forge/studio-theme`

#### Props

| Name | Type | Default | Required | Description |
|---|---|---|---|---|
| `workspaceThemes` | `{dark, light}` x 13 keys |  |  | base raised deep line text muted accent ink soft paper paperInk paperMuted error. |
| `workspaceScale` | space, radius, type, font, size |  |  |  |
| `resolveWorkspaceScale(density)` | `WorkspaceDensityScale` | `"standard"` | no | Throws `RangeError` on an unknown density. |
| `workspaceStatus` | `{dark, light}` info, success, onError |  |  |  |
| `prismThemes` | canvas studio override |  |  | Replaces 9 keys. |

#### Variants

##### scheme

| Value | Effect |
|---|---|
| dark, light | Web: `[data-theme="light"]` block and `.dark` block (the NightScope class). Native: `@variant light` and `@variant dark`. |

##### density

| Value | Effect |
|---|---|
| compact, standard, comfortable | Changes `space` and `size` only; never `type` or `radius`. |

#### States

none in code.

##### Motion

No motion tokens exist in `theme.ts`. tokens.map.json proposes 36 motion tokens from icons, interaction policy and turret constants.

#### A11y

- Not applicable. Contrast pairs for the Workbench chrome are checked in `forge-directions.test.ts` (not run here, UNVERIFIED).
- Platforms in source: ios, android, web

#### Example

```tsx example=studio-theme
import { resolveWorkspaceScale } from '@nitro-forge/studio-workspace/theme';

export const gap = resolveWorkspaceScale('comfortable').space.group;
```

#### Do/Don't

Do

- Regenerate CSS with `build:theme` after editing `theme.ts`.
- Rebrand with the three accent keys (`accent`, `ink`, `soft`) per scheme only (decision 23).

Don't

- Do not unify the icon accent `#6859E8` with `#6950D1`; that changes pixels (decisions 5, 20).
- Do not hand-edit `theme.css`; the header says it is generated.

Notes

- Defines rather than reads. The generated CSS declares 32 custom properties today. tokens.map.json proposes 234 tokens in 19 tiers (instrument 53, motion 36, stage-colour 20, semantic-colour 18, size 15, space 14, chrome 14, type 12, icon-colour 9, icon-size 7, fixed-literal 7, layer 6, shadow 5, radius 4, document-colour 4, lab 4, icon-stroke 2, opacity 2, border 2); status counts: new-value-preserving 185, existing-ts-new-css 21, existing-nyc-tron 15, new-forge-extension 5, reserved-value-undefined-in-repo 4, existing-css-renamed 2, existing-css-keep (AGENTS.md rounded-sm 4px) 1, existing-ts-new-css (value equals title) 1. The `tokens` array in the front matter lists only the semantic roles `theme.ts` feeds.

### `@nitro-forge/forge-directions`

```yaml
---
name: "ForgeDirections"
namespace: "@nitro-forge"
subpath: "@nitro-forge/studio-workspace/directions"
tier: 1
docs: "handwritten"
platforms: []
category: "forge"
tokens: ["--color-chrome-accent", "--color-chrome-body", "--color-chrome-chip-edge", "--color-chrome-chip-ring", "--color-chrome-disabled-ink", "--color-chrome-edge", "--color-chrome-muted", "--color-chrome-press", "--color-chrome-rule", "--color-chrome-selected", "--color-chrome-selected-muted", "--color-chrome-text", "--color-chrome-well", "--color-instrument-atelier-accent", "--color-instrument-atelier-accent-halo", "--color-instrument-atelier-bezel-0", "--color-instrument-atelier-bezel-1", "--color-instrument-atelier-face-0", "--color-instrument-atelier-face-1", "--color-instrument-atelier-face-text", "--color-instrument-atelier-knurl", "--color-instrument-atelier-lathe", "--color-instrument-atelier-muted", "--color-instrument-atelier-notch", "--color-instrument-atelier-panel", "--color-instrument-atelier-panel-edge", "--color-instrument-atelier-panel-solid", "--color-instrument-atelier-text", "--color-instrument-optics-accent", "--color-instrument-optics-accent-halo", "--color-instrument-optics-bezel-0", "--color-instrument-optics-bezel-1", "--color-instrument-optics-bezel-2", "--color-instrument-optics-bezel-3", "--color-instrument-optics-face-0", "--color-instrument-optics-face-1", "--color-instrument-optics-face-text", "--color-instrument-optics-knurl", "--color-instrument-optics-lathe", "--color-instrument-optics-muted", "--color-instrument-optics-notch", "--color-instrument-optics-panel", "--color-instrument-optics-panel-edge", "--color-instrument-optics-panel-solid", "--color-instrument-optics-text", "--color-instrument-workbench-accent", "--color-instrument-workbench-accent-halo", "--color-instrument-workbench-bezel-0", "--color-instrument-workbench-bezel-1", "--color-instrument-workbench-face-0", "--color-instrument-workbench-face-1", "--color-instrument-workbench-face-text", "--color-instrument-workbench-knurl", "--color-instrument-workbench-lathe", "--color-instrument-workbench-muted", "--color-instrument-workbench-notch", "--color-instrument-workbench-panel", "--color-instrument-workbench-panel-edge", "--color-instrument-workbench-panel-solid", "--color-instrument-workbench-text", "--color-lab-ground", "--color-lab-mat", "--color-lab-paper", "--color-lab-paper-ink", "--shadow-chrome-depth", "--shadow-instrument-atelier-dial", "--shadow-instrument-atelier-panel", "--shadow-instrument-optics-dial", "--shadow-instrument-optics-panel", "--shadow-instrument-workbench-dial", "--shadow-instrument-workbench-panel"]
registryDependencies: ["@nitro-forge/studio-theme"]
a11yStatus: "unverified"
---
```

Source files (`packages/studio-workspace/src`): `forge-directions.ts`

#### Purpose

Three material directions for the Prism chrome and persona turret (workbench, optics, atelier), the Workbench chrome palette, helpers that turn a palette into the NYC-Tron semantic variables, WCAG contrast helpers and turret geometry. Audit B counts 149 hex literals here (regex-based). Not a component.

#### Install

- Package: `@nitro-forge/forge-directions` (registry item)
- Import: `import { forgeDirections, chromePalette, nycTronTokens } from '@nitro-forge/studio-workspace/directions';`
- Peers: none
- Requires: `@nitro-forge/studio-theme`
- Command: `npx shadcn@latest add @nitro-forge/forge-directions`

#### Props

| Name | Type | Default | Required | Description |
|---|---|---|---|---|
| `forgeDirections`, `FORGE_DIRECTION_IDS`, `DEFAULT_TURRET_DIRECTION` |  | `"workbench"` |  |  |
| `workbenchChrome`, `chromePalette(scheme)`, `directionPalette(direction, scheme)` |  |  |  | Palettes as `WorkspaceColors`. |
| `nycTronTokens(scheme)`, `nycTronTokensFor(colors, selected?)` |  |  |  | Variables for a `TokenScope`. |
| `luminance`, `contrastRatio` |  |  |  | WCAG. |
| `systemColor(name)`, `glassAllowed`, `detentDurationMs`, `forgeFeedbackMotion`, `turretGeometry`, `prismFillSwatches`, `labCanvas` |  |  |  |  |

#### Variants

##### direction

| Value | Effect |
|---|---|
| workbench | Graphite or white ceramic; no glass. |
| optics | Glass: blur 18, saturate 1.4. |
| atelier | Ceramic with two shadow planes. |

#### States

| State | How it is set | What the code does |
|---|---|---|
| Glass | direction has glass and neither Reduce Transparency nor More Contrast | Allowed (`glassAllowed`). |
| Forced colors | `systemColor` | Emits `var(--forge-system-<name>, <name>)`. |

##### Motion

Detent travel and feedback timings: see persona-turret.

#### A11y

- Not applicable. Non-visual; contrast helpers support checks.
- Platforms in source: none stated

#### Example

```tsx example=forge-directions
import { nycTronTokens } from '@nitro-forge/studio-workspace/directions';

export const vars = nycTronTokens('dark');
```

#### Do/Don't

Do

- Feed `nycTronTokens(scheme)` to `TokenScope` so NYC-Tron parts match the panel.
- Check new palettes with `contrastRatio`.

Don't

- Do not merge the three direction palettes; each is a separate token tier (decision 20).
- Do not treat `labCanvas` as app chrome; it backs lab pages.

Notes

- Defines the instrument tier (53 tokens), chrome tier (14) and lab tier (4) in tokens.map.json, all value-preserving and not yet in source.

## (c) Icons

### `@nitro-forge/forge-icon`

```yaml
---
name: "ForgeIcon"
namespace: "@nitro-forge"
subpath: "@nitro-forge/icons/native"
tier: 1
docs: "handwritten"
platforms: ["ios", "android", "web"]
category: "primitive"
tokens: ["--color-icon", "--color-icon-accent-bright", "--color-icon-cyan", "--color-icon-danger", "--color-icon-muted", "--color-icon-selected", "--color-icon-success", "--color-icon-surface", "--color-icon-warning", "--duration-icon-deselect", "--duration-icon-error", "--duration-icon-hover", "--duration-icon-loading", "--duration-icon-press", "--duration-icon-select", "--duration-icon-success", "--hit-target", "--opacity-disabled", "--scale-icon-press", "--scale-icon-selected", "--size-icon-default", "--size-icon-feature", "--size-icon-hero", "--size-icon-sm", "--size-icon-toolbar", "--size-icon-touch", "--size-icon-xs", "--spring-icon-damping", "--spring-icon-mass", "--spring-icon-stiffness", "--stroke-icon-box", "--stroke-icon-width"]
registryDependencies: []
a11yStatus: "declared"
---
```

Source files (`packages/icons/src`): `ForgeIcon.js`, `state.js`, `tokens.js`, `glyphs.js`, `catalog.js`, `ForgeIcon.d.ts`, `index.d.ts`, `index.js`

#### Purpose

Shared icon. Idle is a rounded outline, selected a filled silhouette, with a crossfade between them. Renders `react-native-svg` paths or a host Rive artboard through `renderRive`. COVERAGE: the catalog reserves 1,463 ids in 25 categories; 47 have drawn artwork (`glyphIds`). `ForgeIcon` returns null for an id without artwork. Do not advertise 1,463 as available.

#### Install

- Package: `@nitro-forge/forge-icon` (registry item)
- Import: `import { ForgeIcon } from '@nitro-forge/icons/native';`
- Peers: `react` >=19, `react-native` >=0.81, `react-native-svg` >=15 (all optional peers; root patches 15.16.0)
- Requires: none
- Command: `npx shadcn@latest add @nitro-forge/forge-icon`

#### Props

Extends: Helpers: `resolveIconState`, `riveIconInputs`, `getGlyph`, `hasIconId`, `getIconMetadata`, `iconsInCategory`, `searchIcons`. Authored ids (47): home dashboard menu search save file folder undo redo pen pencil brush eraser highlighter hand move pointer lasso rectangle ellipse text image layers comment play pause stop scissors table chart slide pdf video audio music bluetooth check close plus minus share export settings sparkles microphone timeline color-wheel.

| Name | Type | Default | Required | Description |
|---|---|---|---|---|
| name | `string` | none | yes | Must be one of the 47 `glyphIds` to render. |
| selected, disabled, loading, pressed, hovered | `boolean` | false | no | See States. |
| status | `"idle" \| "success" \| "error" \| "recording"` | `"idle"` | no |  |
| size | `number \| "xs" \| "sm" \| "toolbar" \| "default" \| "touch" \| "feature" \| "hero"` | `"default"` | no | 12, 16, 20, 24, 28, 32, 48; numbers 8 to 256. |
| appearance | `"light" \| "dark"` | `"light"` | no |  |
| color, selectedColor, disabledColor, successColor, errorColor, surfaceColor | `string` | token defaults | no | Per-instance overrides. |
| reducedMotion | `boolean` | false | no |  |
| renderRive | `(inputs) => ReactNode` | none | no | Host Rive hook; no runtime bundled. |
| testID | `string` | none | no |  |

#### Variants

##### variant

| Value | Effect |
|---|---|
| outline | Idle. |
| filled | Selected. |

##### size

| Value | Effect |
|---|---|
| xs 12, sm 16, toolbar 20, default 24, touch 28, feature 32, hero 48 | Pixels. |

#### States

| State | How it is set | What the code does |
|---|---|---|
| disabled | `disabled` | Opacity 0.52; color `disabledColor` or muted; no motion. |
| loading | `loading` | 850 ms linear spin loop. |
| success / error / recording | `status` | Success and error recolour; recording is a state value for Rive. |
| pressed | `pressed` | Spring to scale 0.9. |
| selected | `selected` | Crossfade to filled, scale 1.075. |
| hover | `hovered` | State value only; no visual change authored. |

##### Motion

Select crossfade 225 ms, deselect 175 ms, `Easing.out(Easing.cubic)`. Press spring stiffness 260, damping 22, mass 0.8. All motion stops under `reducedMotion` or `disabled`. Native driver on. State precedence: disabled, loading, success, error, recording, pressed, selected, hover, idle.

#### A11y

- Hidden from assistive tech: `accessible: false`, `aria-hidden`, `importantForAccessibility="no-hide-descendants"`. Name comes from the wrapper (ForgeIconButton).
- Size outside 8 to 256 throws `RangeError`.
- Platforms in source: ios, android, web

#### Example

```tsx example=forge-icon
import { ForgeIcon } from '@nitro-forge/icons/native';

export const Demo = () => <ForgeIcon name="home" selected size="toolbar" appearance="dark" />;
```

#### Do/Don't

Do

- Check `hasIconId` and `glyphIds` before showing an icon name (`name`).
- Tie `loading` and `status` to real operation state; the README forbids timers faking success.

Don't

- Do not claim 1,463 icons; 47 are drawn.
- Do not rely on `./web` working without react-native-web (UNVERIFIED).

Notes

- UNVERIFIED: whether the registry will carry the icons as `.tsx`; source is plain `.js` with a hand-written `.d.ts`.
- UNVERIFIED: `./web` resolves to the same file as `./native`, so web needs react-native-web; no web build was read.
- Drift kept as separate tokens (decision 5): icon accent `#6859E8` vs workspace `#6950D1`; icon dark surface `#11131B` vs `#15171D`. `iconColorTokens.successColor` maps to accent, a possible bug left alone (decision 16).

### `@nitro-forge/forge-icon-button`

```yaml
---
name: "ForgeIconButton"
namespace: "@nitro-forge"
subpath: "@nitro-forge/icons/native"
tier: 1
docs: "handwritten"
platforms: ["ios", "android", "web"]
category: "input"
tokens: ["--hit-target", "--spacing-fixed-stack", "--spacing-fixed-target"]
registryDependencies: ["@nitro-forge/forge-icon"]
a11yStatus: "declared"
---
```

Source files (`packages/icons/src`): `ForgeIcon.js`

#### Purpose

Pressable wrapper around `ForgeIcon` with a minimum 44 by 44 hit target and hit slop 4. It throws a `TypeError` when `label` is blank, so an unnamed icon button cannot ship. Same source file as `forge-icon`; the split is an authoring choice.

#### Install

- Package: `@nitro-forge/forge-icon-button` (registry item)
- Import: `import { ForgeIconButton } from '@nitro-forge/icons/native';`
- Peers: same as forge-icon
- Requires: `@nitro-forge/forge-icon`
- Command: `npx shadcn@latest add @nitro-forge/forge-icon-button`

#### Props

| Name | Type | Default | Required | Description |
|---|---|---|---|---|
| name | `string` | none | yes | Icon id. |
| label | `string` | none | yes | Non-blank; becomes `accessibilityLabel`. |
| onPress | `() => void` | none | no |  |
| selected, disabled, loading | `boolean` | false | no |  |
| size | as `ForgeIcon` | `"default"` | no |  |
| testID | `string` | none | no |  |
| rest | any other `ForgeIcon` prop |  | no | Forwarded. |

#### Variants

##### inherits

| Value | Effect |
|---|---|
| forge-icon | Same outline, filled and size variants. |

#### States

| State | How it is set | What the code does |
|---|---|---|
| Disabled or loading | `disabled` or `loading` | Pressable disabled; loading shows the spin. |
| Pressed | Pressable state | Fed to the icon as `pressed`. |
| Selected | `selected` | `accessibilityState.selected`. |

##### Motion

Inherits `forge-icon`.

#### A11y

- `accessibilityRole="button"`, `accessibilityLabel={label}`, `accessibilityState {selected, disabled, busy}`.
- Target `minWidth: 44`, `minHeight: 44`, `hitSlop: 4`.
- A blank label throws.
- Platforms in source: ios, android, web

#### Example

```tsx example=forge-icon-button
import { ForgeIconButton } from '@nitro-forge/icons/native';

export const Demo = () => <ForgeIconButton name="save" label="Save" onPress={() => {}} />;
```

#### Do/Don't

Do

- Pass a visible-meaning `label` (`label`).
- Set `loading` from real work so the button blocks double presses.

Don't

- Do not pass an empty `label`; it throws.
- Do not use an id outside `glyphIds`; the icon renders nothing but the 44 pt target remains.

## (d) Binding view-model adapters

### `@nitro-forge/quill-office-binding` (DEFERRED)

```yaml
---
name: "QuillOfficeBinding"
namespace: "@nitro-forge"
subpath: "@nitro-forge/quill/office-cluster"
tier: 1
docs: "handwritten"
platforms: []
category: "forge"
tokens: []
registryDependencies: []
a11yStatus: "unverified"
---
```

Source files (`packages/quill/src`): `office-cluster.ts`, `list-markers.ts`

#### Purpose

View-model for NYC-Tron `RichTextRibbon`, `BulletsNumberingEditor`, `NavigationOutline` and `DocumentReadAloudTransport`. `bindQuillRibbon(document, selection, onChanged)` returns runs, paragraph style and callbacks.

#### Install

- Package: `@nitro-forge/quill-office-binding` (registry item)
- Import: `import { bindQuillRibbon } from '@nitro-forge/quill/office-cluster';`
- Peers: none of its own
- Requires: Engine facade `@nitro-forge/quill` (deferred, decision 3) and through it `@nitro-forge/ignition` (not a registry item, decision 4: native prerequisite, install-order.md steps 0 to 1)
- Command: `npx shadcn@latest add @nitro-forge/quill-office-binding` (not published, deferred)

#### Props

| Name | Type | Default | Required | Description |
|---|---|---|---|---|
| API |  |  |  | `bindQuillRibbon`, `bindQuillList`, `bindQuillBookmarks`, `readQuillOutline`, `readQuillReadAloudBlocks`, `QUILL_PARAGRAPH_STYLES`, `QUILL_DEFERRED_OPS`. Source `office-cluster.ts` 307 lines, `list-markers.ts` 3,914 bytes. |

#### Variants

none

#### States

| State | How it is set | What the code does |
|---|---|---|
| Engine error | any write | Rejects with the engine message; nothing is applied optimistically; each write re-reads state. |

##### Motion

None.

#### A11y

- Not applicable. Non-visual view-model.
- Platforms in source: none stated

#### Example

```tsx example=quill-office-binding
// Not published. Deferred until the engine facade is installable (decision 3).
```

#### Do/Don't

Do

- Wait for the engine tarball scheme before admitting it.
- Keep the NYC-Tron prop shapes the callbacks match.

Don't

- Do not copy the file alone; its `./index` import needs the facade.
- Do not call it from a host without an open engine document.

Notes

- File-level check passed: no Rust, native or Nitro import; the only import is `import type` from `./index` plus the pure `list-markers`. Deferred because `./index` is the Quill facade, which imports `DocumentHandle` from `@nitro-forge/ignition` at runtime and is itself deferred. Admission needs the tarball scheme and an import rewrite to `@nitro-forge/quill`.

### `@nitro-forge/tally-sheet-binding` (DEFERRED)

```yaml
---
name: "TallySheetBinding"
namespace: "@nitro-forge"
subpath: "@nitro-forge/tally/grid-cluster"
tier: 1
docs: "handwritten"
platforms: []
category: "forge"
tokens: []
registryDependencies: []
a11yStatus: "unverified"
---
```

Source files (`packages/tally/src`): `grid-cluster.ts`, `grid-adapter.ts`

#### Purpose

View-model for NYC-Tron `SheetTabs` and the grid cluster. `bindTallySheetTabs(document, onChanged)` wires select, add, rename, protect, duplicate, move, tone and remove.

#### Install

- Package: `@nitro-forge/tally-sheet-binding` (registry item)
- Import: `import { bindTallySheetTabs } from '@nitro-forge/tally/grid-cluster';`
- Peers: none of its own
- Requires: Engine facade `@nitro-forge/tally` (deferred, decision 3) and through it `@nitro-forge/ignition` (not a registry item, decision 4: native prerequisite, install-order.md steps 0 to 1)
- Command: `npx shadcn@latest add @nitro-forge/tally-sheet-binding` (not published, deferred)

#### Props

| Name | Type | Default | Required | Description |
|---|---|---|---|---|
| API |  |  |  | `bindTallySheetTabs`, `readTallySheetTabs`, `tallyRangeWindow`, `readTallyRange`, `commitTallyCardField`, `commitTallyFill`, `TALLY_SHEET_BOUNDS`. Source `grid-cluster.ts` 231 lines. |

#### Variants

none

#### States

| State | How it is set | What the code does |
|---|---|---|
| Engine error | any write | Rejects with the engine message; nothing is applied optimistically; each write re-reads state. |

##### Motion

None.

#### A11y

- Not applicable. Non-visual view-model.
- Platforms in source: none stated

#### Example

```tsx example=tally-sheet-binding
// Not published. Deferred until the engine facade is installable (decision 3).
```

#### Do/Don't

Do

- Wait for the engine tarball scheme before admitting it.
- Keep the NYC-Tron prop shapes the callbacks match.

Don't

- Do not copy the file alone; its `./index` import needs the facade.
- Do not call it from a host without an open engine document.

Notes

- File-level check passed: no native import; type imports from `./index`, values from the pure `grid-adapter`. Deferred for the facade reason.

### `@nitro-forge/splice-timeline-binding` (DEFERRED)

```yaml
---
name: "SpliceTimelineBinding"
namespace: "@nitro-forge"
subpath: "@nitro-forge/splice/timeline-cluster"
tier: 1
docs: "handwritten"
platforms: []
category: "forge"
tokens: []
registryDependencies: []
a11yStatus: "unverified"
---
```

Source files (`packages/splice/src`): `timeline-cluster.ts`

#### Purpose

View-model class `SpliceTimelineAdapter` for NYC-Tron timeline controls. Reads Splice into whole frames at the sequence rate and maps each gesture to ops; two-op gestures go through `batch` so each is one undo step.

#### Install

- Package: `@nitro-forge/splice-timeline-binding` (registry item)
- Import: `import { SpliceTimelineAdapter } from '@nitro-forge/splice/timeline-cluster';`
- Peers: none of its own
- Requires: Engine facade `@nitro-forge/splice` (deferred, decision 3) and through it `@nitro-forge/ignition` (not a registry item, decision 4: native prerequisite, install-order.md steps 0 to 1)
- Command: `npx shadcn@latest add @nitro-forge/splice-timeline-binding` (not published, deferred)

#### Props

| Name | Type | Default | Required | Description |
|---|---|---|---|---|
| API |  |  |  | `new SpliceTimelineAdapter(doc, rate)`, `read()`, `timelineView`, `editOps`, `batchOps`, `timelineClusterCallbacks`, `SPLICE_TRANSITION_PRESETS`. Source 585 lines. |

#### Variants

none

#### States

| State | How it is set | What the code does |
|---|---|---|
| Engine error | any write | Rejects with the engine message; nothing is applied optimistically; each write re-reads state. |

##### Motion

None.

#### A11y

- Not applicable. Non-visual view-model.
- Platforms in source: none stated

#### Example

```tsx example=splice-timeline-binding
// Not published. Deferred until the engine facade is installable (decision 3).
```

#### Do/Don't

Do

- Wait for the engine tarball scheme before admitting it.
- Keep the NYC-Tron prop shapes the callbacks match.

Don't

- Do not copy the file alone; its `./index` import needs the facade.
- Do not call it from a host without an open engine document.

Notes

- File-level check passed: type-only import from `./index`, no runtime import. Deferred for the facade reason.

### `@nitro-forge/prism-canvas-binding` (DEFERRED)

```yaml
---
name: "PrismCanvasBinding"
namespace: "@nitro-forge"
subpath: "@nitro-forge/prism/canvas-cluster"
tier: 1
docs: "handwritten"
platforms: []
category: "forge"
tokens: []
registryDependencies: []
a11yStatus: "unverified"
---
```

Source files (`packages/prism/src`): `canvas-cluster.ts`, `canvas-types.ts`, `rgba.ts`

#### Purpose

View-model class `PrismCanvasAdapter` for NYC-Tron canvas and layers controls: alignment, distribute, origin, selection, paint, stroke, boolean ops. Each intent writes to the engine and returns fresh state.

#### Install

- Package: `@nitro-forge/prism-canvas-binding` (registry item)
- Import: `import { PrismCanvasAdapter } from '@nitro-forge/prism/canvas-cluster';`
- Peers: none of its own
- Requires: Engine facade `@nitro-forge/prism` (deferred, decision 3) and through it `@nitro-forge/ignition` (not a registry item, decision 4: native prerequisite, install-order.md steps 0 to 1)
- Command: `npx shadcn@latest add @nitro-forge/prism-canvas-binding` (not published, deferred)

#### Props

| Name | Type | Default | Required | Description |
|---|---|---|---|---|
| API |  |  |  | `new PrismCanvasAdapter(doc)`, `canvasClippingRows`, `canvasPathNodes`. Source `canvas-cluster.ts` 171 lines plus `canvas-types.ts` 312. |

#### Variants

none

#### States

| State | How it is set | What the code does |
|---|---|---|
| Engine error | any write | Rejects with the engine message; nothing is applied optimistically; each write re-reads state. |

##### Motion

None.

#### A11y

- Not applicable. Non-visual view-model.
- Platforms in source: none stated

#### Example

```tsx example=prism-canvas-binding
// Not published. Deferred until the engine facade is installable (decision 3).
```

#### Do/Don't

Do

- Wait for the engine tarball scheme before admitting it.
- Keep the NYC-Tron prop shapes the callbacks match.

Don't

- Do not copy the file alone; its `./index` import needs the facade.
- Do not call it from a host without an open engine document.

Notes

- File-level check: no native import, but a runtime import of `base64ToBytes` from the `@nitro-forge/ignition` index and type imports from the Prism facade. Deferred on both counts.

## Deferred items

Decision 3 defers engine facades: a source-copy install cannot carry the Rust engine, and distribution is GitHub tarballs at 0.0.0. The four adapters pass the file-level test (no Rust or native import in the file) but each imports its engine facade, so none installs alone. They return when the tarball versioning scheme is decided and the facade is installable.

- `@nitro-forge/quill-office-binding`: File-level check passed: no Rust, native or Nitro import; the only import is `import type` from `./index` plus the pure `list-markers`. Deferred because `./index` is the Quill facade, which imports `DocumentHandle` from `@nitro-forge/ignition` at runtime and is itself deferred. Admission needs the tarball scheme and an import rewrite to `@nitro-forge/quill`.
- `@nitro-forge/tally-sheet-binding`: File-level check passed: no native import; type imports from `./index`, values from the pure `grid-adapter`. Deferred for the facade reason.
- `@nitro-forge/splice-timeline-binding`: File-level check passed: type-only import from `./index`, no runtime import. Deferred for the facade reason.
- `@nitro-forge/prism-canvas-binding`: File-level check: no native import, but a runtime import of `base64ToBytes` from the `@nitro-forge/ignition` index and type imports from the Prism facade. Deferred on both counts.

## UNVERIFIED register

- UNVERIFIED: NYC-Tron registry id format: the template says it is not settled, so this file uses the template's export-key form for `@nyc-tron/...` dependencies.
- UNVERIFIED: Forge token names use the CSS-variable `name` of tokens.map.json; conversion to the template's dotted names is undefined.
- UNVERIFIED: Meaning of `tier` and `docs` for Forge items; the template ties tier to a NYC-Tron list.
- UNVERIFIED: Category and registry type for non-visual items (persona-model, instrument-system, workspace-utilities, forge-directions, studio-theme).
- UNVERIFIED: Template `namespace` is fixed to `"@nyc-tron"`; Forge uses `"@nitro-forge"`.
- UNVERIFIED: Every `example=` block: not type-checked, no install allowed.
- UNVERIFIED: The class `bg-ink-800` in `index.tsx` is defined nowhere in this repo.
- UNVERIFIED: `react-native-reanimated` as an optional peer: the native turret motion file imports it unconditionally; a build without it was not tried.
- UNVERIFIED: Icons `./web` entry: same file as native, needs react-native-web; no web build read.
- UNVERIFIED: Whether the registry carries the icons as `.tsx` (source is `.js` plus a hand-written `.d.ts`).
- UNVERIFIED: Web host `apps/studio-preview/src/studio-ui.tsx` was not read.
- UNVERIFIED: Screen reader, contrast, Windows High Contrast and device behaviour of every item; no item is `a11yStatus: "verified"`.
- UNVERIFIED: Visual states and prop details of NYC-Tron components behind the 27 slots: read through import sites and `ui.tsx` types only.
- UNVERIFIED: Prism layers panel: which side of the 1100 width threshold docks it was not traced.
- UNVERIFIED: Chrome contrast pairs in `forge-directions.test.ts`: tests not run here.

