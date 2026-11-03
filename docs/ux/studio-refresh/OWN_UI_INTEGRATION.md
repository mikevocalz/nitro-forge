# Source-owned UI integration

User-selected source of truth: `nyc-mon/packages/ui` (November 3, 2026).
MoyoLearn was inspected initially but explicitly rejected as the canonical source.

Studio now requires `StudioUIProvider`. Its shared visual surfaces import the
provider's components, never raw RN View/Text/Pressable/Input/Image/ScrollView.
The provider has no substitute UI fallback; a missing host binding throws an
explicit integration error. RN imports remaining in Studio are behavior,
measurement types, platform queries and accessibility services. The boundary
check is `node packages/studio-workspace/verify-ui-boundary.mjs`.

NYC owns `@acme/ui/studio-controls`. It binds its actual `tw`/`html` primitives,
Menu, Select, Image and native input adapters. The native Menu uses the kit's
existing Expo UI OS menu; native Select uses the kit's existing dropdown. The
web adapter bridges pressed render callbacks and concrete styles to the same
semantic Button, rather than drawing another button. Image dimensions pass
through the existing Image's `containerStyle`. No components were copied into
NitroForge.

The browser imports `@acme/ui/studio-controls/web` for its existing FilePicker.
The native entry deliberately does not fake a browser FilePicker; native file
entry remains the consuming application's responsibility. The browser launcher
and host envelope import actual `@acme/ui/html` landmarks and content elements.
Tailwind scans the canonical source and uses its theme; `important` is required
by that source's documented RNWeb class precedence contract.

Local source-owned dependency commit: nyc-mon `782c682ea684606111e612242a66761d50137f95`.
It is committed locally, not pushed. The paired UI commit must be published
before pushing the NitroForge branch: CI checks out that exact UI commit into
an adjacent `nyc-mon` directory, installs its own dependencies, then builds the
real integration. A bare NitroForge checkout no longer pretends to contain the
application UI package. The portable Studio package itself remains host-injected.

Development: default source is the adjacent `../nyc-mon/packages/ui` checkout;
`STUDIO_UI_ROOT` sets the Vite/Metro source location. The current browser CSS
source/theme paths expect that adjacent checkout. Consuming native applications
normally resolve `@acme/ui` from their own workspace instead of this development
Metro mapping. NYC's UI targets Expo58/RN0.88. The legacy example still has
Expo54/RN0.81 and no implemented native engine runtime; static bindings and
TypeScript checks are not a claim that it is a runnable SDK58 native host.
No SDK, app window, manifest or orientation changes were made.

## Reused layer drag

Dock and layer bars share `DragGrabHandle` and its controller. Layers measure
actual row/window viewport frames. A drag previews only, validates unchanged
state, maps top-to-bottom rows to bottom-to-top engine indices, then releases
one `moveLayer` command. Cancel, termination, scroll, resize, panel close,
stale documents and Escape discard the transaction. Raise/Lower remain for
keyboard and assistive-technology operation.

NYC DropZone handles incoming files/content; it is not an internal list sorter.
No exported NYC row sorter with pointer/touch parity was found, so Studio reuses
its existing dock drag machinery rather than mislabelling DropZone as a sorter.

## Existing control inventory

Studio now exposes the actual canonical TabBar and SegmentedControl through
the required host provider. Dock panel headers use TabBar with tabs semantics;
Arrange panel-position choices use SegmentedControl as a named radio group.
Their selection callbacks call the existing dock model, not a parallel state
machine. This does not add new editor modes or change application routing.

Use the canonical inventory before composing new controls: TabBar for tab-panel
selection, SegmentedControl for exclusive choices, Menu/Select for dropdowns,
TextInput for text entry, and semantic ui/html for document structure. DropZone
handles incoming content; internal row sorting retains the existing drag engine.
The Studio provider has no handmade fallback when a binding is absent.
