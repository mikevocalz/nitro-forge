# Full component completion program

This supersedes the limited recovery scope. All 341 canonical IDs are included. Existing merged implementations are audited and reused; missing functionality must be implemented. A source file, a callback-shaped stand-in, a successful compile, or an unavailable-feature message cannot by itself satisfy completion.

## Approved v1 scope update — 2026-11-10

All twelve previously deferred native/service rows are included in the current
candidate. Their implementations stay with their actual library, engine or Viro
owners and are pinned in [V1 platform closure](reports/V1-PLATFORM-CLOSURE.md).
Source coverage and required platform acceptance continue to be separate gates.

## Ownership and PR structure

Forge owns this canonical ledger, document models, Rust operations, native processing and typed bindings. NYC-Tron owns reusable controls and platform UI/services. One primary Forge draft PR and a linked NYC-Tron draft PR form the program; cross-repository code cannot be represented by one Git diff. Both branches stay open across phases. No phase is merged or released early merely to make the checklist look complete.

## Phase sequence

| Phase | Work | Component delivery IDs | Dependencies |
| --- | --- | ---: | --- |
| P00 | Inventory, requirements and completion gates | 0 | none |
| P01 | Native runtime bootstrap | 0 | P00 |
| P02 | Shared platform and document infrastructure | 15 | P01 |
| P03 | Decoder and playback foundation | 3 | P01, P02 |
| P04 | Studio shell and advanced GUI foundations | 30 | P02 |
| P05 | Canvas, selection, layers and vectors | 27 | P04 |
| P06 | Brush, ink, pen and timelapse | 11 | P05 |
| P07 | Color and image processing | 27 | P05 |
| P08 | Timeline and video production | 41 | P03, P04, P07 |
| P09 | Audio, MIDI and recording | 41 | P02, P03, P04 |
| P10 | Photo catalog and RAW development | 18 | P05, P07 |
| P11 | Motion and compositing | 15 | P05, P08 |
| P12 | Documents and typography | 22 | P02, P04 |
| P13 | Spreadsheet completion | 21 | P02, P04 |
| P14 | Slides and presentation | 16 | P04, P08, P09 |
| P15 | PDF editing and delivery | 21 | P02, P04 |
| P16 | UI design and prototyping | 15 | P04, P05 |
| P17 | CAD, 3D, materials and nodes | 17 | P05, P07 |
| P18 | Desktop, XR and additional host integration | 1 | P02, P03, P04, P17 |
| P19 | Full component and platform acceptance | 0 | P02, P03, P04, P05, P06, P07, P08, P09, P10, P11, P12, P13, P14, P15, P16, P17, P18 |
| P20 | Distribution and final release acceptance | 0 | P19 |

The delivery phase assigns each component exactly once. P01 is a host-bootstrap milestone; P19 applies final acceptance to all components, and P20 verifies their released distribution. Completing a phase milestone does not silently mark its components complete across untested platforms. Independent work may proceed while an external hardware gate is recorded, but final acceptance cannot waive that gate.

## Definition of complete

Each component needs a reviewed functional specification with real inputs, outputs and failure cases; the appropriate canonical export and actual implementation; authoritative backend operations where needed; tested host integration; atomic edits and undo/redo; save/reopen and migrations; lifecycle/cancellation/error handling; keyboard and assistive-technology behavior; responsive/fold/RTL/window continuity; measured performance budgets; reviewed source/dependency/model licenses; and a verified consumer artifact. Pure visual controls or headless services can have an inapplicable gate only with a documented architectural reason and evidence of the consuming workflow. An unsupported required platform is unfinished work, not a passing exception.

Required platform coverage: iOS/iPadOS, Android including foldable/tablet behavior, web, macOS, Windows, visionOS, Meta Quest and PICO. Additional QNX/Linux/watchOS/tvOS host applicability must be explicitly resolved in P18 rather than silently assumed supported. Preserve each existing app window/orientation contract and platform manifest metadata; use expo-horizon-core for Meta Horizon/Quest app configuration.

`components.json` preserves original status/evidence separately from new strict acceptance. Every new gate begins unverified; this does not discard existing implementation. Passing evidence must identify component IDs, platform, command/workflow, commit, environment, result and durable artifact. Mocks can validate routing but cannot prove native functionality. Required real hardware/accessibility evidence remains a gate when unavailable locally.

## Execution protocol

1. Audit the phase’s existing code, contracts and dependencies; specify actual missing behavior before implementing.
2. Implement reusable controls in NYC-Tron and real engine/native behavior in Forge; do not duplicate owners, introduce useState, replace established window contracts, or copy unreviewed third-party code.
3. Run relevant engine/component/consumer and actual platform checks. Record failures and fix them; keep remaining external gates explicit.
4. Commit and push the phase to the umbrella branches. Write a phase report listing changes, exact commits, evidence, completed gates and remaining blockers. Report back to the user.
5. Continue to the next phase. Only mark the overall PR ready when all 341 entries satisfy P19/P20 and required CI/release/device gates.

## Phase exit details

### P00 — Inventory, requirements and completion gates

Map all 341 IDs once; preserve baseline evidence; validate phase dependencies and mandatory completion gates.

### P01 — Native runtime bootstrap

Start the canonical generated factory in the native consumer; exercise seven engines, snapshots and Cadence edits through actual JS/native calls; verify cleanup and errors on iOS/Android.

### P02 — Shared platform and document infrastructure

Complete task/cancellation/cache/binary APIs, autosave/recovery, atomic gesture transactions, collaboration, file/share, keyboard and accessibility infrastructure.

### P03 — Decoder and playback foundation

Implement real Android/iOS/web media decoding, native video playback and frame-accurate seek; validate cancellation, bounds, codec failures and lifecycle.

### P04 — Studio shell and advanced GUI foundations

Complete all shell controls, commands, bounded unit inputs, real import/export delivery, overlay coordination, clipboard/drag-drop and workspace/document continuity.

### P05 — Canvas, selection, layers and vectors

Complete real rendering, transforms, selection, masks, crop/encode, artboards and vector operations with atomic undo and stable document snapshots.

### P06 — Brush, ink, pen and timelapse

Implement brush/dynamics/taper/stabilization, pixel/vector/mask erasing, hardware input/prediction/Muse integration and actual timelapse encoding.

### P07 — Color and image processing

Complete color spaces/gamut/ICC/proof, swatches/gradients/mesh, histograms/curves/grading/scopes and actual eyedropper sampling.

### P08 — Timeline and video production

Complete every remaining timeline/video component against real decoded media, effect rendering, tracking/stabilization/captions, cache and encoded export.

### P09 — Audio, MIDI and recording

Complete real playback/recording/device routing, automation/comping, MIDI/sequencer, latency/surround, offline DSP/model-backed features and valid exported audio.

