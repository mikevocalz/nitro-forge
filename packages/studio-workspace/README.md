# Studio workspace

Host-UI-bound React Native / React Native Web editor chrome, backed by the validated
`@nitro-forge/studio-layout` model and a vanilla Zustand store per instance.
The host supplies its existing document state and command callbacks. Panel
changes never open, close, restore or mutate an engine document.

`ForgeWorkspace` supplies three dock zones, tabs, collapse/expand, explicit
move/reorder/resize buttons, pointer/touch drag handles in Arrange panels mode,
non-destructive drop previews, cancellation, and versioned layout presets.
Keyboard users can activate the same buttons; Escape cancels an active drag.
Geometry is measured from the host. On compact hosts, panels open in the bottom
dock. Dark/light defaults, host persistence callbacks and blocked-region geometry
are supported. All preset data is layout only.

Pass `children` to supply a native canvas/editor. The default `ForgeDocumentStage`
is a read-only state projection: text/styles, raw spreadsheet cells, slide objects,
shape layers, timeline clips and PDF metadata. It is not a PDF painter, raster
compositor, media player or direct manipulation editor. The seven engine-backed
command lists remain available in Commands. Object snapping and native floating
windows remain separate workstreams.

The Expo example uses this same component. Run the local browser harness in
`apps/studio-preview` to exercise it against real Rust engines without a native
runtime. Native device, stylus, screen reader, foldable and XR validation remains
pending. No app orientation or spatial window dimensions are changed here.

```sh
pnpm --filter @nitro-forge/studio-workspace test
pnpm --filter @nitro-forge/studio-workspace typecheck
```


`QuillTextEditor` is a separate writing surface supplied through the stage slot.
It keeps a local draft in Zustand and writes minimal Unicode-aware edits through
Quill on Apply text. Its imperative `flush()` lets a host commit the draft before
saving or exporting; `isDirty()` prevents opening another document over unapplied
text. External edits cause a visible conflict and preserve the draft. Host apps
own document entry, file pickers and persistence. The shared workspace does not
require a permanent app/mode switcher.

## Required application UI

Wrap Studio with `StudioUIProvider` from `@nitro-forge/studio-workspace/ui` and
pass your application's actual components. Both hosts here build them with
`nycTronStudioUI` from `@nitro-forge/studio-workspace/nyc-tron-host`, which
maps every slot to NYC-Tron UI (release pinned in `tooling/nyc-tron.json`).
The host supplies only its platform primitives, `Select` and `NativeActionMenu`
from `@nyc-tron/expo-controls`, and an optional `TokenScope`. There is no
raw-native visual fallback. The browser host takes its file picker from
`@nyc-tron/ui/components/files/FilePicker`. NYC-Tron's colour variables are
generated with Forge's own in `src/theme.css` and `src/theme.native.css`
(`pnpm build:theme`). See `docs/ux/studio-refresh/OWN_UI_INTEGRATION.md`.

The Prism layer panel is NYC-Tron UI's `LayerStack`
(`@nyc-tron/ui/components/forge/layers/LayerStack`, release pinned in
`tooling/nyc-tron.json`). `src/prism-layers.ts` maps Prism's bottom-to-top
layers to its top-first rows and turns each move, visibility toggle, rename
released opacity drag and row removal into one engine operation, so one
undo step. Rows carry Prism's kind ("Rectangle", "Ellipse", "Raster") and a
shape's fill as the thumbnail.
Selection stays in the editor store. Dock and Composer handles use NYC-Tron's
`DragGrabHandle`, and layer opacity uses its `PrecisionScrubber`; NYC-Tron's
colour variables come from `nycTronTokens` through the host's `TokenScope`.
