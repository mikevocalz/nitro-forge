# Nitro Forge audit A: cadence, folio, icons, ignition, pitch + shared root

Clone: <scratch>/forge (master, shallow). Read-only. Counts are from grep/find on that clone; "guess" marks inference.

## 0. Headline findings

1. **cadence, folio, pitch ship zero UI components.** They are typed TS facades over a Rust engine (`packages/<p>/rust`) plus "cluster adapters" that return props/callbacks for components owned by the external `@nyc-tron/ui` package. A shadcn-style registry of *components* has nothing to copy out of these three. What they can contribute to a registry are adapter/binding files and doc pages.
2. **Only `icons` contains a rendered React Native component** (`ForgeIcon`, `ForgeIconButton`). It is plain JS with `React.createElement`, no TSX, no JSX.
3. **Real token sources live outside my slice**: `packages/studio-workspace/src/theme.ts` (generates `theme.css`, `theme.native.css` via `build-theme.mjs`), `packages/icons/src/tokens.js`, and `tooling/brand/icon-family.mjs` (per-studio launcher colours). Three unrelated token sets, three naming schemes, no shared source.
4. **No registry artefact exists.** No `registry.json`, no shadcn `components.json`, no `llms.txt`, no `SKILL.md` anywhere in the repo (find, excluding node_modules). `docs/completion/components.json` is a 341-row completion plan, not a registry.
5. The suite's UI is injected from NYC-Tron UI release tarballs pinned in `tooling/nyc-tron.json` (`v1.0.0-rc.2`, 7 `@nyc-tron/*` packages). `AGENTS.md` says NYC-Tron owns reusable controls and "Never recreate the knob, graph, crop overlay, or generic native popup inside Forge". A `@nitro-forge` registry has to sit on top of that rule, or the rule needs a documented exception.

## 1. Inventories

### 1.1 packages/cadence (`@nitro-forge/cadence` 0.1.0, 31 files)
Exports map: `.`, `./instrument-adapter`, `./instrument-session`, `./editor-adapter`, `./mixer-cluster`, `./transfer`. `main`/`types` point at `src/index.ts` (no build step; source is published).

| Name | File | Purpose |
|---|---|---|
| `OPS` (59 op-name entries), `CadenceDocument` + ~25 types (`TrackKind`, `InsertKind`, `EqBand`, `CompressorParams`, `MeterResult`, `LoudnessResult`, `SpectrogramResult`, `BeatDetectionResult`, `CadenceMarker`, `InsertPreset`, `ProjectInfo`...) | src/index.ts (569 lines) | Typed document API over `DocumentHandle`: tracks, clips, notes, inserts, automation, markers, analysis, render |
| `createCadenceMixerBindings`, `createCadenceTempoBindings`, `createCadenceClipBindings`, `toMixerChannels`, `toMidiNotes`, `MIN_BPM=20`, `MAX_BPM=400`, `CadenceMixerBindings/TempoBindings/ClipBindings` | src/editor-adapter.ts (208) | Props/callback bindings for StepSequencer-style mixer/tempo/clip editors |
| `createCadenceTrackInstrumentBindings`, `toNativeKnobBinding`, `CadenceKnobBinding`, `CadenceNativeKnobBinding`, `InstrumentCommit` | src/instrument-adapter.ts (93) | Knob props: `InstrumentKnob` (`@nyc-tron/ui`, RN views) and `ArcKnob` (`@nyc-tron/native-controls`, SwiftUI/Compose) |
| `CadenceInstrumentSession`, `CadenceInstrumentState`, `CadenceInstrumentListener`, `CadenceInstrumentOptions` | src/instrument-session.ts (239) | Serialized knob commits with state/listeners |
| `CadenceMixerAdapter` (class), `mixerClusterChannels`, `mixerClusterRoutes`, `mixerClusterSlots`, `MixerInsert`, `CadenceMixerState`, `MixerId` | src/mixer-cluster.ts (122) | Adapter feeding MixingConsole, BusAndRoutingMatrix, InsertEffectRack, EQ, dynamics, automation, MIDI, analysis |
| `CADENCE_WAV_EXPORT`, `CADENCE_EXPORT_FORMATS`, `CADENCE_IMPORT_FORMATS`, `songEndTicks`, `wavFloat32Stereo`, `WAV_SAMPLE_RATE=48000` | src/transfer.ts (74) | Import/export format tables for the file sheet |
| (type-only) | contracts/audio-cluster.ts (33) | Compile-time check: 14 `@nyc-tron/ui` prop types (MixingConsole, MixGroupBar, BusAndRoutingMatrix, InsertEffectRack, PluginPresetBrowser, EQFrequencyGraph, DynamicsTransferGraph, AutomationLane, AutomationModePicker, MIDIVelocityLane, MIDIPianoRoll, TempoAndMetronome, LoudnessMeter, SpectrogramView) |

