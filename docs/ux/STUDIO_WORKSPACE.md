# Studio UX-01..UX-12 — shared editor components, snap rails and independent app spaces

**Status:** shared workspace shell implemented on November 3, 2026 in `packages/studio-workspace`, integrated into the Expo example and a real-engine browser harness. The design contract below remains the broader target; native canvas adapters, direct manipulation, device and accessibility validation are not implied by the shell implementation.

## Product stance
NitroForge Studio is one **recognizable original product family** with Prism (image/vector), Quill (text), Tally (spreadsheets), Pitch (slides), Folio (PDF), Splice (video) and Cadence (audio). Every editor uses the same workspace structure, control grammar, actions, keyboard behavior, focus affordances, dock mechanics, save/export states, typography/icon scale and interaction feedback. The engine/document model and domain-specific inspectors change by explicit studio manifest, not by creating seven separate app shells.

Affinity's unified Photo/Vector/Layout app is an **interaction reference** for a multi-discipline studio. Do not trace its exact visual identity, icon artwork or panel layouts. Mobbin's Framer, Rive, Canva, Adobe Express, Jitter and Freeform references are review material, not assets that may be copied. See [MOBBIN_REVIEW.md](./MOBBIN_REVIEW.md).

## Shared shell contract

```text
┌────────────────────────────────── Product header ──────────────────────────────────┐
│ NitroForge logo     Document title / save state         Search   Share    Export │
├────────────────────────────────────────────────────────────────────────────────────┤
│ App identity         Main context actions / undo / redo / document scope         │
├──────────┬─────────────────────────────────────────────┬───────────────────────────┤
│ LEFT RAIL│            DOCUMENT/STAGE                   │ RIGHT DOCK                │
│ Tools    │  Contextual floating bar (only on selection)│ Properties | Layers | FX  │
│ Layers   │                                             │                           │
│ Assets   │  Stage is a stable engine session.          │ Inspector reacts to        │
│          │  Overlays are accessible, engine-backed.     │ selection or tool context. │
├──────────┴─────────────────────────────────────────────┴───────────────────────────┤
│ OPTIONAL BOTTOM DOCK: tracks, timeline, notes, history, formula audit, preflight  │
├────────────────────────────────────────────────────────────────────────────────────┤
│ STATUS: zoom/page · selection coordinates · errors · sync / offline · GPU status   │
└────────────────────────────────────────────────────────────────────────────────────┘
```

**Single components across all studios:** `ForgeWorkspace`, `ForgeDocumentBar`, `ForgeToolRail`, `ForgeContextBar`, `ForgeDock`, `ForgeInspector`, `ForgeStageHost`, `ForgeCommandPalette`, `ForgeStatusBar`, `ForgeWorkspacePreset`. App-specific persistence/auth and global nav are host ports; NitroForge owns the inner editor UI only. `ForgeStageHost` never creates a second document/undo model.

### Studio manifests, no divergent UI kits

| Engine | Primary surface | Left contents | Inspector | Optional bottom dock |
| --- | --- | --- | --- | --- |
| Prism | raster/vector artboard | tools, layers/assets | transform, fill, stroke, adjustments, masks | history |
| Quill | paginated text | outline, section tree | typography/styles, comments | revisions |
| Tally | grid workbook | sheets, named ranges | formatting/validation/chart settings | formula trace |
| Pitch | slide canvas | thumbnails, assets | slide/element properties, animation | notes/timeline |
| Folio | PDF pages | page thumbnail/bookmarks | annotation/rotation, export restrictions | comments/preflight |
| Splice | video viewport | media/tracks/assets | clip/transforms/fx, speed | editable timeline |
| Cadence | piano roll/waveform | tracks/clips/assets | track gain/pan/notes | mixer/transport |

Manifest must declare `documentKind`, supported engine capabilities, tools (id/name/shortcut/availability), inspector panels, optional docks, snapping modes and accessible context actions. Unsupported engine capability must be disabled with explanation, not exposed as a working button. Do not assume native PSD/PPTX/XLSX round-trips from ArtCraft descriptions.

## Two distinct snapping systems

