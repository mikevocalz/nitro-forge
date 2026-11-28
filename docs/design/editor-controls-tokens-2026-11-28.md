# Editor-controls tokens (2026-11-28)

Under the gate as this branch leaves it, `packages/editor-controls/src` had 2,298 values that
`tooling/codemod/check-no-hardcoded.mjs` reports as hard-coded. Under the gate as it was, the count
was 2,280; [Gate changes](#gate-changes) explains the difference. Each value now reads from a token,
except 21 that are allowlisted with a reason each, in 19 entries. No package or file exemption was
added. Across the repo the gate reports 85 findings, all allowlisted, with 0 violations and 0 stale
entries.

Branch `design/editor-controls-tokens`. It starts from draft PR #91 (`agent-native-20261119`) and
merges draft PR #94 (radius, `claude/blissful-faraday-5jovmd`) first, so the counts below are
measured after that merge. Before PR #94 the parent count was 2,386. PR #94 removed the radius
literals.

## Where the tokens live

editor-controls cannot import studio-workspace, because studio-workspace depends on it. It follows
the pattern `src/radius.ts` already uses for radius: a local copy, plus a check that fails when the
copy drifts.

- `packages/editor-controls/src/tokens.ts` exports:
  - `tokens`, which copies groups and keys of `packages/studio-workspace/src/tokens.ts` with
    identical names and values: spacing, text, leading, borderWidth, fontWeight, opacity and size.
  - `controlTokens`, which holds the few roles the workspace has no token for (see
    [New tokens](#new-tokens)).
- `tooling/check-token-mirror.mjs` (`pnpm check:token-mirror`) fails when any mirrored key is
  missing from studio-workspace or has a different value. `tooling/tests/check-token-mirror.test.mjs`
  covers it, and the radius job in `.github/workflows/v1-readiness.yml` runs both.
- Radius stays in `src/radius.ts`, which mirrors `forgeRadius` and is checked by
  `tooling/check-radius.mjs`.
- Colours and shadows are never values in `tokens.ts`. They are theme classes, so the light theme,
  the dark theme and a host rebrand all reach them. The package contract test also forbids hex
  strings anywhere in `src`.

## Policy

1. **Exact match first.** A literal equal to a token of its role becomes that token. A token
   counts as existing if studio-workspace already names it, including its `off*` steps. Those are
   off-scale values studio-workspace kept by name in PR #91, so reusing them changes nothing that
   renders.
2. **Snap the rest.** A value with no token of its role snaps to the nearest token of that role.
   Ties go to the named workspace steps over the `off*` steps, then to the smaller value. Every snap
   is listed in [Snapped values](#snapped-values) for owner review.
3. **Role comes from the property.**
   - Spacing and sizes: position, padding, margin, gap, width, height, min and max, flexBasis.
   - Type: fontSize.
   - Leading: lineHeight.
   - Border: border and outline widths.
   - Weight: fontWeight.
   - Layer: zIndex.
   - Opacity.
   - Icon: the JSX `size` prop.

   Two sites override their property's role: a text input's font size and a thumbnail's line-height
   ratio.
4. **Opacity by meaning.** An opacity below 1 is a disabled or unavailable state, and takes
   `tokens.opacity.disabled` (0.52, the workspace value). The exception is a decorative mark listed
   in `DECORATIVE_OPACITY` in the codemod, such as a grid line, guide, matte or crosshair. Those take
   `controlTokens.opacity`. `tokens.opacity.scrim` (0.45) is kept for the one backdrop. It is not
   used as a disabled value, even where the old literal was 0.45, because that would tie a disabled
   state to the backdrop token.
5. **Write what the value is.** Some values keep their exact number, written as an expression of a
   token:
   - 0.5 becomes `tokens.borderWidth.hairline / 2`, half a hairline, used to centre a 1 px line.
   - A position or margin that is exactly half a step becomes `<step> / 2`, for example 9 to
     centre an 18 px puck.
   - A circle's radius at a `radius-exempt` site becomes `<diameter token> / 2`.
   - A border wider than the border scale draws a shape (a CSS triangle or a ring), so it takes the
     spacing scale.
6. **New tokens only where no role exists.** Each new token is named by role, not by value.
7. **Only lengths become tokens.** Some literals are not lengths even though the gate reports them
   or a token has the same value. Those stay literals:
   - a unit `1` in a fraction or count: `(1 - t) * length`, `(x + 1) / 2`, `(last - first + 1) * row`;
   - a factor: `LEAD * 2`, or `inner * 2` for a diameter;
   - a percentage: `(t.position * 100) + "%"`;
   - data that is not a style: a probe plot, a normalised crop rect, a document default, or a
     `{start, end}` range.

   The gate stops reporting the unit `1`. The rest are allowlisted.

## Counts

Whole repo, from `node tooling/codemod/check-no-hardcoded.mjs`:

| | Findings | Allowed | Violations | Stale entries |
|---|---:|---:|---:|---:|
| Before (after the PR #94 merge, gate as it was) | 2,345 | 64 | 2,281 | 4 |
| After | 85 | 85 | 0 | 0 |

By package and kind (findings; violations in brackets):

| Package | Kind | Before | After |
|---|---|---:|---:|
| editor-controls | number | 2,259 (2,259) | 21 (0) |
| editor-controls | prop | 16 (16) | 0 |
| editor-controls | colour | 4 (4) | 0 |
| editor-controls | tailwind | 1 (1) | 0 |
| studio-workspace | number | 34 (1) | 33 (0) |
| studio-workspace | prop / colour / offset / tailwind | 20 / 1 / 4 / 1 (0) | 20 / 1 / 4 / 1 (0) |
| audio-ui, media-ui, pitch | prop, number | 5 (0) | 5 (0) |

### Gate changes

The "before" rows use the gate as it was. This branch changes the gate in two ways, both in
`tooling/codemod/lib.mjs`. Neither changes the count in any package except editor-controls.

- **The logical properties are now covered.** `marginStart`, `marginEnd`, `paddingStart`,
  `paddingEnd`, `borderStartWidth` and `borderEndWidth` were missing from `STYLE_PROPS`. With them,
  the gate reports 26 more in editor-controls. `start` and `end` were also tried but left out,
  because waveform and timeline ranges use the same keys (`{start: 0, end: 1}`). The `start`/`end`
  style values that run rewrote keep their tokens of identical value.
- **A unit `1` in a factor is no longer reported.** This is the `1` in `(1 - t) * length`,
  `(x + 1) / 2` or `(n + 1) * row`. It is a fraction or a count, the same reasoning as the existing
  `x / 2` exemption. 8 fewer findings in editor-controls.

Under the final gate, editor-controls goes from 2,298 findings (2,277 number, 16 prop, 4 colour,
1 tailwind) to 21, all allowlisted.

The 4 stale entries were left behind by PR #94, which removed the radius literals they covered. The
merge commit removes them.

Editor-controls before, by property (number kind):

gap 621, height 313, width 264, top 110, opacity 101, paddingHorizontal 98, minHeight 98, padding 88, left 73, fontSize 72, minWidth 71, borderWidth 62, paddingVertical 56, bottom 20, maxHeight 20, lineHeight 19, zIndex 18, borderRadius 18, fontWeight 17, right 14, flexBasis 11, paddingTop 9, borderBottomWidth 9, borderLeftWidth 9, columnGap 8, rowGap 8, marginLeft 7, borderRightWidth 7, marginTop 6, paddingBottom 6, marginHorizontal 6, borderTopWidth 6, maxWidth 4, marginBottom 3, paddingLeft 3, margin 1, paddingRight 1, marginVertical 1, marginRight 1.

Rewrite totals from the codemod (`tooling/codemod/tokenize-editor-controls.mjs --write`):

- The first run rewrote 2,262 literals: 2,062 exact and 200 snapped.
- The run over the logical properties rewrote 40, all exact.
- Code review then put 23 back as literals: 21 exact and 2 snapped. They were fractions, factors,
  percentages and data (rule 7). One of them, the spectrogram marker, was a real rendering bug:
  `(t.position * 100) + "%"` had snapped to 96 percent.
- That leaves 2,279 rewrites: 2,081 exact and 198 snapped. Counting `tokens.ts`, 299 files in
  `packages/editor-controls/src` change. A dry run of the codemod on this branch rewrites 0 and
  skips the 21 allowlisted sites.
- By role, before the review: spacing 1965, opacity 98, border 93, type 70, leading 18, layer 18, radius 18, weight 17, icon 3, override 2.

Hand fixes covered the 4 colours, the 1 Tailwind arbitrary value and 2 opacity sites that were
arithmetic. They also snapped one studio-workspace value, listed below.

## Mapping table

Each token, its value and how many references the rewrite added. "Of which snapped" counts the
references whose old literal differed from the value. Studio-workspace references count too (one
`tokens.spacing.off104`).

### Spacing and sizes: padding, margin, gap, position, width, height, min/max, flexBasis

| Token | Value | References | Of which snapped |
|---|---:|---:|---:|
| `tokens.spacing.off1_5` | 1.5 | 17 | 2 |
| `tokens.spacing.off2` | 2 | 115 | 0 |
| `tokens.spacing.off3` | 3 | 25 | 0 |
| `tokens.spacing.fixedStack` | 4 | 175 | 0 |
| `tokens.spacing.off5` | 5 | 15 | 0 |
| `tokens.spacing.off5_75` | 5.75 | 2 | 2 |
| `tokens.spacing.off6` | 6 | 235 | 0 |
| `tokens.spacing.off7` | 7 | 9 | 0 |
| `tokens.spacing.fixedElement` | 8 | 447 | 5 |
| `tokens.spacing.off10` | 10 | 84 | 0 |
| `tokens.spacing.fixedInset` | 12 | 146 | 2 |
| `tokens.spacing.off14` | 14 | 40 | 0 |
| `tokens.spacing.fixedGroup` | 16 | 71 | 2 |
| `tokens.spacing.off18` | 18 | 19 | 0 |
| `tokens.spacing.off20` | 20 | 29 | 0 |
| `tokens.spacing.off22` | 22 | 30 | 0 |
| `tokens.spacing.fixedSection` | 24 | 28 | 1 |
| `tokens.spacing.off26` | 26 | 3 | 0 |
| `tokens.spacing.fixedStatus` | 28 | 18 | 0 |
| `tokens.spacing.fixedCanvas` | 32 | 13 | 6 |
| `tokens.spacing.off33` | 33 | 11 | 9 |
| `tokens.spacing.off40` | 40 | 8 | 0 |
| `tokens.spacing.fixedTarget` | 44 | 149 | 0 |
| `tokens.spacing.off48` | 48 | 6 | 0 |
| `tokens.spacing.fixedToolbar` | 52 | 13 | 6 |
| `tokens.spacing.fixedHeader` | 60 | 2 | 0 |
| `tokens.spacing.fixedPage` | 64 | 12 | 0 |
| `tokens.spacing.fixedRail` | 72 | 5 | 0 |
| `tokens.spacing.off76` | 76 | 9 | 7 |
| `tokens.spacing.off96` | 96 | 14 | 7 |
| `tokens.spacing.off104` | 104 | 2 | 1 |
| `tokens.spacing.off360` | 360 | 8 | 2 |
| `tokens.spacing.off480` | 480 | 4 | 2 |
| `tokens.spacing.off600` | 600 | 2 | 1 |
| `tokens.spacing.off800` | 800 | 1 | 0 |

### Fixed extents of control parts

| Token | Value | References | Of which snapped |
|---|---:|---:|---:|
| `controlTokens.extent.field` | 88 | 18 | 2 |
| `controlTokens.extent.fieldWide` | 120 | 14 | 5 |
| `controlTokens.extent.column` | 160 | 14 | 5 |
| `controlTokens.extent.previewCompact` | 180 | 16 | 3 |
| `controlTokens.extent.preview` | 240 | 25 | 14 |
| `controlTokens.extent.list` | 320 | 15 | 6 |
| `controlTokens.extent.listTall` | 400 | 6 | 2 |

### Icon size (JSX `size` prop)

| Token | Value | References | Of which snapped |
|---|---:|---:|---:|
| `tokens.size.iconXs` | 12 | 1 | 0 |
| `tokens.size.iconSm` | 16 | 2 | 0 |

### Type: fontSize (and lineHeight where the leading group has no step)

| Token | Value | References | Of which snapped |
|---|---:|---:|---:|
| `tokens.text.off9` | 9 | 1 | 0 |
| `tokens.text.micro` | 10 | 4 | 0 |
| `tokens.text.off11` | 11 | 18 | 0 |
| `tokens.text.label` | 12 | 17 | 0 |
| `tokens.text.off13` | 13 | 11 | 0 |
| `tokens.text.body` | 14 | 13 | 0 |
| `tokens.text.off15` | 15 | 16 | 12 |
| `tokens.text.title` | 20 | 4 | 3 |
| `tokens.text.off22` | 22 | 2 | 2 |
| `tokens.text.display` | 32 | 2 | 2 |

### Type role: text inputs

| Token | Value | References | Of which snapped |
|---|---:|---:|---:|
| `controlTokens.type.input` | 16 | 1 | 0 |

### Leading as a multiple of a computed font size

| Token | Value | References | Of which snapped |
|---|---:|---:|---:|
| `controlTokens.leadingRatio.thumbnail` | 1.2 | 1 | 0 |

### Border and outline widths

| Token | Value | References | Of which snapped |
|---|---:|---:|---:|
| `tokens.borderWidth.hairline` | 1 | 118 | 0 |
| `tokens.borderWidth.off1_5` | 1.5 | 7 | 0 |
| `tokens.borderWidth.strong` | 2 | 48 | 0 |
| `tokens.borderWidth.off3` | 3 | 7 | 0 |

### Font weight

| Token | Value | References | Of which snapped |
|---|---:|---:|---:|
| `tokens.fontWeight.medium` | 500 | 1 | 0 |
| `tokens.fontWeight.semibold` | 600 | 11 | 0 |
| `tokens.fontWeight.bold` | 700 | 5 | 1 |

### Opacity

| Token | Value | References | Of which snapped |
|---|---:|---:|---:|
| `controlTokens.opacity.faint` | 0.35 | 8 | 3 |
| `tokens.opacity.scrim` | 0.45 | 1 | 0 |
| `tokens.opacity.disabled` | 0.52 | 74 | 74 |
| `controlTokens.opacity.muted` | 0.6 | 13 | 5 |
| `controlTokens.opacity.strong` | 0.9 | 4 | 1 |

### Stacking (zIndex) inside one control

| Token | Value | References | Of which snapped |
|---|---:|---:|---:|
| `controlTokens.layer.resting` | 1 | 4 | 0 |
| `controlTokens.layer.lifted` | 2 | 5 | 0 |
| `controlTokens.layer.guide` | 3 | 3 | 0 |
| `controlTokens.layer.ghost` | 4 | 1 | 0 |
| `controlTokens.layer.indicator` | 5 | 2 | 0 |
| `controlTokens.layer.handle` | 6 | 1 | 0 |
| `controlTokens.layer.floating` | 10 | 2 | 0 |

## New tokens

These are `controlTokens` in `packages/editor-controls/src/tokens.ts`. No workspace token has their
role, so each is named by role and used only in editor-controls.

| Token | Value | Why it exists |
|---|---|---|
| `layer.resting`, `lifted`, `guide`, `ghost`, `indicator`, `handle`, `floating` | 1, 2, 3, 4, 5, 6, 10 | zIndex inside one control: a selection lifted over its siblings, a guide over the canvas, a drag ghost, a drop indicator, a resize handle, a popover. The workspace `z` layers order whole chrome regions and must not be compared with these, so they get their own group. The values are the ones already in use. |
| `opacity.faint`, `muted`, `strong` | 0.35, 0.6, 0.9 | Emphasis of decorative marks such as grid lines, guides, mattes and crosshairs. The workspace has opacity tokens only for disabled (0.52) and scrim (0.45). The three values are the most common ones among the decorative sites. |
| `type.input` | 16 | Font size of a text input. A smaller size makes iOS Safari zoom the page when the field takes focus ([CSS-Tricks](https://css-tricks.com/16px-or-larger-text-prevents-ios-form-zoom/), [Defensive CSS](https://defensivecss.dev/tip/input-zoom-safari/)). The workspace type scale has no 16, and snapping to 15 would bring the zoom back. Used at `audio/PluginPresetBrowser.tsx`. |
| `leadingRatio.thumbnail` | 1.2 | Line height as a multiple of a font size computed from the thumbnail scale, in `slides/SlideThumbnail.tsx`. It is a ratio, not a length, so no leading token fits. |
| `extent.field`, `fieldWide`, `column`, `previewCompact`, `preview`, `list`, `listTall` | 88, 120, 160, 180, 240, 320, 400 | Fixed widths and heights of control parts the spacing scale does not reach: value fields, inspector columns, preview panes and list viewports. Without them, dozens of distinct values between 80 and 440 would snap to `off76`, `off96`, `off104` or `off360` and change size by up to 120 px. The 7 steps are the most common values in that range. |

## Snapped values

198 snaps from the codemod and 5 from hand fixes, for owner review.

### Hand fixes

| Site | Old | New | Notes |
|---|---|---|---|
| `packages/studio-workspace/src/prism-editor.tsx:260`, minWidth of the blend-mode menu button | 132 | `tokens.spacing.off104` (104) | studio-workspace has no step between 104 and 360. It is a minimum width, so a longer label still widens the button. |
| `devices/DevicePairingDialog.tsx`, backdrop | `rgba(0,0,0,0.5)` | absolutely placed `bg-black` view at `tokens.opacity.scrim` (0.45) | The workspace scrim opacity, behind the dialog content. |
| `layers/CanvasCompareView.tsx`, divider handle | `boxShadow: "0 1px 3px rgba(0,0,0,0.25)"` | `shadow-sm` class (styled only) | The Tailwind default theme's `--shadow-sm`: `0 1px 3px 0 rgb(0 0 0 / 0.1), 0 1px 2px -1px rgb(0 0 0 / 0.1)` ([Tailwind box-shadow](https://tailwindcss.com/docs/box-shadow)). NYC-Tron already uses `shadow-md` and `shadow-lg`, and every host that imports `tailwindcss` has these. The forge `shadow-float-*` tokens were not used, because the lab hosts do not import the forge theme. |
| `layers/CanvasCompareView.tsx`, label chip | `boxShadow: "0 4px 12px rgba(0,0,0,0.18)"` | `shadow-md` class (styled only) | `--shadow-md`: `0 4px 6px -1px rgb(0 0 0 / 0.1), 0 2px 4px -2px rgb(0 0 0 / 0.1)`. |
| `photo/PhotoBrushSurface.tsx`, brush stroke preview | `rgba(80,180,255,0.5)` | `bg-accent` at `controlTokens.opacity.muted` (0.6) | Colour changes from a fixed light blue to the theme accent, which exists in light and dark. |

These hand fixes keep their exact value and are not snaps:

- `spreadsheet/SheetTabs.tsx` changes `border-b-[3px]` to `border-b-3`. With Tailwind 4.3.5, both
  compile to `border-bottom-width: 3px` ([Tailwind border-width](https://tailwindcss.com/docs/border-width)).
- `color/SVColorField.tsx` replaces 48 literal gradient-strip centres with
  `STRIP_CENTRES = Array.from({ length: 48 }, (_, i) => (i + 0.5) / 48)`, which gives the same
  values.
- `CanvasCompareView` `end: 12` becomes `tokens.spacing.fixedInset`.

### Summary of codemod snaps

The most visible group is the disabled opacity: 0.45, 0.4, 0.3, 0.5, 0.55 and 0.6 all become the
workspace's 0.52 (74 sites). Disabled controls now dim by the same amount everywhere.

| Old | New | Token | Sites |
|---:|---:|---|---:|
| 0.45 | 0.52 | `tokens.opacity.disabled` | 50 |
| 220 | 240 | `controlTokens.extent.preview` | 9 |
| 16 | 15 | `tokens.text.off15` | 9 |
| 0.4 | 0.52 | `tokens.opacity.disabled` | 7 |
| 80 | 76 | `tokens.spacing.off76` | 7 |
| 300 | 320 | `controlTokens.extent.list` | 6 |
| 30 | 32 | `tokens.spacing.fixedCanvas` | 6 |
| 56 | 52 | `tokens.spacing.fixedToolbar` | 6 |
| 100 | 96 | `tokens.spacing.off96` | 6 |
| 9 | 8 | `tokens.spacing.fixedElement` | 5 |
| 36 | 33 | `tokens.spacing.off33` | 5 |
| .5 | 0.52 | `tokens.opacity.disabled` | 4 |
| 0.3 | 0.52 | `tokens.opacity.disabled` | 4 |
| 0.5 | 0.52 | `tokens.opacity.disabled` | 4 |
| 34 | 33 | `tokens.spacing.off33` | 4 |
| 140 | 120 | `controlTokens.extent.fieldWide` | 3 |
| 280 | 240 | `controlTokens.extent.preview` | 3 |
| 0.7 | 0.6 | `controlTokens.opacity.muted` | 3 |
| 0.6 | 0.52 | `tokens.opacity.disabled` | 3 |
| 17 | 15 | `tokens.text.off15` | 3 |
| 144 | 160 | `controlTokens.extent.column` | 2 |
| 150 | 160 | `controlTokens.extent.column` | 2 |
| 90 | 88 | `controlTokens.extent.field` | 2 |
| 132 | 120 | `controlTokens.extent.fieldWide` | 2 |
| 420 | 400 | `controlTokens.extent.listTall` | 2 |
| 260 | 240 | `controlTokens.extent.preview` | 2 |
| 200 | 180 | `controlTokens.extent.previewCompact` | 2 |
| 0.4 | 0.35 | `controlTokens.opacity.faint` | 2 |
| 0.5 | 0.6 | `controlTokens.opacity.muted` | 2 |
| 0.55 | 0.52 | `tokens.opacity.disabled` | 2 |
| 1.6 | 1.5 | `tokens.spacing.off1_5` | 2 |
| 17 | 16.5 | `tokens.spacing.off33 / 2` | 2 |
| 380 | 360 | `tokens.spacing.off360` | 2 |
| 5.5 | 5.75 | `tokens.spacing.off5_75` | 2 |
| 18 | 20 | `tokens.text.title` | 2 |
| 156 | 160 | `controlTokens.extent.column` | 1 |
| 176 | 180 | `controlTokens.extent.previewCompact` | 1 |
| 0.45 | 0.35 | `controlTokens.opacity.faint` | 1 |
| 0.85 | 0.9 | `controlTokens.opacity.strong` | 1 |
| 800 | 700 | `tokens.fontWeight.bold` | 1 |
| 15 | 16 | `tokens.spacing.fixedCanvas / 2` | 1 |
| 15 | 16 | `tokens.spacing.fixedGroup` | 1 |
| 17 | 16 | `tokens.spacing.fixedGroup` | 1 |
| 11 | 12 | `tokens.spacing.fixedInset` | 1 |
| 13 | 12 | `tokens.spacing.fixedInset` | 1 |
| 23 | 24 | `tokens.spacing.fixedSection` | 1 |
| 112 | 104 | `tokens.spacing.off104` | 1 |
| 440 | 480 | `tokens.spacing.off480` | 1 |
| 460 | 480 | `tokens.spacing.off480` | 1 |
| 640 | 600 | `tokens.spacing.off600` | 1 |
| 92 | 96 | `tokens.spacing.off96` | 1 |
| 30 | 32 | `tokens.text.display` | 1 |
| 34 | 32 | `tokens.text.display` | 1 |
| 24 | 22 | `tokens.text.off22` | 1 |
| 25 | 22 | `tokens.text.off22` | 1 |
| 21 | 20 | `tokens.text.title` | 1 |

### Every codemod snap

Line numbers are in this branch's files.

| File (packages/editor-controls/src) | Line | Property | Old | New | Token | Why |
|---|---:|---|---:|---:|---|---|
| audio/AudioInterruptionRecoveryDialog.tsx | 32 | maxWidth | 460 | 480 | `tokens.spacing.off480` | nearest spacing step |
| audio/AutomationLane.tsx | 207 | opacity | 0.5 | 0.6 | `controlTokens.opacity.muted` | bar line against beat lines |
| audio/AutomationLane.tsx | 232 | opacity | 0.45 | 0.52 | `tokens.opacity.disabled` | disabled or unavailable state |
| audio/AutomationLane.tsx | 235 | lineHeight | 16 | 15 | `tokens.text.off15` | nearest leading step |
| audio/AutomationLane.tsx | 255 | opacity | 0.45 | 0.52 | `tokens.opacity.disabled` | disabled or unavailable state |
| audio/BusAndRoutingMatrix.tsx | 246 | opacity | 0.45 | 0.52 | `tokens.opacity.disabled` | disabled or unavailable state |
| audio/BusAndRoutingMatrix.tsx | 316 | opacity | 0.45 | 0.52 | `tokens.opacity.disabled` | disabled or unavailable state |
| audio/BusAndRoutingMatrix.tsx | 369 | opacity | 0.45 | 0.52 | `tokens.opacity.disabled` | disabled or unavailable state |
| audio/ChannelStrip.tsx | 158 | gap | 9 | 8 | `tokens.spacing.fixedElement` | nearest spacing step |
| audio/DynamicsTransferGraph.tsx | 228 | opacity | 0.5 | 0.6 | `controlTokens.opacity.muted` | unity reference line |
| audio/DynamicsTransferGraph.tsx | 230 | opacity | 0.3 | 0.52 | `tokens.opacity.disabled` | disabled or unavailable state |
| audio/DynamicsTransferGraph.tsx | 264 | opacity | 0.55 | 0.52 | `tokens.opacity.disabled` | disabled or unavailable state |
| audio/DynamicsTransferGraph.tsx | 280 | opacity | 0.45 | 0.52 | `tokens.opacity.disabled` | disabled or unavailable state |
| audio/DynamicsTransferGraph.tsx | 284 | lineHeight | 16 | 15 | `tokens.text.off15` | nearest leading step |
| audio/DynamicsTransferGraph.tsx | 289 | opacity | 0.45 | 0.52 | `tokens.opacity.disabled` | disabled or unavailable state |
| audio/DynamicsTransferGraph.tsx | 300 | lineHeight | 16 | 15 | `tokens.text.off15` | nearest leading step |
| audio/EQFrequencyGraph.tsx | 176 | opacity | 0.55 | 0.52 | `tokens.opacity.disabled` | disabled or unavailable state |
| audio/EQFrequencyGraph.tsx | 191 | opacity | 0.45 | 0.35 | `controlTokens.opacity.faint` | minor frequency grid line |
| audio/EQFrequencyGraph.tsx | 197 | top | 15 | 16 | `tokens.spacing.fixedGroup` | nearest spacing step |
| audio/EQFrequencyGraph.tsx | 198 | opacity | 0.3 | 0.52 | `tokens.opacity.disabled` | disabled or unavailable state |
| audio/EQFrequencyGraph.tsx | 256 | minWidth | 56 | 52 | `tokens.spacing.fixedToolbar` | nearest spacing step |
| audio/EQFrequencyGraph.tsx | 257 | lineHeight | 16 | 15 | `tokens.text.off15` | nearest leading step |
| audio/EQFrequencyGraph.tsx | 395 | lineHeight | 16 | 15 | `tokens.text.off15` | nearest leading step |
| audio/InsertEffectRack.tsx | 147 | opacity | 0.45 | 0.52 | `tokens.opacity.disabled` | disabled or unavailable state |
| audio/InsertEffectRack.tsx | 211 | opacity | 0.45 | 0.52 | `tokens.opacity.disabled` | disabled or unavailable state |
| audio/InsertEffectRack.tsx | 228 | opacity | 0.45 | 0.52 | `tokens.opacity.disabled` | disabled or unavailable state |
| audio/InsertEffectRack.tsx | 233 | opacity | 0.3 | 0.52 | `tokens.opacity.disabled` | disabled or unavailable state |
| audio/InsertEffectRack.tsx | 238 | opacity | 0.3 | 0.52 | `tokens.opacity.disabled` | disabled or unavailable state |
| audio/InsertEffectRack.tsx | 242 | opacity | 0.45 | 0.52 | `tokens.opacity.disabled` | disabled or unavailable state |
| audio/LevelFader.tsx | 223 | opacity | 0.45 | 0.52 | `tokens.opacity.disabled` | disabled or unavailable state |
| audio/LevelFader.tsx | 259 | opacity | 0.45 | 0.52 | `tokens.opacity.disabled` | disabled or unavailable state |
| audio/LevelFader.vertical.tsx | 54 | opacity | .5 | 0.52 | `tokens.opacity.disabled` | disabled or unavailable state |
| audio/LoudnessMeter.tsx | 121 | minWidth | 132 | 120 | `controlTokens.extent.fieldWide` | nearest spacing step |
| audio/LoudnessMeter.tsx | 121 | flexBasis | 132 | 120 | `controlTokens.extent.fieldWide` | nearest spacing step |
| audio/LoudnessMeter.tsx | 124 | fontSize | 16 | 15 | `tokens.text.off15` | nearest type step |
| audio/LoudnessMeter.tsx | 192 | flexBasis | 80 | 76 | `tokens.spacing.off76` | nearest spacing step |
| audio/LoudnessMeter.tsx | 193 | flexBasis | 80 | 76 | `tokens.spacing.off76` | nearest spacing step |
| audio/LoudnessMeter.tsx | 194 | flexBasis | 80 | 76 | `tokens.spacing.off76` | nearest spacing step |
| audio/LoudnessMeter.tsx | 212 | minWidth | 150 | 160 | `controlTokens.extent.column` | nearest spacing step |
| audio/LoudnessMeter.tsx | 216 | fontSize | 30 | 32 | `tokens.text.display` | nearest type step |
| audio/LoudnessMeter.tsx | 216 | lineHeight | 34 | 32 | `tokens.text.display` | nearest leading step |
| audio/LoudnessMeter.tsx | 225 | flexBasis | 280 | 240 | `controlTokens.extent.preview` | nearest spacing step |
| audio/MixGroupBar.tsx | 90 | opacity | 0.45 | 0.52 | `tokens.opacity.disabled` | disabled or unavailable state |
| audio/MixGroupBar.tsx | 101 | minWidth | 56 | 52 | `tokens.spacing.fixedToolbar` | nearest spacing step |
| audio/MixGroupBar.tsx | 101 | maxWidth | 140 | 120 | `controlTokens.extent.fieldWide` | nearest spacing step |
| audio/PanControl.tsx | 187 | opacity | 0.45 | 0.52 | `tokens.opacity.disabled` | disabled or unavailable state |
| audio/PluginPresetBrowser.tsx | 128 | opacity | 0.45 | 0.52 | `tokens.opacity.disabled` | disabled or unavailable state |
| audio/PluginPresetBrowser.tsx | 149 | opacity | 0.45 | 0.52 | `tokens.opacity.disabled` | disabled or unavailable state |
| audio/SoloMuteButtons.tsx | 89 | opacity | 0.45 | 0.52 | `tokens.opacity.disabled` | disabled or unavailable state |
| audio/TempoAndMetronome.tsx | 120 | opacity | 0.45 | 0.52 | `tokens.opacity.disabled` | disabled or unavailable state |
| cad/BakingMapPanel.tsx | 13 | height | 260 | 240 | `controlTokens.extent.preview` | nearest spacing step |
| cad/DimensionsAndHatching.tsx | 12 | height | 260 | 240 | `controlTokens.extent.preview` | nearest spacing step |
| cad/Native3DViewport.tsx | 29 | height | 420 | 400 | `controlTokens.extent.listTall` | nearest spacing step |
| cad/PBRMaterialInspector.tsx | 7 | height | 220 | 240 | `controlTokens.extent.preview` | nearest spacing step |
| cad/PaperSpaceLayout.tsx | 14 | height | 300 | 320 | `controlTokens.extent.list` | nearest spacing step |
| cad/ParametricConstraintEditor.tsx | 12 | height | 220 | 240 | `controlTokens.extent.preview` | nearest spacing step |
| cad/TextureBrush3D.tsx | 25 | height | 380 | 360 | `tokens.spacing.off360` | nearest spacing step |
| cad/TextureMaskAndGenerator.tsx | 10 | height | 220 | 240 | `controlTokens.extent.preview` | nearest spacing step |
| canvas-tools/ColorDropCanvasTarget.tsx | 228 | opacity | 0.5 | 0.52 | `tokens.opacity.disabled` | disabled or unavailable state |
| canvas-tools/ColorDropCanvasTarget.tsx | 229 | width | 34 | 33 | `tokens.spacing.off33` | nearest spacing step |
| canvas-tools/ColorDropCanvasTarget.tsx | 229 | height | 34 | 33 | `tokens.spacing.off33` | nearest spacing step |
| canvas-tools/ColorDropCanvasTarget.tsx | 229 | borderRadius | 17 | 16.5 | `tokens.spacing.off33 / 2` | circle radius from the nearest diameter step |
| canvas-tools/ReferenceImageBoard.tsx | 251 | opacity | 0.45 | 0.52 | `tokens.opacity.disabled` | disabled or unavailable state |
| canvas-tools/ReferenceImageBoard.tsx | 325 | fontSize | 18 | 20 | `tokens.text.title` | nearest type step |
| canvas/AlignDistributePanel.tsx | 159 | opacity | 0.45 | 0.52 | `tokens.opacity.disabled` | disabled or unavailable state |
| canvas/SmartGuides.tsx | 50 | top | 5.5 | 5.75 | `tokens.spacing.off5_75` | nearest spacing step |
| canvas/SmartGuides.tsx | 50 | left | 5.5 | 5.75 | `tokens.spacing.off5_75` | nearest spacing step |
| canvas/SnapGridOverlay.tsx | 44 | opacity | 0.4 | 0.35 | `controlTokens.opacity.faint` | grid lines (major strong, minor faint) |
| canvas/SnapGridOverlay.tsx | 46 | opacity | 0.4 | 0.35 | `controlTokens.opacity.faint` | grid lines (major strong, minor faint) |
| canvas/TransformOriginHandle.tsx | 145 | opacity | 0.5 | 0.52 | `tokens.opacity.disabled` | disabled or unavailable state |
| canvas/TransformOriginHandle.tsx | 153 | width | 220 | 240 | `controlTokens.extent.preview` | nearest spacing step |
| color/ChannelTrack.tsx | 119 | opacity | 0.45 | 0.52 | `tokens.opacity.disabled` | disabled or unavailable state |
| color/ColorDiscPicker.tsx | 123 | opacity | 0.45 | 0.52 | `tokens.opacity.disabled` | disabled or unavailable state |
| color/ColorHarmonyAssistant.tsx | 74 | fontSize | 24 | 22 | `tokens.text.off22` | nearest type step |
| color/ColorPickerDialog.tsx | 175 | maxWidth | 440 | 480 | `tokens.spacing.off480` | nearest spacing step |
| color/ColorWheel.tsx | 105 | opacity | 0.45 | 0.52 | `tokens.opacity.disabled` | disabled or unavailable state |
| color/GamutWarning.tsx | 21 | minWidth | 100 | 96 | `tokens.spacing.off96` | nearest spacing step |
| color/HsvPicker.tsx | 150 | opacity | 0.45 | 0.52 | `tokens.opacity.disabled` | disabled or unavailable state |
| color/HsvPicker.tsx | 158 | opacity | 0.45 | 0.52 | `tokens.opacity.disabled` | disabled or unavailable state |
| color/HsvPicker.tsx | 190 | opacity | 0.45 | 0.52 | `tokens.opacity.disabled` | disabled or unavailable state |
| color/HsvPicker.tsx | 214 | opacity | 0.45 | 0.52 | `tokens.opacity.disabled` | disabled or unavailable state |
| design/DevHandoffInspector.tsx | 11 | height | 220 | 240 | `controlTokens.extent.preview` | nearest spacing step |
| design/FlowOverview.tsx | 12 | height | 300 | 320 | `controlTokens.extent.list` | nearest spacing step |
| design/VariablesAndModes.tsx | 18 | height | 220 | 240 | `controlTokens.extent.preview` | nearest spacing step |
| document/LayoutSpreadNavigator.tsx | 20 | height | 420 | 400 | `controlTokens.extent.listTall` | nearest spacing step |
| document/LayoutSpreadNavigator.tsx | 20 | minWidth | 100 | 96 | `tokens.spacing.off96` | nearest spacing step |
| document/NavigationOutline.tsx | 120 | fontSize | 16 | 15 | `tokens.text.off15` | nearest type step |
| document/NavigationOutline.tsx | 130 | minWidth | 56 | 52 | `tokens.spacing.fixedToolbar` | nearest spacing step |
| document/ParagraphRuler.tsx | 27 | height | 176 | 180 | `controlTokens.extent.previewCompact` | nearest spacing step |
| document/RichTextRibbon.tsx | 56 | fontWeight | 800 | 700 | `tokens.fontWeight.bold` | nearest weight |
| document/RichTextRibbon.tsx | 113 | fontSize | 17 | 15 | `tokens.text.off15` | nearest type step |
| document/RichTextRibbon.tsx | 121 | fontSize | 17 | 15 | `tokens.text.off15` | nearest type step |
| document/RichTextRibbon.tsx | 161 | opacity | 0.45 | 0.52 | `tokens.opacity.disabled` | disabled or unavailable state |
| ink/InkToolbar.tsx | 130 | width | 92 | 96 | `tokens.spacing.off96` | nearest spacing step |
| ink/InkToolbar.tsx | 214 | opacity | 0.45 | 0.52 | `tokens.opacity.disabled` | disabled or unavailable state |
| ink/InkToolbar.tsx | 233 | fontSize | 18 | 20 | `tokens.text.title` | nearest type step |
| ink/InkToolbar.tsx | 261 | width | 34 | 33 | `tokens.spacing.off33` | nearest spacing step |
| ink/InkToolbar.tsx | 261 | height | 34 | 33 | `tokens.spacing.off33` | nearest spacing step |
| ink/InkToolbar.tsx | 261 | borderRadius | 17 | 16.5 | `tokens.spacing.off33 / 2` | circle radius from the nearest diameter step |
| ink/InkToolbar.tsx | 263 | width | 30 | 32 | `tokens.spacing.fixedCanvas` | nearest spacing step |
| ink/InkToolbar.tsx | 263 | height | 30 | 32 | `tokens.spacing.fixedCanvas` | nearest spacing step |
| ink/InkToolbar.tsx | 263 | borderRadius | 15 | 16 | `tokens.spacing.fixedCanvas / 2` | circle radius from the nearest diameter step |
| inputs/AssetPresetGallery.tsx | 23 | height | 380 | 360 | `tokens.spacing.off360` | nearest spacing step |
| inputs/InstrumentKnob.tsx | 96 | opacity | 0.45 | 0.52 | `tokens.opacity.disabled` | disabled or unavailable state |
| inputs/InstrumentKnob.tsx | 104 | opacity | 0.45 | 0.52 | `tokens.opacity.disabled` | disabled or unavailable state |
| inputs/InstrumentKnob.tsx | 114 | opacity | 0.45 | 0.52 | `tokens.opacity.disabled` | disabled or unavailable state |
| inputs/InstrumentXYPad.tsx | 77 | opacity | 0.45 | 0.52 | `tokens.opacity.disabled` | disabled or unavailable state |
| inputs/InstrumentXYPad.tsx | 103 | opacity | 0.45 | 0.52 | `tokens.opacity.disabled` | disabled or unavailable state |
| inputs/PointEditor2D.tsx | 32 | height | 280 | 240 | `controlTokens.extent.preview` | nearest spacing step |
| layers/CanvasCompareView.tsx | 237 | minHeight | 200 | 180 | `controlTokens.extent.previewCompact` | nearest spacing step |
| layers/ClippingMaskControls.tsx | 90 | height | 13 | 12 | `tokens.spacing.fixedInset` | nearest spacing step |
| layers/ClippingMaskControls.tsx | 91 | left | 1.6 | 1.5 | `tokens.spacing.off1_5` | nearest spacing step |
| layers/ClippingMaskControls.tsx | 92 | right | 1.6 | 1.5 | `tokens.spacing.off1_5` | nearest spacing step |
| layers/LayerStack.tsx | 120 | minWidth | 80 | 76 | `tokens.spacing.off76` | nearest spacing step |
| layers/LayerStack.tsx | 292 | opacity | 0.45 | 0.52 | `tokens.opacity.disabled` | disabled or unavailable state |
| layers/LayerStack.tsx | 396 | width | 300 | 320 | `controlTokens.extent.list` | nearest spacing step |
| layers/LayerStack.tsx | 432 | opacity | 0.45 | 0.52 | `tokens.opacity.disabled` | disabled or unavailable state |
| layers/LayerThumbnail.tsx | 134 | opacity | 0.7 | 0.6 | `controlTokens.opacity.muted` | placeholder bar |
| layers/LayerThumbnail.tsx | 135 | opacity | 0.7 | 0.6 | `controlTokens.opacity.muted` | placeholder bar |
| layers/MaskThumbnailAndEditor.tsx | 126 | opacity | 0.45 | 0.52 | `tokens.opacity.disabled` | disabled or unavailable state |
| layers/MaskThumbnailAndEditor.tsx | 128 | top | 23 | 24 | `tokens.spacing.fixedSection` | nearest spacing step |
| layers/panel-button.tsx | 30 | opacity | 0.45 | 0.52 | `tokens.opacity.disabled` | disabled or unavailable state |
| layers/panel-button.tsx | 35 | width | 30 | 32 | `tokens.spacing.fixedCanvas` | nearest spacing step |
| layers/panel-button.tsx | 45 | lineHeight | 16 | 15 | `tokens.text.off15` | nearest leading step |
| midi/MIDIPianoRoll.tsx | 372 | opacity | 0.45 | 0.52 | `tokens.opacity.disabled` | disabled or unavailable state |
| midi/MIDIVelocityLane.tsx | 219 | opacity | 0.45 | 0.52 | `tokens.opacity.disabled` | disabled or unavailable state |
| midi/MIDIVelocityLane.tsx | 247 | opacity | 0.45 | 0.52 | `tokens.opacity.disabled` | disabled or unavailable state |
| midi/MIDIVelocityLane.tsx | 398 | opacity | 0.45 | 0.52 | `tokens.opacity.disabled` | disabled or unavailable state |
| midi/MidiChannelPicker.tsx | 94 | opacity | 0.45 | 0.52 | `tokens.opacity.disabled` | disabled or unavailable state |
| midi/StepSequencer.tsx | 118 | opacity | 0.45 | 0.52 | `tokens.opacity.disabled` | disabled or unavailable state |
| motion/EasingPresetGallery.tsx | 27 | minHeight | 56 | 52 | `tokens.spacing.fixedToolbar` | nearest spacing step |
| motion/EasingPresetGallery.tsx | 27 | flexBasis | 144 | 160 | `controlTokens.extent.column` | nearest spacing step |
| motion/EasingPresetGallery.tsx | 27 | opacity | .5 | 0.52 | `tokens.opacity.disabled` | disabled or unavailable state |
| motion/ExpressionEditor.tsx | 44 | minHeight | 80 | 76 | `tokens.spacing.off76` | nearest spacing step |
| office/ReadAloudTransport.tsx | 121 | opacity | 0.45 | 0.52 | `tokens.opacity.disabled` | disabled or unavailable state |
| office/ReadAloudTransport.tsx | 149 | fontSize | 17 | 15 | `tokens.text.off15` | nearest type step |
| office/ReadAloudTransport.tsx | 149 | lineHeight | 25 | 22 | `tokens.text.off22` | nearest leading step |
| office/office-controls.tsx | 64 | opacity | 0.45 | 0.52 | `tokens.opacity.disabled` | disabled or unavailable state |
| pdf/CommentsThreadPanel.tsx | 106 | opacity | 0.7 | 0.6 | `controlTokens.opacity.muted` | resolved thread |
| pdf/CommentsThreadPanel.tsx | 142 | lineHeight | 21 | 20 | `tokens.text.title` | nearest leading step |
| pdf/ExtractMergeSplitDialog.tsx | 27 | maxHeight | 280 | 240 | `controlTokens.extent.preview` | nearest spacing step |
| pdf/PDFFormFieldEditor.tsx | 25 | height | 220 | 240 | `controlTokens.extent.preview` | nearest spacing step |
| pdf/PDFScanSession.tsx | 30 | height | 220 | 240 | `controlTokens.extent.preview` | nearest spacing step |
| photo/PhotoBrushSurface.tsx | 30 | opacity | .5 | 0.52 | `tokens.opacity.disabled` | disabled or unavailable state |
| photo/PhotoLibraryGrid.tsx | 29 | minHeight | 100 | 96 | `tokens.spacing.off96` | nearest spacing step |
| photo/PhotoVersionHistoryBrowser.tsx | 26 | minHeight | 56 | 52 | `tokens.spacing.fixedToolbar` | nearest spacing step |
| photo/PresetFilmstrip.tsx | 28 | height | 156 | 160 | `controlTokens.extent.column` | nearest spacing step |
| photo/PresetFilmstrip.tsx | 30 | width | 144 | 160 | `controlTokens.extent.column` | nearest spacing step |
| selection/MagicSelectionControls.tsx | 261 | opacity | 0.6 | 0.52 | `tokens.opacity.disabled` | disabled or unavailable state |
| selection/SelectionBounds.tsx | 75 | opacity | .5 | 0.52 | `tokens.opacity.disabled` | disabled or unavailable state |
| selection/SelectionBounds.tsx | 76 | width | 30 | 32 | `tokens.spacing.fixedCanvas` | nearest spacing step |
| selection/SelectionMarquee.tsx | 320 | opacity | 0.6 | 0.52 | `tokens.opacity.disabled` | disabled or unavailable state |
| selection/switch-row.tsx | 30 | opacity | 0.6 | 0.52 | `tokens.opacity.disabled` | disabled or unavailable state |
| selection/switch-row.tsx | 35 | opacity | 0.5 | 0.52 | `tokens.opacity.disabled` | disabled or unavailable state |
| slides/ConnectorAndDiagramTools.tsx | 28 | maxHeight | 200 | 180 | `controlTokens.extent.previewCompact` | nearest spacing step |
| slides/MorphPreview.tsx | 24 | height | 300 | 320 | `controlTokens.extent.list` | nearest spacing step |
| slides/SlideAnimationPane.tsx | 129 | opacity | 0.45 | 0.52 | `tokens.opacity.disabled` | disabled or unavailable state |
| slides/SlideAnimationPane.tsx | 136 | flexBasis | 100 | 96 | `tokens.spacing.off96` | nearest spacing step |
| slides/SlideAnimationPane.tsx | 141 | flexBasis | 100 | 96 | `tokens.spacing.off96` | nearest spacing step |
| slides/SlideSorter.tsx | 106 | maxHeight | 640 | 600 | `tokens.spacing.off600` | nearest spacing step |
| slides/SlideSorter.tsx | 142 | width | 9 | 8 | `tokens.spacing.fixedElement` | nearest spacing step |
| spreadsheet/ChartBuilder.tsx | 54 | width | 36 | 33 | `tokens.spacing.off33` | nearest spacing step |
| spreadsheet/ChartBuilder.tsx | 59 | width | 36 | 33 | `tokens.spacing.off33` | nearest spacing step |
| spreadsheet/ChartBuilder.tsx | 66 | width | 36 | 33 | `tokens.spacing.off33` | nearest spacing step |
| spreadsheet/ConditionalFormatRules.tsx | 25 | maxHeight | 300 | 320 | `controlTokens.extent.list` | nearest spacing step |
| spreadsheet/DataImportWizard.tsx | 31 | maxHeight | 300 | 320 | `controlTokens.extent.list` | nearest spacing step |
| spreadsheet/PivotFieldList.tsx | 36 | height | 220 | 240 | `controlTokens.extent.preview` | nearest spacing step |
| spreadsheet/SparklineEditor.tsx | 103 | width | 112 | 104 | `tokens.spacing.off104` | nearest spacing step |
| spreadsheet/SplitSpreadsheetView.tsx | 124 | width | 36 | 33 | `tokens.spacing.off33` | nearest spacing step |
| spreadsheet/SplitSpreadsheetView.tsx | 124 | height | 36 | 33 | `tokens.spacing.off33` | nearest spacing step |
| spreadsheet/SpreadsheetCardsView.tsx | 38 | minHeight | 100 | 96 | `tokens.spacing.off96` | nearest spacing step |
| spreadsheet/panel-controls.tsx | 66 | minWidth | 140 | 120 | `controlTokens.extent.fieldWide` | nearest spacing step |
| spreadsheet/panel-controls.tsx | 66 | flexBasis | 140 | 120 | `controlTokens.extent.fieldWide` | nearest spacing step |
| spreadsheet/panel-controls.tsx | 81 | fontSize | 16 | 15 | `tokens.text.off15` | nearest type step |
| timeline/CaptionWordTimingHandles.tsx | 34 | maxHeight | 80 | 76 | `tokens.spacing.off76` | nearest spacing step |
| timeline/InOutRangeHandles.tsx | 79 | height | 30 | 32 | `tokens.spacing.fixedCanvas` | nearest spacing step |
| timeline/JKLShuttleController.tsx | 73 | opacity | 0.4 | 0.52 | `tokens.opacity.disabled` | disabled or unavailable state |
| timeline/LoopRangeBar.tsx | 131 | opacity | 0.4 | 0.52 | `tokens.opacity.disabled` | disabled or unavailable state |
| timeline/OverlayAndEffectsTrackStack.tsx | 100 | opacity | 0.4 | 0.52 | `tokens.opacity.disabled` | disabled or unavailable state |
| timeline/PlaybackRateMenu.tsx | 55 | opacity | 0.4 | 0.52 | `tokens.opacity.disabled` | disabled or unavailable state |
| timeline/RazorSplitTool.tsx | 65 | opacity | 0.4 | 0.52 | `tokens.opacity.disabled` | disabled or unavailable state |
| timeline/SeekBar.tsx | 87 | opacity | 0.45 | 0.52 | `tokens.opacity.disabled` | disabled or unavailable state |
| timeline/StickerMotionLane.tsx | 35 | maxHeight | 80 | 76 | `tokens.spacing.off76` | nearest spacing step |
| timeline/TimecodeDisplay.tsx | 85 | minWidth | 150 | 160 | `controlTokens.extent.column` | nearest spacing step |
| timeline/TimelineRuler.tsx | 72 | width | 90 | 88 | `controlTokens.extent.field` | nearest spacing step |
| timeline/TimelineRuler.tsx | 74 | width | 90 | 88 | `controlTokens.extent.field` | nearest spacing step |
| timeline/TimelineZoomAndScroll.tsx | 117 | opacity | 0.45 | 0.52 | `tokens.opacity.disabled` | disabled or unavailable state |
| timeline/TrackHeaders.tsx | 70 | height | 9 | 8 | `tokens.spacing.fixedElement` | nearest spacing step |
| timeline/TrackHeaders.tsx | 75 | height | 11 | 12 | `tokens.spacing.fixedInset` | nearest spacing step |
| timeline/TrackHeaders.tsx | 86 | borderBottomWidth | 9 | 8 | `tokens.spacing.fixedElement` | nearest spacing step |
| timeline/TrackHeaders.tsx | 86 | borderTopWidth | 9 | 8 | `tokens.spacing.fixedElement` | nearest spacing step |
| timeline/TransitionHandles.tsx | 192 | opacity | 0.4 | 0.52 | `tokens.opacity.disabled` | disabled or unavailable state |
| timeline/TransitionPresetBrowser.tsx | 64 | width | 30 | 32 | `tokens.spacing.fixedCanvas` | nearest spacing step |
| timeline/TransitionPresetBrowser.tsx | 69 | opacity | 0.85 | 0.9 | `controlTokens.opacity.strong` | overlapping second tile |
| timeline/TransportControls.tsx | 56 | minWidth | 56 | 52 | `tokens.spacing.fixedToolbar` | nearest spacing step |
| timeline/TransportControls.tsx | 56 | opacity | 0.4 | 0.52 | `tokens.opacity.disabled` | disabled or unavailable state |
| vector/ShapeBuilder.tsx | 149 | height | 17 | 16 | `tokens.spacing.fixedGroup` | nearest spacing step |
| vector/vector-controls.tsx | 49 | opacity | 0.5 | 0.52 | `tokens.opacity.disabled` | disabled or unavailable state |

## Allowlist entries added

19 entries cover 21 findings. Each is in `tooling/codemod/allowlist.json` with the reason below.
Each matches on file, kind, property and value, not on a line. The other 57 entries are unchanged and cover packages outside
this pass. 4 stale radius entries were removed.

| File | Property | Value | Count | Reason |
|---|---|---|---:|---|
| `inputs/InstrumentKnob.tsx` | height | 0.28 | 1 | Knob pointer length as a proportion of the knob size (size * 0.28). Glyph geometry, outside the token scale. |
| `office/office-controls.tsx` | width | 0.85 | 1 | Play glyph width as a proportion of its size (size * 0.85). Glyph geometry, outside the token scale. |
| `office/office-controls.tsx` | gap | 0.28 | 1 | Gap between the pause bars as a proportion of the glyph size (size * 0.28). Glyph geometry, outside the token scale. |
| `office/office-controls.tsx` | width | 0.3 | 2 | Pause bar width as a proportion of the glyph size (size * 0.3). Glyph geometry, outside the token scale. |
| `timeline/glyphs.tsx` | borderLeftWidth | 0.85 | 1 | Play-triangle depth as a proportion of the glyph size (size * 0.85); the border draws the triangle. Glyph geometry, outside the token scale. |
| `timeline/glyphs.tsx` | borderRightWidth | 0.85 | 1 | Reverse-triangle depth as a proportion of the glyph size (size * 0.85); the border draws the triangle. Glyph geometry, outside the token scale. |
| `photo/photo-export.ts` | opacity | .7 | 1 | Default watermark opacity in the photo export settings: document data for the exporter, not a view style. |
| `photo/photo-export.ts` | fontSize | 24 | 1 | Default watermark text size in the photo export settings: document data for the exporter, not a view style. |
| `slides/slide-model.ts` | width | 960 | 1 | Default slide width of the slide document model (960 x 540): document data, not a view style. |
| `slides/slide-model.ts` | height | 540 | 1 | Default slide height of the slide document model (960 x 540): document data, not a view style. |
| `audio/AutomationLane.tsx` | width | 2 | 1 | Factor, not a length: the lane is the visible width plus the lead-in on both sides (width + LEAD * 2). |
| `audio/SpectrogramView.tsx` | right | 100 | 1 | Percentage, not a length: the end marker sits at (1 - position) * 100 percent of the strip, a string ending in %. |
| `audio/SpectrogramView.tsx` | left | 100 | 1 | Percentage, not a length: the marker sits at position * 100 percent of the strip, a string ending in %. |
| `audio/eq-graph.ts` | width | 1 | 2 | Data the gate reads as style: a 1-wide probe plot passed to assertPlot to validate height and range, not a view. |
| `canvas/GuidedCropAndStraighten.tsx` | width | 1 | 1 | Data the gate reads as style: the reset crop rect is the full normalised image (0, 0, 1, 1), not a view size. |
| `canvas/GuidedCropAndStraighten.tsx` | height | 1 | 1 | Data the gate reads as style: the reset crop rect is the full normalised image (0, 0, 1, 1), not a view size. |
| `color/ColorWheel.tsx` | width | 2 | 1 | Factor, not a length: the inner disc is a circle of radius inner, so its width is inner * 2. |
| `color/ColorWheel.tsx` | height | 2 | 1 | Factor, not a length: the inner disc is a circle of radius inner, so its height is inner * 2. |
| `vector/fill-stroke-model.ts` | width | 2 | 1 | Data the gate reads as style: the default stroke width of a vector document stroke, not a view style. |

There are four groups:

- **Glyph proportions** (7 findings).
- **Document data** (4): photo export, slide model.
- **Data the gate reads as style** (5): the EQ probe plot, the reset crop rect, the default vector
  stroke.
- **Factors and percentages** (5): `LEAD * 2`, `inner * 2`, `position * 100%`.

The glyph entries are proportions, `size * k`. They draw a play triangle, pause bars and a knob
pointer at any size. Tokenizing the factor would give a token that is not a length. Snapping it
would distort the glyph. The photo-export and slide-model entries are default values of document
models. The gate reads their `width`, `fontSize` and `opacity` keys as style properties, but no view
renders them as styles.

## Re-running

```sh
node tooling/codemod/tokenize-editor-controls.mjs          # dry run; on this branch it rewrites 0 and skips the 21 allowlisted sites
node tooling/codemod/check-no-hardcoded.mjs
node tooling/check-token-mirror.mjs
node tooling/check-radius.mjs
```
