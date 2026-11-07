# Prism document detail controls — P04–P07 source checkpoint

`apps/studio-preview/src/prism-detail-controls.tsx` composes existing NYC-Tron controls with Forge's typed Prism operations. It owns only per-document presentation state. The caller supplies the already-open PrismDocument, an authoritative full PrismCanvasState, a disabled flag and the shared source/selection/operation commit gate. The parent must perform a fresh full describe and publish it after mutations; a partial layers-only state is not this contract.

## Supported composition

Objects: existing layer property selection, lock/unlock, canonical clipping, bounded numeric translation/rotation and MaskThumbnailAndEditor. Mask add/remove/apply, enable/invert/refine and thumbnails use PrismCanvasAdapter. Mask availability reads the actual getSelection result. Transform ranges include the current valid engine value rather than clamping document data to an arbitrary UI range. Locked layers keep their existing engine restriction.

Selection: whole-canvas select/deselect/invert, canonical grow/shrink/feather settings, controlled engine object selection and AlignDistributePanel. Alignment, distribution and sibling arrange use the actual selected IDs and typed adapter. Wand settings do not claim wand sampling: connecting the existing MagicWandCanvas to the real artboard input is separate work. Smooth/refine-edge callbacks are absent because that operation is not provided by this adapter.

Artboards: ArtboardNavigator reads authoritative board order/geometry and uses actual add/rename/remove/reorder operations and real artboardThumbnail results. The optional onSelectArtboard callback lets the existing viewport reveal a board. Without it, selection supplies the alignment reference; this component does not move the canvas, navigate routes or resize the app window.

Colors: ForegroundBackgroundChips, ColorPickerDialog and SwatchGrid read getColors and commit real palette/recent operations. The canonical chip pair emits the resulting pair for Swap/Reset; one setColors command with remember:false applies either action without guessing its intent or modifying recent colors. Picker draft changes stay local until Apply. A foreground color can fill a supported raster, shape, path or boolean layer through the existing engine APIs. The preview loaders and color reads discard source/selection/availability generations that no longer match. The older released widgets reset their local gestures/drafts on source/selection boundaries, not density or geometry. Picker ownership also checks its original document state so an old draft is not applied to a restored document.

## Integration API

Render `PrismDetailControls({document,state,disabled,commit,density,theme,selectedLayerId?,onSelectLayer?,onSelectArtboard?})` within an existing bounded inspector/scroll region. Supply selectedLayerId/onSelectLayer to share primary layer focus with the existing canvas/layer UI; the component can own a fallback property focus when used standalone. The shared commit must serialize these writes with header Save/Open/history and the existing editor's direct writes. A separate uncoordinated lock is insufficient. The component does not open or close a handle and does not replace the existing canvas renderer.

## Parent integration

The preview now routes Prism through EngineStudioSurface. PrismCanvasAdapter.read supplies the full authoritative canvas description; the editor and detail controls share the host write gate with file/history commands. The original EngineResult is returned to the editor so newly created layer focus still works. Flatten/describe/renderRegion remain reads and do not reload their own source. One host Zustand store supplies primary layer focus to both surfaces, with standalone fallback retained in PrismEditor. The detail region has a bounded scroll height inside the current workspace. Regular opened documents remain mounted while lab routes are displayed rather than being closed by an early return.

## Original phase exit criteria still open

P04 requires full overlay/clipboard/file-delivery and document/workspace continuity acceptance across all required hosts. This composition reuses the real canonical dialog and the caller's existing operation owner; it does not certify those other delivery paths.

P05 has genuine engine canvas transforms, selection, grouping, masks, booleans, artboards, paths and render/thumbnail operations in the inspected typed Prism API. This checkpoint connects a subset. Arbitrary offset crop/encode is absent from that API; resize is not substituted for crop. The Vector detail tab now connects the canonical ShapeBuilder to boolean combine/change/release/rasterize, and real group/ungroup commands. FillStrokeInspector edits selected path fill/gradient, stroke width/join/cap/miter/dashes, winding and paint order through the existing vector adapter. New gradient defaults span the actual content-space control hull of path anchors and handles, not a claimed pixel-tight render bound. Degenerate zero-width/height paths retain an explicit limitation. Optional stroke defaults match the inspected Rust serde model. Node overlays, mask painting and on-canvas gradient handles still need the real editor coordinate/gesture integration and acceptance. No separate drawing canvas was introduced.

P06 is not completed by path stroke styling. The inspected Prism index/canvas adapter exposes no live brush/dynamics/taper/stabilization, hardware stylus/prediction/Muse session or timelapse encoder contract. The repository's advanced native port roster points to separate Board/Muse work; that work was not audited or implemented here.

P07's inspected palette adapter supports foreground/background/recent RGBA and solid fills. Prism also exposes solid/linear/radial paint and basic grayscale/invert/brightness operations, but ICC/proof/gamut, full grading/scopes, mesh gradient processing and genuine eyedropper integration are not established by this palette composition. The picker is an sRGB display control, not a claim of color-managed processing.

## Verification

Preview and workspace TypeScript checking and static diff checking passed. Production bundling also passed after installing the real expo-linear-gradient 58.0.3 peer required by the canonical HsvPicker. Vite reports module directive/chunk size warnings. No runtime, native binary, browser/device, engine acceptance or full suite was executed, per the user's review gate. Required native/accessibility/keyboard/RTL/large-text, viewport reveal and actual rendered-image evidence remain open. Published alpha.4 pins, native manifests, window/orientation contracts and unrelated native-media changes remain unchanged. These are source implementation advances within P04–P07; none of those formal phases is declared complete.

## Bounded PNG delivery

The preview's Export PNG action reads the actual Prism describe/flatten result and reuses the existing portable RGBA PNG encoder. It admits at most 1,048,576 pixels and 4096 pixels per side before requesting the flattened buffer, rechecks returned dimensions and byte length, and requests a browser download of the resulting PNG. Unmounted/replaced document owners discard the result before delivery; object URLs are revoked. This is an 8-bit RGBA file without an embedded ICC profile or color conversion. Larger canvas exports, native destination providers and actual file/image acceptance remain open. Combined preview/workspace typechecks and production bundling passed; no runtime suite was run.