Rust: `packages/cadence/rust` crate `cadence-engine`, 9 .rs files, ~4,300 lines (`lib.rs` 1888; analysis, dsp, markers, mix_ops, mix_ops_tests, mixer_model, presets, render). Deps: ignition-core, serde, serde_json only.
Tests: 12 files in tests/ (9 e2e/unit vitest, `nyc-tron-props.typecheck.ts`, `v1-host-session.test.ts`).

### 1.2 packages/folio (`@nitro-forge/folio` 0.1.0, 35 files)
Exports: `.`, `./office-cluster`, `./render`, `./transfer`.

| Name | File | Purpose |
|---|---|---|
| `OPS` (36 entries), `FolioDocument` + ~30 types (`Annotation`, `AnnotSubtype`, `InkPaths`, `FolioFormField`, `FolioSignature`, `FolioAttachmentInfo`, `FolioRedactReport`, `FolioCompareResult`, `FolioOutlineItem`, `FolioPageImage`, `FolioEncryptOptions`...) | src/index.ts (776) | PDF document API |
| `FOLIO_ANNOTATION_TOOLS` (8 tools), `FolioAnnotationTool`, `readFolioPageCount`, `folioSearchPages`, `readFolioReadAloudBlocks`, `addFolioAnnotation`, `bindFolioHistory`, `readFolioThreads`, `folioThreadRef`, `bindFolioComments`, `FolioThread`, `FolioCommentsBinding`, `FOLIO_DEFERRED_OPS = {}` | src/office-cluster.ts (203) | Binds PDF viewer, annotation toolbar, comments, read-aloud transport. Imports no React, no `@nyc-tron/*` |
| `FolioRenderService`, `FolioRenderTextItem/SearchHit/Link/PageInfo/OpenInfo/PageRequest/Png/Raw/Image` | src/render.ts (290) | Client for the `rust/folio-render` pdfium host service |
| `FOLIO_PDF_EXPORT/IMPORT`, `FOLIO_EXPORT_FORMATS`, `FOLIO_IMPORT_FORMATS` | src/transfer.ts (29) | Format tables |

Rust: `packages/folio/rust`, crate `folio-engine`, 15 .rs files + 2 examples, ~14,000 lines (largest: redact 2109, lib 1701, outlines 1667, page_image 1610, forms 1523, page_ops 1306). Deps: lopdf 0.36, md-5, flate2, crc32fast, rand 0.9. Separate host crate `rust/folio-render` (lib 724, pdfium 108, main 15; links real libpdfium, see ROSTER).
Tests: 13 files incl. fixtures `forms.pdf`, `signatures.pdf`; `nyc-tron-consumer.test.ts`.

### 1.3 packages/pitch (`@nitro-forge/pitch` 0.1.0, 23 files)
Exports: `.`, `./office-cluster`.

