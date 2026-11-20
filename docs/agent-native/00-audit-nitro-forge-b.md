# Forge audit B (prism, quill, splice, studio-layout, studio-workspace, tally, apps, rust, native)

Clone: <scratch>/forge (master). Read-only. Counts come from grep over non-test .ts/.tsx/.css files; the regex is rough (guess-grade for the numeric-literal count).

## Headline
- prism, quill, splice, tally are HEADLESS engine/document APIs (TS wrapper over a Rust engine through @nitro-forge/ignition). They ship zero visual components, zero tokens, zero colours/spacing. Nothing there to put in a shadcn registry as UI; at most "adapter/binding" items (see section 1).
- All visual chrome for the studios lives in packages/studio-workspace (39 src files) plus host apps apps/example (Expo/RN) and apps/studio-preview (Vite + react-native-web).
- studio-workspace does NOT own its UI. It defines a slot contract (`StudioUIComponents`, src/ui.tsx) filled by NYC-Tron UI (`@nyc-tron/ui`, `@nyc-tron/expo-controls`, pinned tarball rc.2 in tooling/nyc-tron.json). AGENTS.md says "NYC-Tron UI is the single owner of reusable native controls" and "Never recreate the knob, graph, crop overlay, or generic native popup inside Forge". A @nitro-forge registry must decide its relationship to NYC-Tron (re-export vs own).

## 1. Inventory

### packages/prism (5 src files, 0 TSX; 14 Rust files; contracts/canvas-cluster.ts)
- src/index.ts (564 lines): `OPS` op-name table, `PrismDocument` class (engine handle), types PrismColors, RectShape, EllipseShape, Shape, ShapeTransform, Filter.
- src/canvas-cluster.ts (171): `PrismCanvasAdapter` class, `canvasClippingRows`, `canvasPathNodes`, `PrismCanvasState`, type aliases CanvasPaint/Stroke/Node/Subpath/Region/Id.
- src/canvas-types.ts (312): BlendMode, BLEND_MODES, LayerTransform, SelectionMode/Shape/State, SampleSource, LayerBounds, Align*, PixelPreview, Artboard, PathNode, Subpath, GradientStop, Paint, Stroke, FillRule, BooleanOp, StrokeSample, StrokeModelParams, Brush*, PaintStroke*, EraseStroke* types.
- src/color-cluster.ts (119): `commitPrismFill`, `toEngineColor`, `fromEngineColor`, `readPrismColors`, `bindPrismColors`, `PRISM_COLOR_OPS`, interfaces ColorValue/ColorPairValue/PrismColorBinding/PrismColorCallbacks.
- src/rgba.ts: `Rgba = [r,g,b,a]`.
- Exports map: ".", "./canvas-cluster", "./color-cluster". Rust: stroke, geom, vector, render, raster, png, select, colors, ops, model.

### packages/quill (4 src; 21 Rust files incl. a test font fixture)
- src/index.ts (1490): `OPS`, `QuillDocument`, ~60 types (Style, Range, LayoutPage/Line, ParagraphFormat, NamedStyle, DocComment, Revision, Footnote, Toc*, Merge*, Citation/Bibliography*, PageSetup, ...).
- src/office-cluster.ts (307): `readQuillBlocks`, `quillSelectionRuns`, `QUILL_PARAGRAPH_STYLES`, `bindQuillRibbon`, `bindQuillList`, `readQuillOutline`, `readQuillReadAloudBlocks`, `quillSectionOf`, `readQuillBookmarks`, `bindQuillBookmarks`, `QUILL_DEFERRED_OPS`. These are UI-binding view-models (ribbon/list/outline/bookmarks) with no view.
- src/list-markers.ts: `deriveQuillListMarkers`. src/transfer.ts: QUILL_DOCX_EXPORT/IMPORT, QUILL_EXPORT_FORMATS/IMPORT_FORMATS.
- Exports: ".", "./office-cluster", "./transfer". Rust: format, revisions, sections, lists, toc, citations, merge, docx, footnotes, comments, glyphs, runs, fonts, change_case, tables, numbering.

