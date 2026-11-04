# Nitro Forge — Native Creative Component Parity Checklist

**Audit date:** November 3, 2026 (reconciled after ArtCraft Android AGPL adoption, November 4 UTC)  
**Target:** original, reusable React Native/Expo native UI powered by Nitro/Rust engines, with Skia v3/Graphite and a web adapter; *not* an embedded egui desktop UI and *not* a WebView editor shell.  
**Reference suites:** [artcraft-android organization](https://github.com/artcraft-android) (7 public Android repositories verified) plus ArtCraft PhotoCraft, VectorCraft, FilmCraft, SoundCraft, EffectCraft, LightCraft, WordCraft, GridCraft, DeckCraft, PdfCraft, DesignCraft, FigCraft, CADCraft, TextureCraft, MaterialCraft, plus cross-app primitives.  
**Meaning of checklist:** a **planned or unverified** component, not a claim that the exact component is missing from every active PR. The repository's `master` branch has core Rust/TS engines but not complete native editor surfaces. Draft PRs cover some foundation work.

**Existing work to preserve:** [Studio dock and workspace #5](https://github.com/mikevocalz/nitro-forge/pull/5), [Board #18](https://github.com/mikevocalz/nitro-forge/pull/18), [Board/Skia/Ink #19](https://github.com/mikevocalz/nitro-forge/pull/19), [motion icon library #21](https://github.com/mikevocalz/nitro-forge/pull/21), [Muse #15](https://github.com/mikevocalz/nitro-forge/pull/15), [pen/BLE #20](https://github.com/mikevocalz/nitro-forge/pull/20), and [Nitro v1 C++ bridge #10](https://github.com/mikevocalz/nitro-forge/pull/10), plus [ArtCraft Android migration / AGPL #24](https://github.com/mikevocalz/nitro-forge/pull/24). These are not all merged or device verified.

## ArtCraft Android direct-source migration — SDK 58, Nitro v1, Expo Modules v2

**Decision:** CapCraft source under **AGPL-3.0-or-later** is *allowed* in Forge as long as the actual derivative/combined shipped work meets AGPL obligations. This reverses the earlier reference-only recommendation; it is not a legal clearance for a closed-source combined SDK or app. Migrating code to Swift/Kotlin/TypeScript/Rust, or connecting it with Nitro Modules v1 / Expo Modules v2, does not erase copyleft obligations. Consult legal counsel before integrating source-derived modules into proprietary consumers.

**Source of truth:** This is the full **341-contract master roster**, not a tally of implemented components. The separate [PR #24 implementation map](https://github.com/mikevocalz/nitro-forge/pull/24) is a smaller, source-evidenced crosswalk and currently contains an unverified native WAV analyzer and an experimental AGPL speed-curve package. Neither is a complete user-facing editor control yet.

| Source repository | Source license (top-level) | Representative real Android control files | Target Forge consumers | Admission |
|---|---|---|---|---|
| [ProCraft](https://github.com/artcraft-android/procraft) | MIT OR Apache-2.0 | `ui/ColorPanel.kt`, `LayersPanel.kt`, `BrushStudio.kt`, `ReferenceUi.kt`, `TimeLapseUi.kt` | `board`, `prism`, `color-ui`, `studio-ui` | File/asset notice review; permissive port possible |
| [FilmCraft](https://github.com/artcraft-android/filmcraft-android) | MIT OR Apache-2.0 | `ui/editor/Timeline.kt`, `Player.kt`, `Voiceover.kt` | `splice`, `cadence`, `media-ui`, `audio-ui`, `native-signal` | File/asset notice review; permissive port possible |
| [LightCraft](https://github.com/artcraft-android/lightcraft-android) | MIT OR Apache-2.0 | `ui/DevelopSlider.kt`, `GradingWheel.kt`, `HistogramView.kt`, `CurveTool.kt` | `prism`, `color-ui`, `studio-ui` | File/asset notice review; permissive port possible |
| [PdfCraft](https://github.com/artcraft-android/pdfcraft-android) | MIT OR Apache-2.0 | `ui/viewer/PageCanvas.kt`, `Forms.kt`, `DigitalSign.kt`, `VoiceRecorder.kt` | `folio`, `board`, `folio-ui` | File/asset notice review; permissive port possible |
| [WordCraft](https://github.com/artcraft-android/wordcraft-android) | MIT OR Apache-2.0 | `ui/editor/EditorInput.kt`, `ContextTabs.kt`, `Comments.kt` | `quill`, `studio-ui`, `document-ui` | File/asset notice review; permissive port possible |
| [GridCraft](https://github.com/artcraft-android/gridcraft-android) | MIT OR Apache-2.0 | `ui/editor/GridView.kt`, `FormulaRefs.kt`, `Keypad.kt`, `Cards.kt` | `tally`, `grid-ui` | File/asset notice review; permissive port possible |
| [CapCraft](https://github.com/artcraft-android/capcraft-android) | **AGPL-3.0-or-later** | `ui/editor/Timeline.kt`, `panels/SpeedCurveEditor.kt`, `AutoCaptions.kt`, `IsolateVoice.kt`, `Tracking.kt` | `splice`, `audio-ui`, optional **AGPL-licensed** native components | Source reuse allowed under AGPL-compliant release and attribution plan; combined-work obligations reviewed before distribution |

**License/provenance for every transplanted source file:** pinned source commit, original copyright and license text, modification notice, complete corresponding source/build scripts when required, third-party notice/asset review, source-offer/section 13 analysis if applicable, and documented combined-work decisions. CapCraft also includes a modified [Concat](https://github.com/jub0t/concat) engine and [third-party notices](https://github.com/artcraft-android/capcraft-android/blob/main/THIRD_PARTY_NOTICES.md). A separate package directory or optional bridge **does not automatically create a license firewall**.

### Component IDs mapped to verified source files

| Source file | Existing component IDs | New component IDs | Implementation note |
|---|---|---|---|
| FilmCraft `ui/editor/Timeline.kt` | D-04, D-05, D-08, D-10, D-11, D-15, D-17, D-19, E-02 | — | Canvas time mapping, trim drag, waveform drawing; needs iOS and web counterparts |
| FilmCraft `ui/editor/Voiceover.kt` | E-04, E-06, E-07, N-17 | E-38, N-20 | Actual Android AudioRecord/WAV; Expo v2 service for recording lifecycle |
| FilmCraft `ui/editor/Player.kt` | D-01, D-06 | N-19 | Playback surface, decoder seek and honest frame state |
| ProCraft `ui/ColorPanel.kt` | C-01 through C-13 | B-28, C-26, C-27 | Floating native palette, color picker, swatch model |
| ProCraft `ui/LayersPanel.kt` | B-09 through B-13 | — | Layer state must commit through the Forge engine |
| ProCraft `ui/BrushStudio.kt` | B-15, B-16, B-17 | B-29, B-33 | Pressure, taper, stabilization and brush previews |
| LightCraft `ui/DevelopSlider.kt` | A-12 through A-15 | N-21 | Numeric scrub precision, fine-adjust and non-linear scales |
| LightCraft `ui/GradingWheel.kt`, `HistogramView.kt` | C-19, C-22, C-24 | — | Video/photo color pipeline differs from screen-only preview |
| PdfCraft `ui/viewer/*` | K-01 through K-17 | K-18 through K-21 | PDF page/voice/form/scan with real document round-trip |
| WordCraft `ui/editor/*` | H-01 through H-20 | H-21, H-22 | Text IME, speech and document selection semantics |
| GridCraft `ui/editor/*` | I-01 through I-19 | I-20, I-21 | Grid editor, formula references and mobile cards |
| CapCraft `ui/editor/Timeline.kt` and `panels/SpeedCurveEditor.kt` | G-13, D-10, D-15, D-22 | D-31, D-32 | **AGPL** source-derived curve and multi-track timeline; no proprietary distribution presumption |
| CapCraft caption/FX/audio panels | G-09, G-10, E-20 | D-33 through D-43, E-34 through E-37, E-39 through E-41 | **AGPL** source port candidates with attribution and third-party checks |

### Component-to-runtime decision

| Component type | Preferred implementation | Status/gate |
|---|---|---|
| Native operating-system media and audio services | **Expo Modules 2.0** Swift/Kotlin `@ExpoModule`/`@JS`, on SDK 58 | New annotation APIs are beta; require both native builds, autolinking and physical tests |
| Native control surfaces (seek bars, sliders, dialogs) | Supported `@expo/ui` SwiftUI/Jetpack Compose; existing Expo `View` DSL / native view as compatibility layer | Do not claim v2 custom view annotation parity before verification |
| High-density canvas, waveform, timeline and spectra | **Skia v3 / Board** native GPU + platform input bridges; rational frame/sample time model | Device GPU performance/gesture correctness gate |
| Editing engines, audio DSP, timeline commands and undo | **Rust Ignition + Nitro Modules v1** existing experimental bridge | Nitro v1 integration and binary transport on target devices still to verify |
| Web/desktop | TypeScript front end + WASM/Canvas/WebGPU adapters where supported | No WebView or Android UI embedded in web shell |
| Shared state | **Zustand** presentation only; Rust document/session source of truth | Prevent double undo and duplicate persisted document representations |

**Release gates for every component:** real native behavior, unit/integration/interaction tests, iOS+Android builds, keyboard/stylus accessibility, 60fps-target profiling where appropriate, unfold/rotate/hinge handling on Surface Duo/foldables, web fallback, legal-source review, and package exports. An unchecked box is **not** an implemented component.

## Build order

**P0:** shared editor shell, canvas/layers, color controls, real media transport & timeline, audio waveform/mix/record UI, and platform contracts.  
**P1:** specialized photo, compositing, office, slide, PDF and interface-design tools.  
**P2:** 3D texture painting, material graphs and CAD-oriented tools.  

**Key architecture rule:** UI components are independent presentation/interaction primitives. Rust engines own document state, data transforms, decoding/DSP, undo and durable saves. Nitro bridges bounded native operations; UI never creates a second source of truth. The checklist covers components **and their required behavior**, not just visual shells.

**Inventory size:** **341 component contracts** (original 296 + 45 ArtCraft Android parity additions): **P0: 196**, **P1: 128**, **P2: 17**.

## A. Studio shell, navigation & reusable controls — 30 components (P0)

**Consumers:** @nitro-forge/studio-ui • all editors

- [ ] **A-01 `WorkspaceHost`:** One document and multiple editing modes with persistent panels.
- [ ] **A-02 `WorkspacePresetSwitcher`:** Edit, color, audio, review, presentation, and custom layouts.
- [ ] **A-03 `AdaptiveDock`:** Left/right/bottom panes and floating/stacked dock targets.
- [ ] **A-04 `PaneSplitter`:** Resizable boundaries, safe minimums, and hinge awareness.
- [ ] **A-05 `DocumentTabBar`:** Dirty markers, reorder, close, and multi-document focus.
- [ ] **A-06 `ToolRail`:** Compact professional tools; expanded flyouts and active states.
- [ ] **A-07 `ContextualToolbar`:** Selection-specific controls and narrow-width overflow.
- [ ] **A-08 `RibbonTabs`:** Command groups, contextual tabs, gallery and split buttons.
- [ ] **A-09 `InspectorPanel`:** Selection-aware, collapsible properties.
- [ ] **A-10 `InspectorSection`:** Nested groups, enable/disable and reset behavior.
- [ ] **A-11 `PropertyRow`:** Label, editor, mixed-value indicator and override state.
- [ ] **A-12 `NumericScrubField`:** Drag label, type values, commit/cancel, fine adjust.
- [ ] **A-13 `UnitInput`:** px, pt, mm, %, frames, seconds, samples, dB and conversion.
- [ ] **A-14 `SliderField`:** Precision slider with value entry, reset and bounded range.
- [ ] **A-15 `RangeSlider`:** Two-handle range with editable endpoints.
- [ ] **A-16 `RotaryKnob`:** Keyboard/touch/stylus adjustments and exact entry.
- [ ] **A-17 `SplitButton`:** Separate primary action and flyout hit targets.
- [ ] **A-18 `CommandPalette`:** Search commands, shortcuts, tools and assets.
- [ ] **A-19 `ContextMenu`:** Touch long-press, stylus click, mouse and keyboard access.
- [ ] **A-20 `NativePopover`:** Anchoring, pointer avoidance, safe-area and focus.
- [ ] **A-21 `InspectorSearch`:** Filter controls, properties and assets.
- [ ] **A-22 `AssetBrowser`:** Thumbnails, previews, categories, filters and drag insertion.
- [ ] **A-23 `PresetGallery`:** Live preview, selection and favorite presets.
- [ ] **A-24 `HistoryPanel`:** Undo grouping, visible checkpoints and document actions.
- [ ] **A-25 `StatusBar`:** Zoom, units, selection count, rendering/recording state.
- [ ] **A-26 `ToastAndProgress`:** Cancelable long operation, warnings, real status.
- [ ] **A-27 `KeyboardShortcutHUD`:** Discover commands and customizable bindings.
- [ ] **A-28 `FocusAndA11yLayer`:** Focus visibility, screen reader labels and reduced motion.
- [ ] **A-29 `FindReplacePopover`:** Document-aware search and replace actions.
- [ ] **A-30 `FileImportExportSheet`:** Format, quality, metadata and destination settings.

## B. Shared canvas, layers & gestures — 34 components (P0)

**Consumers:** @nitro-forge/board • Prism • Pitch • Quill • Folio • Fig/CAD later

- [ ] **B-01 `GPUCanvasViewport`:** Skia v3/Graphite render surface with independent Rust document state.
- [ ] **B-02 `CanvasPanZoom`:** Pinch, wheel, two-finger pan and zoom-to-fit.
- [ ] **B-03 `CanvasRuler`:** Document units, ticks, origin and guide interactions.
- [ ] **B-04 `SnapGridOverlay`:** Configurable grid, magnetism and artboard intersections.
- [ ] **B-05 `SmartGuides`:** Object alignment, spacing and live snap feedback.
- [ ] **B-06 `SelectionBounds`:** Hit-testing, move, resize and rotation handles.
- [ ] **B-07 `MultiSelectionControls`:** Group/lasso/shift selection with shared property state.
- [ ] **B-08 `TransformOriginHandle`:** Pivot edits and angle snapping.
- [ ] **B-09 `LayerStack`:** Drag reorder, nested groups, visibility and lock.
- [ ] **B-10 `LayerThumbnail`:** Async cached raster/vector preview.
- [ ] **B-11 `LayerBlendAndOpacity`:** Mode selector, precise alpha and color-space handling.
- [ ] **B-12 `MaskThumbnailAndEditor`:** Create, refine, disable, invert and preview masks.
- [ ] **B-13 `ClippingMaskControls`:** Clip/unclip and visually display hierarchy.
- [ ] **B-14 `ArtboardNavigator`:** Multiple pages/artboards and navigation thumbnails.
- [ ] **B-15 `BrushPresetBrowser`:** Presets, preview stroke and favorites.
- [ ] **B-16 `BrushDynamicsInspector`:** Size, hardness, flow, spacing, stabilizer, scatter.
- [ ] **B-17 `InkStrokePreview`:** Pressure/tilt/twist and real-time latency feedback.
- [ ] **B-18 `EraserModePicker`:** Pixel, vector, mask and object-aware erasing.
- [ ] **B-19 `SelectionMarquee`:** Rectangular, elliptical, polygonal and freehand selection.
- [ ] **B-20 `MagicSelectionControls`:** Tolerance, feather, grow/shrink and refine edge.
- [ ] **B-21 `PenNodeEditor`:** Bezier handles, smooth/corner and curve joins.
- [ ] **B-22 `ShapeBuilder`:** Booleans, combine/subtract/intersect and editable operands.
- [ ] **B-23 `FillStrokeInspector`:** Stroke width, join/cap, dashes, fill rules and order.
- [ ] **B-24 `GradientOnCanvasHandles`:** Move/rotate editable linear/radial/focal gradients.
- [ ] **B-25 `AlignDistributePanel`:** Align, evenly distribute, spacing and order.
- [ ] **B-26 `GuidedCropAndStraighten`:** Crop handles, ratio presets, rotation and overlays.
- [ ] **B-27 `CanvasCompareView`:** Before/after, split, overlay and reference view.


### ArtCraft Android parity additions (2026-11-03)

- [ ] **B-28 `FloatingPaletteUndockHandle`:** ProCraft dock-to-floating color/tool palette, accessible drag targets and foldable-safe restoration. *Source candidate: `procraft/ui/ColorPanel.kt`; requires verified implementation and license admission.*
- [ ] **B-29 `BrushTaperControl`:** Pen-versus-touch taper start/end, pressure and tip controls with live test strokes. *Source candidate: `procraft/ui/BrushStudio.kt`; requires verified implementation and license admission.*
- [ ] **B-30 `ColorDropCanvasTarget`:** Drag a color chip onto a bounded canvas region with live drop feedback and one fill transaction. *Source candidate: `procraft/ui/ColorDropUi.kt`; requires verified implementation and license admission.*
- [ ] **B-31 `ReferenceImageBoard`:** Pinned and movable visual reference images, fit/crop, lock and overlay modes. *Source candidate: `procraft/ui/ReferenceUi.kt`; requires verified implementation and license admission.*
- [ ] **B-32 `TimelapsePlaybackExporter`:** Record non-destructive drawing history and produce a real media file with export progress. *Source candidate: `procraft/ui/TimeLapseUi.kt`; requires verified implementation and license admission.*
- [ ] **B-33 `BrushStabilizationPreview`:** Preview streamline/stabilization and motion filtering while maintaining pressure fidelity. *Source candidate: `procraft/ui/BrushStudio.kt`; requires verified implementation and license admission.*
- [ ] **B-34 `GestureCustomizationPanel`:** Map touch/stylus gestures and quick actions with cancellation and conflict checks. *Source candidate: `procraft/ui/GestureControlsUi.kt`; requires verified implementation and license admission.*

## C. Color & imaging controls — 27 components (P0)

**Consumers:** @nitro-forge/color-ui • Prism • Splice • Cadence visualization • all document editors

- [ ] **C-01 `ColorPickerDialog`:** Original/new comparison, commit/cancel, live preview.
- [ ] **C-02 `SVColorField`:** Saturation/value 2D plane with stable hue.
- [ ] **C-03 `ColorWheel`:** Hue ring with precision selector and hue retention.
- [ ] **C-04 `HueSlider`:** Full-gamut hue scrub with accessible numeric value.
- [ ] **C-05 `AlphaSlider`:** Checkerboard transparency preview and direct entry.
- [ ] **C-06 `ColorChannels`:** RGB, HSL, HSV, HEX and alpha values.
- [ ] **C-07 `PrintColorChannels`:** CMYK and Lab inputs with conversion policy.
- [ ] **C-08 `WideGamutChannels`:** Linear RGB, HDR and optional OKLCH/OKLab input.
- [ ] **C-09 `ColorSpaceChooser`:** sRGB, Display-P3, embedded ICC and output profiles.
- [ ] **C-10 `GamutWarning`:** Out-of-gamut badges, mapped preview and original values.
- [ ] **C-11 `EyedropperTool`:** Sample canvas pixels without capturing unrelated screen content.
- [ ] **C-12 `ForegroundBackgroundChips`:** Swap and reset foreground/background colors.
- [ ] **C-13 `SwatchGrid`:** Recent, document, saved, named and searchable swatches.
- [ ] **C-14 `ThemeColorReferences`:** Preserve token/spot/theme IDs rather than flatten RGB.
- [ ] **C-15 `SpotAndGlobalColorEditor`:** Spot ink, overprint and global color definitions.
- [ ] **C-16 `GradientStopEditor`:** Stops, midpoint, alpha, type, angle and interpolation.
- [ ] **C-17 `GradientMeshEditor`:** Mesh points and smoothly interpolated multicolor fields.
- [ ] **C-18 `ColorHarmonyAssistant`:** Complementary, analogous and accessible contrast preview.
- [ ] **C-19 `LiveHistogram`:** Per-channel histogram with clipping indicators.
- [ ] **C-20 `LevelsEditor`:** Input, midpoint, black/white and output levels.
- [ ] **C-21 `CurvesEditor`:** RGB/Luma curves with draggable anchors and presets.
- [ ] **C-22 `ColorGradingWheels`:** Lift/gamma/gain, shadows/midtones/highlights.
- [ ] **C-23 `HSLSecondaryEditor`:** Select hue ranges, soften, saturation and luminance.
- [ ] **C-24 `VideoScopesPanel`:** RGB parade, luma waveform, vectorscope and histogram.
- [ ] **C-25 `SoftProofControls`:** Proof profile, paper/ink simulation and gamut clipping.


### ArtCraft Android parity additions (2026-11-03)

- [ ] **C-26 `FloatingColorPalette`:** Dock/undock mobile color picker with compact, classic and palette modes; preserve active document colors. *Source candidate: `procraft/ui/ColorPanel.kt`; requires verified implementation and license admission.*
- [ ] **C-27 `ColorDiscPicker`:** Disc-based hue and saturation picker with chromatic hue preservation near gray and wide-gamut preview. *Source candidate: `procraft/ui/ColorPanel.kt`; requires verified implementation and license admission.*

## D. Video playback, source monitor & editing timeline — 43 components (P0)

**Consumers:** @nitro-forge/splice (ReelForge) • FilmCraft

- [ ] **D-01 `NativeVideoPlayer`:** Real iOS/Android decoder-backed playback surface.
- [ ] **D-02 `SourceMonitor`:** Load, preview, select in/out points for source assets.
- [ ] **D-03 `ProgramMonitor`:** Accurate timeline output, overlays and frame display.
- [ ] **D-04 `NativeSeekBar`:** Buffered and played ranges, touch/pen/mouse seeking.
- [ ] **D-05 `FrameAccurateScrubber`:** Coalesced seeks, frame snaps, exact final commit.
- [ ] **D-06 `TransportControls`:** Play, pause, stop, jump, previous/next frame.
- [ ] **D-07 `PlaybackRateMenu`:** Speeds, reverse/shuttle where supported and pitch policy.
- [ ] **D-08 `TimecodeDisplay`:** Frames, source/timecode, drop-frame and sample time.
- [ ] **D-09 `JKLShuttleController`:** Variable-speed jog/shuttle keyboard and touch modes.
- [ ] **D-10 `TimelineRuler`:** Timecode ticks, zoom, guides and marks.
- [ ] **D-11 `TimelinePlayhead`:** Drag anywhere, follows playback, visible across tracks.
- [ ] **D-12 `InOutRangeHandles`:** Trim/preview range and set selection bounds.
- [ ] **D-13 `LoopRangeBar`:** Enable loop, range handles and toggle state.
- [ ] **D-14 `TimelineZoomAndScroll`:** Pinch centered at pointer, mini-map and fit selection.
- [ ] **D-15 `TimelineClipLane`:** Multi-track video/audio segments and region thumbnails.
- [ ] **D-16 `VideoFilmstrip`:** Cached thumbnails by zoom/time with virtualization.
- [ ] **D-17 `AudioClipWaveform`:** Audio wave underneath clip with peaks cache.
- [ ] **D-18 `TrackHeaders`:** Lock, hide, mute, solo, enable, labels and track heights.
- [ ] **D-19 `ClipTrimHandles`:** Non-destructive head/tail edits with snapping.
- [ ] **D-20 `RazorSplitTool`:** Split at playhead, select edges, ripple operations.
- [ ] **D-21 `RollSlipSlideControls`:** Industry trim modes with explicit preview feedback.
- [ ] **D-22 `DragReorderAndRipple`:** Track/clip move, insert, overwrite and collision policy.
- [ ] **D-23 `TransitionHandles`:** Overlap, fade, dissolve and editable duration.
- [ ] **D-24 `TimelineMarkers`:** Named/color markers, snapping and keyboard navigation.
- [ ] **D-25 `SafeAreaOverlay`:** Title/action safe, guides and aspect ratio framing.
- [ ] **D-26 `ScopesDock`:** Video scopes anchored to source/program scopes.
- [ ] **D-27 `MulticamAngleViewer`:** Synchronized preview and track angle selection.
- [ ] **D-28 `RenderCacheIndicator`:** Queue progress, invalidation and preview quality.
- [ ] **D-29 `ExportMonitor`:** Preset, codec, resolution, frame rate and render progress.
- [ ] **D-30 `PictureInPictureControls`:** Where platform supports PiP and background state.


### ArtCraft Android parity additions (2026-11-03)

- [ ] **D-31 `OverlayAndEffectsTrackStack`:** Separate and fold overlays, effects, stickers, captions and main media tracks; keep ordered timing. *Source candidate: `capcraft/ui/editor/Timeline.kt`; requires verified implementation and license admission.*
- [ ] **D-32 `VideoSpeedRampCurve`:** Keyframed clip speed curve with draggable knots, accurate retime, source-duration estimate and undo. *Source candidate: `capcraft/ui/editor/panels/SpeedCurveEditor.kt`; requires verified implementation and license admission.*
- [ ] **D-33 `AutoCaptionTranscriptTimeline`:** Transcript-to-caption blocks with editable text, speaker labels and playback sync. *Source candidate: `capcraft/ui/editor/panels/AutoCaptions.kt`; requires verified implementation and license admission.*
- [ ] **D-34 `CaptionWordTimingHandles`:** Word-level caption segment handles, collision checks, frame alignment and timing preview. *Source candidate: `capcraft/ui/editor/panels/Transcript.kt`; requires verified implementation and license admission.*
- [ ] **D-35 `AutoReframeGuides`:** Aspect-ratio-aware crop guidance and subject tracking with user override. *Source candidate: `capcraft/ui/editor/panels/AutoReframe.kt`; requires verified implementation and license admission.*
- [ ] **D-36 `VideoStabilizationInspector`:** Stabilization strength, crop side effects, before/after preview and bounded quality controls. *Source candidate: `capcraft/ui/editor/panels/StabilizePanel.kt`; requires verified implementation and license admission.*
- [ ] **D-37 `TransitionPresetBrowser`:** Preview and apply transitions with timing, available handles and capability checks. *Source candidate: `capcraft/ui/editor/panels/TransitionGlyph.kt`; requires verified implementation and license admission.*
- [ ] **D-38 `VideoEffectsBrowser`:** Video and body-effect choices, masks, intensity and per-clip previews. *Source candidate: `capcraft/ui/editor/panels/EffectLayer.kt`; requires verified implementation and license admission.*
- [ ] **D-39 `MotionTrackingOverlay`:** Track objects for effects/text with progress, correction points and loss-of-track handling. *Source candidate: `capcraft/ui/editor/panels/Tracking.kt`; requires verified implementation and license admission.*
- [ ] **D-40 `CoverFramePicker`:** Choose a frame or source image as the actual exported cover/thumbnail. *Source candidate: `capcraft/ui/editor/CoverEditor.kt`; requires verified implementation and license admission.*
- [ ] **D-41 `BatchEditPanel`:** Apply compatible color, speed or effect changes across selected clips with batch undo. *Source candidate: `capcraft/ui/editor/panels/BatchEditPanel.kt`; requires verified implementation and license admission.*
- [ ] **D-42 `VideoQualityInspector`:** Media resolution, bit depth, frame rate, codec, preview/export capability and warnings. *Source candidate: `capcraft/ui/editor/panels/VideoQuality.kt`; requires verified implementation and license admission.*
- [ ] **D-43 `StickerMotionLane`:** Insert stickers as timeline objects with transforms, keyframes and independently adjustable range. *Source candidate: `capcraft/ui/editor/panels/Stickers.kt`; requires verified implementation and license admission.*

## E. Sound, music production, recording & waveforms — 41 components (P0)

**Consumers:** @nitro-forge/cadence (BeatForge) • SoundCraft • Splice

- [ ] **E-01 `NativeAudioTransport`:** Low-latency play/pause/record/punch transport.
- [ ] **E-02 `WaveformLane`:** Scrollable and editable audio clip peaks in timeline.
- [ ] **E-03 `StereoMultichannelWaveform`:** Split channels, channel labels and peak/rms modes.
- [ ] **E-04 `LiveRecordingWaveform`:** Continuous capture waveform with honest input levels.
- [ ] **E-05 `SpectrogramView`:** Time-frequency view, zoom and color scale.
- [ ] **E-06 `RecordingArmButton`:** Per-track arming with armed/recording/error states.
- [ ] **E-07 `InputMonitorToggle`:** Hardware monitoring, software monitoring and feedback guard.
- [ ] **E-08 `DeviceAndChannelPicker`:** Microphones, interface input/output and sample rate.
- [ ] **E-09 `AudioClipTrimAndFade`:** Fades, crossfades, non-destructive trim and region gain.
- [ ] **E-10 `ClipGainEnvelope`:** Direct draggable editable envelope within clip.
- [ ] **E-11 `AutomationLane`:** Breakpoint draw/edit for volume, pan and plugin params.
- [ ] **E-12 `AutomationModePicker`:** Read/write/touch/latch/trim with state indication.
- [ ] **E-13 `MixingConsole`:** Channel strips, meters, FX slots, grouping and routing.
- [ ] **E-14 `VerticalFader`:** dB taper, fine control, numeric gain and double-tap reset.
- [ ] **E-15 `PanAndBalanceControl`:** Mono pan, stereo balance and surround positioning.
- [ ] **E-16 `RealtimePeakMeter`:** Peak hold, clipping, true peak and meter falloff.
- [ ] **E-17 `LoudnessMeter`:** RMS, LUFS, integrated/short-term and reset semantics.
- [ ] **E-18 `SoloMuteButtons`:** Clear states, group solo and solo-safe display.
- [ ] **E-19 `BusAndRoutingMatrix`:** Inputs, sends, sidechain, master, aux and bus map.
- [ ] **E-20 `InsertEffectRack`:** Slots, enable/bypass, ordering, plugin settings.
- [ ] **E-21 `EQFrequencyGraph`:** Frequency, Q, gain, high/low-pass filter handles.
- [ ] **E-22 `DynamicsTransferGraph`:** Threshold, ratio, knee, makeup and reduction.
- [ ] **E-23 `PluginPresetBrowser`:** Search/preset store with A/B and undo grouping.
- [ ] **E-24 `MIDIPianoRoll`:** Pitch lanes, note rectangles, resize and audition.
- [ ] **E-25 `MIDIVelocityLane`:** Bars/curves and channel/velocity editing.
- [ ] **E-26 `StepSequencer`:** Beat-grid input, accents and instrument lanes.
- [ ] **E-27 `TempoAndMetronome`:** BPM/tap-tempo, time signature and click feedback.
- [ ] **E-28 `TakePlaylistAndComping`:** Multiple takes, swipe comping and lanes.
- [ ] **E-29 `LoopPunchRecording`:** Pre/post-roll, loop recording and punch boundaries.
- [ ] **E-30 `SampleEditor`:** Sample start/end/loop and pitch keyboard mapping.
- [ ] **E-31 `AudioVideoSync`:** Picture track playback locked to audio sample clock.
- [ ] **E-32 `LatencyCalibrationPanel`:** Round-trip offset, device buffer and drift diagnostics.
- [ ] **E-33 `SurroundPanView`:** Multispeaker field and source/destination routing.


### ArtCraft Android parity additions (2026-11-03)

- [ ] **E-34 `VoiceIsolationPanel`:** Native-backed speech separation preview, processing progress and revert. *Source candidate: `capcraft/ui/editor/panels/IsolateVoice.kt`; requires verified implementation and license admission.*
- [ ] **E-35 `BeatDetectionMarkerLane`:** Beat markers aligned to audio clip timeline and editable by user. *Source candidate: `capcraft/ui/editor/panels/BeatsPanel.kt`; requires verified implementation and license admission.*
- [ ] **E-36 `SoundEffectsLibrary`:** Preview, search, category filter and insert licensed sound effects onto audio tracks. *Source candidate: `capcraft/ui/editor/panels/SoundFx.kt`; requires verified implementation and license admission.*
- [ ] **E-37 `SpeechTranscriptTakeReview`:** Review recognized speech against recorded takes with speaker/timing corrections. *Source candidate: `capcraft/ui/editor/panels/SpeechPanel.kt`; requires verified implementation and license admission.*
- [ ] **E-38 `VoiceoverCountdownAndTakeBin`:** Countdown, recording input monitor, take management and safe discard/retry. *Source candidate: `filmcraft/ui/editor/Voiceover.kt`; requires verified implementation and license admission.*
- [ ] **E-39 `AudioEffectsPresetPanel`:** Per-clip audio effects and editable parameters, offline preview and bypass. *Source candidate: `capcraft/ui/editor/panels/AudioEffects.kt`; requires verified implementation and license admission.*
- [ ] **E-40 `NoiseReductionMonitor`:** Audition selected noise cleanup with measured signal and reversible commit. *Source candidate: `capcraft/ui/editor/panels/IsolateVoice.kt`; requires verified implementation and license admission.*
- [ ] **E-41 `AutoDuckEnvelopePanel`:** Automated music-under-dialogue volume ducking with adjustable sensitivity and envelopes. *Source candidate: `capcraft/ui/editor/panels/AudioEffects.kt`; requires verified implementation and license admission.*

## F. Photo, RAW development & catalog — 18 components (P1)

**Consumers:** @nitro-forge/prism • PhotoCraft/LightCraft

- [ ] **F-01 `PhotoLibraryGrid`:** Virtualized large-photo catalog with fast thumbnails.
- [ ] **F-02 `CatalogFilterBar`:** EXIF, camera, lens, date, ratings, flags and album filters.
- [ ] **F-03 `RatingAndFlagControl`:** Stars, color labels, pick/reject markers.
- [ ] **F-04 `RAWDevelopPanel`:** Non-destructive settings with default, revert and copy/paste.
- [ ] **F-05 `ExposureAndWhiteBalance`:** Exposure, temperature, tint, highlight and shadow.
- [ ] **F-06 `ToneAndPresence`:** Contrast, texture, clarity, dehaze, vibrance.
- [ ] **F-07 `EightBandColorMixer`:** Per-range hue/saturation/luminance adjustments.
- [ ] **F-08 `LensCorrectionPanel`:** Distortion, chromatic aberration and profiles.
- [ ] **F-09 `LocalMaskBrush`:** Add/subtract mask with feather and brush controls.
- [ ] **F-10 `LinearRadialGradientMask`:** Interactive mask geometry and falloff.
- [ ] **F-11 `LuminanceColorRangeMask`:** Range pickers, tolerance, combine masks.
- [ ] **F-12 `BeforeAfterCompare`:** Side-by-side, wipe and reference photo comparison.
- [ ] **F-13 `PresetFilmstrip`:** Hover/tap preview, favorite and batch apply.
- [ ] **F-14 `BatchExportPanel`:** Sizes, watermark, output format and metadata privacy.


### ArtCraft Android parity additions (2026-11-03)

- [ ] **F-15 `PhotoVersionHistoryBrowser`:** Compare and restore non-destructive photo edit versions without losing originals. *Source candidate: `lightcraft/ui/VersionsScreen.kt`; requires verified implementation and license admission.*
- [ ] **F-16 `CleanupAndRetouchPanel`:** Localized spot cleanup with native brush marks, bounded radius and preview. *Source candidate: `lightcraft/ui/RemoveTool.kt`; requires verified implementation and license admission.*
- [ ] **F-17 `PresetManager`:** Manage reusable photo adjustments with import/export and versioned presets. *Source candidate: `lightcraft/ui/PresetManage.kt`; requires verified implementation and license admission.*
- [ ] **F-18 `PhotoMetadataInspector`:** Display provenance, camera/exposure/lens information and editing annotations. *Source candidate: `lightcraft/ui/InfoScreen.kt`; requires verified implementation and license admission.*

## G. Motion graphics, effects & compositing — 15 components (P1)

**Consumers:** @nitro-forge/splice • FilmCraft/EffectCraft

- [ ] **G-01 `CompositionLayerTree`:** Nested comps, shape/text/footage/adjustment layers.
- [ ] **G-02 `MotionKeyframeTimeline`:** Keyframes per property, drag and select groups.
- [ ] **G-03 `KeyframeValueGraph`:** Bezier values, handles, interpolation and limits.
- [ ] **G-04 `KeyframeSpeedGraph`:** Temporal easing and velocity visualization.
- [ ] **G-05 `EasingPresetGallery`:** Hold, linear, ease, spring-like options where supported.
- [ ] **G-06 `MotionPathEditor`:** Spatial trajectory, tangent and point snapping.
- [ ] **G-07 `Transform3DInspector`:** Anchor, position, scale, rotations and opacity.
- [ ] **G-08 `CameraAndLightControls`:** 3D focal depth, view and lighting properties.
- [ ] **G-09 `MatteAndMaskPanel`:** Track matte sources, alpha/luma mode and feather.
- [ ] **G-10 `EffectStackAndInspector`:** Reorder, bypass, reset, favorites and presets.
- [ ] **G-11 `ExpressionEditor`:** Code completion, references, validation and errors.
- [ ] **G-12 `ParticleEmitterControls`:** Emit rate, life, motion, texture and seed.
- [ ] **G-13 `TimeRemapCurve`:** Source time against composition time and interpolation.
- [ ] **G-14 `NodeGraphEditor`:** Pin/port connections, typed links and graph interaction.
- [ ] **G-15 `RenderQueuePanel`:** Sequences, alpha mode, output profile and progress.

## H. Documents, rich text & page publishing — 22 components (P1)

**Consumers:** @nitro-forge/quill (QuillForge) • WordCraft/DesignCraft

- [ ] **H-01 `PaginatedTextCanvas`:** Native editable text with page layout and cursor.
- [ ] **H-02 `TextSelectionAndCaret`:** Keyboard/selection handles, bidirectional text.
- [ ] **H-03 `RichTextRibbon`:** Font family, size, style, highlighter, colors and cases.
- [ ] **H-04 `TypographyInspector`:** Kerning, tracking, leading, paragraph space and glyphs.
- [ ] **H-05 `ParagraphStylesGallery`:** Named styles, overrides, live preview and hierarchy.
- [ ] **H-06 `ParagraphRuler`:** Indents, tab stops, margins and columns.
- [ ] **H-07 `BulletsNumberingEditor`:** Multilevel list and nesting policy.
- [ ] **H-08 `InsertTableGrid`:** Touch grid selection and rows/columns insertion.
- [ ] **H-09 `TableLayoutInspector`:** Cell merge/split, border, fill and alignment.
- [ ] **H-10 `HeadersFootersEditor`:** Running titles, page numbers and first-page behavior.
- [ ] **H-11 `PageSetupPanel`:** Margins, paper sizes, orientation, sections and columns.
- [ ] **H-12 `TextWrapAndFrames`:** Object anchors, text boxes, threaded text frames.
- [ ] **H-13 `CommentsAndReviewRail`:** Threaded comments, mentions and resolve.
- [ ] **H-14 `TrackChangesView`:** Add/delete/format diffs with accept/reject controls.
- [ ] **H-15 `NavigationOutline`:** Headings, bookmark jump and page thumbnails.
- [ ] **H-16 `TableOfContentsEditor`:** Automatic headings and update fields.
- [ ] **H-17 `FootnoteCitationEditor`:** References, citation picker and bibliography.
- [ ] **H-18 `SpellGrammarPopover`:** Suggestions, ignore/dictionary and offline states.
- [ ] **H-19 `MailMergeFieldPicker`:** Data-field insertion and recipient preview.
- [ ] **H-20 `LayoutSpreadNavigator`:** Facing pages, parent/master pages and overset text.


### ArtCraft Android parity additions (2026-11-03)

- [ ] **H-21 `DocumentReadAloudTransport`:** Synchronized text-to-speech controls and highlighted paragraph reading position. *Source candidate: `wordcraft/ui/editor/EditorScreen.kt`; requires verified implementation and license admission.*
- [ ] **H-22 `DictationSessionPanel`:** Speech-to-text input with permission/record state, review, editing and undo. *Source candidate: `wordcraft/ui/editor/EditorInput.kt`; requires verified implementation and license admission.*

## I. Spreadsheets, formulas & charts — 21 components (P1)

**Consumers:** @nitro-forge/tally (GridForge) • GridCraft

- [ ] **I-01 `VirtualSpreadsheetGrid`:** Huge row/column virtualization and stable scrolling.
- [ ] **I-02 `CellSelectionOverlay`:** Range selection with fill/resize and frozen panes.
- [ ] **I-03 `FormulaBar`:** Edit and view raw formula with cancellation.
- [ ] **I-04 `NameBox`:** Go to named ranges/addresses and display selection.
- [ ] **I-05 `FormulaAutocomplete`:** Function signatures, references and suggestions.
- [ ] **I-06 `ReferenceColorizer`:** Colored formula references and highlight ranges.
- [ ] **I-07 `FillHandleAndAutoFill`:** Copy formulas, series and drag previews.
- [ ] **I-08 `SheetTabs`:** Add, rename, duplicate, reorder, protect and colors.
- [ ] **I-09 `CellFormatInspector`:** Numbers, currency, dates, borders, fills, alignment.
- [ ] **I-10 `ConditionalFormatRules`:** Rules editor, color scales, icons and data bars.
- [ ] **I-11 `ValidationDropdown`:** Editable list and error validation feedback.
- [ ] **I-12 `SortFilterHeader`:** Dropdowns, multi-sort and visible row filters.
- [ ] **I-13 `ChartBuilder`:** Chart type gallery, axes, labels, series and formatting.
- [ ] **I-14 `SparklineEditor`:** In-cell tiny charts and data range controls.
- [ ] **I-15 `PivotFieldList`:** Drag row/column/value/filter fields and aggregates.
- [ ] **I-16 `TableStyleGallery`:** Named tables, header, totals and structured references.
- [ ] **I-17 `FreezeSplitControls`:** Rows/cols frozen, split view and divider geometry.
- [ ] **I-18 `RangeComments`:** Notes, discussions and focus/resolve state.
- [ ] **I-19 `DataImportWizard`:** CSV/TSV/XLSX types, headers and conversion preview.


### ArtCraft Android parity additions (2026-11-03)

- [ ] **I-20 `SpreadsheetCardsView`:** Readable card-form editing of table rows on phones and folded screens. *Source candidate: `gridcraft/ui/editor/Cards.kt`; requires verified implementation and license admission.*
- [ ] **I-21 `SavedSheetViewManager`:** Store and restore grid/view presets, visible columns and sort/filter scope. *Source candidate: `gridcraft/ui/editor/Tabs.kt`; requires verified implementation and license admission.*

## J. Slides, animations & presenting — 16 components (P1)

**Consumers:** @nitro-forge/pitch (DeckForge) • DeckCraft

- [ ] **J-01 `SlideFilmstrip`:** Thumbnails, sections, reorder and selection.
- [ ] **J-02 `SlideSorter`:** Grid thumbnail mode with multiselect.
- [ ] **J-03 `MasterLayoutEditor`:** Parent/master, placeholders and theme inheritance.
- [ ] **J-04 `ThemeAndTemplateGallery`:** Theme colors, fonts, presets and preview.
- [ ] **J-05 `SlideCanvas`:** Editable text/shapes/media with resize and snapping.
- [ ] **J-06 `ShapePresetGallery`:** Vector shapes, editable adjustment handles.
- [ ] **J-07 `ConnectorAndDiagramTools`:** Sticky connectors, direction and labels.
- [ ] **J-08 `TransitionPicker`:** Timing, duration and effect previews.
- [ ] **J-09 `SlideAnimationPane`:** Entrance/emphasis/exit, object order and triggers.
- [ ] **J-10 `MorphPreview`:** Inter-slide object correspondence and animation.
- [ ] **J-11 `SlideNotesEditor`:** Speaker notes with rich text.
- [ ] **J-12 `PresenterView`:** Current/next slide, notes, clock and timer.
- [ ] **J-13 `RehearsalTimers`:** Record timings, reset, elapsed and session stats.
- [ ] **J-14 `InkAndLaserPointer`:** Live pen/laser overlays with optional capture.
- [ ] **J-15 `MediaInsertInspector`:** Video/audio fit, trim and playback options.
- [ ] **J-16 `ChartAndTableEditor`:** Data-bound charts and editable table formatting.

## K. PDF authoring, markup & review — 21 components (P1)

**Consumers:** @nitro-forge/folio (FolioForge) • PdfCraft

- [ ] **K-01 `VirtualPDFPageViewer`:** Fast multi-page text and vector render.
- [ ] **K-02 `PDFThumbnailSidebar`:** Drag reorder, grouping and insert previews.
- [ ] **K-03 `PDFPageLayoutSelector`:** Single, continuous, facing-page/two-up modes.
- [ ] **K-04 `TextSearchResults`:** Document-wide indexing, highlights and jump.
- [ ] **K-05 `PDFTextSelection`:** Copyable reading-order aware text selection.
- [ ] **K-06 `AnnotationToolbar`:** Text, highlight, underline, strike, draw and shapes.
- [ ] **K-07 `CommentsThreadPanel`:** Thread, author, reply and resolve actions.
- [ ] **K-08 `SignatureStampTool`:** Pen draw, image signature and preview placement.
- [ ] **K-09 `PDFFormFieldEditor`:** Checkbox, signature, text, dropdown and validation.
- [ ] **K-10 `PageReorderOrganizer`:** Rearrange/duplicate/delete/rotate thumbnails.
- [ ] **K-11 `ExtractMergeSplitDialog`:** Selected page range and source documents.
- [ ] **K-12 `BookmarkOutline`:** Hierarchy, expand/collapse and destinations.
- [ ] **K-13 `HyperlinkInspector`:** Link targets, internal page jumps and actions.
- [ ] **K-14 `RedactionReviewTool`:** Redact preview and irreversible apply confirmation.
- [ ] **K-15 `EncryptPermissionsPanel`:** Password, restrictions and compatibility levels.
- [ ] **K-16 `PDFCompareOverlay`:** Visual diff and text change list.
- [ ] **K-17 `PrintAndExportPreview`:** Paper, crop, quality, PDF/A and output progress.


### ArtCraft Android parity additions (2026-11-03)

- [ ] **K-18 `PDFReadAloudTransport`:** PDF text/speech alignment, playback rate, current sentence and screen reader cooperation. *Source candidate: `pdfcraft/ui/viewer/ReadAloud.kt`; requires verified implementation and license admission.*
- [ ] **K-19 `PDFVoiceNoteAttachment`:** Record actual attached audio notes, show duration and playback state. *Source candidate: `pdfcraft/ui/viewer/VoiceRecorder.kt`; requires verified implementation and license admission.*
- [ ] **K-20 `PDFScanSession`:** Camera capture multi-page scan, correction and PDF document append/replace. *Source candidate: `pdfcraft/ui/ScanSession.kt`; requires verified implementation and license admission.*
- [ ] **K-21 `PDFInlineTextEdit`:** Editable PDF text with font/layout limitations, hit testing and truthful save status. *Source candidate: `pdfcraft/ui/viewer/Edit.kt`; requires verified implementation and license admission.*

## L. UI design, prototyping & collaboration — 15 components (P1)

**Consumers:** @nitro-forge/prism + future FigCraft adapter

- [ ] **L-01 `FrameAndComponentTree`:** Frames, instances, groups and layers in hierarchy.
- [ ] **L-02 `AutoLayoutInspector`:** Direction, gap, padding, wrap, alignment.
- [ ] **L-03 `HugFillFixedSizeControls`:** Per-axis sizing modes with live layout.
- [ ] **L-04 `ConstraintsPanel`:** Anchoring, min/max and responsive relationships.
- [ ] **L-05 `ComponentVariantPicker`:** Variant properties and instance overrides.
- [ ] **L-06 `ReusableStylesPanel`:** Colors, text, effects and assets.
- [ ] **L-07 `VariablesAndModes`:** Token modes, aliases and binding visualization.
- [ ] **L-08 `PrototypeConnectionTool`:** Drag targets, hot spots and navigation links.
- [ ] **L-09 `InteractionTriggerEditor`:** Tap, press, hover, drag and timer events.
- [ ] **L-10 `PrototypePreviewPlayer`:** Screen preview and animated transitions.
- [ ] **L-11 `FlowOverview`:** Connected frames, entry points and navigation flows.
- [ ] **L-12 `DevHandoffInspector`:** Spacing, typography, assets and code hints.
- [ ] **L-13 `CollaborationPresence`:** User cursors, selections and live conflict states.
- [ ] **L-14 `CommentPins`:** Thread pins positioned on design canvas.
- [ ] **L-15 `MultiExportSlices`:** Presets, resolutions, asset batching and transparent bounds.

## M. CAD, 3D painting & procedural materials — 17 components (P2)

**Consumers:** Future CADCraft / TextureCraft / MaterialCraft targets

- [ ] **M-01 `Native3DViewport`:** Orbit/pan/zoom, scene selection and material preview.
- [ ] **M-02 `ViewCubeAndAxisGizmo`:** Orientation, orthographic/perspective modes.
- [ ] **M-03 `TransformGizmo3D`:** Translate/rotate/scale with axis constraints.
- [ ] **M-04 `UVEditor`:** UV seams, islands, packing and synchronized 2D view.
- [ ] **M-05 `TextureSetPanel`:** PBR channel groups and per-channel visibility.
- [ ] **M-06 `PBRMaterialInspector`:** Base color, roughness, metallic, normals, emissive.
- [ ] **M-07 `TextureBrush3D`:** Model painting across seams with true surface projection.
- [ ] **M-08 `TextureMaskAndGenerator`:** Mask, smart generators and fill layer parameters.
- [ ] **M-09 `BakingMapPanel`:** AO, curvature, thickness, normals and bake output.
- [ ] **M-10 `NodeGraphCanvas`:** Visual nodes, sockets, cables, pan/zoom and selection.
- [ ] **M-11 `NodeLibrarySearch`:** Search nodes and drag to graph.
- [ ] **M-12 `LiveNodeThumbnail`:** Preview images and dependency/cook status.
- [ ] **M-13 `DraftingCommandLine`:** CAD command entry, history and completion.
- [ ] **M-14 `ObjectSnapsAndOrtho`:** Endpoint, midpoint, tangent and polar feedback.
- [ ] **M-15 `DimensionsAndHatching`:** Associative measurement and area patterns.
- [ ] **M-16 `PaperSpaceLayout`:** Viewport sizes, scale, sheet templates and print.
- [ ] **M-17 `ParametricConstraintEditor`:** Expressions, geometric constraints and conflicts.

## N. Input, platform, offline & delivery infrastructure — 21 components (P0)

**Consumers:** Shared platform layer + Ignition + Board

- [ ] **N-01 `NativePointerRouter`:** Touch, mouse, keyboard, stylus, hover and pressure.
- [ ] **N-02 `PenPairingDialog`:** Honest BLE link vs verified input and cancellation.
- [ ] **N-03 `LogitechMuseSpatialInk`:** SDK-backed tracked input and 6DoF diagnostics.
- [ ] **N-04 `PalmRejectionAndPrediction`:** Pressure/tilt, coalesced predicted strokes.
- [ ] **N-05 `HapticsAndFeedback`:** Stateful tactile feedback with user opt-out.
- [ ] **N-06 `VoiceOverTalkBackSupport`:** Labels, roles, adjustable controls and navigation.
- [ ] **N-07 `HardwareKeyboardMap`:** Desktop-level shortcuts and conflict resolution.
- [ ] **N-08 `SafeAreaFoldableLayout`:** Dual panes, occlusion/hinge and orientation changes.
- [ ] **N-09 `XRPresentationAdapter`:** Optional Viro/visionOS/PICO surface; not source of document truth.
- [ ] **N-10 `OfflineCheckpointAndAutosave`:** MMKV v4 snapshots, atomic save and dirty status.
- [ ] **N-11 `CollaborationAdapter`:** Yjs where applicable, revision boundaries and conflicts.
- [ ] **N-12 `NativeFileAndShareAdapter`:** Open-in-place, document picker, share and security scope.
- [ ] **N-13 `LongTaskScheduler`:** Cancelable decode/export/render without JS blocking.
- [ ] **N-14 `MediaCache`:** Waveform peaks, preview frames, thumbnails and eviction.
- [ ] **N-15 `UndoTransactionCoordinator`:** One undo step per continuous gesture.
- [ ] **N-16 `NativeBinaryTransport`:** Shared bytes/ArrayBuffer handles; avoid giant base64 copies.
- [ ] **N-17 `NativePlaybackLifecycle`:** Audio focus, interruptions, background and headset loss.
- [ ] **N-18 `TestAndTelemetryAdapter`:** Permission-aware timings, failures and debug traces.


### ArtCraft Android parity additions (2026-11-03)

- [ ] **N-19 `NativeMediaDecoderSurface`:** Platform frame/audio decode and seek backed by media-time coordinates, with error surface. *Source candidate: `filmcraft/ui/editor/Player.kt`; requires verified implementation and license admission.*
- [ ] **N-20 `AudioInterruptionRecoveryDialog`:** Audio focus/route-loss/recovered-recording experience with safe pause/stop/resume. *Source candidate: `filmcraft/ui/editor/Voiceover.kt`; requires verified implementation and license admission.*
- [ ] **N-21 `AccessiblePrecisionScrubControl`:** Keyboard, switch control, screen reader adjustable value, trackpad and touch scrub parity. *Source candidate: `lightcraft/ui/DevelopSlider.kt`; requires verified implementation and license admission.*

## Active implementation slices (November 3–4, 2026)

The following are **source-level partial components**, not completed parity entries.
Leave their checklist items **unchecked** until the platform/runtime gates below pass.

| Master ID | Source implementation | CI evidence | Still missing |
| --- | --- | --- | --- |
| D-04 `NativeSeekBar` | [media-ui PR #25](https://github.com/mikevocalz/nitro-forge/pull/25) — controlled native Expo UI slider, frame-step and timecode | [Linux/macOS/Windows TS and unit checks pass](https://github.com/mikevocalz/nitro-forge/actions/runs/41774414374) | Real decoded media seeking, buffered region, drag-end lifecycle, platform E2E |
| E-02 `WaveformLane` | [media-ui PR #25](https://github.com/mikevocalz/nitro-forge/pull/25) — bounded RN min/max display + seeker | Same source CI pass | Skia v3 GPU lane, viewport virtualization, actual mic/PCM streaming, device perf |
| C-06 `ColorChannels` | [color-ui PR #26](https://github.com/mikevocalz/nitro-forge/pull/26) — native RGBA sliders and hex/HSV conversions | [Linux/macOS/Windows TS and unit checks pass](https://github.com/mikevocalz/nitro-forge/actions/runs/41774424739) | Native hue/SV picker, CMYK/Lab + ICC management, actual device/brower E2E |
| E-11/E-12 mixer-related | [media-ui PR #25](https://github.com/mikevocalz/nitro-forge/pull/25) — `NativeLevelSlider` generic gain control | Same source CI pass | dB precision, routing/meters, audio engine integration |

**Cross-platform is a required acceptance contract, not a checked feature merely because one shared TypeScript component exists.** Universal Expo SDK 58 `@expo/ui` renders SwiftUI/Jetpack Compose/browser range controls, but all new UI requires mounted/interactive verification on supported iOS, Android, desktop/mobile browser, phone/tablet/hinge. Nitro v1 and Expo Modules v2 platforms require separately passing native integration tests. visionOS/PICO need explicit adapters and tests; do not assume support from iPhone/Android code.

**Agent-ready, not dispatched:** [native player #27](https://github.com/mikevocalz/nitro-forge/issues/27), [audio capture and GPU waveform #28](https://github.com/mikevocalz/nitro-forge/issues/28), [color wheel/gradient/eyedropper #29](https://github.com/mikevocalz/nitro-forge/issues/29), [native ABI + AGPL source/release QA #30](https://github.com/mikevocalz/nitro-forge/issues/30). Copilot cloud-agent assignment was rejected by the repository, so these are human/agent-ready engineering issues and **no autonomous agent session is claimed**.

## Required engine/platform dependencies before declaring parity

1. **Splice / ReelForge:** native decode, video texture/frame output, synchronized audio, play/pause/seek, frame-accurate timebase, source indexing, thumbnails, GPU compositor, and render/export encoder. Current `master` exposes mostly clip metadata and a render *plan*, not playable media.
2. **Cadence / BeatForge:** device audio input/output, recording PCM to disk, scheduling, multitrack streaming mix, waveform peak pyramid, spectrogram computations, latency compensation, MIDI I/O, plugin processing and bounce/export. The current engine supports MIDI structures and sine PCM renders, not actual microphone recording or waveform audio clips.
3. **Prism / PixForge:** GPU layer compositing, vector/selection/mask model, color-managed pipeline, fonts/typography, brush engine and PSD/SVG interchange beyond existing shapes and pixel filters.
4. **Board:** preserve one authoritative document, one Skia v3 canvas, Ink pressure path and user-owned Yjs/MMKV adapters; do not duplicate board engines or rename its already scoped package.
5. **All editors:** stable command model, ability to abort a gesture, one journal transaction per drag, exact mixed-value handling, keyboard/stylus parity, reliable document saves and real-device performance budgets.
6. **Nitro v1:** use the existing experimental alpha branch behind compatibility gates; master currently exposes an older Nitro contract. Do not mix generated types or claim native readiness until iOS/Android linkage and device tests pass.
7. **Expo SDK 58 / Expo Modules 2.0:** SDK 58 is stable, while Expo Modules 2.0's annotation API remains a beta within it. 2.0 native services do not establish support for 2.0 custom-view decorators; use supported native views and @expo/ui behind tested adapters. The existing main example currently targets Expo 54; no SDK58 device test has passed for the new module yet.
8. **CapCraft AGPL track:** `@nitro-forge/agpl-speed-curve` is a source-only experimental derived implementation, not completed playable retiming. Any combined native app/SDK integrating it needs AGPL compliance and source-distribution planning before shipment.

## Native control acceptance criteria

- Real actions: playback moves frames; seeking updates the decoded frame; recording creates real audio and waveforms; a color commit updates the Rust document; export produces an actual supported file.
- Input: test finger, stylus/Muse where verified, trackpad/mouse and hardware keyboard; cancel and Escape restore prior state.
- Rendering: high-frequency signals and previews remain off the JS render loop; bounded caches, virtualization and coalescing; no base64 frame/audio flood.
- Undo: drag, trim, and automation write have clear transaction boundaries; focus loss and interruptions are safe.
- Adaptive: phone, iPad, Android tablets, Surface Duo/foldables, desktop web, keyboard and optional XR adapters, without pane splits crossing hinge/occlusion.
- A11y: screen-reader names, keyboard focus, large touch targets, high contrast and reduced motion.
- Visual system: professional Affinity/Adobe/Sketch/Canva-grade *original* aesthetic. Reuse the Forge icon catalog and Rive seams, without copying trademarks or shipped graphic assets.
- Evidence: unit/interaction tests, screenshot comparisons, actual device playback/recording/export tests, performance traces and package-consumer builds.

## Primary references

- [ArtCraft Android public repositories](https://github.com/artcraft-android) and [Nitro Forge PR #24](https://github.com/mikevocalz/nitro-forge/pull/24)
- [GNU AGPL-3.0-or-later](https://www.gnu.org/licenses/agpl-3.0.en.html), [CapCraft LICENSE](https://github.com/artcraft-android/capcraft-android/blob/main/LICENSE) and [third-party notices](https://github.com/artcraft-android/capcraft-android/blob/main/THIRD_PARTY_NOTICES.md)

- [Nitro Forge repository](https://github.com/mikevocalz/nitro-forge)
- [ArtCraft official suite](https://getartcraft.com/apps)
- [ArtCraft shared UI component audit](https://github.com/storytold/craft-libs/blob/main/docs/ui-components-audit.md)
- [FilmCraft](https://getartcraft.com/apps/filmcraft) and [SoundCraft](https://getartcraft.com/apps/soundcraft)
- [PhotoCraft](https://getartcraft.com/apps/photocraft), [VectorCraft](https://getartcraft.com/apps/vectorcraft), and [LightCraft](https://getartcraft.com/apps/lightcraft)
- [EffectCraft](https://getartcraft.com/apps/effectcraft) and [FigCraft](https://getartcraft.com/apps/figcraft)
- [WordCraft](https://getartcraft.com/apps/wordcraft), [GridCraft](https://getartcraft.com/apps/gridcraft), [DeckCraft](https://getartcraft.com/apps/deckcraft), [PdfCraft](https://getartcraft.com/apps/pdfcraft), and [DesignCraft](https://getartcraft.com/apps/designcraft)
- [CADCraft](https://getartcraft.com/apps/cadcraft), [TextureCraft](https://getartcraft.com/apps/texturecraft), [MaterialCraft](https://getartcraft.com/apps/materialcraft)