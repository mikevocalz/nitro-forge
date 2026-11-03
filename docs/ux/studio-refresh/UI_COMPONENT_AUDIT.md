# Canonical UI inventory and Studio adoption

User source of truth: `nyc-mon/packages/ui`. User requested a full inventory
review and actual component reuse on November 3, 2026. The audit covered all
42 package export entries, the root/component-group barrels, public props and
platform forks, the Storybook roster and all 41 NeonBlade catalog entries. This
is source/API coverage; the entire catalog was not rendered or hardware-tested.
Current source supersedes stale missing-component notes in older REPO_MAP docs.

## Components consumed by Studio

All controls below are actual canonical components, imported narrowly into the
source-owned studio-controls object and passed through StudioUIProvider. The
provider has no local replacement UI. Shared state remains Zustand; engine
operations, resources and native window contracts retain their ownership.

| Existing component | Actual use |
|---|---|
| Button / IconButton | Shared Save, undo/redo, panel actions, creation tools, Layers, close/retry/cancel; browser theme and Word export actions |
| TabBar | Dock panel tabs, compact density, selected semantics and dock-specific accessible name |
| SegmentedControl | Named panel-position radio groups driving the existing dock model |
| Toolbar | Compact panel/Arrange headers with real drag-handle and close-action slots |
| FieldGroup.Section / KeyValueList | Grouped document inspector fields from real engine describe data |
| List / ListItem | Static document-outline rows with supporting values |
| Card | Browser and native application directories; existing route links remain authoritative |
| Badge | Actual layer count and opened-session status |
| Banner / ErrorMessage | Real operation feedback, persistent render/import errors and recovery actions |
| EmptyState | Real empty layer list, with Add rectangle wired to the engine |
| Menu / Select | Source-owned dropdown boundary; actual Workspace and opacity menus |
| DropZone / browser FilePicker | Open import target, using the existing DOCX/NFD validation/import path and keyboard picker alternative |
| TextInput / native input and html.Textarea adapter | Real Quill essay editing |
| Image | Actual Prism engine composite |
| ui/html / tw primitives | Semantic structure and native/web layout throughout the host boundary |

Studio now exposes the existing components it consumes; it does not import the
large root UI barrel or mount unrelated components simply to populate a screen.
Rounded-sm is 4px at Studio call sites. Existing control defaults remain intact.
The canonical Button/IconButton support selected state and an explicit 4px frame
radius; compact TabBar/Toolbar density is opt-in for editor panes.

A real phone QA issue was fixed in the activation policy: a panel already in the
bottom dock is no longer reinserted when its tab is selected. Three regressions
check stable tab order, usable compact expansion and unchanged wide-panel docks.

## Remaining catalog, reviewed for matching jobs

