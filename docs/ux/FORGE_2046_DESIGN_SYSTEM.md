# Forge 2046 — creative suite design constitution

> **Status: design direction and shared interaction contracts, not a claim of shipped components.** This is a stacked design/engineering proposal on top of Studio PR #5. Existing media/color PRs #25/#26, Board/Ink, Nitro v1 and Expo 58 work remain the execution tracks. Native device and visual QA are required before a component becomes release-ready.

## Product promise

Build a distinctive, professional native-first creative environment for Prism, Cadence, Splice, Quill, Tally, Pitch, Folio and Board. Aim for the quality of a bespoke premium studio while refusing superficial “future UI”: no stock cards, giant gradients, glow everywhere, anonymous icon buttons, fake scopes, decorative dials, hover-only interactions or pretend AI features. The user-created media is the hero.

**System name:** Forge 2046. **Visual material:** soft-machined graphite, layered ceramic surfaces, precisely lit active edges, deep neutral canvas mattes, exact typography, intentional spectral accent *only where selected or meaningfully encoding a channel*. A light workbench mode remains first-class for paper/grid work and daylight drawing. Never place gradients over the actual pixel/grade output.

## Visual grammar (a design system, not seven themes)

| Layer | Purpose | Treatment |
|---|---|---|
| Workbench | Immersive document/canvas/stage | Neutral, predictable, color-managed, no decorative tint |
| Navigation membrane | Documents, suite switching, global command | Slim, stable location and semantics across studios |
| Instrument deck | Contextual, precise controls | Shape and scale communicate affordance, not ornament; touch and hardware parity |
| Data layer | Scopes, waveform, guides, spectra, histograms | High-resolution Skia v3 Graphite visualization from **real** engine/signal data |
| Feedback layer | Input focus, snap, selection, sync, recording | Subtle, fast, distinguishable by shape and label, not color alone |
| Spatial layer | XR/foldable multi-pane composition | Content-anchored volumes; real occlusion-aware panes, no stretched phone UI |

Shared typography: engineered grotesk for chrome, tabular numerals for values/timecode, clear monospace for key commands/formulas, optical-friendly reading face only inside Quill document content. Icons: original bold outline at rest, filled on selection; paired variants and Rive states in PR #21. Motion: use only to communicate causality, state and location. Reduced-motion transitions are instantaneous but retain state feedback.

**Density is a user preference**, not the platform: compact for workstation, comfortable for stylus/touch, presentation for review. Targets stay accessible and may exceed visible chrome size. Configure semantic tokens in Studio; never hard-code a different visual foundation in each app.

## One shared workstation, adaptive by composition

Canonical skeleton: document header / command surface / left tool or asset rail / primary stage / precision inspector / optional bottom temporal deck / thin truthful status line. Stage owns the majority of space. **Only the purpose-specific instrument** changes when the user switches task or studio; shortcuts, panel docking, numeric entry, units, undo, selection, save, restore, and focus navigation stay consistent.

- **Wide desktop:** multi-dock with two simultaneous inspectors, floating references, precise timeline/mixer, keyboard command palette, multi-window when supported.
- **Tablet/iPad:** stage-first, Pencil/stylus hover and pressure where the device reports them, two-hand touch modifiers, collapsible inspector near the working hand.
- **Phone:** contextual command capsule, precision sheet, reversible gestures; no permanently shrunk desktop panels.
- **Surface Duo/foldables:** real hinge/occlusion metrics; one or two stages may occupy panes independently. A panel must never span an unrenderable hinge or destroy the engine document when posture changes.
- **XR:** authored spatial surfaces with hand/controller/gaze semantics and stable real-world scale, not CSS pixels mapped into a rectangle.
- **Web:** same behavior and data contracts via native-web adapter and WebGPU/WASM fallbacks; no WebView editor shell.

No raw HTML editor shells; reuse canonical UI semantics and adapters through `@nitro-forge/studio-workspace/ui`, not a second ad hoc button/menu library. Zustand owns local presentation state; Rust Ignition is authoritative for document edits and undo. MMKV/Yjs remain host-level persistence/collaboration ports, not competing history journals.

## Signature creative instruments: what “not basic” means

