# ArtCraft Android -> Nitro Forge native component adoption (SDK 58)

Status: **source audit + initial independent Expo Modules 2.0 WAV analyzer**, NOT a 296-component implementation.
Audit date: 2026-11-03. Source organization: https://github.com/artcraft-android (7 public repositories on this date).

## Baseline / architecture

- **Expo SDK 58 is stable**, released October 15, 2026, with React Native 0.88 and iOS 27. https://expo.dev/changelog/sdk-58
- **Expo Modules 2.0 annotations remain beta inside stable SDK 58.** Verified Android `io.github.expo.modules.v2.{ExpoModule,JS,Module}` and Swift `@ExpoModule` / `@JS`. Use v2 for platform services and methods now.
- **Do not claim v2 custom-view parity yet**: upstream's public Expo Modules 2.0 announcement says `@ExpoView` + `@ViewProps` are on a separate roadmap. Implement visual controls through supported `@expo/ui` (native Compose/SwiftUI) or the existing Expo view definition (`View / Prop / Events`) with a documented compatibility boundary. Migrate to annotated v2 views only after the exact SDK implementation is verified on both platforms. Reference: https://expo.dev/blog/an-early-look-at-expo-modules-2-0 and https://docs.expo.dev/modules/module-api/
- **Existing `master` Expo example is NOT upgraded yet**: `apps/example/package.json` currently pins Expo `^54.0.0`, RN `^0.81.0` and Nitro `^0.29.0`. SDK 58 and Nitro v1 work is in separate draft PRs. Do not install this module into the old example or label it device-ready until the SDK 58 upgrade lands and is verified.
- **Keep Rust Ignition / Nitro authoritative for editing documents, undo/redo, render plan and snapshots.** Expo controls/services own native media I/O, UI, touch/haptics, accessibility and host lifecycle. Neither layer creates a duplicate document.
- **Keep Skia v3 and Board PR #19 for the drawn canvas**. Reuse workspace from PR #5, icons from PR #21, spatial pen from PR #15 and pen connection PR #20. Never replace them with upstream app shells.
- Scope: iOS, Android, tablet, foldable/hinge, Surface Duo, desktop web fallback. No direct React Native WebView/egui app embedding.

## License / provenance gate

Repositories (verify each selected file and nested assets/dependencies separately):

