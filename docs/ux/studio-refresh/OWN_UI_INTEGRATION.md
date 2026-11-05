# Studio UI integration

Source of truth: NYC-Tron UI (rule #38, 2026-11-05: Forge imports NYC-Tron;
nothing in NYC-Tron imports Forge). It replaced `nyc-mon/packages/ui`
(`@acme/ui`), which the user selected on November 3, 2026; that history is in
`docs/ROSTER.md` and `UI_COMPONENT_AUDIT.md`.

Studio requires `StudioUIProvider`. Its shared visual surfaces import the
provider's components, never raw RN View/Text/Pressable/Input/Image/ScrollView.
The provider has no substitute UI fallback; a missing host binding throws an
explicit integration error. The boundary check is
`node packages/studio-workspace/verify-ui-boundary.mjs`.

## Release

`tooling/nyc-tron.json` pins `@nyc-tron/ui`, `core`, `expo-controls` and
`reserved-regions` at v0.1.0-alpha.3, each with the sha256 from the release's
`SHA256SUMS`. `node tooling/verify-nyc-tron.mjs` fails if a workspace manifest
uses another URL or a tarball no longer matches.

## Slot map

`nycTronStudioUI` in `packages/studio-workspace/src/nyc-tron-host.tsx` builds
every slot. Each host adds its primitives (`apps/example/src/studio-ui.tsx`,
`apps/studio-preview/src/studio-ui.tsx`).

| Studio slot | NYC-Tron |
| --- | --- |
| Select | `@nyc-tron/expo-controls/Select` |
| Menu | `@nyc-tron/expo-controls/NativeActionMenu` (trigger label names the menu; no title row) |
| SegmentedControl, TabBar, Toolbar, List, ListItem, IconButton, FieldGroup(.Section) | `@nyc-tron/ui/components/<Name>` |
| Button, Card | `@nyc-tron/ui/components/Button`, `Card`, through small adapters: `outline` is `secondary`, `cornerRadius` becomes a style, a night card sits in NightScope |
| Banner, Badge, EmptyState, ErrorMessage | `@nyc-tron/ui/components/feedback/<Name>` |
| KeyValueList | `content/KeyValueList` |
| NightScope | `theme/NightScope` |
| DropZone | `files/DropZone` (the preview's FilePicker is `files/FilePicker`) |
| View, Text, Pressable, ScrollView, TextInput, Image | the host's React Native primitives; on web, the className binding |
| TokenScope | Uniwind `ScopedVariables` on native; a `display: contents` view on web |
| Popover | `@nyc-tron/expo-controls/NativePopover`, measured trigger form |
| NativeDropdown | grouped `@nyc-tron/expo-controls/Select`; uses native dropdowns where supported |

The browser launcher and host envelope use `@nyc-tron/ui/components/html`.
Forge's `tone` and `surface` props are accepted and ignored: colour comes from
the semantic variables, which `packages/studio-workspace/build-theme.mjs`
writes next to Forge's own (`src/theme.css`, `src/theme.native.css`).

**Popover and NativeDropdown (alpha.3).** Both slots are bound. Popover
passes the controlled trigger and rich content to NYC-Tron's measured trigger
form. NYC-Tron chooses placement within its available region; the Studio's
optional above/below preference does not override native placement. Hosts that
supply fold regions must retain that geometry ownership.

Dropdown maps Studio group labels (or stable IDs) to NYC-Tron headings. Its
canonical Select retains disabled choices and includes supporting text in the
option label. On native it delegates to NativeDropdown when its selection can
be represented; NYC-Tron keeps its accessible token picker for placeholder or
disabled-option cases. No local popup implementation is introduced.

Layers returns to its original 280-point panel: alpha.3 collapses row opacity
on narrow rows instead of requiring Forge's temporary 356-point workaround.
This changes editor geometry only, with no app-window configuration changes.

## React Native Web

`studio-preview` renders NYC-Tron through React Native Web, which drops
`className`. `src/react-native-classname.tsx` forwards it as a `$$css` style,
and `vite.config.ts` routes every `@nyc-tron/*` package's `react-native`
imports to that binding, resolved to the app's one RNW copy.

## Fold geometry

`apps/example` reads regions with `useReservedRegions` from
`@nyc-tron/reserved-regions` (native module `NYCTronReservedRegions`) and types
them with `ReservedRegion` from `@nyc-tron/core/folds`. The app-local
`modules/reserved-regions` Expo module is gone. The package has no
`RCT_NEW_ARCH_ENABLED`-gated sources, so it needs no `Package.swift` define
(`apps/example/src/native/spm-new-arch-define.test.ts`).

## Reused layer drag

Dock and Composer bars use NYC-Tron UI's `DragGrabHandle` with Forge's
platform transport (`src/drag-transport.ts`: the browser responder on web,
Gesture Handler on native). Prism layers are NYC-Tron's `LayerStack`: a row
drag previews in the list and lands one `moveLayer` on release; a cancelled
drag never reorders. Each row removes its own layer (button, screen-reader
action, Delete) as one `removeLayer`. LayerStack has no keyboard reorder, so
Raise/Lower remain; the rows also carry move-up and move-down screen-reader
actions.

NYC-Tron's DropZone handles incoming files/content; it is not an internal list sorter.
No exported row sorter with pointer/touch parity was found, so Studio reuses
its existing dock drag machinery rather than mislabelling DropZone as a sorter.

## Existing control inventory

Studio exposes NYC-Tron's TabBar and SegmentedControl through
the required host provider. Dock panel headers use TabBar with tabs semantics;
Arrange panel-position choices use SegmentedControl as a named radio group.
Their selection callbacks call the existing dock model, not a parallel state
machine. This does not add new editor modes or change application routing.

Use the NYC-Tron inventory before composing new controls: TabBar for tab-panel
selection, SegmentedControl for exclusive choices, Menu/Select for dropdowns,
TextInput for text entry, and semantic ui/html for document structure. DropZone
handles incoming content; internal row sorting retains the existing drag engine.
The Studio provider has no handmade fallback when a binding is absent.