| Instrument | Expert behavior | Owner / reuse |
|---|---|---|
| **Forge Precision Scrubber** | Drag or enter exact number; unit- and zoom-aware, Shift/fine or coarse response, snapping detents, absolute reset, keyboard/VoiceOver/TalkBack parity; one engine commit | Shared inspector: all studios |
| **Forge Chroma Space** | Multi-plane chroma selector, RGBA/HSB/Lab and document color profile, gradients, eyedropper, alpha, recent swatches, side-by-side comparison; no inaccurate fake gamut | Prism, Splice, Pitch; evolve PR #26 |
| **Forge Color Wheels & Curves** | Lift/gamma/gain/HDR-style bands, spline points with tangent/constraint, histogram/scopes based on source frames; nondestructive operations | Prism, Splice |
| **Forge Infinite Ink Deck** | Pressure/tilt/hover brush dynamics, nib preview, texture, taper, velocity, symmetry, eraser and stylus actions; no guessing Muse hardware capability | Board, Prism; PRs #18–#20 |
| **Forge Temporal Canvas** | Frame-accurate trim, ripple, slip, roll, magnetic multi-clip snapping, nested lanes, continuous zoom, keyframe bezier curves, marker and time ruler | Splice, Pitch, Cadence; evolve PR #25 |
| **Forge Spectral Wave** | Native peak pyramid / RMS / frequency view, per-track gain envelope, selection handles, phase and clipping visibility, scrub and seek from the same timebase | Cadence, Splice; PR #24/#25 signal source |
| **Forge Harmonic Mixer** | Meter bridge, faders, pan, buses, sends, automation modes, effects chain, true selected-track parameter macros, control surface bindings | Cadence, Splice |
| **Forge Vector Node Graph** | Grouped graph editing, connector routing, safe graph evaluation, selection, auto-layout, mini-map, keyboard traversal | Prism, Splice, Pitch |
| **Forge Layer & Object Constellation** | High-density row tree with thumbnails, visibility, lock, nesting, drag/reorder preview, semantic bulk operations and one transaction per drop | All editors that have layers |
| **Forge Type Laboratory** | Variable axes, baseline rhythm, optical sizing, paragraph styles, kerning/tracking and page-aware layout | Quill, Pitch, Folio |
| **Forge Formula Lens** | Live dependency trace, range provenance, typed cell validation, visual references, audit popover, keyboard-first edit | Tally |
| **Forge Export Chamber** | Color management, pixel/frame/sample metadata, print bleed, accessibility/embedded font checks, estimated size, warnings from real engine validators | All seven studios |
| **Forge Command Orbit** | Mode-aware radial/context command access for pen/touch; fully mirrored in visible menus and keyboard commands; no invisible gesture-only actions | All editors |
| **Forge Revision Atlas** | Engine-backed named snapshots, comparison states and safe undo/redo branching only if supported | All editors, not a fake local document history |

Signature compositions must be built as **specialized tool surfaces**, not merely “Slider/Card/Modal with a different border radius”. Each makes at least one professional operation noticeably faster or more accurate.

## Each app is a personality of the same family

- **Prism / PixForge:** canvas with quiet graphite surrounds, brush deck, Chroma Space, layers/adjustment inspector, source color-pipeline readout.
- **Cadence / BeatForge:** waveform-piano-roll switch, dense track header, automation lanes, mixer and spectral instruments sharing a canonical playhead.
- **Splice / ReelForge:** cinematic player, source/program monitor when supported, trim-ready multitrack deck and color scopes; no seek-only toy UI.
- **Quill:** beautifully typographic writing surface, styles/outline and revision inspector; no video-editor clutter.
- **Tally:** keyboard-first matrix, formula tracing, freeze-state and accessible data inspectors; no fake cell canvas.
- **Pitch:** vector slide stage, animation/transition timeline, contextual layout constraints and presenter review.
- **Folio:** precise page raster/vector compositor, annotated review, comparison, print/preflight controls.
- **Board:** infinite low-latency ink world, spatial notes, pressure-ready brushes, multi-user presence only with real connected state.

## Platform execution contract

- **Shared typed values, commands and state transitions** live in pure TypeScript and/or Rust so native/web renderers calculate the same results.
- **Nitro Modules v1 / Rust** own document editing, state/history, coordinate conversions and bounded high-frequency engine commands; do not recreate Rust edits in JS.
- **Expo Modules v2** host platform-native instrument surfaces and device capabilities where justified on SDK 58; use real Swift/Kotlin bindings and exact version-gated native contracts. Its 2.0 API is still beta in SDK 58, so stabilize the bridge before claiming production parity.
- **Skia v3 Graphite** draws pixel-accurate waveforms, scopes, curves, tracks, guides and ink where measured throughput warrants it; test Metal, Vulkan and web explicitly. Offscreen/hidden draw loops must stop.
- **RNGH v3, Reanimated v4 and Rive** can support input handling and meaningful microinteraction after installed APIs and worklets are verified. Avoid JS-per-frame hot loops for visual movement.
- **No duplicate status**: pending media/transport/dock/native integration cannot be marked production solely because a typed contract, animated preview or mocked image exists.

## Design quality gates: the $20k bar as evidence

