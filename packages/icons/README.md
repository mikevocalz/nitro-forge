# @nitro-forge/icons — Forge Motion Icons
A first-party, **bold and modern** visual language shared across Prism, Quill,
Tally, Pitch, Folio, Cadence, Splice, Board, and every Studio rail.

## Critical semantics
- Default/idle: thick rounded **outline**; selected/active: recognizable **filled silhouette**.
- Selection crossfades outline → fill and adds short spring-like emphasis.
- No app-specific icon pack forks: single semantic inventory, reusable native/web geometry, shared animation interface.
- 24px design grid, 2.35px rounded stroke, size tokens 12/16/20/24/28/32/48.
- No baked-in brand colors. All colors are inherited/overridable from host themes; default palette is merely a demonstration.
- Animated UI uses 120ms hover, 110ms press, 225ms select, 175ms deselect. Respect OS reduced-motion settings.
- Outline/filled geometry must be separately reviewed at 16px/20px/24px and at common pixel densities.
- State machines include Idle / Hover / Pressed / Selected / Disabled / Loading / Success / Error / Recording.
- Error, loading and hardware pairing must be tied to **real** state, never a timer pretending that the operation succeeded.
- Every icon button needs an accessible name; no icon alone conveys status. Keyboard, pointer, pen, high-contrast and XR input supported by consuming wrappers.

## Status — avoid phantom icon coverage
The semantic inventory covers **25 categories** and many proposed suite actions, including
Office/Google Workspace/iWork classes of operations and pro tools found in
Affinity/Adobe/Figma/Canva/DaVinci-style editors. These are **original** names and
artwork, not copied proprietary icon files.

Only the catalog IDs listed in `glyphIds` (48 today) have committed authored outline/filled vector
paths. Names in `iconIds` are a **design backlog**, not finished SVGs or Rive assets.
`getGlyph` returns undefined for unmatched artwork. Do not silently display
the wrong glyph or imply the whole inventory is ready.

## Integration
```js
import {searchIcons,getGlyph,resolveIconState,riveIconInputs} from "@nitro-forge/icons";
import {ForgeIcon} from "@nitro-forge/icons/native";
const result=resolveIconState({selected:true,size:"toolbar",appearance:"dark"});
const selectionArtwork=getGlyph("vector/pen",result.variant);
```

**Native/web UI:** `ForgeIcon` uses one shared SVG path renderer with
React Native Animated crossfade and press feedback. UI dependencies are lazy
through `/native` and `/web`, not the headless catalog. The Rive state
bindings are also exported. Official Rive CLI source, compiled `.riv` files,
custom runtime integration and device QA are **separate gates**, not claimed done.

## Rive machine contract
Artboard `ForgeIcon`; inputs: `State` string, `Selected` boolean,
`Disabled` boolean, `Loading` boolean, `ReduceMotion` boolean,
`Color` string. Rive adapters must not fake state. Freeze frames
and use static glyphs if reduced motion is enabled.

## Release acceptance
1. Catalog stable IDs; no duplicates; zero implicit generic fallback.
2. Source tests and package export / ESM load pass.
3. Rive CLI source verifies and actually compiles to a Rive binary.
4. Animated outline/filled states verified on iOS, Android and web.
5. Static frame parity to Skia and reduced-motion / VoiceOver / TalkBack.
6. Moyo Studio and independent Forge consumer verify touch/pen/keyboard state
   and no duplicate Rive runtime.
7. NPM tarball, install smoke, licensing and glyph provenance verified.