### packages/splice (3 src; 6 Rust files; contracts/timeline-cluster2.ts)
- src/index.ts (319): `OPS`, `SpliceDocument`, TRANSITION_KINDS, CLIP_GAIN_DB_RANGE, CLIP_PAN_RANGE, TrackKind, RippleScope, PlacementMode, SpeedKey, ClipMix, TrackFlags.
- src/timeline-cluster.ts (585): `SpliceTimelineAdapter`, `timelineView`, `editOps`, `batchOps`, `timelineClusterCallbacks`, `SPLICE_TRANSITION_PRESETS`, `SPLICE_DEFERRED`, view types (TimelineClipView, TrackView, TransitionView, MarkerView, SpliceTimelineView, FrameRate).
- src/transfer.ts: SPLICE_PLAN_EXPORT, SPLICE_EXPORT_FORMATS/IMPORT_FORMATS. Exports: ".", "./timeline-cluster", "./transfer". Rust: timeline_edits, annotations, track_ops, transitions.

### packages/tally (4 src; 22 Rust files)
- src/index.ts (1421): `OPS`, `TallyDocument`, ~70 types (CellInfo, CellFormat, ConditionalFormat, Sort/Filter, Chart*, Sparkline*, Pivot*, Table*, SheetView*, CommentInfo, ...). `SheetTabTone = primary|accent|success|info|muted` is the only styling-adjacent type.
- src/grid-adapter.ts (197): `tallyColumnName`, `tallyCellAddress`, `parseTallyCellAddress`, `windowToA1Range`, `readTallyWindow`, `commitTallyGridCell`, consts TALLY_GRID_MAX_ROWS/COLUMNS/WINDOW_CELLS.
- src/grid-cluster.ts (231): `readTallySheetTabs`, `bindTallySheetTabs`, `tallyRangeWindow`, `readTallyRange`, `commitTallyCardField`, `commitTallyFill`, `TALLY_SHEET_BOUNDS`, `TALLY_DEFERRED_OPS`.
- src/transfer.ts (138): `colName`, `usedBounds`, `csvField`, CSV/TSV/XLSX import+export formats.
- Exports: ".", "./grid-adapter", "./grid-cluster", "./transfer". Rust: 21 *_ops modules, formula.rs (+formula/conditional.rs), xlsx.rs, protection.rs.

### packages/studio-layout (1 src file index.ts 284 lines + test; no TSX; private)
Pure model, no rendering. Exports: STUDIOS (11: prism cadence splice folio pitch tally quill photo motion design draft), DOCKS, types Studio/Dock/Rect/Geometry/DockSizes/Layout/Reason/Result/Point/DockDropPreview/DockDropQuery/DockAction; functions createWorkspace, parsePreset, serializePreset, stageFits, dockPanel, collapsePanel, floatPanel, resizeDock, applyDockAction, resolveDockDropPreview.

### packages/studio-workspace (39 non-test src files; private; README.md; 17 test files)
Components (TSX):
- `ForgeWorkspace` (index.tsx, 290 lines): three dock zones, tabs, collapse, drag/reorder/resize, presets. Props `ForgeWorkspaceProps`; `WorkspaceRow`, `WorkspaceAction`.
- `ForgeDocumentStage` (stage.tsx, 118): read-only state projection per studio.
- `PrismEditor` (prism-editor.tsx, 463; `PrismEditorProps`), `PrismCanvas` (prism-canvas.tsx, 100; exports ARTBOARD_CHECKER).
- `QuillTextEditor` (text-editor.tsx, 158; ref handle `QuillTextEditorHandle` with flush()/isDirty()).
- `PersonaTurret` (persona-turret.tsx, 502; `PersonaTurretProps`, `PersonaTurretHandle`, hooks `useStudioTextScale`, `useForgeRenderPrefs`, `useTurretShortcut`, `documentRtl`, `turretCopy`, `TURRET_SIZE`).
- `PersonaComposer` (persona-composer.tsx, 449; `PersonaComposerProps`, `ComposerGlyph`).
- `TurretPointer`, `TurretRim` (turret-motion.tsx / .native.tsx / -types.ts; Reanimated optional peer).
- `StudioGesture` (studio-gesture.tsx / .native.tsx / -types.ts; GH v3 on native).
- `nycTronStudioUI(host)` (nyc-tron-host.tsx, 78): factory mapping NYC-Tron to StudioUIComponents.
- ui.tsx (167): `StudioUIProvider` and 24 context-forwarding wrappers: View, Text, Pressable, ScrollView, TextInput, Image, Menu, Popover, NativeDropdown, Select, SegmentedControl, TabBar, Button, IconButton, Banner, Badge, EmptyState, KeyValueList, ErrorMessage, FieldGroup(+.Section), Card, Toolbar, List, ListItem, DropZone, NightScope, TokenScope. Throws if no provider ("No substitute UI is installed").
Non-visual:
- model.ts: createStudioWorkspaceStore (Zustand vanilla), createDefaultLayout, fitWorkspace, actOnPanel, PANEL_IDS (outline, properties, actions, history), MIN_STAGE 320x240.
- theme.ts (70): workspaceThemes, workspaceScale, WORKSPACE_DENSITIES, resolveWorkspaceScale, workspaceStatus, prismThemes.
- forge-directions.ts (340): 3 "directions" (workbench, optics, atelier) with material/light/depth/motion/glass, chromePalette, nycTronTokens(+For), contrastRatio, luminance, systemColor, turretGeometry, prismFillSwatches, labCanvas, detentDurationMs, glassAllowed.
- interaction-policy.ts: forgeMotionProfile, forgeHitTarget, planForgeOverlay. instrument-system.ts: instrument blueprints, scrubPrecision, advancePrecisionGesture, snapTypedPrecision, temporalRulerTicks, timebase fns. app-manifest.ts (APP_MANIFESTS per studio), persona.ts / persona-store.ts / persona-composer-model.ts / turret.ts, prism-layers.ts, prism-layout.ts, prism-canvas-model.ts, prism-transform.ts, prism-layer-label.ts, json-problem.ts, text-diff.ts, keyboard-event.ts, drag-transport(.native).ts, rgba-png.ts, nyc-tron-options.ts.
- Exports map (13): ".", model, theme, apps, prism, ui, instruments, interaction, personas, turret, composer, directions, nyc-tron-host, rgba-png.
- Build scripts: build-theme.mjs (theme.ts -> theme.css, theme.native.css), verify-ui-boundary.mjs.