Before “done”: real engine-connected feature, measured input latency and frame pacing, accurate display of actual media/data, undo/redo/save/reopen, incremental export, persistent workspace preset, keyboard/pointer/touch/pen parity, legible density controls, zoom and oversized data sets, screen-reader test, high-contrast/reduced-motion, localization/RTL, and physical iPad/Surface Duo/Android hardware evidence. A screenshot-only PR is not a shipped instrument.

Required visual QA for every instrument: studio screenshot at 390, 768, 1280, 1920 widths; dark/light, compact/comfortable; selected/hover/focused/disabled/busy/error; real sample media; meaningful empty state; accessibility tree; a side-by-side review showing it fits the same suite. Compare actual user task time, not just aesthetic impressions.

**Vertical slices in order:** (1) one real Prism Chroma/precision edit with engine undo; (2) Splice synchronized playhead+waveform+frame seek on real media; (3) Cadence waveform+gain+automation; (4) shared inspector/dock application in Quill/Tally/Pitch/Folio; (5) Board/Muse/foldable/XR parity.

## Inspiration and licensing boundary

Study the *principle*, never reproduce original UI assets/brand/traced geometry. Use Mobbin as observed screen references and Dribbble as concept exploration; Dribbble shots are not proof of shipping behavior.

- [Adobe Spectrum 2](https://spectrum.adobe.com/getting-started/introduction) and [Adobe app frame](https://spectrum.adobe.com/foundations/app-frame/overview): cross-app consistency with context-appropriate platform variants.
- [Procreate Dreams gesture manual](https://help.procreate.com/dreams/handbook/interface-and-gestures/gestures): direct manipulation, timeline zoom and multitouch.
- [Logic Pro Smart Controls](https://support.apple.com/guide/logicpro/smart-controls-overview-lgcp7e59f24b/10.7/mac/11.0): one coherent control may adjust multiple declared sound parameters.
- [DaVinci Resolve Color](https://www.blackmagicdesign.com/products/davinciresolve/color): professional scopes, wheels and curves are real grading operations, not decoration.
- [Mobbin Figma inspector](https://mobbin.com/screens/e44768be-5219-4011-83de-262642caa8ff), [Canva editor](https://mobbin.com/screens/5167b1cb-8930-4b98-9481-9a3cdac23312), [Procreate Pocket](https://mobbin.com/screens/80ca3cc7-cc6f-4fe1-a02b-7e8644f960a9), and [music app](https://mobbin.com/screens/996916cd-2a7f-4d0c-ad28-d699736f8ee5): comparative research only.
- [Dribbble Audio Design Desk / DAW redesign](https://dribbble.com/shots/26160115-Audio-Design-Desk-DAW-UI-Redesign), [Nixtio video editor](https://dribbble.com/shots/26280112-AI-Video-Editor-Platform-UI-Design), and [Design Tool explorations](https://dribbble.com/search/design-tool): aesthetic ideation, not source code.

Related existing work: [Studio #5](https://github.com/mikevocalz/nitro-forge/pull/5), [media-ui #25](https://github.com/mikevocalz/nitro-forge/pull/25), [color-ui #26](https://github.com/mikevocalz/nitro-forge/pull/26), [icons #21](https://github.com/mikevocalz/nitro-forge/pull/21), [Board #18/#19](https://github.com/mikevocalz/nitro-forge/pull/19), [pen #20](https://github.com/mikevocalz/nitro-forge/pull/20).

## Design exploration and independent review

Follow [Forge 2046's three-direction design and native quality playbook](./FORGE_2046_DESIGN_REVIEW_PLAYBOOK.md) before calling any instrument visually finished. A locally owned Web Designer Pro ZIP informed the **process** (exploration, specificity, responsive critique), but is not copied, published or required by CI. Compare real Prism, Splice and Cadence interactions, produce independent review notes, and clear separate design and engineering gates. Marketing-page visual techniques do not override editor data accuracy, physical input behavior or content legibility.

## Living micro-interactions and native overlays

Micro-interactions, actual editable focus/hover/pressed feedback, reduced-motion behavior, responsive popovers and native menus are core Forge 2046 acceptance gates, not later cosmetic polish. See [the implementation and QA contract](./FORGE_2046_MICROINTERACTIONS_NATIVE_OVERLAYS.md) NYC-Tron UI supplies the Studio controls (rule #38); its `NativeActionMenu` is bound as the Studio Menu. A rich Popover is not bound: NYC-Tron's `NativePopover` needs an anchor rect and usable regions that Forge's trigger-based contract does not yet pass (`docs/ux/studio-refresh/OWN_UI_INTEGRATION.md`). `@nitro-forge/studio-workspace/interaction` provides testable motion and pane-local overlay policy, not a replacement renderer. All motion must respect reduced motion, dynamic type, native platform behavior, hinge-safe placement, keyboard/screen-reader accessibility and real engine edit state.