| Components / group | Applicability and platform detail |
|---|---|
| Slider, Switch, Checkbox | Existing controlled numeric/Boolean fields. Slider has browser range and SwiftUI/Compose forks; use for actual field workflows with an appropriate engine commit policy. |
| TextField, Textarea, FormField, SearchBar | Real labeled entry, validation, paste and search. Search/filter UI belongs with implemented filtering rather than a decorative search box. |
| Collapsible | Existing disclosure; native Expo UI children need NativeSlot for arbitrary RN subtrees. |
| VirtualList | Legend native / TanStack web for genuinely large collections; measured Prism drag rows retain their existing refs and transaction controller. |
| DataTable, Pagination | Actual table inspection, sorting and selection; editable workbook behavior remains the Tally engine's job. |
| Toast, ToastCard, notify, Toaster | Existing transient notification queue/cards. Current Studio feedback uses Banner and its bounded notice lifetime. |
| LoadingSkeleton, RiveLoader, ProgressBar, CircularProgress, Rain/Arrow/Turbine loaders | Existing loading/progress UI; show only genuine loading or known progress. No fabricated percentages. |
| Dialog, DialogCard, ResponsiveDialog, BottomSheet, SheetSurface, Modal | Existing contained overlays for actual recovery/confirmation workflows and compatible native hosts. |
| ConfirmDestructive | Named irreversible actions; ordinary layer edits retain engine undo. |
| Lightbox | Genuine image inspection when exposed as a workflow. |
| SafeArea, KeyboardAwareScroll, NativeSlot | Native containment, keyboard behavior and RN/Expo UI bridging. Existing native host ownership is preserved. |
| Container, Heading, Text, BackButton, LinkButton, TabBarAccessory | Available layout/type/navigation building blocks. Semantic route links and native stack back ownership remain explicit. |
| FilterBar / FilterChip, CopyButton, Timestamp, Checklist / CheckRow | Actual filtering, copyable values, timestamps and validation results when those data/workflows exist. |
| StatusRow, SignagePlate / SignageBand | Semantic status and section presentation; use the actual state as the content. |
| Avatar, AuthProviderButton, MaskedValue, NotificationPreview, YearGrid | Identity/authentication, masked data, notifications and dates; no matching current document-editor task. |
| adaptive-panes / arrangement | Existing native split/Inspector/fold-aware host infrastructure; preserve router, session identity and Studio docking contracts. |
| cards / future / elements | Notch/beam frames, CardSlider, image items, CircuitButton, GridCard, AccentFrame and event Timeline for genuine matching surfaces. |
| charts | Real line/sparkline/bar/donut series and selection; suitable for implemented Tally/chart workflows. |
| audio / audio-session | AudioPlayer, VoiceRecorder, Waveform and session ownership for actual Cadence audio data. |
| nav / cursors | Site navigation and pointer feedback. Native cursor components return null. |
| neon / theme / motion / icons / haptics / hooks | Existing design, animation, preference and per-instance Zustand infrastructure; preserve reduced motion and Forge icon requirements. |
| GPU / Three / renderer services | Rendering and diagnostics; engine output and resource lifetimes remain authoritative. |
| backgrounds | Existing city/grid/rain/river scenes; available for screens with a real visual purpose. |
| hlynk / hatch / care / mon | Authored device, creature and lifecycle components from NYC's domain. |
| game-controls / lobby | Actual game-controller, hardware-layout and lobby workflows. |
| admin / native / net / asset helpers / site-embed | Curated exports, direct SDK primitives, transport and embedded-site services. Narrow imports keep unrelated subsystems out of document editors. |

Important platform distinctions: native SegmentedControl is the kit's shared
branded radio group; native Select is its branded dropdown; native Menu is
Expo's OS-backed menu. FieldGroup is shared branded UI on native. Static native
List rows use the existing NativeSlot bridge. DropZone receives files/content;
it does not reorder layers. The legacy Expo54 example is not native runtime
proof for the Expo58 source UI package.

## Exact public export coverage

The following package entrypoints were checked against current source. Group
barrels and their public API/platform contracts were reviewed; rendering proof
for actual Studio consumers is recorded separately in ROSTER.md.

