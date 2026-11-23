# Radius inventory, 2026-11-23

Scope: the radius rule in [DIRECTION.md](DIRECTION.md) ("Owner brief and view
radius rule"), checked by `tooling/check-radius.mjs` over the TS, JS, CSS and
HTML sources under `apps/`, `examples/` and `packages/` (the roots in
`tooling/source-roots.mjs`, shared with the v1 component-scope derivation).
Base commit `dab27e1`.

This document lists radius values at their call sites. The view-by-view
inventory per studio, the captures, rendered review and critique that F8 also
asks for are separate work and are not recorded here. The checker reads no
Swift, Kotlin or C++ source.

## Result

| | Violations |
| --- | --- |
| Before (base commit, checker run against an export of `HEAD`) | 77 (73 call sites, 4 token-definition) |
| After the first migration | 5 |
| After owner decision D6 (`docs/completion/DECISIONS-2026-11-23-v1-scope.md`) | 0 in 223 files |
| R2 review: the checker also scans `examples/`, `.mjs`, `.cjs` and `.html`, and catches identifier values | 11 in 262 files (9 in `examples/native-cadence/App.tsx`, 2 identifiers) |
| After the R2 fixes | 0 in 262 files |

`node tooling/check-radius.mjs` ends with `check-radius: 0 violation(s) in 262 files`
and exits 0.

## Tokens

Defined once in `packages/studio-workspace/src/theme.ts`:

| Token | Value | Tailwind class | Role names that use it |
| --- | --- | --- | --- |
| `forgeRadius.md` | 6 px | `rounded-md`, `rounded-card` | `workspaceScale.radius.panel` (outer views), `workspaceScale.radius.paper` (document frames) |
| `forgeRadius.sm` | 4 px | `rounded-sm`, `rounded-control`, `rounded-forge-control` | `workspaceScale.radius.control` (inner views, controls) |
| `forgeHairlineRadius.tick` | 1 px | none | hairline ticks |
| `forgeHairlineRadius.needle` | 0.75 px | none | hairline needles |

`build-theme.mjs` writes them into `theme.css` (web), `theme.native.css`
(Uniwind) and a new `radius.css` (radius only, for hosts that keep their own
palette). `--radius-control` and `--radius-card` are the names NYC-Tron recipes
read; they now come from the same two values.

## Checker rules

| Rule | Fails on |
| --- | --- |
| `token-definition` | `theme.ts` lacks exactly one `forgeRadius = { sm: 4, md: 6 }`; a `workspaceScale.radius` entry is anything but `forgeRadius.sm` or `forgeRadius.md`; a `forgeHairlineRadius` value is 4 or more; a generated sheet holds any `--radius-*` set other than sm 4, md 6, forge-control 4, control 4, card 6; or a sheet differs from a fresh `build-theme.mjs` run in a temp directory |
| `rounded-scale` | `rounded-xs`, `rounded-lg` and larger, with any side or corner prefix (`rounded-t-xl`, `rounded-br-2xl`) |
| `rounded-arbitrary` | `rounded-[...]` |
| `rounded-dynamic` | a class built at run time: `` `rounded-${size}` ``, `'rounded-' + size` |
| `rounded-full` | `rounded-full` without an exemption marker |
| `radius-variable` | a `--radius-*` definition with its own number outside the token files; `var(--radius-x)` naming a variable the token sheets do not define |
| `raw-radius` | a literal radius: `borderRadius: 8`, `'borderTopLeftRadius': '50%'`, `"border-radius": "8px"`, `el.style.borderRadius = '10px'`, `cornerRadius={4}`, `cornerRadius="8"`, a config object such as `borderRadius: { lg: '12px' }`, CSS or inline-style `border-radius: 4px` |
| `radius-arithmetic` | a radius computed with a number (`scale.radius.control + 2`, `size / 2`), or CSS mixing a token with a number |
| `radius-identifier` | a radius read from anything but `forgeRadius.*`, `forgeHairlineRadius.*`, `scale.radius.*` or `workspaceScale.radius.*` |
| `exemption-kind` | a marker naming a kind DIRECTION.md does not list |
| `exemption-unused` | a marker that excuses no violation |

These pass: a literal `0`; a ternary whose branches all pass; the CSS-wide
keywords (`inherit`, `initial`, `unset`, `revert`); CSS shorthand made only of
`0` and token `var()` parts, such as `0 var(--radius-sm)`. Comments are
ignored. Strings are checked, because class names live in strings.

Out of scope: `native/persona/site`, a static page outside the three roots.
Run through the same rules it has 39 findings in 5 files; they are not counted
above.

Skipped directories: `node_modules`, `dist`, `build`, `coverage`, `.expo`,
`.turbo`, `target` (dependencies and build output); `ios`, `android`,
`generated` (native projects and Nitrogen output, not hand-written UI);
`tests`, `__tests__`, `fixtures`, `tooling`, `*.test.*`, `*.spec.*` (tests
assert on radius values and render nothing that ships); `rust`; `*.d.ts`.

### Exemption marker

A comment on the same line or the line above:

```tsx
// radius-exempt: knob
{/* radius-exempt: colour-well */}
borderRadius: props.size / 2, /* radius-exempt: knob */
<!-- radius-exempt: artwork -->
```

Allowed kinds, exactly DIRECTION.md's list: `knob`, `colour-well`, `radio`,
`avatar`, `record-button` (circular by nature); `window`, `system-sheet`,
`launcher-icon-mask` (owned by the operating system); and `artwork` (shapes
drawn on a document or sample artboard, decision D6).

The marker counts only in comment text; the same words inside a string do
nothing. Each marker excuses one violation of `rounded-full`, `raw-radius`,
`radius-arithmetic` or `radius-identifier`: first one on its own line, then
one on the next line. Two rounded views on one line need two markers. A marker
never excuses `rounded-lg` and larger, arbitrary or dynamic classes, or radius
variables, and a marker left with nothing to excuse fails as
`exemption-unused`.

## Before, by package

| Package | Count | Rules |
| --- | --- | --- |
| `packages/studio-workspace` | 41 | 12 rounded-arbitrary, 19 raw-radius, 6 radius-arithmetic, 4 token-definition |
| `apps/studio-preview` | 20 | 9 rounded-arbitrary, 11 raw-radius |
| `apps/example` | 12 | 5 rounded-arbitrary, 7 raw-radius |
| `apps/forge-audio-lab` | 2 | 2 radius-variable |
| `apps/forge-media-lab` | 2 | 2 radius-variable |

Lines in the Migrated section are at the base commit `dab27e1`. Lines in the
later sections are at this commit.

## Migrated

### Controls and inner views, to `sm` (value unchanged at 4 px)

Studio shell, shared by every studio (`packages/studio-workspace`):

- `src/index.tsx:115` (x2), `:153` (x2), `:172`: rail buttons, segmented control, dock TabBar. `rounded-[4px]` to `rounded-sm`.
- `src/text-editor.tsx:29`, `:155` (Quill): toolbar controls, banner. `rounded-[4px]` to `rounded-sm`.
- `src/prism-editor.tsx:205`, `:224`, `:255`, `:454`, `:455` (Prism): tool buttons, layer count badge, empty-state action, feedback banner and retry button. `rounded-[4px]` to `rounded-sm`, `cornerRadius: 4` to `forgeRadius.sm`.
- `src/prism-canvas.tsx:97` (Prism): Cancel move button.
- `src/persona-composer.tsx:313`, `:314`, `:358`, `:389`, `:399`, `:406` (Prism personas): composer buttons.
- `src/stage.tsx:63` (Cadence, Splice): clip inside a track lane.
- `src/stage.tsx:85` (Motion): layer row.
- `src/stage.tsx:96` (Design): node row, 3 px to 4 px.

Apps:

- `apps/studio-preview/src/main.tsx:85`, `:100`, `:116`, `:139`, `:212`: export buttons, notice banner, theme toggle.
- `apps/studio-preview/src/composer-lab.tsx:20`, `turret-lab.tsx:84`, `:107`: lab buttons.
- `apps/studio-preview/src/app-launcher.tsx:28`: "Open in this session" badge.
- `apps/studio-preview/src/style.css:60`: preview `select`, `4px` to `var(--radius-sm)`.
- `apps/example/app/editor/[product].tsx:44`, `app/persona-composer.tsx:21`, `app/personas.tsx:24`, `src/persona/persona-turret-host.tsx:64`, `:76`: header and sheet buttons.
- `apps/example/src/persona-capture/PersonaCaptureScreen.tsx:590`: capture button, 8 px to 4 px.

### Outer views and document frames, to `md` (6 px)

- `workspaceScale.radius.panel` moved from 4 to 6 px. Every existing use was
  checked for role: Prism chrome surface, bottom sheet and popover
  (`prism-editor.tsx:221`, `:378`, `:383`), dock panel and floating panel
  (`index.tsx:169`, `:260`), turret-lab chrome and stage (`turret-lab.tsx:61`,
  `:123`), example persona dock, About card and launcher card. All outer.
- `workspaceScale.radius.paper` moved from 2 to 6 px, following the
  "document and canvas frames" row of the rule. This changes the Quill page
  corner. (The turret-lab artboard later moved to `sm`; see the R2 section.)
- `src/stage.tsx:18` (Quill, Photo page), `:29` (Tally sheet), `:105` (Draft
  drawing): 2 or 3 px to `workspaceScale.radius.paper`.
- `apps/studio-preview/src/app-launcher.tsx:23`: launcher app card, 4 px to `forgeRadius.md`; `style.css` `.app-card` at narrow widths to `var(--radius-md)`.
- `apps/studio-preview/src/style.css:60`: preview-controls popover label to `var(--radius-md)`.
- `--radius-card`, the NYC-Tron card radius, is 6 px.

### Inner views that used the outer role

These used `scale.radius.panel` but sit inside an outer view, so they move to
`scale.radius.control` and stay at 4 px:

- `index.tsx:132`: Properties field group inside a dock panel.
- `index.tsx:205`: 32 to 38 px studio mark in the header.
- `persona-composer.tsx:370`: preview section inside the composer.

### Hairlines

- `persona-turret.tsx:365`: 6 x 2 px committed tick, 1 px to `forgeHairlineRadius.tick`.
- `prism-editor.tsx:340`: 1.5 px dial needle in the persona button, 0.75 px to `forgeHairlineRadius.needle`.

### Per-app radius variables

- `apps/forge-audio-lab/global.css:19-20` and `apps/forge-media-lab/global.css:19-20`
  defined `--radius-control: 8px` and `--radius-card: 12px`. Removed; both labs
  import `packages/studio-workspace/src/radius.css`. Compiling each lab's
  `global.css` through its Uniwind Metro transformer now gives
  `rounded-control` 4 and `rounded-card` 6.

### Marked exemptions

- `persona-turret.tsx:402`: focus ring around the turret dial. `knob`.
- `turret-motion.tsx:48`, `turret-motion.native.tsx:46`: pulse ring around the turret dial. `knob`.
- `prism-editor.tsx:339`: 16 px dial glyph on the persona button, a miniature of the turret knob. `knob`.
- `apps/example/app/_layout.tsx:16`: `sheetCornerRadius` on the persona `formSheet`, a system sheet. `system-sheet`. The value stays 4.

## Resolved by decision D6

The owner added the `artwork` exemption to DIRECTION.md and asked for token
fixes for the rest.

| Location | Was | Now |
| --- | --- | --- |
| `packages/studio-workspace/src/stage.tsx:49` | ellipse layers as `borderRadius: 9999` | Marked `radius-exempt: artwork`. The shape projection draws the user's shapes. |
| `apps/studio-preview/src/turret-lab.tsx:77` | `'50%'` ellipse on the sample artboard | Marked `radius-exempt: artwork`. |
| `apps/studio-preview/src/style.css:48` | 5 px status dot at `50%` | Square. The radius is removed; 4 px on a 5 px dot would still read as a circle. |
| `packages/studio-workspace/src/persona-turret.tsx:476` | dial pointer with `1.5k` ends | Square ends, radius removed. The pointer is drawn as a slot milled into the dial face. |
| `packages/studio-workspace/src/prism-editor.tsx:446` | selection ring at `control + 2` round a 4 px swatch | Prism's fill swatches are circular colour wells: the 25 px swatch and its 33 px ring are both `rounded-full`, each with `radius-exempt: colour-well` (lines 447 and 449). An earlier attempt drew the ring as an outline offset 2 px from a 4 px swatch; an outline's corner grows by its offset, so that ring rendered at about 8 px, above `md`. |

## R2 review fixes

- `examples/native-cadence/App.tsx`: the lab is its own pnpm workspace and
  does not depend on `@nitro-forge/studio-workspace`, so it imports
  `forgeRadius` from `../../packages/studio-workspace/src/theme.ts` (line 28),
  and `metro.config.js` adds `packages/studio-workspace` to `watchFolders`.
  `theme.ts` has no imports of its own. By role: the segment style (`:199`) and
  the two segment views (`:299`, `:377`) were 4 px and 9 px and are now `sm`;
  the six 12 px cards (`:217`, `:251`, `:256`, `:261`, `:274`, `:280`) are now
  `md`.
- `packages/studio-workspace/src/nyc-tron-host.tsx:48`: the Button adapter
  forwarded `cornerRadius` unchanged. `cornerRadius` is now typed
  `ForgeRadiusValue` (4 or 6, from `theme.ts`), and the adapter maps it to
  `forgeRadius.md` or `forgeRadius.sm`, so only a token reaches the style.
- `packages/studio-workspace/src/persona-turret.tsx:429`: the dial face,
  `borderRadius: R`, is the turret knob. Marked `radius-exempt: knob`.
- `apps/studio-preview/src/turret-lab.tsx:76`: the sample rectangle on the
  artboard is artwork and is now square (`0`).
- Turret-lab nesting: the artboard (`:75`) sat at `md` inside the `md` lab
  stage (`:123`). The lab stage keeps `md` because it is the outer view on the
  lab page, and the artboard moves to `sm` (`scale.radius.control`). The
  nesting rule fixes the order: a view inside a `rounded-md` view is
  `rounded-sm` or square. The document-frame row still applies to frames that
  are outer views, such as the Quill page.
- Tailwind's default radius scale is not reset. The `@nyc-tron/ui` dist
  recipes use bare `rounded` and `rounded-full`, which come from Tailwind's
  defaults, so a reset would change Tron components.

## Flagged by role, not by the checker

These use a token, so the checker passes them, but their role is unclear:

- `index.tsx:203`: in canvas studios the header floats with a margin and a
  shadow. It uses `control` (4 px). If a floating header counts as an outer
  view it should be `panel` (6 px).
- `index.tsx:271`: in canvas studios the status line floats over the canvas
  with a shadow, like a toast. Toasts are outer (`md`); it uses `control`.
- NYC-Tron recipes under `node_modules/@nyc-tron/*/dist` use `rounded-full`
  and bare `rounded`. They are dependencies, so the checker does not scan them;
  a Tron-side review belongs to that repository.
