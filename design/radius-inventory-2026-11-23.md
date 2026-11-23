# Radius inventory, 2026-11-23

Scope: the radius rule in [DIRECTION.md](DIRECTION.md) ("Owner brief and view
radius rule"), checked by `tooling/check-radius.mjs` over the TS, TSX, JS and
CSS sources of `packages/*` and `apps/*`. Base commit `dab27e1`.

This is a call-site inventory of radius values. It is not the view-by-view
inventory per studio that F8 asks for, and it records no captures, rendered
review or critique. Native Swift, Kotlin and C++ sources are not scanned.

## Result

| | Violations |
| --- | --- |
| Before (base commit, checker run against an export of `HEAD`) | 77 (73 call sites, 4 token-definition) |
| After this change | 5 |

`node tooling/check-radius.mjs` ends with `check-radius: 5 violation(s) in 222 files`
and exits 1. `validate:v1` therefore fails at the radius step until the five
items below are decided.

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
| `token-definition` | `theme.ts` lacks exactly one `forgeRadius = { sm: 4, md: 6 }`, or a generated sheet lacks `--radius-sm: 4px` / `--radius-md: 6px` |
| `rounded-scale` | `rounded-xs`, `rounded-lg` and larger, with any side or corner prefix (`rounded-t-xl`, `rounded-br-2xl`) |
| `rounded-arbitrary` | `rounded-[...]` |
| `rounded-full` | `rounded-full` without an exemption marker |
| `radius-variable` | a `--radius-*` definition with its own number outside the token files; `var(--radius-x)` naming a variable the token sheets do not define |
| `raw-radius` | a literal radius: `borderRadius: 8`, `borderTopLeftRadius: '50%'`, `cornerRadius={4}`, `sheetCornerRadius: 4`, CSS `border-radius: 4px` |
| `radius-arithmetic` | a radius computed with a number (`scale.radius.control + 2`, `size / 2`) |
| `exemption-kind` | a marker naming a kind DIRECTION.md does not list |

A literal `0` is square and passes. Comments are ignored; strings are checked,
because class names live in strings.

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
```

Allowed kinds, exactly DIRECTION.md's list: `knob`, `colour-well`, `radio`,
`avatar`, `record-button` (circular by nature), and `window`, `system-sheet`,
`launcher-icon-mask` (owned by the operating system). A marker excuses
`rounded-full`, `raw-radius` and `radius-arithmetic` on its line. It never
excuses `rounded-lg` and larger, arbitrary classes or per-app variables.

## Before, by package

| Package | Count | Rules |
| --- | --- | --- |
| `packages/studio-workspace` | 41 | 12 rounded-arbitrary, 19 raw-radius, 6 radius-arithmetic, 4 token-definition |
| `apps/studio-preview` | 20 | 9 rounded-arbitrary, 11 raw-radius |
| `apps/example` | 12 | 5 rounded-arbitrary, 7 raw-radius |
| `apps/forge-audio-lab` | 2 | 2 radius-variable |
| `apps/forge-media-lab` | 2 | 2 radius-variable |

Line numbers below are at the base commit.

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
  corner and the Prism turret-lab artboard.
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

## Remaining (5)

Current line numbers.

| Location | Rule | Studio | Why it was left |
| --- | --- | --- | --- |
| `packages/studio-workspace/src/persona-turret.tsx:476` | radius-arithmetic | Prism personas | Pointer on the dial face, `3k` wide with `1.5k` ends, scaled with the dial. It is a hairline but scales, and the hairline tokens are fixed values. Needs a decision on a scaled hairline token or a square pointer. |
| `packages/studio-workspace/src/prism-editor.tsx:446` | radius-arithmetic | Prism | Selection ring round a fill swatch, `control + 2` (6 px) so it is concentric with the 4 px swatch. As a control it should be `sm`; DIRECTION also names colour wells as circular. Either the swatches become circular colour wells or the ring drops to `sm`. A design call, not a mechanical one. |
| `packages/studio-workspace/src/stage.tsx:49` | radius-arithmetic | Prism | Ellipse layers drawn as `borderRadius: 9999` in the shape projection. This is document content, not chrome, and DIRECTION lists no exemption for artwork. Fix by drawing ellipses with SVG, or by adding an artwork exemption to DIRECTION. |
| `apps/studio-preview/src/turret-lab.tsx:77` | raw-radius | Prism lab | Same case: a circle in the sample artboard, drawn with `'50%'`. |
| `apps/studio-preview/src/style.css:48` | raw-radius | Launcher | 5 px "open" status dot, `50%`. A status dot is not in DIRECTION's circular list (knobs, colour wells, radio buttons, avatars, record buttons). |

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