### A. Magnetic panel docking (`ForgeDock`)
- Allowed zones: left, right, bottom and supported floating panel containers. A dock is a tab-grouped list of stable `panelId` values; no one panel may appear in two zones at once.
- A panel can be collapsed to rail tab, resized within host-defined minimum stage dimensions, reordered in its dock, moved between zones, or temporarily floated on platforms that truly support an independent safe overlay.
- Desktop pointer drag targets use header drag handle, a visible destination preview, a cancel path (Escape / pointer cancel), and a release transaction. The actual dock state updates **once per completed gesture**, not on every drag frame.
- Native touch uses long-press affordances, reversible preview, haptics when supported and equally capable action menu. Keyboard, accessibility and screen reader offer `Move left/right/bottom`, `Collapse/Expand`, `Move before/after`, `Reset`, `Restore preset`. Never make drag the only control.
- Snap threshold is in *layout dp/CSS logical pixels*, with measured host origin, safe area, keyboard, hinge occlusion and pane minimum size. No target can be underneath a separating hinge or out of view.
- Floating coordinates are clamped to the local pane host and reconstructed after resize. No fixed screen coordinates saved as universal presets.
- Panel visibility and stage availability must not remount the Rust engine, wipe undo history, or keep hidden GPU render loops running. `react-freeze` freezes renders, not effects; explicitly gate engine/render workers.
- `WorkspaceLayoutV1` JSON schema in `studio-workspace-layout.schema.json` stores only panel registry identifiers, dock/order/ratios and studio preferences, not credentials/document data. Cross-zone uniqueness, known panel IDs and minimum viewport constraints are runtime validation gates beyond JSON Schema.

### B. Document object snapping (`ForgeSnapEngine` contract)
- Guides, grid, page margins, column centers, object edges/centers, distances, angular increments and precise numeric input depend on available geometry in the actual engine.
- Objects preview at magnetic targets but commit only a **revision-aware engine operation**, with one undo step. No JS-only visual transform is persisted as though it changed a Rust document.
- Snapping tolerance measured in screen space and transformed into document coordinates; distinguish pointer hit testing from canvas pixels. Temporary modifier overrides and touch alternatives must be documented and accessible.
- For Quill/CSV grids, use their own logical snapping or selection contract. Do not force vector geometry controls onto spreadsheets or text documents.

## UX roles and deliverables

| ID | Expert workstream | Deliverable and ownership | Dependency | Required evidence | Status |
| --- | --- | --- | --- | --- | --- |
| UX-01 | Design lead | original NitroForge visual grammar: type, density, surface, icons, elevation, neutral dark/light, focus; no Affinity asset clone | Expo design system, Mobbin review | approved token matrix and comparative screenshots | PLANNED |
| UX-02 | UX systems | shared `ForgeWorkspace` shell, studio manifest and same positions | native-ui extraction PR #4 | single shell across ≥4 engines | PLANNED |
| UX-03 | Stage/runtime | stable document session across layout changes, canvas overlays | Ignition and Skia #3 | undo/save/reopen after window resize | PLANNED |
| UX-04 | Dock interaction | pointer/touch docking, safe snapping previews and release transactions | UX-02 | device videos and state-machine tests | PLANNED |
| UX-05 | Layout persistence | versioned presets, migration and restore with host storage callback | UX-04 | JSON schema validation + corrupt/unknown panel cases | PLANNED |
| UX-06 | Accessible controls | focus, screen reader panel menus and keyboard alternative to drag | UX-04 | keyboard/VoiceOver/TalkBack flow evidence | PLANNED |
| UX-07 | Tablet UX | iPad Pencil, Android tablet touch/keyboard, contextual Inspector | UX-02 | iPad split, Android tablet live screenshots | PLANNED |
| UX-08 | Foldable UX | hinge-safe snapping, physical-right host nav in Moyo, book/tabletop | adaptive extraction PR #4 | Moyo 18-case skill and physical Surface Duo | PLANNED |
| UX-09 | Web UX | SSR-safe desktop/tablet/mobile Web, keyboard/mouse and responsive Tailwind v4 | UX-02 | browser runs at measured containers, focus and screenshots | PLANNED |
| UX-10 | Object geometry | engine-backed grid/guides, visual snap feedback, undo | capability schemas / Rust changes | property-based geometry + parity tests | PLANNED |
| UX-11 | Design QA | screenshot diff, contrast, keyboard navigation, interaction flow and icon consistency | UX-01..UX-10 | per-engine multi-platform review | PLANNED |
| UX-12 | Product release | publish SDK separately, verify Moyo and second app with host themes | all | install/tarball + independent Expo/Next.js consumption | PLANNED |