| Repository | Stated top-level license | Direct code migration? | Notes |
| --- | --- | --- | --- |
| [procraft](https://github.com/artcraft-android/procraft) | MIT OR Apache-2.0 | Yes, reviewed per file | Painting, color/layers/brushes, transforms, time-lapse; original UI visual system must remain Forge's |
| [lightcraft-android](https://github.com/artcraft-android/lightcraft-android) | MIT OR Apache-2.0 | Yes, reviewed per file | Develop sliders, histograms, wheels, curves, masking |
| [filmcraft-android](https://github.com/artcraft-android/filmcraft-android) | MIT OR Apache-2.0 | Yes, reviewed per file | Timeline/waveform geometry, drag hit-tests, voiceover recording |
| [pdfcraft-android](https://github.com/artcraft-android/pdfcraft-android) | MIT OR Apache-2.0 | Yes, reviewed per file | Viewer, annotations, forms, digital signatures, voice notes |
| [wordcraft-android](https://github.com/artcraft-android/wordcraft-android) | MIT OR Apache-2.0 | Yes, reviewed per file | Rich text, contextual ribbon, comments, object dragging |
| [gridcraft-android](https://github.com/artcraft-android/gridcraft-android) | MIT OR Apache-2.0 | Yes, reviewed per file | Grid, formula references, keyboard, formatting palettes |
| [capcraft-android](https://github.com/artcraft-android/capcraft-android) | **AGPL-3.0-or-later** | **YES, if the actual integrated work is distributed under AGPL-compatible terms and all obligations are met** | Port/reuse timeline, speed curves, captions, effects, audio as reviewed AGPL code; no automatic closed-source exception from Nitro/Expo wrappers |

A repository license is not a license for every font, trademark, reference image, icon, codec, model or third-party asset. Reuse under MIT/Apache requires correct notices and modified-source tracking; check any crate/submodule dependencies and patent/trademark constraints. **CapCraft is approved as a potential source to reuse under its AGPL-3.0-or-later license**; it is not limited to behavioral study. The Expo Modules 2.0 / Nitro v1 wrappers do not change the inherited license. Check the whole linked work, not just the component's package.json.


## AGPL-3.0-or-later adoption decision (2026-11-03)

The owner has elected to **permit AGPL source use** where the Forge components and their resulting *combined distributions* comply with the terms. Previous wording blocking direct CapCraft reuse is superseded.

This is **not** permission to use AGPL as if it were MIT/Apache. Upgrading to Nitro Modules v1, Expo Modules 2.0, Swift, Kotlin, C++, WASM, Rust or an alternate public API does **not** eliminate copyright obligations for source-derived code. In particular, wrapping a copied/ported AGPL module and linking it into an app can create a combined AGPL-covered work. Technical packaging alone, including separate workspaces, repositories, plugins or processes, does not guarantee legal separation.

### Proposed adoption structure

- **Core Forge UI and engines:** remain independent of CapCraft source by default, until a project-level decision is made to distribute the relevant combination under AGPL-compatible terms. Preserve other already-permissive source provenance.
- **Optional source-derived AGPL track:** create distinct `@nitro-forge/capcraft-agpl-*` packages only with per-file copyright notices, unchanged upstream licensing where applicable, full LICENSE copy, attribution, provenance pinned to upstream revision, modifications log, source availability statement, and explicit package dependency gates. Even when a package is optional, integrating it into a native app or library can bring the **combined work** within copyleft requirements.
- **Integration contracts:** expose a stable `SpeedCurve`, `TimelineLane`, `AutoCaption`, `AudioEffects` interface that works through Expo 58 v2-native methods/views where supported, or Nitro v1 for Rust/C++ DSP/timeline systems. Neither bridge is a license loophole. Preserve Rust as the document source of truth, with atomic begin/update/commit/cancel undo gestures.
- **Platforms:** Android Compose UI + iOS SwiftUI/UIKit equivalent; Skia v3 for extremely dense drawing; web desktop adapter using Canvas/WASM where appropriate. Never claim that the Android Compose component is already cross-platform.
- **AGPL vs commercial:** Selling an AGPL application is permitted. Restricting the entire linked AGPL-derived application/SDK as closed-source while distributing that combined work generally is not; if closed distribution is required, obtain an alternative license from the rights holders or implement independently without copying AGPL expression, subject to review.

### Source admission checklist

1. Record the exact upstream `capcraft-android` commit SHA, path, copyright holders (including Concat contributors where relevant), SPDX expression and what expression was copied.
2. Preserve original copyright, license/warranty notices, and required notices of modifications/dates. Include complete AGPL-3.0-or-later license and project-specific third-party notices.
3. Analyze **what is combined**: JS library, v2 native module, Nitro v1 native binary, app, bundled assets, and server. Source availability of modified AGPL works and distributed combined works must comply with AGPL sections 4–6; section 13 may require an online source offer if users interact remotely with a modified AGPL program.
4. Verify original and new sources can be built from Corresponding Source, including build scripts and required installation information where applicable. Source offer in UI/NOTICE where required.
5. Check UI fonts/assets, FFmpeg codec configurations, speech models and audio dependencies individually against `NOTICE` and `THIRD_PARTY_NOTICES.md`.
6. Separate untouched, independent MIT/Apache modules from the AGPL-derived track **only when architecturally and legally independent**. An `optional` flag, dynamic linking, generated bindings, or a TS interface by itself does not make code independent.
7. Seek counsel before shipping a proprietary app/template SDK incorporating AGPL-derived native code. The key question is the resulting licensed **combined work**, not whether a component can technically be compiled.
8. Until a release decision is completed, keep AGPL-derived packages opt-in, out of the stable package export graph, and unclaimed as safe for proprietary redistribution.

**Ground truth:** https://github.com/artcraft-android/capcraft-android/blob/main/LICENSE , https://github.com/artcraft-android/capcraft-android/blob/main/NOTICE , https://github.com/artcraft-android/capcraft-android/blob/main/THIRD_PARTY_NOTICES.md , https://www.gnu.org/licenses/agpl-3.0.en.html , https://www.gnu.org/licenses/gpl-faq.en.html#GPLAndPlugins .

## Source-to-component map

Source paths below are from public `main` and are pointers for engineering review, **not source files imported into Forge**.

| Upstream source | Forge controls | Package(s) | Migration disposition |
| --- | --- | --- | --- |
| `procraft/android/.../ui/ColorPanel.kt` | color panel, hue/SV field, palette, floating color picker | `color-ui`, `studio-ui`, Prism | P0 reimplement Forge styling; separate color data model |
| `procraft/android/.../ui/LayersPanel.kt` | grouped layer tree, rename, reorder, masks, blend, opacity, channel tray | `board`, `studio-ui`, Prism/Pitch/Splice | P0 headless layer transaction + native panel |
| `procraft/android/.../ui/BrushStudio.kt` | brush presets, pressure/tilt/streamline, size/taper controls | `board`, Prism | P0/P1 preserve Muse/native pen semantics |
| `procraft/android/.../canvas/TransformHandles.kt` | transform gizmo, handles, snapping | `board`, Prism/Pitch/Folio | P0 geometry in scene/engine, overlay in native |
| `lightcraft-android/apps/.../ui/DevelopSlider.kt` | numeric scrub slider, Kelvin-specific scale, fine-adjust gesture | `studio-ui`, `color-ui` | P0 inject numeric conversion rules |
| `lightcraft-android/apps/.../ui/GradingWheel.kt` | grading wheel, saturation/hue | `color-ui`, Prism/Splice | P0 color management adapter |
| `lightcraft-android/apps/.../ui/HistogramView.kt` | live histogram view | `color-ui`, Prism/Splice | P0 native analysis + zero-copy GPU display |
| `lightcraft-android/apps/.../ui/CurveTool.kt` | RGB/luma tone-curve editor | `color-ui`, Prism/Splice | P1 engine-backed editable knots |
| `filmcraft-android/apps/.../ui/editor/Timeline.kt` | timeline ruler, playhead, waveforms, trim handles, drag/drop | `media-ui`, Splice/Cadence | P0 implement exact frame/timebase contract |
| `filmcraft-android/apps/.../ui/editor/Player.kt` | preview transport/playback state | `media-ui`, Splice | P0 native decoder integration, no fabricated frames |
| `filmcraft-android/apps/.../ui/editor/Voiceover.kt` | actual WAV microphone recording, monitoring UI, countdown | `audio-ui`, Cadence/Splice | P0 explicit permissions + background/lifecycle |
| `pdfcraft-android/apps/.../ui/viewer/PageCanvas.kt` | paginated viewport, selection overlays, annotations | `folio-ui`, Folio/Quill | P1 avoid second document layout engine |
| `pdfcraft-android/apps/.../ui/viewer/Forms.kt` | PDF form controls | `folio-ui`, Folio | P1 PDF-native form model required |
| `pdfcraft-android/apps/.../ui/viewer/DigitalSign.kt` | sign/verify UI | `folio-ui`, Folio | P1 cryptographic state must be genuine |
| `wordcraft-android/apps/.../ui/editor/EditorInput.kt` | rich text caret/input, selection toolbar | `document-ui`, Quill | P1 keyboard/IME and composition correctness |
| `wordcraft-android/apps/.../ui/editor/ContextTabs.kt` | contextual ribbon tabs | `studio-ui`, Quill/Tally/Pitch | P0 generic and engine capability aware |
| `wordcraft-android/apps/.../ui/editor/Comments.kt` | anchored comment panels | `document-ui`, Quill/Folio | P1 document rev/anchor identity |
| `gridcraft-android/apps/.../ui/editor/GridView.kt` | virtual grid, range selection, fill handles | `grid-ui`, Tally | P1 high-volume native rendering |
| `gridcraft-android/apps/.../ui/editor/FormulaRefs.kt` | formula reference coloring and taps | `grid-ui`, Tally | P1 accepts Rust evaluator semantics |
| `gridcraft-android/apps/.../ui/editor/Keypad.kt` | numeric/formula keypad | `grid-ui`, Tally | P1 IME-safe |
| `capcraft-android/src/crates/.../ui/editor/Timeline.kt` | overlay/effect track hierarchy | Splice / optional AGPL module | P1 AGPL source port permitted with provenance and corresponding-source release obligations |
| `capcraft-android/src/crates/.../ui/editor/panels/SpeedCurveEditor.kt` | nonlinear speed curve and handles | Splice / optional AGPL module | P1 may port with original notices, license file, changes and AGPL-aware distribution |
| `capcraft-android/src/crates/.../ui/editor/panels/AutoCaptions.kt` | captions review workflow | Splice / optional AGPL module | P1 may port; evaluate model, subtitle, and runtime third-party licenses separately |

## First real seed in this PR

`@nitro-forge/native-signal` provides an **original** Expo Modules 2.0 annotated Swift + Kotlin `ForgeSignal.analyzeWavFile(uri, columns)` for 1..4096 min/max waveform bins from a local 16-bit PCM RIFF/WAV file. Exposes a TS `analyzeWavFile` wrapper. Limited to mono/stereo, <=64 MiB, no device build evidence; **does not record/play audio or draw a waveform**. It supplies native data for future `WaveformLane`, `AudioClipWaveform` and `LiveRecordingWaveform`. No upstream source was copied.

## Implementation and acceptance roster

All items are **planned, not implemented**, except the source-only native-signal seed above. Feature IDs are stable to permit cross-PR tracking.

| ID | Feature | Source | Native surface / host | Owner / test gate |
| --- | --- | --- | --- | --- |
| ART-01 | `NativeSeekBar` with buffered/played regions, seek preview, keyboard and frame stepping | FilmCraft | SwiftUI/UIKit; Jetpack Compose/Android View | playback owner; frame-accurate instrumented tests |
| ART-02 | `FrameTimecodeRuler` (30000/1001, 24, 25, 30, 60fps) | FilmCraft | reusable native/Skia drawn component | video owner; rational timing, drift tests |
| ART-03 | `TimelinePlayhead`, drag, trim, split, overlap/snapping | FilmCraft | native gesture layer + Splice Rust ops | video owner; exactly one undo txn per gesture |
| ART-04 | `AudioWaveformLane` min/max, tiled LOD, zoom/pan | FilmCraft | native-signal + Skia/Canvas GPU | audio owner; 1h+ multitrack performance |
| ART-05 | `NativeAudioRecorder` with mic permissions, interruption, file-backed WAV | FilmCraft | Expo v2 native service + RN UI | audio owner; real mic device test |
| ART-06 | `RecordingLevelMeter`, record/punch control | FilmCraft | low-frequency UI events; audio buffers stay native | audio owner; no fake meters |
| ART-07 | `ColorWheel`, `ColorSquare`, `EyeDropper`, `ColorDrop` | ProCraft | Compose/SwiftUI native + Rust color adapter | graphics owner; RGB/HSV, P3 round-trip |
| ART-08 | `LayerTree` (blend, mask, reorder, visibility) | ProCraft | native virtual list; Rust transactions | graphics owner; undo and accessibility |
| ART-09 | `BrushStudio` with pressure/taper/tilt input | ProCraft | Board+Pen/Muse adapters | ink owner; physical stylus |
| ART-10 | `DevelopSlider`, `HistogramView`, `GradingWheel` | LightCraft | Expo view + native analysis | color owner; precision/contrast tests |
| ART-11 | `PDFPageViewport`, comments/forms/signature controls | PdfCraft | native/Board overlay + Folio | docs owner; semantic PDF save/reopen |
| ART-12 | `RichTextCaret`, selection toolbar, contextual ribbon | WordCraft | native IME host + Quill | docs owner; composition/bidi test |
| ART-13 | `VirtualSheetGrid`, `FormulaBar` | GridCraft | native virtualized view + Tally | grid owner; 100k cell scroll test |
| ART-14 | `SpeedCurveEditor`, `CaptionTimeline`, `EffectsTracks` | CapCraft AGPL-3.0-or-later code or behavior | optional AGPL-native module + Splice, distribution compliance gate | video engineer + licensing/source reviewer; device and API verification |

## No false positives / test gates

1. Native v2 code compiles for actual Expo 58 iOS Xcode 27 and Android SDK; no `Expo Go` assumption. Current seed is **uncompiled**.
2. Confirm `requireNativeModule("ForgeSignal")` autolinks on both platforms and returns identical peak sequences for stereo/mono fixtures.
3. No UI controls are labelled native until native view mounted and interacted with on devices.
4. Canvas/timeline render passes at 60fps target for target devices; no JS-frame audio buffer flood.
5. Every gesture has commit/cancel semantics, one Rust undo transaction, semantics labels, 44pt touch targets, keyboard alternative, RTL/high contrast, reduced motion and screen-reader pass.
6. Fold/unfold, hinge occlusion, rotation, keyboard, split view and app interruption maintain engine identity, playback position and media buffers.
7. License notices and source manifest reviewed before any upstream implementation is transplanted.
8. Expo v2 beta signature/codegen checks in CI; keep v1 view DSL fallback behind adapters until verified.

## PR strategy / dependencies

- This PR: source-admission audit + standalone `native-signal` source scaffold. It is **DRAFT** and not proof of native builds.
- Follow-on PR A: `@nitro-forge/media-ui` seek bar, video surface and timeline under SDK 58, with live decoder + Splice validation.
- Follow-on PR B: `@nitro-forge/audio-ui` WaveformLane + recorder, monitor, mixer, Cadence integration.
- Follow-on PR C: `@nitro-forge/color-ui` and `@nitro-forge/studio-ui` picker/wheel/develop sliders/layers, integrated with Board/Prism.
- Follow-on PR D: Quill, Tally, Folio editors, with source admission and conformance tests.
- Track desktop/web separately with Canvas/Skia/WASM adapters, not Android-only UI masquerading as cross-platform.