| Name | File | Purpose |
|---|---|---|
| `OPS` (72 entries), `PitchDocument`, ~45 types (`PitchTheme`, `PitchThemeColorSlot`, `PitchMaster`, `PitchLayout`, `PitchPlaceholder`, `PitchShapeKind`, `PitchConnectorSpec`, `PitchMediaSpec`, `PitchChartSpec`, `PitchTableSpec`, `PitchInkStroke`, `PitchSlideTransition`, `PitchSlideTiming`, `AnimKind` (7), `PitchScene`, `Rgba`...) | src/index.ts (1031) | Slides API |
| `PITCH_SLIDE_SIZE` (960x540), `PITCH_ANIMATION_EFFECTS`, `PITCH_DEFERRED_OPS`, `readPitchDeck`, `pitchId`, `pitchMovePlan`, `bindPitchSlideList`, `bindPitchCanvas`, `bindPitchAnimations`, `readPitchSlideAt`, `PitchSlideObject/Summary/Animation`, `PitchDeck` | src/office-cluster.ts (334) | Binds slide list, canvas, animation pane. Refuses to render shape kinds the pinned NYC-Tron slide renderer lacks (`UNSUPPORTED_OBJECT_KINDS`: roundedRect, ellipse, triangle, diamond, line, arrow, star, connector, media, chart, table) |

