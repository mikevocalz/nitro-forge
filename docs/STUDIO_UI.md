# NitroForge Studio — One responsive creative suite

**Status: design/implementation contract; reusable UI packages and editor workspace have not shipped.** 2026-11-02.

NitroForge already contains **Ignition** and seven original engine packages: Prism (image), Cadence (audio), Splice (video), Folio (PDF), Pitch (slides), Tally (sheets) and Quill (rich text). Keep these current public package names/API contracts. **Do not replace them with ArtCraft repos or rename their npm APIs** merely because ArtCraft provides feature-rich upstream alternatives. ArtCraft is an independently admitted optional source for new capabilities.

## Identity: one design system, multiple disciplines

Inspired by Affinity's unified Photo/Vector/Layout workflow, create an *original* consistent NitroForge suite UI: shared workspace, tool positions, icon family, keyboard commands, contextual properties, dock behavior, panel widths, focus/hover/pressed states, status, file-open/save/export flows, dark/light themes and animations. Individual studios change only manifests/tools/document properties/visible panels, not the product's underlying visual grammar. Do not copy Affinity's exact branded UI, icons or product assets.

Research in Mobbin (screens may be reviewed in the provider, not redistributed in NitroForge):
- [Framer web editing](https://mobbin.com/screens/1edcc2ea-d2e4-41a8-97d3-b8b4feca2735)
- [Rive web animation editing](https://mobbin.com/screens/0deb9a56-af1f-4697-a912-ff87f5ccd09f)
- [Canva web canvas editing](https://mobbin.com/screens/3f507e35-c583-41b5-afc0-c0422e00e068)
- [Adobe Express web graphics](https://mobbin.com/screens/64d24cec-61c2-4907-8d75-84fcbc4314ce)
- [Jitter web animation](https://mobbin.com/screens/6c71f040-3f15-43ef-8faf-6e21442f898a)
- [Apple Freeform iOS](https://mobbin.com/screens/30867762-fa72-4721-9ad3-d2bae601e48d)

## Exactly shared cross-platform native controls

**Do not build a separate, look-alike NitroForge UI kit**. Moyo already uses:
- `@expo/ui` Universal `Host` / `RNHostView`, including platform-backed SwiftUI on Apple and Jetpack Compose on Android, with accessible web equivalents.
- Shared `@acme/ui` semantic elements, `AdaptivePanes`, Inspector, native `ReservedRegions` and platform adaptive navigation. Android's actual folding feature geometry is sourced through an Expo Modules 2 / Jetpack WindowManager bridge. `@metavr/layout-compat` and `@metavr/layout-window-compat` exist in Moyo's mobile package; verify their concrete APIs before extracting.
- Tailwind CSS **v4** token system; **Uniwind** native styling and **react-native-css** on Next.js web behind `packages/ui/tw.tsx`. These platforms share semantic themes, class recipes and token source, not raw CSS manipulation of SwiftUI/Compose controls.

Extract app-neutral components into versioned, independent NitroForge packages, then make Moyo compose/re-export these exact implementations with its own brand/theme; avoid a circular dependency and don't import Moyo-only tokens into a generic SDK. Use a host-supplied theme contract so NYC-MON, DVNT, Pa'Casa and third parties can style the same components. Do not introduce Tamagui/Bento/new unapproved styling stacks or use raw HTML as the shared feature UI.

Proposed isolated packages (NOT yet implemented):
- `@nitro-forge/native-ui`: typed semantic control wrappers for Expo UI native / accessible web, reusable toolbars, lists, forms, shortcuts.
- `@nitro-forge/adaptive-layout`: tested pane, inspector, safe-area, fold/hinge and Meta adaptive platform adapters, host navigation excluded.
- `@nitro-forge/editor-ui`: built exclusively from these same controls, with ForgeWorkspace / ForgeDock / ForgeInspector / ForgeStudioSwitcher.
- `@nitro-forge/renderer-skia`: **React Native Skia v3 Graphite only**, with native WebGPU/Dawn adapter and browser CanvasKit path.
- Existing `@nitro-forge/ignition` and seven engine packages remain **headless**, with no UI/Expo/Skia dependencies.

## Shared workspace anatomy

```text
┌──────────────────────── Document / Project / Save / Share ─────────────────────────┐
│ Studio switcher: Prism | Quill | Tally | Pitch | Folio | Splice | Cadence           │
├───────┬──────────────────────────────────────────────┬───────────────────────────┤
│ Tools │             Document / Canvas                │ Properties / Inspector    │
│ Rail  │   Context bar & selection overlays            │ Dock (tabbed panels)       │
│       │                                              │ Layers, Style, History…  │
├───────┴──────────────────────────────────────────────┴───────────────────────────┤
│ Optional bottom dock: film/audio timeline, formulas, notes, preflight            │
│ Status bar: zoom · coordinates · revision · provider sync state                   │
└─────────────────────────────────────────────────────────────────────────────────┘
```

- **ForgeWorkspace:** one stable document session; no reinitialize when switching panels or resizing.
- **ForgeDock / ForgeRail:** dock panels left/right/bottom, collapse/tab-stack/resize/reorder, use magnetic drop-preview before commit. On touch devices use long press and actions; add keyboard/screen-reader alternatives.
- **ForgeInspector:** same properties UI across studios; domain-specific schema supplies content.
- **ForgeCanvas:** Rust engine is document state source of truth, React UI overlays and controls render with Skia v3 or a validated web renderer adapter.
- **ForgeCommandPalette:** shared action discovery and shortcuts.
- **ForgeWorkspacePreset:** versioned serialization of pane arrangement, per user/device via host-provided storage; never bake in Moyo tenancy.

**Two types of snapping must remain distinct.** Magnetic **dock snapping** repositions UI panels; **object snapping** aligns document objects to grid/guides/centers/edges and must commit engine-backed revision-safe operations. Both need visual preview, input precision, undo and accessibility.

## First-class responsive/adaptive behavior

| Surface | Expected behavior |
| --- | --- |
| Native phones | Content first; compact contextual toolbar; bottom sheets for inspector |
| Tablet/iPad | Canvas + layers + inspector when space permits; Pencil, keyboard, split-window resizing |
| Android tablets / Surface Duo / foldables | Jetpack WindowManager hinge-safe panes; physical rail and posture capability remain **host policy**, not hardcoded into this SDK |
| Web desktop | Full multi-pane dockable experience, keyboard/mouse/trackpad; CSS responsive tokens; SSR-safe fallback |
| Web tablet / phone width | Container-adaptive pane collapse, accessible focus and touch, not a second web-only editor |
| XR host | Same typed engine semantics; separate tested spatial layout/renderer, no fake 2D width assumption |

Measure actual usable containers and segments, not device names. Preserve selection, scroll, undo stack, focus intent, save revisions and GPU resource lifecycle across dock, rotate, fold and resize. Respect RTL, high text scaling, reduced motion, input method editors and screen reader. Avoid DOM drag-only interaction and do not render native lists under unbounded native scroll parents.

## Release gates

1. Shared component story fixtures and visual regression for all themes, density, pointer modes and supported screen sizes.
2. Actual Expo UI `Host` / `RNHostView` behavior on physical iPad, Android tablet and Surface Duo, plus browser and simulator evidence separately.
3. Dock drag / touch / keyboard reorder, collapse/restore, saved layout migrations, contrast/focus and hinge safety.
4. Real command + undo/save/reopen/export parity through Ignition, not a mock UI, and no stale GPU canvases after pane visibility changes.
5. **Skia v3** native device build and WebGPU Dawn pairing; no v2 compatibility shim in NitroForge's shipping editor renderer. See [SKIA_V3.md](./SKIA_V3.md).

This is a design commitment, not an implementation claim; each package must be released and tested separately.
