# Studio workspace

Shared React Native / React Native Web editor chrome, backed by the validated
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