Rust: `packages/pitch/rust`, crate `pitch-engine`, 6 .rs files, ~9,500 lines (`lib.rs` 5755, data 1089, masters 1308, themes 558, animation 553, sections 229). Deps: ignition-core, serde, serde_json.
Tests: 12 files incl. `animation-pixels.e2e.test.ts` (renders through Prism's CPU renderer).

### 1.4 packages/icons (`@nitro-forge/icons` 0.1.0, private, 12 files, plain ESM JS + hand-written .d.ts)
Exports: `.`, `./native`, `./web` (both map to the same `ForgeIcon.js`), `./catalog`, `./glyphs`.

| Name | File | Purpose |
|---|---|---|
| `ForgeIcon`, `ForgeIconButton` | src/ForgeIcon.js (98) | The only rendered components. react-native `Animated` crossfade outline->filled, spring on press, loop spin when loading, `renderRive` hook, `Pressable` with `minWidth/minHeight: 44`, throws on blank `label` |
| `iconGroups` (25 categories), `iconCategories`, `iconIds` (**1,463 ids**), `hasIconId`, `getIconMetadata`, `iconsInCategory`, `searchIcons` | src/catalog.js (40, very long lines) | Semantic inventory |
| `glyphs`, `glyphIds` (**47 authored**), `getGlyph(id, variant)` | src/glyphs.js (104) | 24x24 paths as `[d, "stroke"/"fill"/"knockout"]` tuples. 47 of 1,463 ids have artwork (3.2%); README says the rest is design backlog |
| `resolveIconState`, `riveIconInputs` | src/state.js (29) | Pure state resolver (9 states) |
| `iconColors`, `iconSizes`, `iconStroke`, `iconMotion`, `iconStates` | src/tokens.js (14) | Token sources |

Authored glyph ids: home dashboard menu search save file folder undo redo pen pencil brush eraser highlighter hand move pointer lasso rectangle ellipse text image layers comment play pause stop scissors table chart slide pdf video audio music bluetooth check close plus minus share export settings sparkles microphone timeline color-wheel.
Tests: 2 files (icon-contract, motion-contract), run with `node --test`. No typecheck beyond `node --check`.

### 1.5 packages/ignition (`@nitro-forge/ignition` 0.1.0, 116 files, 23 .ts/.js source files, 49 generated nitrogen files)
Exports (13): `.`, `./cli` (host-cli), `./nitro` (specs/ForgeFactory.nitro), `./v1-host`, `./workspace`, `./transfer`, `./workspace-ui`, `./transfer-ui`, `./autosave`, `./transactions`, `./collaboration`, `./collaboration-http`, `./collaboration-checkpoint`. Plus `imports: {"#nitro/*": "./nitrogen/generated/shared/javascript/*.cjs"}`.

| Group | Files | Names |
|---|---|---|
| Core contracts | types.ts (67), contracts.ts (34), index.ts (27) | `ENGINE_KINDS` (12: prism cadence splice folio pitch tally quill photo motion design draft scene), `EngineError`, 8 `ErrorCode`s, `RESERVED_OPS`, `Command`, `CommandResult`, `ForgeEvent` |
| Host | host.ts (184), host-cli.ts (184), v1-host.ts (129), document.ts (135), base64.ts (56), owned-json.ts (36) | `NitroHost`, `createNitroHost`, `createNativeForgeFactory`, `DocumentHandle`, CLI JSON-lines host for tests |
| Nitro specs | specs/ForgeFactory, ForgeDocument, ForgeTask, ForgeMediaCache `.nitro.ts` | 4 HybridObjects |
| Workspace | workspace.ts (406), workspace-ui.ts (19) | `WorkspaceSession`, built-in presets edit/color/audio/review/presentation, `PRESET_NAME_MAX=40`, `workspaceUiView`, `workspaceUiBindings` (feeds NYC-Tron `WorkspaceHost`, `WorkspacePresetSwitcher`) |
| Transfer | transfer.ts (172), transfer-ui.ts (34) | `runExport/runImport`, `transferUiFormats`, `transferUiImports`, `createTransferUiBindings` (feeds `FileImportExportSheet`) |
| Persistence/collab | autosave.ts (199), transactions.ts (116), collaboration.ts (220), collaboration-http.ts (168), collaboration-checkpoint.ts (104) | `DocumentAutosave`, `createCheckpointStore`, `UndoTransactionCoordinator`, `DocumentCollaboration`, `CollaborationConflict` |
| contracts/ | workspace-cluster.ts (18) | Type-check of NYC-Tron shell/files/color props |
Tests: 18 files in tests/ (host, nitro-host, autosave, collaboration, workspace, transactions, per-engine registration...).

## 2. Platform targets and renderers

| Package | Platforms | Renderer | Native/JSI |
|---|---|---|---|
| cadence | Anywhere the ignition host runs: iOS, Android (Nitro), Node (nf-cli). Web via wasm is a separate lane (`rust/wasm-probe`, guess: not wired for these three) | None. Headless. Audio render returns Float32 PCM bytes | No native files of its own. Rust crate only |
| folio | Same. Rendering is out of process: `rust/folio-render` uses pdfium (host service, macOS-verified per ROSTER) | None in-package. `FolioRenderService` returns PNG/raw pixels | Rust only |
| pitch | Same | None. Pixel output goes through Prism CPU renderer in tests | Rust only |
| icons | RN (iOS/Android) via `react-native-svg` + `Animated`; `./web` entry exists but resolves to the same RN file, so web needs react-native-web (guess; not verified in repo). QNX not mentioned | react-native-svg paths; optional host Rive via `renderRive` (no Rive runtime bundled) | None |
| ignition | iOS (>= 16, `Package.swift` `.iOS(.v16)`, podspec `NitroForgeV1.podspec`), Android (CMake, NDK, abis armeabi-v7a/arm64-v8a/x86/x86_64, prefab, minSdk from root project), Node (CLI host) | n/a | Nitro HybridObjects, all C++ (`language: "c++"` for Apple and Android) |

Ignition native inventory (hand-written): `cpp/ForgeRustSession.cpp` (185), `HybridForgeDocument.cpp` (135), `HybridForgeFactory.cpp` (48), `nf_v1.h` (86 C ABI header), headers `cpp/NitroForgeV1/{ByteCache,ForgeRustSession,HybridForgeDocument,HybridForgeFactory,HybridForgeMediaCache,HybridForgeTask,SerialQueue,TaskControl}.hpp`; `android/src/main/cpp-adapter.cpp` (7), `android/.../NitroForgePackage.java` (18), `android/CMakeLists.txt`, `android/build.gradle`; `scripts/build-apple.sh` (builds `native/ForgeRust.xcframework`), `build-android.sh`; `Package.swift` (swift-tools 6.4, binaryTarget `ForgeRust`). No Swift or Kotlin sources of its own. Generated (nitrogen, 49 files): Swift module `NitroForgeV1Module.swift`, Kotlin `NitroForgeV1OnLoad.kt`, C++ specs, `.cjs/.d.cts` JS stubs. Nitro runtime pinned `1.0.0-alpha.nightly.136.gdb81de61bd32` (peer + root override). C ABI backend: `rust/nf-sys`.

## 3. Tokens and theming

| Source | Naming | Values | Mechanism |
|---|---|---|---|
| `packages/icons/src/tokens.js` | camelCase maps: `iconColors{ink,inkInverse,muted,accent,accentBright,cyan,positive,warning,negative}`, `iconSizes{xs12,sm16,toolbar20,default24,touch28,feature32,hero48}`, `iconStroke{size24,width2.35}`, `iconMotion{hoverMs120,pressMs110,selectMs225,deselectMs175,successMs320,errorMs240,loadingMs850,pressScale0.9,selectedScale1.075}` | Hex literals, frozen objects | Overridable per instance via props (`color`, `selectedColor`, `successColor`, `errorColor`, `surfaceColor`, `appearance`). No provider, no CSS variables. README: "No baked-in brand colors... default palette is merely a demonstration" |
| `packages/studio-workspace/src/theme.ts` (not my slice, read for context) | `workspaceThemes.{dark,light}`: base raised deep line text muted accent ink soft paper paperInk paperMuted error (13 keys each); `workspaceScale`: space{stack4 element8 inset12 group16 section24 canvas32 page64}, radius{control4 panel4 paper2}, type{micro10 label12 body14 title20 display32 manuscript20}, size{target44 rail72 header60 toolbar52 status28}; densities compact/standard/comfortable | Hex per theme | `build-theme.mjs` generates `theme.css` (Tailwind v4 `@theme`, 91 lines) and `theme.native.css` (69 lines). CSS var names: `--color-forge-{surface,raised,mat,border,text,muted,accent,on-accent,tint,paper,paper-ink,paper-muted,error}`, plus shadcn-like aliases `--color-{primary,on-primary,surface-raised,surface-sunken,border,text,text-muted,danger,on-danger,accent,info,success,focus}`, `--spacing-forge-target`, `--radius-sm` |
| `tooling/brand/icon-family.mjs` | `FAMILY.{suite,prism,quill,tally,pitch,folio,splice,cadence,audio-lab,media-lab,cadence-qa}`: `{colour, source, ground, glyph}`; `GROUNDS{product,lab}`; `STEEL` | Per-studio accent hex: prism #9C5FE6, quill #4F77E8, tally #33B38B, pitch #F07C2F, folio #DE4339, splice #E3B23D, cadence #40B5DB, suite #F3E7D3 | Launcher-icon generation only. Not connected to in-app theme |
| `tooling/brand/brand.schema.json` + `apps/example/brands/{cadence,folio,pitch,prism,quill,splice,suite,tally}.json` | `id, productName, shortName, engine, slug, scheme, ios.bundleIdentifier, android.package, icons.{family,app,adaptiveForeground,adaptiveBackground,adaptiveMonochrome,favicon}` | JSON | Expo config plugin `tooling/brand/plugin.cjs`; `rebrand-check.mjs` tests it. **This is today's rebrand mechanism**: rewrite name fields, bundle ids, icon art. Schema description: "A rebrand rewrites id, productName, shortName, slug, scheme and the identifiers; engine and icons are left alone." It carries no colour or radius tokens |
| NYC-Tron UI (external tarball) | n/a here | n/a | Host-injected through `packages/studio-workspace/src/nyc-tron-host.tsx`. Semantic colours "are consumed by the host-injected NYC UI components" (theme.ts header comment) |

Today a studio is rebranded by: (a) a brand JSON (name, ids, icons), (b) swapping `workspaceThemes` / generated CSS in studio-workspace, (c) per-instance colour props on `ForgeIcon`. There is no single token file the three studios (cadence, folio, pitch) read; their TS packages have no colour awareness at all. The accent per studio exists only in `icon-family.mjs`.

Rules in AGENTS.md that constrain tokens: "Preserve rounded-sm (4px) Studio chrome" and the design constitution (docs/ux/FORGE_2046_DESIGN_SYSTEM.md): "Configure semantic tokens in Studio; never hard-code a different visual foundation in each app."

## 4. Hardcoded values (src only, tests/node_modules/generated excluded)

| Package | Hex | rgba()/hsl() literals | spacing/radius/fontSize literals | duration/motion literals | Notes |
|---|---|---|---|---|---|
| cadence | 0 | 0 | 0 | 0 | headless; `MIN_BPM 20`, `MAX_BPM 400`, `WAV_SAMPLE_RATE 48000` are domain constants |
| folio | 0 | 0 | 0 | 0 | headless |
| pitch | 0 | 0 (4 grep hits are calls to local helper `rgba()` at office-cluster.ts:114,150,154,155,178; engine colours are `Rgba` tuples from Rust) | 0 | 0 | `PITCH_SLIDE_SIZE` 960x540 is a document constant, not UI |
| ignition | 0 | 0 | 0 | 0 | |
| icons | **11** (tokens.js 9, ForgeIcon.js 2) | 0 | 4 in ForgeIcon.js: `minWidth:44`, `minHeight:44`, `hitSlop:4`, viewBox `0 0 24 24`; stroke linecap strings | ~9 in tokens.js (as tokens), plus 3 inline spring/timing constants in ForgeIcon.js: `stiffness:260, damping:22, mass:0.8`; `opacity: disabled ? 0.52 : 1` in state.js | |

Totals for the slice: hex 11, rgba/hsl 0, layout literals 4, motion literals 3 inline + 9 token values, opacity 1 (0.52).

Worst files (only 3 files have anything; "8 worst" does not exist in this slice):
1. `packages/icons/src/tokens.js` lines 3-5: `ink:"#18202D", inkInverse:"#F8FAFC", muted:"#737F91", accent:"#6859E8", accentBright:"#8E83FF", cyan:"#00B6C7", positive:"#139E75", warning:"#C68B27", negative:"#D94462"` (9 hex).
2. `packages/icons/src/ForgeIcon.js:36`: `const surface=surfaceColor??(appearance==="dark"?"#11131B":"#FFFFFF");` (2 hex; the dark value differs from every token in studio-workspace, `#1C1E25`/`#15171D`).
3. `packages/icons/src/ForgeIcon.js:52-53`: `stiffness:260,damping:22, mass:0.8`.
4. `packages/icons/src/ForgeIcon.js:93-94`: `hitSlop:4`, `minWidth:44,minHeight:44` (duplicates `workspaceScale.size.target=44`).
5. `packages/icons/src/state.js`: `opacity:disabled?0.52:1`; range check `pixels<8||pixels>256`.
6. `packages/icons/src/glyphs.js`: ~47 x 2 SVG path strings (art data, not tokens; leave alone).
7-8. none. Cadence/folio/pitch/ignition contain nothing to extract.

Colour drift (finding): icon palette `accent #6859E8` vs studio-workspace light accent `#6950D1` / dark `#B7A5FF`; icon surface dark `#11131B` vs workspace `#15171D`. Two near-duplicate token sets already diverge.

## 5. Dependencies

Workspace edges (from package.json): cadence -> ignition; folio -> ignition; pitch -> ignition; icons -> (none); ignition -> (none). Reverse: studio-workspace -> icons, ignition, studio-layout; apps/example -> all engines + icons + studio-layout + studio-workspace + persona-native; apps/studio-preview -> icons, ignition, studio-layout, studio-workspace; apps/console -> 13 packages (no icons).
Type-level (not in package.json deps): cadence, folio, pitch all import types from `@nyc-tron/ui/...` in `contracts/`, `tests/`, and doc comments; runtime source does not import it. `@nyc-tron/ui` is a devDependency by URL tarball (cadence, folio, pitch). Cadence's `contracts/audio-cluster.ts` and ignition's `contracts/workspace-cluster.ts` reach into other packages by relative path (`../../prism/src/color-cluster`): a layering leak.
Mentioned but not present in package.json: `@nyc-tron/native-charts` (pitch/src/index.ts:309 comment), `@nyc-tron/native-controls` (cadence comments).

External deps:
- cadence: dev only: typescript 7.0.2, vitest 5.1.0, @nyc-tron/ui rc.2 tarball, @types/react ~19.3.0, react 19.3.1, react-native 0.88.1.
- folio, pitch: dev only: typescript, vitest, @nyc-tron/ui.
- icons: peer (all optional): react >=19, react-native >=0.81, react-native-svg >=15; dev @types/react 19.3.0. Root patches react-native-svg@15.16.0.
- ignition: dev: react-native-nitro-modules / nitrogen / nitro-core `1.0.0-alpha.nightly.136.gdb81de61bd32`, typescript, vitest; peer: react-native-nitro-modules, nitro-core (same pin). Root pnpm overrides force the same nightly everywhere.
- Rust: workspace edition 2021, MIT; serde 1, serde_json 1, thiserror 2; folio adds lopdf 0.36, md-5 0.10, flate2 1, crc32fast 1, rand 0.9.
- Toolchain (root): pnpm 12.18.0, node >=24.3.0, turbo 2.11.11, tsx 4.23.15, typescript 7.0.2, vitest 5.1.0, metro 0.87.2 family, Expo 58 (patches in /patches for @expo/ui, expo-router, skia 3.9.1, webgpu 0.21.0, etc.).

## 6. Existing docs and gaps

Present:
- Root: README.md (62 lines, still says "Seven products", layout section stale: lists 7 engines, omits photo/motion/design/draft/scene/icons/studio-*), AGENTS.md (59 lines, contributor rules + NYC-Tron rule + no-ai-slop rule), docs/ARCHITECTURE.md, docs/ENGINE_OPS.md (2,214 lines; per-engine op tables, cadence at line 1273, folio 1507, pitch 1576), docs/ROSTER.md (verification ledger), docs/COMPONENT_MASTER_INVENTORY.md (569 lines; 341 component ids by letter, with "Consumers" lines naming cadence/folio/pitch), docs/ui/SHARED_NATIVE_COMPONENTS.md, docs/ux/FORGE_2046_DESIGN_SYSTEM.md (+ 20 other ux/design docs), design/APP-IDENTITY*.md, design/DIRECTION.md, design/CRITIQUE*.md, design/icons/renders (PNG), design/references (4 mobbin md), design/research.
- Per-studio phase docs: docs/design/CADENCE_{ANALYSIS,DETAIL,TRACK_NAME}_PHASE.md, PITCH_SECTIONS_PHASE.md, docs/native/CADENCE_NATIVE_EDITOR_SESSION.md, docs/OFFICE_CLUSTER_INTEGRATION.md (folio/pitch clusters), docs/native/NITRO_V1_HOST_INTEGRATION.md.
- packages/icons/README.md (60 lines, good: semantics, motion numbers, Rive machine contract, release acceptance).
- No README in cadence, folio, pitch, ignition. No CHANGELOG. No Storybook/stories (`find -name '*.stories.*'` empty). No per-package AGENTS.md. No per-component doc pages. JSDoc exists on exported functions (cadence/folio/pitch/ignition) but no generated reference.
Gaps relevant to the fixed doc template: no usage examples per component, no props tables outside .d.ts, no a11y section outside icons README, no install/registry instructions, no "what is verified" per component except the global ROSTER.

## 7. Registry-like artefacts

- None of: registry.json, shadcn components.json, llms.txt, llms-full.txt, SKILL.md, .claude/skills. (`find` over repo minus node_modules.)
- Near-misses: `docs/completion/components.json` (plan: 341 ids, phases P00-P20+, requiredPlatforms ios/android/web/macos/windows/visionos/quest/pico + additionalHostScope qnx/linux/watchos/tvos), `docs/advanced-gui-native-sources.json`, `docs/design/reference-index.json`, `docs/ux/studio-workspace-layout.v1.schema.json`, `tooling/nyc-tron.json` (pinned release manifest with sha256), `compatibility.v1.json` (verification receipts; 312 lines; `distribution: github-release-tarballs`, `npm: not-used`, no tag/release exists).
- Distribution note for the registry: root version `0.0.0`, no npm. shadcn-style copy-in via a URL registry matches the existing "GitHub release tarballs, not npm" stance.

## 8. Shared root: how things relate

- Workspaces: pnpm `packages/*`, `apps/*`; root package.json `workspaces` same. Cargo workspace: `rust/*` (ignition-core, nf-cli, nf-sys, nf-raw, nf-color, folio-render, splice-render, raw-decode, scene-render, wasm-probe) + `packages/*/rust`. turbo.json drives build/test/typecheck/lint.
- 24 packages: adaptive-layout, agpl-speed-curve, audio-ui, cadence, collaboration-server, design, draft, folio, icons, ignition, media-ui, motion, native-signal, photo, pitch, prism, quill, scene, spatial-ink, splice, studio-layout, studio-workspace, tally, telemetry. Engine packages = ignition + 12 kinds. UI-ish packages (other audit): audio-ui, media-ui, studio-layout, studio-workspace, adaptive-layout, spatial-ink, native-signal.
- Apps: console, example (Expo, Uniwind `global.css`, `src/studio-ui.tsx`, `src/editors.tsx` 373 lines, consumes cadence/folio/pitch at editors.tsx:3-6), forge-audio-lab, forge-media-lab, studio-preview.
- Shared assets: `design/icons/renders` (family-16/32/60.png, home-screen-dark/light.png, per-studio folders audio-lab, cadence, cadence-qa, device, folio...), `apps/example/assets/brand/<studio>/{icon,adaptive-*,favicon}.png`.
- Existing token/theme package: none named as such. De facto: `@nitro-forge/studio-workspace` (`theme.ts`, generated `theme.css`/`theme.native.css`, `build-theme.mjs`). Icons own a second set.
- Existing brand tooling: tooling/brand (brand.cjs, plugin.cjs, schema, rebrand-check, icon-family, render-icons).
- Upstream UI dependency: NYC-Tron UI v1.0.0-rc.2 (7 packages, sha256-pinned in tooling/nyc-tron.json). AGENTS.md makes it "single owner of reusable native controls".
- Process rules a registry must obey (AGENTS.md): no AI-slop prose in docs; never claim unverified results (ROSTER truthfulness); op names live in ENGINE_OPS.md; engines headless, no UI/Expo imports (SHARED_NATIVE_COMPONENTS: "ignition/ and 7 engines/ NO UI/Expo dependencies").

## 9. Implications for the shared registry (my read; guesses marked)

1. Registry items for cadence/folio/pitch would be adapter files (`editor-adapter.ts`, `mixer-cluster.ts`, `office-cluster.ts`...) with `registryDependencies` on `@nyc-tron/ui` components, not UI. Whether those belong in a shadcn registry or stay as npm-style workspace packages is a decision for the owner. (guess: keep as packages, expose docs and llms.txt only.)
2. `ForgeIcon` is the only copy-in-able component in this slice; it needs its 11 hex and ~7 literals moved to semantic tokens (`--forge-icon-*` or reuse `--color-text`, `--color-accent`, `--color-success`, `--color-danger`, `--color-text-muted`). Existing studio-workspace aliases `success`, `danger`, `text-muted`, `accent` already cover 5 of the icon colours; `warning`, `cyan`, `accentBright` have no counterpart.
3. Rebrand today = brand JSON + icons. Adding tokens means extending `brand.schema.json` (currently `additionalProperties:false`, so any new field needs a schema change) or adding a separate theme manifest. Per-studio accent (`icon-family.mjs`) is the natural seed for per-studio `--color-primary`.
4. The icons `./web` export is the same file as `./native`; a web registry item needs react-native-web or a separate DOM renderer (guess).
5. icons has no TS source; the registry will want `.tsx`. Hand-written `.d.ts` must stay in sync with `.js`.
6. 1,463 icon ids vs 47 drawn: docs must state coverage, per the package's own "avoid phantom icon coverage" rule.
7. Nothing in this slice has visual behaviour that tokenising would change if values map 1:1; the colour drift in section 4 is the one place where a mapping choice would alter pixels.