## Component behavior by available usable area
- **Wide desktop web:** doc bar, studio strip, primary tool rail, optional left asset/layer pane, large stage, right inspector, optional bottom timeline. Keep resize handles reachable with mouse, keyboard and touch.
- **Mid-width web/tablet:** center stage retains minimum editing size; one inspector may collapse to icon rail or contextual overlay; horizontal tool labels compact.
- **Native tablet:** same core component implementation, `@expo/ui` on iOS/Android where supported, Pencil pressure or touch when provided, meaningful panel resizing in split-screen.
- **Native phone and mobile web:** stage fills available area, compact command toolbar, bottom/context property sheet; no inaccessible hover state or permanent desktop Inspector.
- **Duo/book/tabletop/multi-hinge:** group controls within real usable regions, avoid dragging across occlusions, preserve state on fold, width and orientation. Moyo host retains its physical-right rail; NitroForge SDK does not own that rail.
- **XR:** compositor panel adapter is a separate capability; do not apply phone/window dp to a spatial scene.

## Tailwind v4 and native-view design tokens
The public design layer accepts semantic tokens: `surface.base`, `surface.raised`, `canvas.mat`, `text.primary`, `text.muted`, `action.active`, `focus.ring`, `border.subtle`, `spacing.{rail,group,section}`, `radius.{control,panel}`, `motion.{snap,collapse}`, `size.{hitTarget,railMin,stageMin}`. Moyo's theme maps these to its app values. NitroForge ships original neutral defaults, and classes compile via Tailwind 4; Moyo currently uses Uniwind on native and react-native-css on Next.js web. `@expo/ui` SwiftUI/Compose modifiers require their own token adapter, not arbitrary DOM CSS.

Prefer crisp hierarchy, restrained elevation and well-labelled controls. Avoid repeating the same AI-generated card/gradient/emoji patterns across seven studio variants. Honor reduced motion. If Moyo requires Kinetrell for high-level chrome, validate the installed animation adapter before claiming it is available.

## Acceptance and verification packet
- Same document bar and tool/inspector architecture in 4+ distinct engines; no frame-independent rerender/reinit.
- 3 dock zones + float when supported; 2 tab groups; persist/restore; corrupted preset safe fallback; keyboard/screen reader action parity.
- Object snapping accuracy in document coords through zoom/rotation/pan and one undo step.
- iPad split/Stage Manager/Pencil, Android tablet, Surface Duo hinge/book/tabletop/RTL and browser across desktop/tablet/phone.
- Dark/light themes and two host themes share component source, not screenshots; contrast, focus, screen reader, tooltips, touch targets.
- Actual performance trace for stage redraw and hidden worker gating. No claimed 60 fps or GPU zero-copy without measurements.

## Implemented follow-up

`ForgeWorkspace` now supplies the document bar, stage slot, left/right/bottom
panel groups, tabs, collapsing, resizing, reordering, move controls, drag previews,
Escape/cancel, and validated layout presets. Its per-instance Zustand model uses
the original docking core. Compact hosts use bottom panels. The host owns the
engine session and persistence; native resources remain in refs.

`apps/studio-preview` runs all seven original command lists through a loopback
bridge to the real Rust engines. It supports dark/light themes, per-studio layout
storage and measured full/768/390px containers. The same workspace component is
used in `apps/example`. Default stages project real engine state; PDF painting,
raster compositing, object editing/snapping and media playback require host
adapters. This is a working workspace shell, not seven complete visual editors.

The UX milestone table above describes the full cross-platform acceptance scope.
Those milestones are not all closed by this follow-up. See `docs/ROSTER.md` for
executed checks and outstanding device evidence.


## App entry contract — user clarification, November 3, 2026

Each app is independently callable. A host presents an app list and opens only
what the user needs in that app's space. Quill is the writing app: a user can type
an essay there or open an existing Word document. Prism, Tally, Pitch, Folio,
Splice and Cadence similarly own their document sessions and entry routes.
Shared dock/workspace components are implementation reuse, not a requirement
for a single editor with seven modes or a permanent studio switcher.

The browser preview now starts with this list. Opened app instances keep their
independent documents while returning to the list. Quill has a real writing
surface, DOCX import and export; the existing Expo app list leads to separate
editor routes and now supplies the same writing surface.