### P10 — Photo catalog and RAW development

Implement catalog/version metadata and genuine RAW/develop/lens/mask/retouch/batch-export processing; select and verify missing decoding/processing dependencies first.

### P11 — Motion and compositing

Implement composition state, keyframes/easing/graphs/paths, 3D/cameras/lights, mattes/effects, bounded expressions, particles, nodes and rendering queues.

### P12 — Documents and typography

Complete Quill layout/caret/IME/fonts, styles/tables/page layout/review/TOC/citations/mail merge and actual speech/dictation workflows.

### P13 — Spreadsheet completion

Complete every Tally grid/formula/format/validation/sort/chart/pivot/import/comment/view feature with real workbook state and keyboard/clipboard semantics.

### P14 — Slides and presentation

Complete Pitch masters/templates/canvas/diagrams/transitions/animation/morph/notes/media/charts, presenter displays, rehearsal and persistent ink.

### P15 — PDF editing and delivery

Complete real PDF rendering/search/selection/annotation/forms/signatures/organizing/redaction/encryption/compare/print/scan/text editing and speech attachments.

### P16 — UI design and prototyping

Implement authoritative design/component/layout/variable/prototype state, real preview/handoff/presence/comments and multi-slice encoding.

### P17 — CAD, 3D, materials and nodes

Implement actual 3D rendering, gizmos/UV/PBR/texture painting/baking/nodes, drafting/snaps/dimensions/paper space and a real parametric constraint backend.

### P18 — Desktop, XR and additional host integration

Complete native Windows/macOS/visionOS/Quest/PICO hosts and their component adapters, displays/input/lifecycle; finish QNX/Linux host scope and ABI/toolchain validation.

### P19 — Full component and platform acceptance

Audit every component against functional, error, undo/persistence, accessibility, adaptive layout, performance, licensing and platform runtime evidence. No unverified row may be counted complete.

### P20 — Distribution and final release acceptance

Publish all completed packages and platform artifacts, verify checksums/exports/size/native consumers/migrations, update all consuming pins and close the full 341-row acceptance ledger.

## All component assignments