## 2. Platform targets and renderer
- prism/quill/splice/tally/studio-layout: platform-neutral TS. Engines run via @nitro-forge/ignition: "Nitro in production, nf-cli in tests" (AGENTS.md). Rust engine crates are inside each package (packages/*/rust); sibling Rust workspace crates in /rust (below). No C++/Swift/Kotlin in these 4 packages.
- studio-workspace: React Native + react-native-web. Peer: react >=19, react-native >=0.81, react-native-gesture-handler >=3.4 <4, react-native-reanimated >=4.7.1 <5 (optional). Deps: zustand 5.1.0, react-native-svg 15.16.0, @nitro-forge/icons, studio-layout, ignition, @nyc-tron/ui. Platform split by file suffix: *.native.tsx/ts and theme.native.css (Uniwind). Renderer: RN views; PrismCanvas draws via RN views/SVG-style layers (guess; not read end to end), no Skia import in this package (grep found none).
- apps/example: Expo 58 / RN 0.88.1; Nitro (nitro-core, react-native-nitro-modules 1.0.0-alpha.nightly.136, react-native-nitro-image), Skia 3.9.1, react-native-webgpu 0.21.0, vision-camera 5.2.4, Uniwind 1.13.2 + Tailwind 4.3.5, reanimated 4.7.1. Persona native module linked from native/persona/nitro (`@nitro-forge/persona-native`).
- apps/studio-preview: Vite 8 + react-native-web 0.21.4 + Tailwind 4 (@tailwindcss/vite), playwright for render checks. Browser harness against real Rust engines.
- Target breadth is declared in docs/completion/components.json: required ios, android, web, macos, windows, visionos, quest, pico; additional qnx, linux, watchos, tvos. 341 canonical components tracked there (see section 7). Studio-workspace itself is RN/RNW only.
- apps/console: Node CLI (tsx), no UI.

### rust/ (directory level, 10 crates, 89 files)
folio-render (pdfium licences), ignition-core (Engine trait), nf-cli (JSON-lines test host), nf-color, nf-raw (+build.rs), nf-sys (FFI, only place `unsafe` allowed), raw-decode, scene-render, splice-render (lib + main + tests), wasm-probe (run-wasi.mjs). Workspace: Cargo.toml, Cargo.lock at root.

### native/ (directory level, 79 files, one dir: native/persona)
C++ core (src/persona.cpp, persona_c.cpp; include/nitroforge/{persona,tracking,audio2x_frames,capture_session,rigged_splats}.h[pp]), tests (cpp + c_consumer.c), openxr/ subdir (xr_tracking.cpp, tests), Package.swift (SwiftPM), CMakeLists.txt, nitro/ (nitro.json, package.json = the Nitro/JSI module `@nitro-forge/persona-native`), tools/ (Python fitting scripts), site/ (HTML), research/craft-anything, docs/ROADMAP.md. Memory note: Pi 400/QNX target exists in other parts of repo; not verified in my slice.

## 3. Token sources, naming, theming
- Single real token source: packages/studio-workspace/src/theme.ts.
  - `workspaceThemes.{dark,light}`: 13 keys (base, raised, deep, line, text, muted, accent, ink, soft, paper, paperInk, paperMuted, error) as hex. Comment: "App-neutral semantic contract. Hosts provide brand overrides".
  - `workspaceScale`: space (stack 4, element 8, inset 12, group 16, section 24, canvas 32, page 64), radius (control 4, panel 4, paper 2), type (micro 10, label 12, body 14, title 20, display 32, manuscript 20), font (Georgia, monospace), size (target 44, rail 72, header 60, toolbar 52, status 28).
  - Densities compact/standard/comfortable via `resolveWorkspaceScale` (changes space+size only; never type or radius).
  - `workspaceStatus` (info, success, onError) per scheme; `prismThemes` = canvas studio override (graphite + blue accent).
- Generated CSS: build-theme.mjs -> src/theme.css (91 lines, Tailwind v4 `@theme`, `[data-theme="light"]`, `.dark`) and src/theme.native.css (69 lines, Uniwind `@variant light/dark`). Two naming layers coexist in the same file:
  1. `--color-forge-{surface,raised,mat,border,text,muted,accent,on-accent,tint,paper,paper-ink,paper-muted,error}`, `--spacing-forge-target`, `--radius-forge-control`, `--font-forge-editorial` (Forge-specific names).
  2. NYC-Tron semantic names: `--color-{primary,on-primary,surface-raised,surface-sunken,border,text,text-muted,danger,on-danger,accent,info,success,focus}`, `--radius-{sm,control,card}`. These are shadcn-adjacent already, but not shadcn names (no background/foreground/card/muted/popover pairs).
- Per-studio brand: prismThemes (hex override) and forge-directions.ts `directionPalette(direction, scheme)` (workbench/optics/atelier). Apps: apps/example/brands/*.json (8: prism, quill, splice, tally, folio, pitch, cadence, suite) hold app identity only (productName, bundle ids, icons), validated by tooling/brand/brand.schema.json; src/brand/surfaces.ts builds strings. They carry NO colours. Only prism has its own palette; quill/splice/tally have none (they use the shared workspaceThemes). So "rebrandable per studio" currently exists for names/icons, and for colours only for prism.
- Runtime scoping: `TokenScope` + `nycTronTokens()` set CSS vars per subtree; `NightScope` for dark islands.
- Duplicate source: contrast checking and palette functions in forge-directions.ts re-declare colours (149 hex there) separate from theme.ts. Drift risk (guess: not diffed value by value).

## 4. Hardcoded values (non-test, excluding node_modules)
| Scope | files scanned | hex | rgba/hsl | numeric style literals (est.) |
|---|---|---|---|---|
| prism/src | 5 | 0 | 3 (RGBA type text; not styling, guess) | 0 |
| quill/src | 4 | 0 | 0 | 0 |
| splice/src | 3 | 0 | 0 | 0 |
| tally/src | 4 | 0 | 0 | 0 |
| studio-layout/src | 1 | 0 | 0 | 0 |
| studio-workspace/src | 39 | 387 | 7 | 251 |
| apps/example (src+app) | 25 | 9 | 0 | 67 |
| apps/studio-preview/src | 33 | 38 | 0 | 149 |
| apps/console/src | 1 | 1 | 0 | 15 |
studio-workspace's 387 hex includes the token sources themselves: theme.ts 51, theme.css 78, theme.native.css 52, forge-directions.ts 149 = 330 in token files. Component-file hex is ~57 (stage.tsx 42, prism-editor.tsx 5, index.tsx 3, persona-* ~7).

8 worst component/style files (hex + rgba + numeric literals):
1. apps/studio-preview/src/style.css: 33 hex, 110 numeric. Plain CSS: sizes, radii, durations. First 4 lines are `@import "tailwindcss" important; @source ...` so it is the web theme entry.
2. packages/studio-workspace/src/stage.tsx: 42 hex, 5 rgba, 68 numeric. e.g. `const caption = { color: theme === 'light' ? '#556359' : '#99a19d', fontSize: 11, ...}`; `backgroundColor: '#f7f5ed', borderRadius: 3, padding: 10`; `fontSize: 22, fontWeight: '500'` and a fallback `'#d9b47a'`. Uses an olive/paper palette that matches NO token in theme.ts (not workspaceThemes).
3. packages/studio-workspace/src/prism-editor.tsx: 5 hex, 69 numeric. e.g. `const FILL_COLORS = ['#6950D1','#249184','#E39B4C','#E26D92']`; `toolbarHeight: 48, railWidth: 52, fillHeight: 52` in store init; `railRight: 12 + railWidth`; `zIndex: 70`.
4. packages/studio-workspace/src/index.tsx: 3 hex, 44 numeric. Mostly already `scale.space.*` (good) mixed with `gap: scale.space.inset + 2`, `paddingBottom: scale.space.group + 2`, `width: 1200, height: 800` defaults.
5. apps/example/app/index.tsx: 29 numeric. e.g. `paddingTop: 26`, `Math.max(compact ? 16 : 24, insets.left)`, `maxWidth: 1040`, `paddingBottom: Math.max(32, insets.bottom + 20)`.
6. apps/example/src/persona-capture/PersonaCaptureScreen.tsx: 9 hex/rgba, 16 numeric. (e.g. `backgroundColor: '#2a6df4'` near line 589 per grep of the app; exact file attribution of that line not re-verified.)
7. apps/studio-preview/src/turret-lab.tsx: 1 + 18. persona-turret.tsx: 1 + 14, persona-composer.tsx: 1 + 13, interaction-policy.ts: 14 (hit-target and motion durations; these are policy constants, arguably tokens).
8. packages/studio-workspace/src/forge-directions.ts: 149 hex (token-like, e.g. shadow strings `'0 0 #FFFFFF0F 0 #00000059'`), the largest single duplication risk.
Also: Georgia/monospace font literals in theme.ts; `ARTBOARD_CHECKER` hex in prism-canvas.tsx (document canvas colours, should stay literal by design).
Takeaway: the engine packages need no token migration. Migration scope is stage.tsx, prism-editor.tsx, index.tsx, persona-*.tsx, forge-directions.ts, studio-preview style.css, example app screens.

## 5. Dependencies
Cross-package edges (from package.json):
- prism, quill, splice, tally -> @nitro-forge/ignition (workspace). No edges among the four.
- quill, splice, tally devDep @nyc-tron/ui (tarball) for `nyc-tron-consumer.test.ts` contract tests (3 files exist: quill, splice, tally). prism has none.
- studio-layout -> none.
- studio-workspace -> studio-layout, icons, ignition, @nyc-tron/ui, zustand 5.1.0, react-native-svg 15.16.0; source imports of prism/quill/splice/tally types are via ignition/prism-editor (guess; not traced import by import).
- apps/console -> ignition + 12 engine packages (cadence, design, draft, folio, photo, pitch, prism, motion, quill, scene, splice, tally). CLI only.
- apps/example -> all studios, icons, studio-layout, studio-workspace, 4 @nyc-tron pkgs, Expo 58 set, Nitro, Skia, WebGPU, Uniwind, Tailwind.
- apps/studio-preview -> studio-workspace, studio-layout, ignition, icons, @nyc-tron/ui + expo-controls, expo-linear-gradient, RNW, Tailwind.
Install order implied for any registry item: `ignition` -> engine package -> `studio-layout` -> `icons` -> NYC-Tron tarballs -> `studio-workspace/theme` + generated CSS -> `studio-workspace/ui` provider -> components. Every studio-workspace component throws without `StudioUIProvider`, so the provider + `nycTronStudioUI` host are hard prerequisites; there is no zero-dep primitive.
Install friction: @nyc-tron/* are GitHub release tarballs (not npm), pinned in tooling/nyc-tron.json; a shadcn registry consumer must be told to add them. Workspace-only packages (`private: true`: studio-layout, studio-workspace) are not publishable as-is. Prism and others are `0.1.0` unpublished.

## 6. Existing docs and gaps
- Present: packages/studio-workspace/README.md (50 lines, prose), repo AGENTS.md (root, agent guide on engines + "Existing UI controls first" + NYC-Tron ownership + no-ai-slop rule), docs/ (ARCHITECTURE, ENGINE_OPS, ROSTER, OFFICE_CLUSTER_INTEGRATION, TALLY_GRID_INTEGRATION, COMPONENT_MASTER_INVENTORY.md 473 lines, NYC_TRON_UI_HANDOFF, ui/, ux/, design/, native/, ...), apps/studio-preview/README.md + qa/README.md + 6 qa/*.json visual-QA cases, native/persona/README.md, rust/*/README.md, design/ (DIRECTION, CRITIQUE r1-r4, APP-IDENTITY), THIRD_PARTY_NOTICES.md in prism and quill.
- Missing (all four engine packages): README.md in prism, quill, splice, tally, studio-layout. Per-package AGENTS.md: none (only root). llms.txt: none. SKILL.md: none anywhere (find over repo, excluding node_modules, found only root AGENTS.md and docs/completion/components.json for these name patterns). Stories/Storybook: none (`*.stories.*` zero hits). Per-component docs pages: none; tests are the closest thing to usage examples (`tests/*.e2e.test.ts`, `nyc-tron-consumer.test.ts`).
- Docs gaps for the registry: no prop tables, no token table, no do/don't, no per-studio theme guide, no accessibility notes per component (only the instruments/policy code).

## 7. Registry-like artefacts (existing)
No shadcn registry: no `registry.json`, no `components.json` in shadcn sense (grep found `docs/completion/components.json`, which is an unrelated phased completion plan: schemaVersion 1, 341 components, phases P00.., platforms). Closest analogues:
- docs/COMPONENT_MASTER_INVENTORY.md and docs/completion/components.json: authoritative component roster and status (a good seed for the registry item list; includes absent/partial/deferred rows).
- docs/ADVANCED_NATIVE_PORT_ROSTER.md, docs/advanced-gui-native-sources.json: upstream native-source admission.
- tooling/nyc-tron.json (+ verify-nyc-tron*.mjs): pinned external UI release; this is the de facto "component source".
- apps/example/brands/*.json + tooling/brand/brand.schema.json: schema-validated rebrand manifest (identity only).
- packages/studio-workspace `./ui` slot contract (`StudioUIComponents`): a de facto interface registry.
- tooling/verify-workspace-source.mjs, verify-ui-boundary.mjs: boundary enforcement scripts to reuse as registry CI checks.

## 8. Layout primitives in studio-layout / studio-workspace
Do they provide Stack/Text/Box? No layout primitives of their own.
- studio-layout: no components at all. It is the dock/panel geometry model (Layout, Dock, Rect, dockPanel, resizeDock, resolveDockDropPreview).
- studio-workspace/ui.tsx exports `View`, `Text`, `Pressable`, `ScrollView`, `TextInput`, `Image` as thin forwarders to host-supplied implementations (NYC-Tron/Uniwind), plus Card, Toolbar, List, ListItem, FieldGroup(+Section), KeyValueList, EmptyState, Banner, Badge, Button, IconButton, TabBar, SegmentedControl, Select, Menu, Popover, NativeDropdown, DropZone, NightScope, TokenScope. So Box ~ `View` (accepts `className`), Text ~ `Text` (TextProps only; no variant/size/tone prop), plus Card/Toolbar/List as containers.
- Missing: Stack/HStack/VStack (no gap/direction/align API; layout is hand-written `style={{ flexDirection, gap, padding... }}` using `scale.space.*` values), Spacer/Divider, Heading/Label/Caption typed text variants (type scale exists in theme.ts `workspaceScale.type` but is consumed ad hoc as `fontSize` numbers), Inset/Container/Screen/SafeArea wrapper, Grid, Surface with elevation levels, Icon wrapper (icons are a separate package, @nitro-forge/icons, not read by me).
- This gap is exactly why hardcoded `fontSize`/`padding` literals appear in stage.tsx, prism-editor.tsx, and the apps. Adding Box/Stack/Text primitives bound to tokens is the enabling step before migrating those files.

## Risks and notes
- Registry namespace @nitro-forge collides with the npm scope of the packages (@nitro-forge/*); the shadcn namespace is separate from npm scope but docs must keep them distinct.
- Nothing I read states a documented rule that colours must stay out of components, but `theme.ts` header says "Hosts provide brand overrides; engines stay headless".
- Not verified: line-level contents of persona-turret.tsx, persona-composer.tsx, studio-preview style.css, exact import graph of studio-workspace to engine packages; counts are regex-based.