| Entrypoint | Source |
|---|---|
| `.` | `./index.ts` |
| `./tw` | `./tw.tsx` |
| `./primitives` | `./primitives/index.tsx` |
| `./html` | `./html/index.tsx` |
| `./backgrounds/CityBlocks` | `./backgrounds/CityBlocks.tsx` |
| `./gpu` | `./gpu/index.ts` |
| `./gpu/gpu-store` | `./gpu/gpu-store.ts` |
| `./three` | `./three/index.ts` |
| `./three/cel` | `./three/cel/index.ts` |
| `./three/hlynk` | `./three/hlynk/index.ts` |
| `./three/hlynk/hud` | `./three/hlynk/hud.ts` |
| `./three/internals` | `./three/renderer-internals.ts` |
| `./three/gpu-timestamps` | `./three/gpu-timestamps.ts` |
| `./neon` | `./neon/index.ts` |
| `./elements` | `./elements/index.ts` |
| `./progress` | `./progress/index.ts` |
| `./haptics` | `react-native: ./haptics.native.ts; default: ./haptics.web.ts` |
| `./icons` | `react-native: ./icons.native.tsx; default: ./icons.web.ts` |
| `./native` | `./native.ts` |
| `./net` | `react-native: ./net/index.native.ts; browser: ./net/index.web.ts; default: ./net/index.ts` |
| `./audio-session` | `react-native: ./audio/session.native.ts; default: ./audio/session.ts` |
| `./game-perf` | `react-native: ./game-perf.native.ts; default: ./game-perf.ts` |
| `./admin` | `./admin/index.ts` |
| `./game-controls` | `./game-controls/index.ts` |
| `./game-controls/parts` | `./game-controls/parts.ts` |
| `./game-controls/hardware` | `./game-controls/hardware/index.ts` |
| `./game-controls/layout` | `./game-controls/layout/index.ts` |
| `./game-controls/layout/parts` | `./game-controls/layout/parts.ts` |
| `./lobby` | `./lobby/index.ts` |
| `./adaptive-panes` | `./adaptive-panes/index.tsx` |
| `./arrangement` | `./arrangement/index.ts` |
| `./adaptive-panes/parts` | `./adaptive-panes/parts.ts` |
| `./three/hatch` | `./three/hatch/index.ts` |
| `./three/asset-bytes` | `./three/asset-bytes.ts` |
| `./three/mon` | `./three/mon/MonModel3D.tsx` |
| `./three/mon/lipsync` | `./three/mon/lipsync/index.ts` |
| `./three/mon/hatch-sound` | `./three/mon/hatch-sound.ts` |
| `./three/mon/hatch-timeline` | `./three/mon/hatch-timeline.ts` |
| `./three/mon/idle` | `./three/mon/idle/index.ts` |
| `./site-embed` | `./html/SiteEmbed.tsx` |
| `./studio-controls` | `./studio-controls/index.tsx` |
| `./studio-controls/web` | `./studio-controls/web.tsx` |

## Integration verification

Eleven fresh Craft Anything browser scenarios passed after the final fixes.
They exercised real tab content switching with stable phone tab order, the
segmented Right-to-Bottom dock move, real Prism shape/opacity/removal and empty
state recovery, responsive Cards/session Badges in both themes, short-window
controls, and Quill's named Essay text field plus real Apply operation. Quill
shows six words, Up to date and the same engine-backed paragraph in the outline;
its writing starts top-left and wraps on phone. Main agent inspected selected
final images; raw evidence/parameters remain in
`artifacts/craft-anything/full-ui-catalog/final-fixed/verified-summary.json`.

Actual testing drove these integration fixes:

- Compact TabBar/Toolbar use the kit's existing type-scale merge configuration,
  retaining both 13px caption size and readable title colour.
- Card action/session rows wrap at phone width; Card roots fill their grid cells.
- The TextInput web adapter maps native accessibility labels/hints to DOM ARIA,
  and converts numeric RN line heights to pixel CSS rather than unitless
  multipliers. Native input behaviour remains unchanged.
- Main's semantic theme uses RN dataSet; Prism's dark controls use the existing
  NightScope utility and web scheme-dark class.
- Vite resolves the installed motion library's actual ESM entry. Its published
  root wrapper star-exports CommonJS, which caused a blank dev page despite a
  passing production build. The module-contract smoke check reproduces the
  actual configured entry's 4 motion APIs and 18 required control APIs. A
  separate negative control confirmed the old wrapper's missing static API. CI runs that check before
  the bundle build.

Checks executed: 28 workspace tests, all package typechecks, source UI full
typecheck/scoped lint, six focused source style/type-scale tests, UI-module
contracts, production build and seven-engine integration. Existing large-chunk
warning remains; this work does not claim a performance optimisation.

Current paired source UI commit: 782c682ea684606111e612242a66761d50137f95,
local only and pinned in CI. Publish that source commit before NitroForge.
No remote CI run, native hardware/runtime, complete browser/OS matrix, screen
reader, or real file-drop/picker interaction is claimed. Open's DropZone uses the
existing validated import function and keeps FilePicker as the keyboard path.

Portable recorded Craft scripts are in apps/studio-preview/qa. They launch a
fresh private local preview, use screenshot-only captures and exercise named
controls. Completed click steps require inspection of the resulting content;
they are not automatically a visual or engine-state assertion.