| ID | Component | Phase | Existing source status | Existing backend/gap |
| --- | --- | --- | --- | --- |
| A-01 | WorkspaceHost | P04 | BUILT-LOCAL | native/device acceptance and publication pending; Ignition WorkspaceSession one-document lifetime and host-validated layout views |
| A-02 | WorkspacePresetSwitcher | P04 | BUILT-LOCAL | native/device acceptance and publication pending; WorkspaceSession presets and explicit host key-value persistence |
| A-03 | AdaptiveDock | P04 | DONE | device gates only; none |
| A-04 | PaneSplitter | P04 | DONE | device gates only; none |
| A-05 | DocumentTabBar | P04 | DONE | device gates only; ignition per-document sessions (forge #9) |
| A-06 | ToolRail | P04 | DONE | device gates only; none |
| A-07 | ContextualToolbar | P04 | BUILT-LOCAL | native/device acceptance and publication pending; host command intents and selection; no new engine op needed |
| A-08 | RibbonTabs | P04 | DONE | device gates only; none |
| A-09 | InspectorPanel | P04 | DONE | device gates only; none |
| A-10 | InspectorSection | P04 | DONE | device gates only; none |
| A-11 | PropertyRow | P04 | DONE | device gates only; none |
| A-12 | NumericScrubField | P04 | DONE | device gates only; none |
| A-13 | UnitInput | P04 | DONE | device gates only; none |
| A-14 | SliderField | P04 | DONE | device gates only; none |
| A-15 | RangeSlider | P04 | DONE | device gates only; none |
| A-16 | RotaryKnob | P04 | DONE | device gates only; none |
| A-17 | SplitButton | P04 | DONE | device gates only; none |
| A-18 | CommandPalette | P04 | DONE | shared command registry (#45 gap) is a later extension; none |
| A-19 | ContextMenu | P04 | DONE | device gates only; none |
| A-20 | NativePopover | P04 | DONE | device gates only; none |
| A-21 | InspectorSearch | P04 | DONE | device gates only; none |
| A-22 | AssetBrowser | P04 | ABSENT | no asset store in any engine; asset index + thumbnail op (N-14 MediaCache) |
| A-23 | PresetGallery | P04 | DONE | device gates only; none |
| A-24 | HistoryPanel | P04 | ABSENT | no history read op; engine undo/redo journal query op (absent in ENGINE_OPS) |
| A-25 | StatusBar | P04 | DONE | device gates only; none |
| A-26 | ToastAndProgress | P04 | ABSENT | needs real progress source; N-13 LongTaskScheduler progress/cancel |
| A-27 | KeyboardShortcutHUD | P04 | DONE | device gates only; none |
| A-28 | FocusAndA11yLayer | P04 | DONE | device gates only; none |
| A-29 | FindReplacePopover | P04 | ABSENT | no engine search op; quill/tally find+replace ops (absent) |
| A-30 | FileImportExportSheet | P04 | BUILT-LOCAL | native/device acceptance and publication pending; NFD/PDF/DOCX/CSV/WAV/render-plan bytes implemented; explicit platform writer required |
| B-01 | GPUCanvasViewport | P05 | PARTIAL | Graphite device test pending (forge#19 Android compile now green); board renderer Nitro v1 (#18/#19/#22) |
| B-02 | CanvasPanZoom | P05 | PARTIAL | wheel/zoom-to-fit unverified; board camera |
| B-03 | CanvasRuler | P05 | BUILT-LOCAL | publication and native/device acceptance pending; document units from engine |
| B-04 | SnapGridOverlay | P05 | BUILT-LOCAL | publication and native/device acceptance pending; none |
| B-05 | SmartGuides | P05 | BUILT-LOCAL | publication and native/device acceptance pending; object bounds query (prism getLayer) |
| B-06 | SelectionBounds | P05 | PARTIAL | no prism move/resize/rotate op; prism transform op (absent; addShape only) |
| B-07 | MultiSelectionControls | P05 | PARTIAL | no multi-select in prism; prism selection model (absent) |
| B-08 | TransformOriginHandle | P05 | BUILT-LOCAL | publication and native/device acceptance pending; prism transform op |
| B-09 | LayerStack | P05 | BUILT-LOCAL | publication and native/device acceptance pending; prism ops: moveLayer,setLayerVisible exist; groups+lock absent |
| B-10 | LayerThumbnail | P05 | BUILT-LOCAL | publication and native/device acceptance pending; prism per-layer thumbnail render (absent; flatten only) |
| B-11 | LayerBlendAndOpacity | P05 | PARTIAL | no blend op; prism ops: setLayerOpacity exists; blend modes absent |
| B-12 | MaskThumbnailAndEditor | P05 | BUILT-LOCAL | publication and native/device acceptance pending; prism mask model (absent) |
| B-13 | ClippingMaskControls | P05 | BUILT-LOCAL | publication and native/device acceptance pending; prism clipping (absent) |
| B-14 | ArtboardNavigator | P05 | BUILT-LOCAL | publication and native/device acceptance pending; prism has one canvas; pitch slides exist |
| B-15 | BrushPresetBrowser | P06 | ABSENT | none; brush engine (absent) |
| B-16 | BrushDynamicsInspector | P06 | ABSENT | none; brush engine |
| B-17 | InkStrokePreview | P06 | PARTIAL | tilt/twist + latency readout absent; board ink |
| B-18 | EraserModePicker | P06 | PARTIAL | mode picker UI only; pixel/vector/mask erase engines absent; board erase + prism raster erase (absent) |
| B-19 | SelectionMarquee | P05 | BUILT-LOCAL | publication and native/device acceptance pending; prism selection model |
| B-20 | MagicSelectionControls | P05 | BUILT-LOCAL | publication and native/device acceptance pending; prism magic-wand op |
| B-21 | PenNodeEditor | P05 | BUILT-LOCAL | publication and native/device acceptance pending; prism vector path model (shapes only) |
| B-22 | ShapeBuilder | P05 | BUILT-LOCAL | publication and native/device acceptance pending; prism boolean ops |
| B-23 | FillStrokeInspector | P05 | BUILT-LOCAL | publication and native/device acceptance pending; prism shape stroke/fill props |
| B-24 | GradientOnCanvasHandles | P05 | BUILT-LOCAL | publication and native/device acceptance pending; prism gradient fill |
| B-25 | AlignDistributePanel | P05 | BUILT-LOCAL | publication and native/device acceptance pending; prism transform op |
| B-26 | GuidedCropAndStraighten | P05 | PARTIAL | ratio presets + straighten absent; no real crop op; prism crop/resize op (resize only) |
| B-27 | CanvasCompareView | P05 | BUILT-LOCAL | publication and native/device acceptance pending; prism flatten (exists) |
| B-28 | FloatingPaletteUndockHandle | P05 | DONE | device gates only; none |
| B-29 | BrushTaperControl | P06 | ABSENT | none; brush engine |
| B-30 | ColorDropCanvasTarget | P05 | BUILT-LOCAL | publication and native/device acceptance pending; prism ops: fillLayer exists (raster only) |
| B-31 | ReferenceImageBoard | P05 | BUILT-LOCAL | publication and native/device acceptance pending; none (reference images are not document state) |
| B-32 | TimelapsePlaybackExporter | P06 | ABSENT | no encoder in any engine; history replay + video encoder (absent) |
| B-33 | BrushStabilizationPreview | P06 | ABSENT | none; ink stabilizer (google/ink candidate, forge #46) |
| B-34 | GestureCustomizationPanel | P05 | BUILT-LOCAL | publication and native/device acceptance pending; none |
| C-01 | ColorPickerDialog | P07 | BUILT-LOCAL | native/device acceptance and publication pending; Prism setColors/swapColors/getColors/setFill implemented; previews host-owned |
| C-02 | SVColorField | P07 | DONE | device gates only; none |
| C-03 | ColorWheel | P07 | DONE | device gates only; none |
| C-04 | HueSlider | P07 | DONE | device gates only; none |
| C-05 | AlphaSlider | P07 | DONE | device gates only; none |
| C-06 | ColorChannels | P07 | DONE | device gates only; none |
| C-07 | PrintColorChannels | P07 | ABSENT | none; color-managed conversion (OpenColorIO candidate, forge #46) |
| C-08 | WideGamutChannels | P07 | ABSENT | none; color pipeline |
| C-09 | ColorSpaceChooser | P07 | ABSENT | none; ICC profile handling (absent) |
| C-10 | GamutWarning | P07 | ABSENT | none; gamut mapping |
| C-11 | EyedropperTool | P07 | ABSENT | must sample document, not screen; canvas pixel sample op (prism flatten exists; board none) |
| C-12 | ForegroundBackgroundChips | P07 | DONE | device gates only; none |
| C-13 | SwatchGrid | P07 | DONE | device gates only; document swatch storage (absent) |
| C-14 | ThemeColorReferences | P07 | ABSENT | schema decision; token/spot color IDs in documents (absent) |
| C-15 | SpotAndGlobalColorEditor | P07 | ABSENT | schema decision; spot ink model |
| C-16 | GradientStopEditor | P07 | ABSENT | none; prism gradient fill |
| C-17 | GradientMeshEditor | P07 | ABSENT | none; mesh gradient renderer |
| C-18 | ColorHarmonyAssistant | P07 | DONE | device gates only; none |
| C-19 | LiveHistogram | P07 | ABSENT | none; histogram op (absent) |
| C-20 | LevelsEditor | P07 | ABSENT | none; prism levels filter (absent) |
| C-21 | CurvesEditor | P07 | ABSENT | none; prism curves filter |
| C-22 | ColorGradingWheels | P07 | ABSENT | none; grading filter (prism/splice) |
| C-23 | HSLSecondaryEditor | P07 | ABSENT | none; HSL range filter |
| C-24 | VideoScopesPanel | P07 | ABSENT | no decode in splice; splice decoded frames + scope compute |
| C-25 | SoftProofControls | P07 | ABSENT | none; color pipeline proofing |
| C-26 | FloatingColorPalette | P07 | DONE | device gates only; none |
| C-27 | ColorDiscPicker | P07 | DONE | device gates only; none |
| D-01 | NativeVideoPlayer | P03 | PARTIAL | no decoder-backed player on any branch (forge#44 linkage green); N-19 native decode surface (Nitro v1 player port, forge #33 gate) |
| D-02 | SourceMonitor | P08 | PARTIAL | playback absent; N-19 native decode surface (Nitro v1 player port, forge #33 gate); splice addSource |
| D-03 | ProgramMonitor | P08 | ABSENT | no compositor; splice renderPlan + GPU compositor (absent) |
| D-04 | NativeSeekBar | P08 | DONE | device gates only; decoded seek (N-19) |
| D-05 | FrameAccurateScrubber | P03 | PARTIAL | exact final commit to decoder absent; N-19 coalesced seek |
| D-06 | TransportControls | P08 | DONE | device gates only; N-19 |
| D-07 | PlaybackRateMenu | P08 | DONE | device gates only; N-19 rate support |
| D-08 | TimecodeDisplay | P08 | DONE | device gates only; none |
| D-09 | JKLShuttleController | P08 | BUILT-UI | Shuttle intent is complete; real reverse/step playback needs a capable player/decoder; N-19 variable-rate playback |
| D-10 | TimelineRuler | P08 | DONE | device gates only; splice timeline read |
| D-11 | TimelinePlayhead | P08 | DONE | device gates only; splice timeline + transport time |
| D-12 | InOutRangeHandles | P08 | DONE | device gates only; splice ops addClip/moveClip/trimClip/splitClip/setSpeed/timeline exist |
| D-13 | LoopRangeBar | P08 | BUILT-LOCAL | Unpublished local cluster; native/device acceptance not run; loop range in splice (absent) |
| D-14 | TimelineZoomAndScroll | P08 | DONE | device gates only; none |
| D-15 | TimelineClipLane | P08 | DONE | device gates only; splice ops addClip/moveClip/trimClip/splitClip/setSpeed/timeline exist |
| D-16 | VideoFilmstrip | P08 | ABSENT | none; thumbnail extraction (N-14/N-19) |
| D-17 | AudioClipWaveform | P08 | ABSENT | none; peak pyramid from decoded audio (N-14) |
| D-18 | TrackHeaders | P08 | BUILT-LOCAL | Unpublished local cluster; native/device acceptance not run; splice track lock/hide/mute (absent; add/remove only) |
| D-19 | ClipTrimHandles | P08 | DONE | device gates only; splice ops addClip/moveClip/trimClip/splitClip/setSpeed/timeline exist (trimClip) |
| D-20 | RazorSplitTool | P08 | BUILT-LOCAL | Unpublished local cluster; native/device acceptance not run; splice ops addClip/moveClip/trimClip/splitClip/setSpeed/timeline exist (splitClip); ripple absent |
| D-21 | RollSlipSlideControls | P08 | BUILT-LOCAL | Unpublished local cluster; native/device acceptance not run; roll/slip/slide ops (absent) |
| D-22 | DragReorderAndRipple | P08 | BUILT-LOCAL | Unpublished local cluster; native/device acceptance not run; splice ops addClip/moveClip/trimClip/splitClip/setSpeed/timeline exist (moveClip rejects overlap); insert/overwrite policy absent |
| D-23 | TransitionHandles | P08 | BUILT-LOCAL | Unpublished local cluster; native/device acceptance not run; splice transitions (absent) |
| D-24 | TimelineMarkers | P08 | BUILT-LOCAL | Unpublished local cluster; native/device acceptance not run; splice markers (absent) |
| D-25 | SafeAreaOverlay | P08 | DONE | device gates only; none |
| D-26 | ScopesDock | P08 | ABSENT | none; C-24 scopes |
| D-27 | MulticamAngleViewer | P08 | ABSENT | no multicam model; multicam sync in splice (absent) |
| D-28 | RenderCacheIndicator | P08 | ABSENT | none; render cache (absent) |
| D-29 | ExportMonitor | P08 | ABSENT | none; encoder/export backend (absent) |
| D-30 | PictureInPictureControls | P08 | ABSENT | none; N-19 + platform PiP |
| D-31 | OverlayAndEffectsTrackStack | P08 | PARTIAL | Overlay/video/audio stack complete locally; effects/adjustment renderer still absent; splice track kinds beyond video/audio (absent) |
| D-32 | VideoSpeedRampCurve | P08 | PARTIAL | retime not playable; AGPL package; splice keyframed speed (setSpeed is constant) |
| D-33 | AutoCaptionTranscriptTimeline | P08 | ABSENT | ASR backend not chosen; on-device ASR service (absent) |
| D-34 | CaptionWordTimingHandles | P08 | ABSENT | none; D-33 transcript model |
| D-35 | AutoReframeGuides | P08 | ABSENT | none; subject tracking (absent) |
| D-36 | VideoStabilizationInspector | P08 | ABSENT | none; stabilization DSP (absent) |
| D-37 | TransitionPresetBrowser | P08 | BUILT-LOCAL | Unpublished local cluster; native/device acceptance not run; D-23 transitions |
| D-38 | VideoEffectsBrowser | P08 | ABSENT | none; video effect pipeline (absent) |
| D-39 | MotionTrackingOverlay | P08 | ABSENT | none; tracking backend |
| D-40 | CoverFramePicker | P08 | ABSENT | none; N-19 frame grab + export metadata |
| D-41 | BatchEditPanel | P08 | BUILT-LOCAL | Unpublished local cluster; native/device acceptance not run; splice batch transaction (absent) |
| D-42 | VideoQualityInspector | P08 | ABSENT | none; media probe (absent) |
| D-43 | StickerMotionLane | P08 | ABSENT | none; splice sticker/overlay tracks |
| E-01 | NativeAudioTransport | P09 | PARTIAL | punch + engine-scheduled transport absent; device audio I/O + PCM-to-disk (forge #35/#37 capture; not in cadence engine) |
| E-02 | WaveformLane | P09 | BUILT-UI | Skia GPU lane deferred: backend unverified on devices; peaks from decoded audio (N-14); window is view state (no op) |
| E-03 | StereoMultichannelWaveform | P09 | ABSENT | none; multichannel peaks (N-14) |
| E-04 | LiveRecordingWaveform | P09 | PARTIAL | device mic test pending; device audio I/O + PCM-to-disk (forge #35/#37 capture; not in cadence engine) |
| E-05 | SpectrogramView | P09 | BUILT-LOCAL | publication and native/device acceptance pending; Cadence spectrogram: implemented offline |
| E-06 | RecordingArmButton | P09 | PARTIAL | armed state absent; cadence track arm (absent) |
| E-07 | InputMonitorToggle | P09 | ABSENT | none; monitoring route in audio graph (absent) |
| E-08 | DeviceAndChannelPicker | P09 | ABSENT | none; device enumeration (absent) |
| E-09 | AudioClipTrimAndFade | P09 | ABSENT | no audio-clip model; cadence audio clips + fades (cadence clips are MIDI) |
| E-10 | ClipGainEnvelope | P09 | ABSENT | none; clip gain envelope |
| E-11 | AutomationLane | P09 | BUILT-LOCAL | publication and native/device acceptance pending; Cadence add/move/removeAutomationPoint: implemented |
| E-12 | AutomationModePicker | P09 | BUILT-LOCAL | publication and native/device acceptance pending; Cadence setAutomationMode off/read: implemented |
| E-13 | MixingConsole | P09 | BUILT-LOCAL | publication and native/device acceptance pending; Cadence mixer, groups, solo-safe: implemented |
| E-14 | VerticalFader | P09 | PARTIAL | numeric entry + double-tap reset absent; cadence ops setTrackGain/setTrackPan/setMuted/setSolo/addClip/addNote/setTempo exist |
| E-15 | PanAndBalanceControl | P09 | BUILT-LOCAL | publication and native/device acceptance pending; Cadence setTrackPan: mono pan / bus balance |
| E-16 | RealtimePeakMeter | P09 | PARTIAL | true peak + falloff absent; real-time levels from audio graph |
| E-17 | LoudnessMeter | P09 | BUILT-LOCAL | publication and native/device acceptance pending; Cadence loudness: implemented offline |
| E-18 | SoloMuteButtons | P09 | BUILT-LOCAL | publication and native/device acceptance pending; Cadence setMuted/setSolo/setSoloSafe: implemented |
| E-19 | BusAndRoutingMatrix | P09 | BUILT-LOCAL | publication and native/device acceptance pending; Cadence setTrackOutput/setSend/removeSend: implemented |
| E-20 | InsertEffectRack | P09 | BUILT-LOCAL | publication and native/device acceptance pending; Cadence gain/EQ/compressor inserts: implemented; no external plugin host |
| E-21 | EQFrequencyGraph | P09 | BUILT-LOCAL | publication and native/device acceptance pending; Cadence EQ response and DSP: implemented |
| E-22 | DynamicsTransferGraph | P09 | BUILT-LOCAL | publication and native/device acceptance pending; Cadence dynamics curve and DSP: implemented |
| E-23 | PluginPresetBrowser | P09 | BUILT-LOCAL | publication and native/device acceptance pending; Cadence factory insert presets: implemented |
| E-24 | MIDIPianoRoll | P09 | DONE | device gates only; dense-arrangement Skia renderer is a perf follow-up; moveNote/resizeNote added (forge#51); addNote/removeNote exist |
| E-25 | MIDIVelocityLane | P09 | BUILT-LOCAL | publication and native/device acceptance pending; Cadence setVelocity/setVelocities: implemented |
| E-26 | StepSequencer | P09 | DONE | device gates only; addNote/removeNote/setVelocity |
| E-27 | TempoAndMetronome | P09 | BUILT-LOCAL | publication and native/device acceptance pending; Cadence setTempo/setTimeSig/setMetronome: implemented; playback host-owned |
| E-28 | TakePlaylistAndComping | P09 | ABSENT | none; take model (absent) |
| E-29 | LoopPunchRecording | P09 | ABSENT | none; device audio I/O + PCM-to-disk (forge #35/#37 capture; not in cadence engine) + loop/punch |
| E-30 | SampleEditor | P09 | ABSENT | none; sampler (absent) |
| E-31 | AudioVideoSync | P09 | ABSENT | none; shared sample clock splice/cadence (absent) |
| E-32 | LatencyCalibrationPanel | P09 | ABSENT | none; latency measurement |
| E-33 | SurroundPanView | P09 | ABSENT | engine precondition fails; cadence render is stereo-only (channels:2) |
| E-34 | VoiceIsolationPanel | P09 | ABSENT | none; speech separation model (absent) |
| E-35 | BeatDetectionMarkerLane | P09 | ABSENT | none; beat detection op (absent) |
| E-36 | SoundEffectsLibrary | P09 | ABSENT | no content pipeline; licensed SFX catalog (none exists) |
| E-37 | SpeechTranscriptTakeReview | P09 | ABSENT | none; ASR (absent) |
| E-38 | VoiceoverCountdownAndTakeBin | P09 | PARTIAL | countdown + take bin absent; none beyond capture |
| E-39 | AudioEffectsPresetPanel | P09 | ABSENT | none; per-clip DSP |
| E-40 | NoiseReductionMonitor | P09 | ABSENT | none; noise reduction DSP |
| E-41 | AutoDuckEnvelopePanel | P09 | ABSENT | none; sidechain ducking DSP + automation |
| F-01 | PhotoLibraryGrid | P10 | ABSENT | no catalog object anywhere; photo catalog engine (absent; prism is single-document); N-14 thumbnails |
| F-02 | CatalogFilterBar | P10 | ABSENT | none; photo catalog engine (absent; prism is single-document) + EXIF index |
| F-03 | RatingAndFlagControl | P10 | ABSENT | none; photo catalog engine (absent; prism is single-document) |
| F-04 | RAWDevelopPanel | P10 | ABSENT | none; RAW decode + develop pipeline (absent) |
| F-05 | ExposureAndWhiteBalance | P10 | ABSENT | none; RAW decode + develop pipeline (absent) |
| F-06 | ToneAndPresence | P10 | ABSENT | none; RAW decode + develop pipeline (absent) |
| F-07 | EightBandColorMixer | P10 | ABSENT | none; HSL range filter (prism adjustment ops) |
| F-08 | LensCorrectionPanel | P10 | ABSENT | none; RAW decode + develop pipeline (absent) + lens profiles |
| F-09 | LocalMaskBrush | P10 | ABSENT | none; prism mask model + brush engine |
| F-10 | LinearRadialGradientMask | P10 | ABSENT | none; prism mask model |
| F-11 | LuminanceColorRangeMask | P10 | ABSENT | none; prism mask model + range select |
| F-12 | BeforeAfterCompare | P10 | ABSENT | none; prism flatten (exists) before/after snapshots |
| F-13 | PresetFilmstrip | P10 | ABSENT | none; preset apply op |
| F-14 | BatchExportPanel | P10 | ABSENT | none; image encoder + metadata strip (absent; prism flatten returns RGBA) |
| F-15 | PhotoVersionHistoryBrowser | P10 | ABSENT | none; version snapshots (N-10) |
| F-16 | CleanupAndRetouchPanel | P10 | ABSENT | none; heal/clone op (absent) |
| F-17 | PresetManager | P10 | ABSENT | none; preset storage |
| F-18 | PhotoMetadataInspector | P10 | ABSENT | none; EXIF read (absent) |
| G-01 | CompositionLayerTree | P11 | ABSENT | none; composition/keyframe engine (absent; splice has no keyframes, pitch has addAnimation) |
| G-02 | MotionKeyframeTimeline | P11 | ABSENT | none; composition/keyframe engine (absent; splice has no keyframes, pitch has addAnimation) |
| G-03 | KeyframeValueGraph | P11 | ABSENT | none; composition/keyframe engine (absent; splice has no keyframes, pitch has addAnimation) |
| G-04 | KeyframeSpeedGraph | P11 | ABSENT | none; composition/keyframe engine (absent; splice has no keyframes, pitch has addAnimation) |
| G-05 | EasingPresetGallery | P11 | ABSENT | none; none (easing curves are pure math) |
| G-06 | MotionPathEditor | P11 | ABSENT | none; composition/keyframe engine (absent; splice has no keyframes, pitch has addAnimation) |
| G-07 | Transform3DInspector | P11 | ABSENT | none; composition/keyframe engine (absent; splice has no keyframes, pitch has addAnimation) |
| G-08 | CameraAndLightControls | P11 | ABSENT | none; composition/keyframe engine (absent; splice has no keyframes, pitch has addAnimation) + 3D camera |
| G-09 | MatteAndMaskPanel | P11 | ABSENT | none; matte compositor |
| G-10 | EffectStackAndInspector | P11 | ABSENT | none; effect stack (absent) |
| G-11 | ExpressionEditor | P11 | ABSENT | none; sandboxed expression evaluator (absent; no eval allowed per forge #46) |
| G-12 | ParticleEmitterControls | P11 | ABSENT | none; particle system (absent) |
| G-13 | TimeRemapCurve | P11 | ABSENT | none; splice keyframed speed (shared with D-32) |
| G-14 | NodeGraphEditor | P11 | PARTIAL | keyboard connect, cycle validation, undo absent; graph document op set (absent) |
| G-15 | RenderQueuePanel | P11 | ABSENT | none; encoder/export backend |
| H-01 | PaginatedTextCanvas | P12 | ABSENT | IME composition design open (forge #45 gap); quill ops insertText/deleteRange/applyStyle/setBlockKind/layout exist; IME-aware native text bridge absent |
| H-02 | TextSelectionAndCaret | P12 | ABSENT | none; IME bridge + bidi selection |
| H-03 | RichTextRibbon | P12 | BUILT-UI | DEFER setFontFamily/setFontSize/setHighlight/changeCase; quill ops insertText/deleteRange/applyStyle/setBlockKind/layout exist (applyStyle) |
| H-04 | TypographyInspector | P12 | ABSENT | none; font metadata (fontations candidate, forge #46) + quill style props |
| H-05 | ParagraphStylesGallery | P12 | ABSENT | none; quill named styles (absent; setBlockKind only) |
| H-06 | ParagraphRuler | P12 | ABSENT | none; quill indents/tabs (absent) |
| H-07 | BulletsNumberingEditor | P12 | BUILT-UI | DEFER setListFormat/setListLevel (ListParagraph, no numPr); quill ops insertText/deleteRange/applyStyle/setBlockKind/layout exist (setBlockKind list kinds) |
| H-08 | InsertTableGrid | P12 | ABSENT | none; quill tables (absent) |
| H-09 | TableLayoutInspector | P12 | ABSENT | none; quill tables |
| H-10 | HeadersFootersEditor | P12 | ABSENT | none; quill sections (absent) |
| H-11 | PageSetupPanel | P12 | ABSENT | none; quill layout page_width exists; sections absent |
| H-12 | TextWrapAndFrames | P12 | ABSENT | none; quill frames (absent) |
| H-13 | CommentsAndReviewRail | P12 | ABSENT | none; comment model (absent) |
| H-14 | TrackChangesView | P12 | ABSENT | none; revision tracking (absent) |
| H-15 | NavigationOutline | P12 | BUILT-UI | DEFER bookmarks/renderPage (thumbnails); quill ops insertText/deleteRange/applyStyle/setBlockKind/layout exist (blocks gives headings) |
| H-16 | TableOfContentsEditor | P12 | ABSENT | none; TOC field (absent) |
| H-17 | FootnoteCitationEditor | P12 | ABSENT | none; footnote/citation model (absent) |
| H-18 | SpellGrammarPopover | P12 | ABSENT | none; spell/grammar service (absent) |
| H-19 | MailMergeFieldPicker | P12 | ABSENT | no data-source object; data source binding (absent) |
| H-20 | LayoutSpreadNavigator | P12 | ABSENT | none; quill layout spreads/masters (absent) |
| H-21 | DocumentReadAloudTransport | P12 | DONE | device gates only; TTS service (OS) + quill text ranges |
| H-22 | DictationSessionPanel | P12 | ABSENT | none; OS dictation via IME bridge |
| I-01 | VirtualSpreadsheetGrid | P13 | DONE | device gates only; tally ops setCell/getRange/addSheet/renameSheet/removeSheet/evaluate exist |
| I-02 | CellSelectionOverlay | P13 | DONE | device gates only (forge#54 adds atomic setRange/fillRange + commitTallyFill); tally ops setCell/getRange/addSheet/renameSheet/removeSheet/evaluate exist |
| I-03 | FormulaBar | P13 | DONE | device gates only; tally ops setCell/getRange/addSheet/renameSheet/removeSheet/evaluate exist |
| I-04 | NameBox | P13 | ABSENT | none; tally named ranges (absent) |
| I-05 | FormulaAutocomplete | P13 | ABSENT | none; tally function catalog query (absent) |
| I-06 | ReferenceColorizer | P13 | DONE | device gates only; none |
| I-07 | FillHandleAndAutoFill | P13 | PARTIAL | numeric/date series inference not implemented (forge#54 limits); tally ops setCell/getRange/addSheet/renameSheet/removeSheet/evaluate exist; series fill op absent |
| I-08 | SheetTabs | P13 | BUILT-UI | DEFER engine ops duplicateSheet/moveSheet/protectSheet/setSheetColor; tally ops setCell/getRange/addSheet/renameSheet/removeSheet/evaluate exist |
| I-09 | CellFormatInspector | P13 | ABSENT | none; tally cell formats (absent) |
| I-10 | ConditionalFormatRules | P13 | ABSENT | none; tally conditional formats (absent) |
| I-11 | ValidationDropdown | P13 | ABSENT | none; tally validation (absent) |
| I-12 | SortFilterHeader | P13 | ABSENT | none; tally sort/filter (absent) |
| I-13 | ChartBuilder | P13 | BUILT-UI | DEFER engine op insertChart (saving a chart); tally ops setCell/getRange/addSheet/renameSheet/removeSheet/evaluate exist (getRange) |
| I-14 | SparklineEditor | P13 | BUILT-UI | DEFER engine op setSparkline (saving); tally ops setCell/getRange/addSheet/renameSheet/removeSheet/evaluate exist |
| I-15 | PivotFieldList | P13 | ABSENT | none; tally pivot op (absent) |
| I-16 | TableStyleGallery | P13 | ABSENT | none; tally table objects (absent) |
| I-17 | FreezeSplitControls | P13 | BUILT-UI | DEFER engine op setSheetView (persisting freeze/split); none |
| I-18 | RangeComments | P13 | ABSENT | none; tally comments (absent) |
| I-19 | DataImportWizard | P13 | ABSENT | none; tally CSV/XLSX import (absent) |
| I-20 | SpreadsheetCardsView | P13 | DONE | device gates only; tally ops setCell/getRange/addSheet/renameSheet/removeSheet/evaluate exist |
| I-21 | SavedSheetViewManager | P13 | ABSENT | none; view preset storage (MMKV) + I-12 |
| J-01 | SlideFilmstrip | P14 | BUILT-UI | DEFER setSlideSection (sections); pitch ops addSlide/moveSlide/addText/addRect/addImage/move/resize/rotateObject/addAnimation/slideAt exist; slide thumbnail render absent |
| J-02 | SlideSorter | P14 | DONE | device gates only (forge#55 adds atomic moveSlides/removeSlides, one undo entry); pitch ops addSlide/moveSlide/addText/addRect/addImage/move/resize/rotateObject/addAnimation/slideAt exist |
| J-03 | MasterLayoutEditor | P14 | ABSENT | none; pitch masters/placeholders (absent) |
| J-04 | ThemeAndTemplateGallery | P14 | ABSENT | none; pitch themes (absent) |
| J-05 | SlideCanvas | P14 | BUILT-UI | DEFER setSlideSize/setObjectOrder/setTextStyle; pitch ops addSlide/moveSlide/addText/addRect/addImage/move/resize/rotateObject/addAnimation/slideAt exist |
| J-06 | ShapePresetGallery | P14 | ABSENT | none; pitch vector shapes (rect only) |
| J-07 | ConnectorAndDiagramTools | P14 | ABSENT | none; pitch connectors (absent) |
| J-08 | TransitionPicker | P14 | ABSENT | none; pitch slide transitions (absent) |
| J-09 | SlideAnimationPane | P14 | BUILT-UI | DEFER updateAnimation/setAnimationTrigger/emphasisAndExitEffects; pitch ops addSlide/moveSlide/addText/addRect/addImage/move/resize/rotateObject/addAnimation/slideAt exist (addAnimation/removeAnimation) |
| J-10 | MorphPreview | P14 | ABSENT | none; object correspondence (absent) |
| J-11 | SlideNotesEditor | P14 | ABSENT | none; pitch notes (absent) |
| J-12 | PresenterView | P14 | ABSENT | none; external display routing (absent; forge #45 gap) |
| J-13 | RehearsalTimers | P14 | ABSENT | none; pitch timings (absent) |
| J-14 | InkAndLaserPointer | P14 | BUILT-UI | native/device acceptance and publication pending; session-only presenter ink; controlled normalized session overlay; Pitch persistence and remote transport absent |
| J-15 | MediaInsertInspector | P14 | ABSENT | none; N-19 playback + pitch media objects (image only) |
| J-16 | ChartAndTableEditor | P14 | ABSENT | none; tally-backed chart data in pitch (absent) |
| K-01 | VirtualPDFPageViewer | P15 | ABSENT | no page renderer in folio; folio page raster/vector render op (absent) |
| K-02 | PDFThumbnailSidebar | P15 | ABSENT | none; folio page raster/vector render op (absent) |
| K-03 | PDFPageLayoutSelector | P15 | ABSENT | none; folio page raster/vector render op (absent) |
| K-04 | TextSearchResults | P15 | BUILT-UI | DEFER renderPage/textPositions (on-page highlight); folio ops open/pageCount/pageText/addAnnotation/listAnnotations/removeAnnotation/rotatePage/save exist (pageText; lossy) |
| K-05 | PDFTextSelection | P15 | ABSENT | none; text positions per glyph (absent) |
| K-06 | AnnotationToolbar | P15 | BUILT-UI | DEFER underline/strikeOut/ink/shape subtypes; renderPage (on-page placement); folio ops open/pageCount/pageText/addAnnotation/listAnnotations/removeAnnotation/rotatePage/save exist (addAnnotation Text/Highlight) |
| K-07 | CommentsThreadPanel | P15 | BUILT-UI | DEFER annotationAuthor/replyAnnotation/setAnnotationState/setAnnotationContents; folio ops open/pageCount/pageText/addAnnotation/listAnnotations/removeAnnotation/rotatePage/save exist (annotation contents); threads absent |
| K-08 | SignatureStampTool | P15 | ABSENT | none; annotation stamp/ink + board ink |
| K-09 | PDFFormFieldEditor | P15 | ABSENT | none; AcroForm fields (absent) |
| K-10 | PageReorderOrganizer | P15 | ABSENT | none; folio ops open/pageCount/pageText/addAnnotation/listAnnotations/removeAnnotation/rotatePage/save exist (rotatePage); move/delete/duplicate page absent |
| K-11 | ExtractMergeSplitDialog | P15 | ABSENT | none; folio merge/split (absent) |
| K-12 | BookmarkOutline | P15 | ABSENT | none; outline read/write (absent) |
| K-13 | HyperlinkInspector | P15 | ABSENT | none; link annotations (absent) |
| K-14 | RedactionReviewTool | P15 | ABSENT | irreversible apply needs verified content removal; content-stream redaction (absent) |
| K-15 | EncryptPermissionsPanel | P15 | ABSENT | none; folio encryption (open reports encrypted:false) |
| K-16 | PDFCompareOverlay | P15 | ABSENT | none; render + text diff |
| K-17 | PrintAndExportPreview | P15 | ABSENT | none; render + PDF/A writer |
| K-18 | PDFReadAloudTransport | P15 | BUILT-UI | DEFER renderPage (follow reading on page); folio ops open/pageCount/pageText/addAnnotation/listAnnotations/removeAnnotation/rotatePage/save exist (pageText) + OS TTS |
| K-19 | PDFVoiceNoteAttachment | P15 | ABSENT | none; file attachment annotations + recorder (forge #37) |
| K-20 | PDFScanSession | P15 | ABSENT | none; camera capture (VisionCamera) + image-to-PDF page op (absent) |
| K-21 | PDFInlineTextEdit | P15 | ABSENT | none; content-stream text edit (absent) |
| L-01 | FrameAndComponentTree | P16 | ABSENT | none; design-document engine (absent; prism has no frames/components/auto-layout) |
| L-02 | AutoLayoutInspector | P16 | ABSENT | none; design-document engine (absent; prism has no frames/components/auto-layout) |
| L-03 | HugFillFixedSizeControls | P16 | ABSENT | none; design-document engine (absent; prism has no frames/components/auto-layout) |
| L-04 | ConstraintsPanel | P16 | ABSENT | none; design-document engine (absent; prism has no frames/components/auto-layout) |
| L-05 | ComponentVariantPicker | P16 | ABSENT | none; design-document engine (absent; prism has no frames/components/auto-layout) |
| L-06 | ReusableStylesPanel | P16 | ABSENT | none; design-document engine (absent; prism has no frames/components/auto-layout) |
| L-07 | VariablesAndModes | P16 | ABSENT | none; design-document engine (absent; prism has no frames/components/auto-layout) |
| L-08 | PrototypeConnectionTool | P16 | ABSENT | none; design-document engine (absent; prism has no frames/components/auto-layout) |
| L-09 | InteractionTriggerEditor | P16 | ABSENT | none; design-document engine (absent; prism has no frames/components/auto-layout) |
| L-10 | PrototypePreviewPlayer | P16 | ABSENT | none; design-document engine (absent; prism has no frames/components/auto-layout) |
| L-11 | FlowOverview | P16 | ABSENT | none; design-document engine (absent; prism has no frames/components/auto-layout) |
| L-12 | DevHandoffInspector | P16 | ABSENT | none; design-document engine (absent; prism has no frames/components/auto-layout) |
| L-13 | CollaborationPresence | P16 | ABSENT | none; collaboration backend (board Yjs adapter only) |
| L-14 | CommentPins | P16 | ABSENT | none; design-document engine (absent; prism has no frames/components/auto-layout) |
| L-15 | MultiExportSlices | P16 | ABSENT | none; design-document engine (absent; prism has no frames/components/auto-layout) |
| M-01 | Native3DViewport | P17 | ABSENT | none; 3D renderer + CAD/material engine (none; filament is an unadopted candidate in forge #40) |
| M-02 | ViewCubeAndAxisGizmo | P17 | ABSENT | none; 3D renderer + CAD/material engine (none; filament is an unadopted candidate in forge #40) |
| M-03 | TransformGizmo3D | P17 | ABSENT | none; 3D renderer + CAD/material engine (none; filament is an unadopted candidate in forge #40) |
| M-04 | UVEditor | P17 | ABSENT | none; 3D renderer + CAD/material engine (none; filament is an unadopted candidate in forge #40) |
| M-05 | TextureSetPanel | P17 | ABSENT | none; 3D renderer + CAD/material engine (none; filament is an unadopted candidate in forge #40) |
| M-06 | PBRMaterialInspector | P17 | ABSENT | none; 3D renderer + CAD/material engine (none; filament is an unadopted candidate in forge #40) |
| M-07 | TextureBrush3D | P17 | ABSENT | none; 3D renderer + CAD/material engine (none; filament is an unadopted candidate in forge #40) |
| M-08 | TextureMaskAndGenerator | P17 | ABSENT | none; 3D renderer + CAD/material engine (none; filament is an unadopted candidate in forge #40) |
| M-09 | BakingMapPanel | P17 | ABSENT | none; 3D renderer + CAD/material engine (none; filament is an unadopted candidate in forge #40) |
| M-10 | NodeGraphCanvas | P17 | PARTIAL | minimap, keyboard graph edits absent; none for generic canvas |
| M-11 | NodeLibrarySearch | P17 | ABSENT | none; generic graph model (shared with G-14 PatchGraph) |
| M-12 | LiveNodeThumbnail | P17 | ABSENT | none; generic graph model (shared with G-14 PatchGraph) |
| M-13 | DraftingCommandLine | P17 | ABSENT | none; 3D renderer + CAD/material engine (none; filament is an unadopted candidate in forge #40) |
| M-14 | ObjectSnapsAndOrtho | P17 | ABSENT | none; 3D renderer + CAD/material engine (none; filament is an unadopted candidate in forge #40) |
| M-15 | DimensionsAndHatching | P17 | ABSENT | none; 3D renderer + CAD/material engine (none; filament is an unadopted candidate in forge #40) |
| M-16 | PaperSpaceLayout | P17 | ABSENT | none; 3D renderer + CAD/material engine (none; filament is an unadopted candidate in forge #40) |
| M-17 | ParametricConstraintEditor | P17 | ABSENT | none; 3D renderer + CAD/material engine (none; filament is an unadopted candidate in forge #40) |
| N-01 | NativePointerRouter | P06 | PARTIAL | hover/pressure on all targets unverified; none |
| N-02 | PenPairingDialog | P06 | DONE | device gates only; forge BLE (exists) |
| N-03 | LogitechMuseSpatialInk | P06 | PARTIAL | SDK-backed 6DoF diagnostics on device pending; Logitech Muse SDK |
| N-04 | PalmRejectionAndPrediction | P06 | ABSENT | none; google/ink core (forge #46 candidate) |
| N-05 | HapticsAndFeedback | P02 | DONE | no device feel test; OS haptics |
| N-06 | VoiceOverTalkBackSupport | P02 | DONE | no VoiceOver/TalkBack device pass; none |
| N-07 | HardwareKeyboardMap | P02 | DONE | no hardware-keyboard device run; none |
| N-08 | SafeAreaFoldableLayout | P02 | DONE | device gates only (no foldable-device / iOS 27.1 runtime QA); OS window/hinge APIs |
| N-09 | XRPresentationAdapter | P18 | PARTIAL | no renderer; Viro/visionOS/PICO adapters |
| N-10 | OfflineCheckpointAndAutosave | P02 | PARTIAL | only board persists; ignition snapshot op for non-board engines |
| N-11 | CollaborationAdapter | P02 | PARTIAL | board only; CRDT choice open; Yjs/Automerge behind engine (forge #46) |
| N-12 | NativeFileAndShareAdapter | P02 | DONE | no device pick/share run; OS document picker/share |
| N-13 | LongTaskScheduler | P02 | BUILT-LOCAL | native JS/device acceptance; Expo decoder cancellation absent; native FIFO + atomic task controls; cooperative safe checkpoints |
| N-14 | MediaCache | P02 | BUILT-LOCAL | native JS/device acceptance; host must generate/key derived bytes; native bounded LRU for host-supplied derived bytes |
| N-15 | UndoTransactionCoordinator | P02 | PARTIAL | no engine-side gesture transaction; engine transaction boundary op (absent) |
| N-16 | NativeBinaryTransport | P02 | BUILT-LOCAL | full native JS/device acceptance; owned copies, not zero-copy; additive native binary command ABI and owned ArrayBuffer |
| N-17 | NativePlaybackLifecycle | P02 | DONE | no device interruption/headset run; background audio left to app; OS audio session |
| N-18 | TestAndTelemetryAdapter | P02 | DONE | no Nitro JSI/device run; telemetry sink backend and consent UI are separate product decisions; none |
| N-19 | NativeMediaDecoderSurface | P03 | PARTIAL | Android decoder absent; iOS native runtime not exercised; Expo v2 AVFoundation iOS + browser video/WebAudio |
| N-20 | AudioInterruptionRecoveryDialog | P02 | BUILT-UI | OS recovery persistence/readiness remains host responsibility; native a11y/device pending; explicit host recovery state/callbacks; existing OS event adapter |
| N-21 | AccessiblePrecisionScrubControl | P02 | PARTIAL | switch control + trackpad parity unverified; none |

## Initial resource evidence

The current machine has Xcode 27.1 and Android build tools, but no registered iOS simulator runtimes or Android AVDs at inventory time. The paired physical iPhone is disconnected. Simulator/runtime setup is being prepared; Windows, XR, QNX and physical-device validation must use real compatible runners/hardware. Do not convert these inventory limits into completion claims.

The 2026-11-05 recovery merges/releases are retained as baseline evidence. Older recovery documents describe their historical scope; they do not exclude any row from this new program.
