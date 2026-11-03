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
pass your application's actual components. This project uses the source-owned
`studioControls` export from `nyc-mon/packages/ui` (`@acme/ui/studio-controls`).
There is no raw-native visual fallback and no copied Studio UI kit. The browser
host uses `@acme/ui/studio-controls/web` for its canonical semantic file picker.
Menu and layer opacity use the existing Menu/Select adapters, with native OS/kit
implementations selected by the consuming host. See
`docs/ux/studio-refresh/OWN_UI_INTEGRATION.md` for checkout and runtime boundaries.

Dock and layer handles reuse `DragGrabHandle`. Layers preview a measured
destination and submit a single engine move only after release. Fast release
waits for native measurement callbacks; cancellation wins while waiting.
