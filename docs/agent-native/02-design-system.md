# Agent-native phase 1.2: design system token audit

Status: audit and proposal on branch `agent-native-20261119` at `ff3abae`. No code changes. Every value below was read from the repo or computed by the commands in section 8. Nothing here was run against a rendered screen, so "no visual change" is a property of the mapping (each token carries the literal's exact value), and phase 1.3 proves it with before and after screenshot diffs (decision 6).

Companion file: `docs/agent-native/tokens.map.json` (234 proposed tokens, 365 migration entries, 5 drift records, the rebrand contract). The tables here summarise it. Where the two disagree, regenerate the JSON.

## 0. Method and limits

- Scope for "components in `packages/*`" is 153 tracked files (`.ts .tsx .js .mjs .css`, excluding tests, `.d.ts`, `rust/`). Command in section 8, line A.
- Counts are regex counts. The numeric-literal regex matches `prop: number` for 24 style property patterns. It misses values inside ternaries (for example `fontSize: block.kind === 'h1' ? 28 : block.kind === 'h2' ? 22 : 15` in `stage.tsx`, where only the 28 follows the property name directly) and values built in template strings. Treat the numeric totals as lower bounds.
- The hex regex covers 3, 4, 6 and 8 digit forms. The earlier audits used 3, 6 and 8 only, which is why `style.css` is 33 here and 31 in a narrower pass. `#face` in `persona-turret.tsx` (an SVG `url(#face-...)` reference) is excluded.
- `stage.tsx` lives at `packages/studio-workspace/src/stage.tsx`. `apps/studio-preview` has no `stage.tsx`.
- Token names, scale classification and the `migrations` list were produced by a throwaway script run against the clone. The script is not committed (this pass edits only two files); its output is `tokens.map.json`, and the section 8 commands reproduce every count.
- Decision 7 defers `apps/*`. `apps/studio-preview/src/style.css` is inventoried in section 3.6 so the owner sees it, and nothing in it is scheduled for change.
- The pre-existing audits said `forge-directions.ts` has 149 hex values. Confirmed: 149 occurrences, 88 distinct.

## 1. Token inventory

There are five token sources and no file that ties them together: `theme.ts`, `icons/src/tokens.js`, `forge-directions.ts`, the constants in `interaction-policy.ts`, and `tooling/brand/icon-family.mjs`. Only `theme.ts` generates CSS.

### 1.1 `packages/studio-workspace/src/theme.ts` (70 lines)

Colour, 13 keys per scheme, plus the status roles and the Prism override:

| theme.ts key | Dark | Light | `--color-forge-*` | Prism dark | Prism light |
|---|---|---|---|---|---|
| `base` | `#1C1E25` | `#F4F5F8` | `--color-forge-surface` | `#232428` | `#ECEDEF` |
| `raised` | `#262932` | `#FFFFFF` | `--color-forge-raised` | `#303136` | `#FAFAFB` |
| `deep` | `#15171D` | `#E7EAF1` | `--color-forge-mat` | `#18191D` | `#D9DBDF` |
| `line` | `#393D49` | `#DDE1EB` | `--color-forge-border` | `#424348` | `#C9CCD2` |
| `text` | `#F0F1F7` | `#252A3A` | `--color-forge-text` | `#F2F3F5` | `#25272D` |
| `muted` | `#ADB3C4` | `#687287` | `--color-forge-muted` | `#B8BBC4` | `#656A74` |
| `accent` | `#B7A5FF` | `#6950D1` | `--color-forge-accent` | `#66B9FF` | `#086CB8` |
| `ink` | `#211A3D` | `#FFFFFF` | `--color-forge-on-accent` | `#081D2F` | inherits |
| `soft` | `#38304F` | `#EEE9FF` | `--color-forge-tint` | `#173C59` | `#D6EAFB` |
| `paper` | `#FFFEFC` | `#FFFEFC` | `--color-forge-paper` | inherits | inherits |
| `paperInk` | `#303440` | `#303440` | `--color-forge-paper-ink` | inherits | inherits |
| `paperMuted` | `#797F8D` | `#797F8D` | `--color-forge-paper-muted` | inherits | inherits |
| `error` | `#FFAAA7` | `#B33E46` | `--color-forge-error` | inherits | inherits |
| `status.info` | `#8AB8FF` | `#1D5FA8` | none | inherits | inherits |
| `status.success` | `#6FD08C` | `#1E7A3C` | none | inherits | inherits |
| `status.onError` | `#2B0703` | `#FFFFFF` | none | inherits | inherits |

`prismThemes` overrides 9 of the 13 keys per scheme (`base raised deep line text muted accent ink soft`) and inherits `paper`, `paperInk`, `paperMuted` and `error`. Prism dark accent `#66B9FF` and light accent `#086CB8` are a blue chrome, separate from the suite lilac. There is no syntax-highlighting theme in the repo; "the prism theme override" is this object.

Scale, `workspaceScale`:

| Group | Name and value |
|---|---|
| space | stack 4, element 8, inset 12, group 16, section 24, canvas 32, page 64 |
| radius | control 4, panel 4, paper 2 |
| type | micro 10, label 12, body 14, title 20, display 32, manuscript 20 |
| font | serif `Georgia`, mono `monospace` |
| size | target 44, rail 72, header 60, toolbar 52, status 28 |

Densities, `resolveWorkspaceScale(density)` (default `standard`; text and radius never change):

| Token | compact | standard | comfortable |
|---|---|---|---|
| `space.stack` | 4 | 4 | 4 |
| `space.element` | 4 | 8 | 12 |
| `space.inset` | 8 | 12 | 16 |
| `space.group` | 12 | 16 | 20 |
| `space.section` | 20 | 24 | 32 |
| `space.canvas` | 24 | 32 | 40 |
| `space.page` | 64 | 64 | 64 |
| `size.target` | 44 | 44 | 48 |
| `size.rail` | 64 | 72 | 80 |
| `size.header` | 52 | 60 | 68 |
| `size.toolbar` | 44 | 52 | 60 |
| `size.status` | 24 | 28 | 32 |
| `size.canvasHeader` | 44 | 52 | 60 |
| `size.canvasToolbar` | 44 | 44 | 52 |
| `size.canvasRail` | 48 | 52 | 60 |

### 1.2 `build-theme.mjs` and the generated CSS

`build-theme.mjs` (43 lines) reads `theme.ts` and writes `theme.css` (91 lines, 84 declarations, 32 distinct names, Tailwind v4 `@theme`, `[data-theme="light"]`, `.dark`) and `theme.native.css` (69 lines, 58 declarations, Uniwind `@variant`). Re-running the script on the current `theme.ts` reproduces both files byte for byte.

The 13 NYC-Tron variables, as Forge fills them today:

| CSS variable | Dark | Light | Built from |
|---|---|---|---|
| `--color-primary` | `#B7A5FF` | `#6950D1` | `accent` |
| `--color-on-primary` | `#211A3D` | `#FFFFFF` | `ink` |
| `--color-surface-raised` | `#262932` | `#FFFFFF` | `raised` |
| `--color-surface-sunken` | `#15171D` | `#E7EAF1` | `deep` |
| `--color-border` | `#393D49` | `#DDE1EB` | `line` |
| `--color-text` | `#F0F1F7` | `#252A3A` | `text` |
| `--color-text-muted` | `#ADB3C4` | `#687287` | `muted` |
| `--color-danger` | `#FFAAA7` | `#B33E46` | `error` |
| `--color-on-danger` | `#2B0703` | `#FFFFFF` | `status.onError` |
| `--color-accent` | `#B7A5FF` | `#6950D1` | `accent` |
| `--color-info` | `#8AB8FF` | `#1D5FA8` | `status.info` |
| `--color-success` | `#6FD08C` | `#1E7A3C` | `status.success` |
| `--color-focus` | `#B7A5FF` | `#6950D1` | `accent` |

The 13 `--color-forge-*` variables repeat the `theme.ts` table above (middle column of the first table). Metrics, same in both schemes: `--spacing-forge-target: 44px`, `--radius-sm: 4px`, `--radius-forge-control: 4px`, `--radius-control: 4px`, `--radius-card: 4px`, `--font-forge-editorial: Georgia, 'Times New Roman', serif`.

### 1.3 `packages/icons/src/tokens.js` and `ForgeIcon.js`

| Name | Value |
|---|---|
| `iconColors.ink` / `inkInverse` | `#18202D` / `#F8FAFC` (default glyph colour, light / dark appearance) |
| `iconColors.muted` | `#737F91` (disabled) |
| `iconColors.accent` | `#6859E8` (selected) |
| `iconColors.accentBright`, `cyan`, `warning` | `#8E83FF`, `#00B6C7`, `#C68B27`. No consumer anywhere in `packages/` or `apps/studio-preview/src`. |
| `iconColors.positive` / `negative` | `#139E75` / `#D94462` (success / error status) |
| `iconSizes` | xs 12, sm 16, toolbar 20, default 24, touch 28, feature 32, hero 48 |
| `iconStroke` | size 24, width 2.35, cap and join `round` |
| `iconMotion` | hover 120ms, press 110, select 225, deselect 175, success 320, error 240, loading 850; pressScale 0.9, selectedScale 1.075 |
| Inline in `ForgeIcon.js` | spring stiffness 260, damping 22, mass 0.8; hit target `minWidth`/`minHeight` 44, `hitSlop` 4; surface `#11131B` dark and `#FFFFFF` light (line 36) |
| Inline in `state.js` | disabled opacity 0.52 |

### 1.4 Motion and interaction constants in TypeScript

| Source | Values |
|---|---|
| `interaction-policy.ts` `presets` | hover 70ms, press 90, selection 120, popover 150, panel-dock 190, detent 65, commit 110, cancel 85, error 140; scale press 0.985, popover 0.98; travel popover 5px, panel-dock 8px; easing names `standard`, `emphasized`, `linear`, `instant` with no control points defined anywhere |
| `interaction-policy.ts` `forgeHitTarget` | 44 for pointer and keyboard, 48 for touch, pen, controller and `presentation` density |
| `forge-directions.ts` `forgeFeedbackMotion` | press 80ms scale 0.96; endStop beat 60ms, 3deg; commit 200ms, peak opacity 0.9 |
| `forge-directions.ts` direction motion | workbench 120ms `cubic-bezier(0.22, 1, 0.36, 1)` (`snap`); optics 200ms `cubic-bezier(0.16, 1, 0.3, 1)` (`reveal`); atelier 280ms `cubic-bezier(0.25, 1, 0.5, 1)` (`dock`) |
| `turretGeometry` | bezel 66, face 48, notch 14, knurlCount 72, labelGap 14, label 80 by 44, box 300 by 200 at top 128. Geometry used in arithmetic, treated as exempt. |

### 1.5 `packages/studio-workspace/src/forge-directions.ts` (340 lines)

149 hex occurrences, 88 distinct, in four structures:

- `forgeDirections`: 3 directions (workbench, optics, atelier) by 2 schemes. Each material has 13 roles (`panel panelEdge panelSolid face[2] lathe bezel[n] knurl notch text muted faceText accent accentHalo`), plus a `panel` and `dial` shadow per scheme.
- `workbenchChrome`: 14 roles per scheme (the Prism editor panels).
- `labCanvas`: 4 roles per scheme.
- `prismFillSwatches`: violet `#6950D1`, teal `#249184`, amber `#E39B4C`, rose `#E26D92`. `prism-editor.tsx` keeps a second copy (`FILL_COLORS`) with a comment saying to change both together.

`nycTronTokens(scheme)` and `nycTronTokensFor(colors, selected)` already override 10 NYC-Tron variables at runtime through `TokenScope`, which is the working per-scope override mechanism today.

Every value is in the JSON (tiers `instrument`, `chrome`, `lab`, `document-colour`). Appendix B lists them.

### 1.6 Outside the packages

- `tooling/brand/icon-family.mjs` holds per-studio launcher accents: suite `#F3E7D3`, prism `#9C5FE6`, quill `#4F77E8`, tally `#33B38B`, pitch `#F07C2F`, folio `#DE4339`, splice `#E3B23D`, cadence `#40B5DB`, plus two ground gradients and `STEEL #E6E8EC`. Not connected to any in-app theme.
- `apps/example/brands/*.json` (8 files) carry identity only. `brand.schema.json` has `additionalProperties: false`.

## 2. Naming inconsistencies

| # | Finding | Evidence | Effect |
|---|---|---|---|
| N1 | Two parallel colour layers in one file. | `theme.css` declares 13 `--color-forge-*` and 13 NYC-Tron names. 8 of the 13 pairs have identical values (raised/surface-raised, mat/surface-sunken, border, text, muted/text-muted, accent, on-accent/on-primary, error/danger). | Components can use either; a rebrand must set both. |
| N2 | Three names per concept. | `deep` (ts), `mat` (forge css), `surface-sunken` (NYC). `ink`, `on-accent`, `on-primary`. `soft`, `tint`, none. `line`, `border`. `error`, `danger`. | Agents guess which spelling a file expects. |
| N3 | Forge has a middle surface NYC-Tron lacks. | `base` / `--color-forge-surface` / no NYC equivalent. | Needs a new role (section 4). |
| N4 | Radius names diverge. | `radius.panel` becomes `--radius-card`; `radius.paper` has no CSS variable; `--radius-sm`, `--radius-control`, `--radius-forge-control` all equal 4px. | Three variables for one value, one dropped. |
| N5 | Size lives in the spacing namespace, and only one of five. | `size.target` becomes `--spacing-forge-target`; rail, header, toolbar, status have no CSS variable. The seven `space` steps and the six `type` steps have none either. | The scale exists only in TypeScript, so CSS consumers hardcode. |
| N6 | Font value differs between files. | `theme.ts` `font.serif` is `Georgia`; the CSS variable is `Georgia, 'Times New Roman', serif`. | Two spellings of one font. |
| N7 | The scheme axis has four names. | `theme.ts` keys `dark`/`light`; `ForgeScheme`; icons `appearance`; `stage.tsx` prop `theme`; CSS `[data-theme]` and `.dark`. In `ARTBOARD_CHECKER`, `light` and `dark` name checker squares, not schemes. | Easy to wire the wrong axis. |
| N8 | Status colours have two vocabularies. | icons `positive`/`negative`/`warning`; theme `success`/`error`/`info`; NYC `success`/`danger`/`info`. | Same meaning, three words. |
| N9 | Density has two vocabularies. | `theme.ts`: compact, standard, comfortable. `forgeHitTarget` and `docs/ux/FORGE_2046_DESIGN_SYSTEM.md`: compact, comfortable, presentation. | `presentation` has no scale in `theme.ts`. |
| N10 | The same motion event has several durations. | press: 110ms (`iconMotion.pressMs`), 90ms (`presets.press`), 80ms (`forgeFeedbackMotion.press`). hover: 120 vs 70. detent: 65 (`presets.detent`) vs 120, 200, 280 (directions). select: 225 vs 120. | Four duration sources, 22 declared durations, 18 distinct values. |
| N11 | Hit target has two rules for 48. | `size.target` is 48 under `comfortable`; `forgeHitTarget` returns 48 by input kind. `ForgeIcon.js` hardcodes 44. | A comfortable pointer user gets 48 from one and 44 from the other. |
| N12 | Tokens and components import from different shapes. | `iconColors.accentBright` (camelCase map), `workspaceScale.space.stack` (nested), `--color-forge-on-accent` (kebab CSS). | No single lookup rule. |

## 3. Hardcoded values in `packages/*` and their tokens

Rule (binding, from decisions 5, 6, 10): a literal maps to a scale token only when it equals that step at standard density. Where it does not, a named token with the identical value is minted and listed as off-scale, value preserved. Nothing is snapped.

One consequence needs the owner's eye. The density-aware space tokens (`--spacing-element` is 4, 8 or 12 by density) cannot replace a literal `8` in a file that does not read `resolveWorkspaceScale`, because compact and comfortable would change pixels. Those literals map to `--spacing-fixed-element`, a density-invariant twin that is always 8px. Moving them to the density-aware token is a separate design call (owner decision 2).

### 3.1 Totals

| Class | Occurrences | Distinct values |
|---|---|---|
| Numeric style literals matched (command J) | 307 | 154 property=value pairs |
| On a scale step, mapped to an existing or twin token | 126 | 55 |
| Off-scale, value preserved in a minted token | 121 | 84 |
| Exempt: zero | 58 | 13 |
| Exempt: document constants (`office-cluster.ts` slide 960 by 540) | 2 | 2 |
| Quoted `fontWeight` (command K), all on a role | 15 | 3 |
| Derived expressions such as `scale.space.inset + 2` | 18 | 15 |
| Hex literals in component files (command D) | 58 | see 3.4 |
| `rgba()` or `hsla()` call sites | 14 | 1 style literal (`text-editor.tsx:148` shadow); 13 call or define a helper that converts an engine `Rgba` tuple to CSS, exempt |
| Duration literals in UI code | 10 in `interaction-policy.ts` (9 presets and the reduced-motion zero) | 8 more in `audio-ui` and `media-ui` are media timings, exempt |

The 84 off-scale values collapse to 52 minted tokens, because several properties share a value: 34 spacing, 6 text, 5 radius, 3 tracking, 2 leading, 2 border width. The 126 on-scale uses land on 27 distinct tokens.

### 3.2 Space and size

Space (padding, margin, gap, offsets, hit slop). Zero values excluded.

| Token | Value | Uses | Properties | Files |
|---|---|---|---|---|
| `--spacing-off-1-5` | 1.5 | 1 | top | prism-editor.tsx 1 |
| `--spacing-off-2` | 2 | 6 | gap, marginTop | index.tsx 1, persona-composer.tsx 1, persona-turret.tsx 1, prism-editor.tsx 2, stage.tsx 1 |
| `--spacing-off-3` | 3 | 4 | paddingHorizontal, gap, padding | index.tsx 1, prism-editor.tsx 3 |
| `--spacing-fixed-stack` | 4 | 12 | hitSlop, gap, paddingVertical, bottom, left, padding, paddingTop, marginTop | ForgeIcon.js 1, index.tsx 3, prism-canvas.tsx 3, prism-editor.tsx 3, stage.tsx 2 |
| `--spacing-off-5` | 5 | 1 | marginHorizontal | prism-editor.tsx 1 |
| `--spacing-off-5-75` | 5.75 | 1 | left | prism-editor.tsx 1 |
| `--spacing-off-6` | 6 | 3 | paddingBottom, paddingVertical, marginTop | index.tsx 1, prism-editor.tsx 1, stage.tsx 1 |
| `--spacing-off-7` | 7 | 1 | padding | stage.tsx 1 |
| `--spacing-fixed-element` | 8 | 16 | gap, marginHorizontal, top, marginRight, marginBottom, bottom, marginTop | NativeVideoMonitor.tsx 1, index.tsx 4, prism-editor.tsx 3, stage.tsx 7, text-editor.tsx 1 |
| `--spacing-off-10` | 10 | 8 | gap, paddingHorizontal, padding, left, marginBottom | index.tsx 1, prism-editor.tsx 2, stage.tsx 5 |
| `--spacing-fixed-inset` | 12 | 10 | right, paddingBottom, top, left, padding, marginBottom, paddingTop, gap | prism-editor.tsx 5, stage.tsx 4, text-editor.tsx 1 |
| `--spacing-off-14` | 14 | 3 | marginBottom, marginTop | stage.tsx 3 |
| `--spacing-off-18` | 18 | 2 | padding, marginBottom | stage.tsx 2 |
| `--spacing-off-20` | 20 | 3 | padding, bottom, marginBottom | prism-editor.tsx 2, stage.tsx 1 |
| `--spacing-fixed-section` | 24 | 5 | marginBottom, margin, paddingVertical, padding | stage.tsx 5 |
| `--spacing-off-28` | 28 | 2 | padding, paddingTop | stage.tsx 2 |
| `--spacing-fixed-canvas` | 32 | 1 | top | stage.tsx 1 |
| `--spacing-off-40` | 40 | 1 | paddingBottom | stage.tsx 1 |
| `--spacing-off-48` | 48 | 2 | paddingVertical, paddingBottom | stage.tsx 1, text-editor.tsx 1 |
| `--spacing-fixed-page` | 64 | 1 | paddingBottom | text-editor.tsx 1 |
| `--spacing-off-76` | 76 | 2 | left, right | index.tsx 2 |
| `--spacing-off-84` | 84 | 1 | bottom | index.tsx 1 |

Size (width, height, min and max). Values 540 and 960 in `office-cluster.ts` are slide dimensions and stay literal.

| Token | Value | Uses | Properties | Files |
|---|---|---|---|---|
| `--spacing-off-1-5` | 1.5 | 1 | width | prism-editor.tsx 1 |
| `--spacing-off-2` | 2 | 1 | height | persona-turret.tsx 1 |
| `--spacing-off-3` | 3 | 1 | width | persona-turret.tsx 1 |
| `--spacing-off-5` | 5 | 1 | height | prism-editor.tsx 1 |
| `--spacing-off-6` | 6 | 1 | width | persona-turret.tsx 1 |
| `--spacing-off-10` | 10 | 1 | height | persona-turret.tsx 1 |
| `--spacing-off-14` | 14 | 1 | minHeight | persona-turret.tsx 1 |
| `--spacing-off-16` | 16 | 2 | width, height | prism-editor.tsx 2 |
| `--spacing-off-18` | 18 | 2 | width, minWidth | persona-composer.tsx 2 |
| `--spacing-off-22` | 22 | 1 | height | index.tsx 1 |
| `--spacing-off-24` | 24 | 1 | height | prism-editor.tsx 1 |
| `--spacing-off-25` | 25 | 2 | width, height | prism-editor.tsx 2 |
| `--spacing-off-26` | 26 | 1 | width | prism-editor.tsx 1 |
| `--spacing-fixed-status` | 28 | 2 | width, minHeight | index.tsx 1, persona-composer.tsx 1 |
| `--spacing-off-33` | 33 | 2 | width, height | prism-editor.tsx 2 |
| `--spacing-off-40` | 40 | 3 | minWidth, width, minHeight | index.tsx 1, stage.tsx 2 |
| `--spacing-fixed-target` | 44 | 3 | minWidth, minHeight | ForgeIcon.js 2, prism-editor.tsx 1 |
| `--spacing-off-50` | 50 | 1 | minHeight | prism-editor.tsx 1 |
| `--spacing-fixed-toolbar` | 52 | 1 | minHeight | prism-editor.tsx 1 |
| `--spacing-fixed-rail` | 72 | 1 | minHeight | persona-composer.tsx 1 |
| `--spacing-off-96` | 96 | 2 | minHeight | persona-composer.tsx 1, stage.tsx 1 |
| `--spacing-off-104` | 104 | 1 | width | stage.tsx 1 |
| `--spacing-off-132` | 132 | 1 | minWidth | prism-editor.tsx 1 |
| `--spacing-off-360` | 360 | 1 | minHeight | stage.tsx 1 |
| `--spacing-off-480` | 480 | 1 | minHeight | text-editor.tsx 1 |
| `--spacing-off-520` | 520 | 1 | maxWidth | stage.tsx 1 |
| `--spacing-off-600` | 600 | 1 | height | prism-editor.tsx 1 |
| `--spacing-off-680` | 680 | 1 | maxWidth | stage.tsx 1 |
| `--spacing-off-760` | 760 | 1 | minHeight | text-editor.tsx 1 |
| `--spacing-off-792` | 792 | 3 | maxWidth | text-editor.tsx 3 |
| `--spacing-off-800` | 800 | 3 | height, width | index.tsx 1, prism-editor.tsx 1, text-editor.tsx 1 |
| `--spacing-off-1200` | 1200 | 1 | width | index.tsx 1 |

Where a size literal equals a size step (28, 44, 52, 72) the role may not match its use, for example `minHeight: 72` in `persona-composer.tsx` maps to `--spacing-fixed-rail` by value. The mapping is exact; the role label is the owner's to refine.

### 3.3 Radius, border, type, layers

| Token | Value | Uses | Properties | Files |
|---|---|---|---|---|
| `--radius-off-0-75` | 0.75 | 1 | borderRadius | prism-editor.tsx 1 |
| `--radius-off-1` | 1 | 1 | borderRadius | persona-turret.tsx 1 |
| `--radius-off-1-5` | 1.5 | 1 | borderRadius | persona-turret.tsx 1 |
| `--radius-paper` | 2 | 1 | borderRadius | stage.tsx 1 |
| `--radius-off-3` | 3 | 3 | borderRadius | stage.tsx 3 |
| `--radius-control` | 4 | 2 | borderRadius | stage.tsx 2 |
| `--radius-off-8` | 8 | 1 | borderRadius | prism-editor.tsx 1 |

| Token | Value | Uses | Properties | Files |
|---|---|---|---|---|
| `--border-width-hairline` | 1 | 45 | borderWidth, borderTopWidth, borderBottomWidth, borderRightWidth, height, width, borderLeftWidth | index.tsx 13, persona-composer.tsx 10, persona-turret.tsx 4, prism-editor.tsx 14, stage.tsx 4 |
| `--border-width-off-1-5` | 1.5 | 1 | borderWidth | prism-editor.tsx 1 |
| `--border-width-strong` | 2 | 3 | borderWidth | index.tsx 1, prism-canvas.tsx 1, prism-editor.tsx 1 |
| `--border-width-off-3` | 3 | 2 | borderWidth | turret-motion.native.tsx 1, turret-motion.tsx 1 |

| Token | Value | Uses | Properties | Files |
|---|---|---|---|---|
| `--tracking-off-neg-0-2` | -0.2 | 1 | letterSpacing | persona-turret.tsx 1 |
| `--tracking-off-0-4` | .4 | 1 | letterSpacing | index.tsx 1 |
| `--tracking-off-1` | 1 | 1 | letterSpacing | index.tsx 1 |
| `--text-off-9` | 9 | 2 | fontSize | index.tsx 2 |
| `--text-micro` | 10 | 1 | fontSize | stage.tsx 1 |
| `--text-off-11` | 11 | 12 | fontSize | index.tsx 6, prism-canvas.tsx 1, prism-editor.tsx 1, stage.tsx 3, text-editor.tsx 1 |
| `--text-label` | 12 | 12 | fontSize | index.tsx 3, prism-editor.tsx 2, stage.tsx 7 |
| `--text-off-13` | 13 | 9 | fontSize | index.tsx 1, prism-editor.tsx 3, stage.tsx 5 |
| `--text-body` | 14 | 1 | fontSize | stage.tsx 1 |
| `--text-off-15` | 15 | 1 | fontSize | stage.tsx 1 |
| `--leading-off-18` | 18 | 1 | lineHeight | stage.tsx 1 |
| `--leading-off-19` | 19 | 2 | lineHeight | index.tsx 2 |
| `--text-off-22` | 22 | 1 | fontSize | stage.tsx 1 |
| `--text-off-28` | 28 | 1 | fontSize | stage.tsx 1 |
| `--font-weight-medium` | 500 | 2 | fontWeight | index.tsx 1, stage.tsx 1 |
| `--font-weight-semibold` | 600 | 9 | fontWeight | index.tsx 2, persona-composer.tsx 3, prism-editor.tsx 4 |
| `--font-weight-bold` | 700 | 4 | fontWeight | persona-composer.tsx 3, persona-turret.tsx 1 |

| Token | Value | Uses | Properties | Files |
|---|---|---|---|---|
| `--opacity-scrim` | 0.45 | 1 | opacity | prism-editor.tsx 1 |
| `--z-layer-row` | 10 | 1 | zIndex | prism-editor.tsx 1 |
| `--z-chrome` | 20 | 2 | zIndex | index.tsx 1, prism-editor.tsx 1 |
| `--z-fill-bar` | 25 | 1 | zIndex | prism-editor.tsx 1 |
| `--z-toast` | 35 | 1 | zIndex | prism-editor.tsx 1 |
| `--z-panel` | 60 | 1 | zIndex | prism-editor.tsx 1 |
| `--z-overlay` | 70 | 2 | zIndex | prism-editor.tsx 2 |

Z-index roles are inferred from the element that carries each value in `prism-editor.tsx` and `index.tsx`: 10 selected layer row, 20 toolbar and rail, 25 fill bar, 35 toast, 60 layers panel, 70 persona sheet and popover.

Derived expressions keep their dependence on the scale. They become `calc()` tokens, so a density change still moves them:

| Expression | Token | Uses | File |
|---|---|---|---|
| `scale.space.group + 2` | `--spacing-group-plus-2` | 1 | index.tsx |
| `scale.space.inset + 2` | `--spacing-inset-plus-2` | 2 | index.tsx |
| `scale.space.element + 2` | `--spacing-element-plus-2` | 2 | index.tsx |
| `scale.space.stack + 1` | `--spacing-stack-plus-1` | 1 | index.tsx |
| `scale.space.inset + 1` | `--spacing-inset-plus-1` | 1 | persona-composer.tsx |
| `scale.type.label + 1` | `--text-label-plus-1` | 1 | persona-turret.tsx |
| `scale.type.micro + 1` | `--text-micro-plus-1` | 1 | persona-turret.tsx |
| `scale.type.body + 2` | `--text-body-plus-2` | 1 | persona-turret.tsx |
| `scale.type.micro + 3` | `--text-micro-plus-3` | 1 | persona-turret.tsx |
| `scale.size.target+4` | `--spacing-target-plus-4` | 2 | prism-editor.tsx |
| `scale.type.micro + 1` | `--text-micro-plus-1` | 1 | prism-editor.tsx |
| `scale.space.inset+2` | `--spacing-inset-plus-2` | 1 | prism-editor.tsx |
| `scale.radius.control + 2` | `--radius-control-plus-2` | 1 | prism-editor.tsx |
| `scale.space.group + scale.space.stack` | `--spacing-group-plus-stack` | 1 | index.tsx |
| `scale.space.element / 2 + 2` | `--spacing-element-half-plus-2` | 1 | index.tsx |

### 3.4 Colour in components (58 hex)

| File | Hex | Mapping |
|---|---|---|
| `stage.tsx` | 42 (22 distinct) | 20 `--color-stage-*` tokens below. Matches nothing in `theme.ts`. |
| `prism-editor.tsx` | 5 | 4 fill swatches `--swatch-violet/teal/amber/rose`, plus `#000000` as `--color-scrim` |
| `prism-canvas.tsx` | 5 | `ARTBOARD_CHECKER` `#FFFFFF`, `#EDEFF3` (document colours), chip `#111827` and `#FFFFFF`, shadow `#00000035` |
| `index.tsx` | 3 | active icon `#FFFFFF` (`--color-icon-on-active`), shadows `#00000020` and `#00000030` |
| `ForgeIcon.js` | 2 | `#11131B` and `#FFFFFF` as `--color-icon-surface` (dark, light) |
| `persona-composer.tsx` | 1 | `#252A3A26` in a `shadow-[...]` class, equals light `text` at 15% alpha, as `--shadow-segment-active` |

`stage.tsx` palette. Two roles have a dark and a light value (`caption`, `heading`), so 22 literals map to 20 tokens:

| Literal | Uses | Token |
|---|---|---|
| `#F7F5ED` | 6 | `--color-stage-paper` |
| `#66735F` | 6 | `--color-stage-paper-text-muted` |
| `#283329` | 4 | `--color-stage-paper-text` |
| `#EEF0E9` | 2 | `--color-stage-heading` |
| `#637161` | 2 | `--color-stage-grid-head-text` |
| `#E5E9DD` | 2 | `--color-stage-grid-head` |
| `#26372E` | 2 | `--color-stage-slide-text` |
| `#222829` | 2 | `--color-stage-track` |
| `#39423F` | 2 | `--color-stage-track-border` |
| `#354638` | 2 | `--color-stage-paper-title` |
| `#D9B47A` | 1 | `--color-stage-fill-fallback` |
| `#556359` | 1 | `--color-stage-caption` |
| `#99A19D` | 1 | `--color-stage-caption` |
| `#202923` | 1 | `--color-stage-heading` |
| `#AD8551` | 1 | `--color-stage-quote-rule` |
| `#DCE0D5` | 1 | `--color-stage-grid-line` |
| `#263B2B` | 1 | `--color-stage-cell-text` |
| `#798373` | 1 | `--color-stage-empty-hint` |
| `#B9C7BA` | 1 | `--color-stage-track-label` |
| `#637660` | 1 | `--color-stage-clip-audio` |
| `#725D7C` | 1 | `--color-stage-clip-video` |
| `#FFFFFF` | 1 | `--color-stage-on-clip` |

The olive and paper tones in `stage.tsx` are not the `theme.ts` paper (`#FFFEFC`). Stage paper is `#F7F5ED`. Whether stage is a separate document palette or should fold into `--color-paper` is owner decision 8; folding changes pixels.

### 3.5 Colour drift, kept as separate tokens

| ID | Topic | Values (all preserved as named tokens) |
|---|---|---|
| D1 | Accent | icons selected `#6859E8`; workspace light accent `#6950D1`; workspace dark accent `#B7A5FF`; Prism override `#66B9FF` dark, `#086CB8` light; launcher accent for prism in `icon-family.mjs` `#9C5FE6`; `style.css` suite mark `#8B7AEF` |
| D2 | Dark surface | `ForgeIcon.js` `#11131B`; workspace `deep` `#15171D`; `style.css` page ground `#17191B`; stage track `#222829` |
| D3 | Success and danger | icons `#139E75` and `#D94462`; workspace success `#1E7A3C` light, `#6FD08C` dark; danger `#B33E46` light, `#FFAAA7` dark |
| D4 | Muted and ink | icons muted `#737F91`, ink `#18202D`, inkInverse `#F8FAFC`; workspace muted `#687287` / `#ADB3C4`, text `#252A3A` / `#F0F1F7` |
| D5 | Paper | `theme.ts` `#FFFEFC`; `stage.tsx` `#F7F5ED` |

Tokens: `--color-icon-selected`, `--color-icon-surface`, `--color-icon-success`, `--color-icon-danger`, `--color-icon-muted`, `--color-icon` (D1 to D4), `--color-stage-paper` (D5). None is aliased to a workspace token, since an alias would change the pixels. Decision 5 asked for D1 and D2; D3 to D5 are additional. Prism's blue accent is an intentional override, not drift, but its distance from the launcher purple (`#9C5FE6`) belongs in the same design call.

### 3.6 `apps/studio-preview/src/style.css` (deferred, decision 7)

33 hex occurrences, 22 distinct, plus about 110 numeric values (audit B estimate, not re-counted). 15 of the 22 are one purple ramp used by the launcher: `#8B7AEF #A997F2 #8273C1 #9B87ED #AD9CFF #B7A5FF #29253C #A593EA24 #B9A8FF #8F7EC24D #6B51C2 #EEEBFC #C3B5E766 #694FC0 #755AC7`. Only `#B7A5FF` equals a workspace token (dark `accent`). The rest are `#17191B` page ground, `#E9C685` (twice, as the `var(--accent, ...)` focus fallback), `#fff` (3), `#ffffff30`, `#ffffff08`, and the short forms `#0003` and `#8882`. When apps consume the registry, mint `--color-launcher-*` tokens with these exact values and map `#B7A5FF` to `--color-accent`.

## 4. Closed semantic scale

Principles. The set below is closed: a new semantic name needs an owner decision, not a drive-by edit. It extends the NYC-Tron names rather than forking them. Names follow Tailwind v4 theme namespaces (`color`, `spacing`, `radius`, `text`, `font-weight`, `leading`, `tracking`, `shadow`, `ease`) so utilities generate; custom namespaces (`duration`, `opacity`, `z`, `border-width`, `size`) become plain CSS variables.

### 4.1 Colour: 18 roles in five groups, no hues

| Group | Roles | Origin |
|---|---|---|
| Surface and edge | `surface-base`, `surface-raised`, `surface-sunken`, `border` | 3 NYC-Tron, 1 new (`surface-base`) |
| Text | `text`, `text-muted` | NYC-Tron |
| Brand | `primary`, `on-primary`, `primary-tint`, `accent`, `focus` | 4 NYC-Tron, 1 new (`primary-tint`) |
| Status | `danger`, `on-danger`, `info`, `success` | NYC-Tron |
| Document | `paper`, `paper-text`, `paper-text-muted` | new |

That is the 13 NYC-Tron variables plus 5 additions: `--color-surface-base`, `--color-primary-tint`, `--color-paper`, `--color-paper-text`, `--color-paper-text-muted`. The additions are used only by Forge components, so NYC-Tron's contract test (`contracts.test.mjs`, which rejects unlisted tokens in NYC components) is unaffected. Whether to upstream them is owner decision 7. Values are the ones in section 1.2 and 1.1 unchanged.

Below the semantic roles sit component-scoped tiers. They are namespaced, carry the current literal, and no component outside the named owner may use them:

| Tier | Prefix | Count | Owner |
|---|---|---|---|
| Icon | `--color-icon-*` | 9 | `@nitro-forge/icons` |
| Stage | `--color-stage-*` | 20 | `stage.tsx` |
| Chrome | `--color-chrome-*`, `--shadow-chrome-depth` | 14 | Prism editor panels |
| Lab | `--color-lab-*` | 4 | turret lab backdrop |
| Instrument | `--color-instrument-<direction>-*`, `--shadow-instrument-<direction>-*` | 53 | persona turret |
| Document | `--swatch-*`, `--color-artboard-checker-*` | 6 | Prism canvas |
| Fixed | `--color-scrim`, `--color-overlay-chip`, `--color-on-overlay-chip`, `--color-icon-on-active`, `--shadow-float-sm/md`, `--shadow-artboard`, `--shadow-page`, `--shadow-segment-active` | 9 | named in 3.4 |

### 4.2 Space and size

Semantic, density-aware (JSON `tier: space` and `size`):

| Token | compact | standard | comfortable |
|---|---|---|---|
| `--spacing-stack` | 4 | 4 | 4 |
| `--spacing-element` | 4 | 8 | 12 |
| `--spacing-inset` | 8 | 12 | 16 |
| `--spacing-group` | 12 | 16 | 20 |
| `--spacing-section` | 20 | 24 | 32 |
| `--spacing-canvas` | 24 | 32 | 40 |
| `--spacing-page` | 64 | 64 | 64 |
| `--spacing-target` | 44 | 44 | 48 |
| `--spacing-rail` | 64 | 72 | 80 |
| `--spacing-header` | 52 | 60 | 68 |
| `--spacing-toolbar` | 44 | 52 | 60 |
| `--spacing-status` | 24 | 28 | 32 |
| `--spacing-canvas-header` | 44 | 52 | 60 |
| `--spacing-canvas-toolbar` | 44 | 44 | 52 |
| `--spacing-canvas-rail` | 48 | 52 | 60 |

Density-invariant twins at the standard value: `--spacing-fixed-{stack 4, element 8, inset 12, group 16, section 24, canvas 32, page 64, target 44, rail 72, header 60, toolbar 52, status 28}`. Off-scale: `--spacing-off-<value>` (34 tokens, listed in 3.2). Derived: `--spacing-<step>-plus-<n>`.

### 4.3 Radius, border, type

- Radius: `--radius-control` 4, `--radius-card` 4, `--radius-sm` 4 (kept for the AGENTS.md "rounded-sm 4px" rule), `--radius-paper` 2. Off-scale: `--radius-off-{0-75, 1, 1-5, 3, 8}`. Tailwind's own `rounded-full` stays as is.
- Border width: `--border-width-hairline` 1px, `--border-width-strong` 2px. Off-scale: `-off-1-5`, `-off-3`.
- Type size: `--text-{micro 10, label 12, body 14, title 20, display 32, manuscript 20}`. Off-scale: `--text-off-{9, 11, 13, 15, 22, 28}`. Line height has no scale: `--leading-off-{18, 19}`. Tracking: `--tracking-off-{neg-0-2, 0-4, 1}`. Weight: `--font-weight-{regular 400, medium 500, semibold 600, bold 700}`. Family: `--font-editorial`, `--font-mono-plain`.

### 4.4 Motion

Closed vocabulary of 9 interaction events from `interaction-policy.ts`, each with a duration token, and a haptic and transform that stay in TypeScript. Three further groups are component-scoped and keep their own values:

| ms | Token | Source |
|---|---|---|
| 60 | `--duration-feedback-endstop-beat` | forge-directions.ts forgeDirections.*.motion |
| 65 | `--duration-detent` | interaction-policy presets.detent |
| 70 | `--duration-hover` | interaction-policy presets.hover |
| 80 | `--duration-feedback-press` | forgeFeedbackMotion.press |
| 85 | `--duration-cancel` | interaction-policy presets.cancel |
| 90 | `--duration-press` | interaction-policy presets.press |
| 110 | `--duration-icon-press` | iconMotion.pressMs |
| 110 | `--duration-commit` | interaction-policy presets.commit |
| 120 | `--duration-icon-hover` | iconMotion.hoverMs |
| 120 | `--duration-selection` | interaction-policy presets.selection |
| 120 | `--duration-turret-snap` | workbench |
| 140 | `--duration-error` | interaction-policy presets.error |
| 150 | `--duration-popover` | interaction-policy presets.popover |
| 175 | `--duration-icon-deselect` | iconMotion.deselectMs |
| 190 | `--duration-panel-dock` | interaction-policy presets.panel-dock |
| 200 | `--duration-feedback-commit` | forge-directions.ts forgeDirections.*.motion |
| 200 | `--duration-turret-reveal` | optics |
| 225 | `--duration-icon-select` | iconMotion.selectMs |
| 240 | `--duration-icon-error` | iconMotion.errorMs |
| 280 | `--duration-turret-dock` | atelier |
| 320 | `--duration-icon-success` | iconMotion.successMs |
| 850 | `--duration-icon-loading` | iconMotion.loadingMs |

- Easing: `--ease-{standard, emphasized, linear, instant}` are reserved names with no value anywhere in the repo, so the JSON records `value: null` (owner decision 6). `--ease-turret-{snap, reveal, dock}` carry the three direction curves.
- Scale and travel: `--scale-icon-press` 0.9, `--scale-icon-selected` 1.075, `--scale-feedback-press` 0.96, `--angle-feedback-endstop` 3deg, `--opacity-feedback-commit-peak` 0.9, `--spring-icon-{stiffness 260, damping 22, mass 0.8}`.
- Nothing is merged. The three press durations (110, 90, 80) and the four detent values (65, 120, 200, 280) stay distinct until the owner picks one (N10).

### 4.5 Other roles

`--opacity-disabled` 0.52, `--opacity-scrim` 0.45, `--hit-target` 44, `--hit-target-touch` 48, `--z-{layer-row 10, chrome 20, fill-bar 25, toast 35, panel 60, overlay 70}`, `--shadow-{float-sm, float-md, artboard, page, segment-active}`.

### 4.6 Density

Three densities, `compact`, `standard`, `comfortable`, exactly as `WORKSPACE_DENSITIES`. Density changes space and size (table in 4.2) and never changes type, radius, colour or motion. Delivery: keep `resolveWorkspaceScale` for TypeScript, and emit `[data-density="compact"]` and `[data-density="comfortable"]` blocks in `theme.css` that override the 15 density-aware variables, so CSS consumers follow the same switch. `standard` is the default and emits nothing extra. `presentation` (N9) is not a fourth scale; it stays a hit-target hint until the owner says otherwise.

## 5. Rebrand contract

Today, `apps/example/brands/*.json` changes name, bundle ids and icon art. It cannot change colour. Prism's palette is a hand-written override object in `theme.ts`.

Proposed contract. A studio overrides exactly 9 `theme.ts` keys, per scheme. That is the same 9 keys `prismThemes` already overrides, so the rule is the one existing precedent, written down.

| Set | `theme.ts` key | CSS variables it feeds | Required |
|---|---|---|---|
| Accent family | `accent` | `--color-primary`, `--color-accent`, `--color-focus` | yes |
| | `ink` | `--color-on-primary` | yes |
| | `soft` | `--color-primary-tint` | yes |
| Neutrals | `base` | `--color-surface-base` | no |
| | `raised` | `--color-surface-raised` | no |
| | `deep` | `--color-surface-sunken` | no |
| | `line` | `--color-border` | no |
| | `text` | `--color-text` | no |
| | `muted` | `--color-text-muted` | no |

Minimum override: 3 keys by 2 schemes, 6 values. Full override: 9 keys by 2 schemes, 18 values.

Locked, not overridable by a studio: `error`, `workspaceStatus` (info, success, onError), `paper*`, every scale (space, size, radius, type, motion), hit targets, and the chrome, stage, instrument, lab and document tiers. Radius is locked because AGENTS.md says to preserve the 4px studio chrome. Status colours are locked so a brand cannot make danger look like success. Chrome and instrument tiers derive from the Prism override and are not set by hand.

Mechanism, three parts:

1. Add an optional `theme` object to `tooling/brand/brand.schema.json` (a schema change, since `additionalProperties` is `false`). Example, written as today's Prism override so it can be checked against `prismThemes`:

```json
"theme": {
  "dark":  { "accent": "#66B9FF", "ink": "#081D2F", "soft": "#173C59" },
  "light": { "accent": "#086CB8", "ink": "#FFFFFF", "soft": "#D6EAFB" },
  "defaultDensity": "standard"
}
```

2. `build-theme.mjs` accepts a brand file, validates the keys against the table above, and emits a `[data-brand="<id>"]` block after the base theme. At runtime the same keys flow through the existing `nycTronTokensFor` and `TokenScope`.
3. A contract check rejects a brand whose pairs fall below WCAG AA: `on-primary` on `primary` at least 4.5:1, `text` and `text-muted` on `surface-raised` and `surface-sunken` at least 4.5:1, `focus` on `surface-raised` at least 3:1. NYC-Tron's reference values clear these (`docs/THEME_TOKENS.md` states 5.5:1 for text pairs and above 3:1 for focus); the Forge values have not been measured in this pass. `contrastRatio` and `luminance` in `forge-directions.ts` compute these.

A studio picks only its default density. Density stays a user preference at runtime, as `docs/ux/FORGE_2046_DESIGN_SYSTEM.md` requires. The per-studio launcher accents in `icon-family.mjs` are natural seeds for each studio's `accent`, but applying them changes in-app pixels (Prism's in-app accent is blue, its launcher accent purple), so they are a design call (owner decision 1), not part of this migration.

### 5.1 Two channels, and which surfaces each reaches

Added after the independent review (finding F5). The three keys travel through two channels, and the contract above only described the first.

| Key | Channel 1: CSS variables (`brandCssVariables`) | Channel 2: JS overrides (`brandThemeOverrides`) |
|---|---|---|
| `accent` | `--color-primary`, `--color-accent`, `--color-focus` | `colors.accent` in `ForgeWorkspace` (14 reads: header, rail label, studio glyphs, selection), `PersonaTurret` `colors.accent` (focus ring, committed notch), `PersonaComposer` `colors.accent` (8 reads) |
| `ink` | `--color-on-primary` | `colors.ink` in `ForgeWorkspace` (2 reads) |
| `soft` | `--color-primary-tint` | `colors.soft` in `ForgeWorkspace` (4 reads), `PersonaComposer` (2 reads) |

Channel 1 reaches every NYC-Tron control and any Tailwind utility that reads those variables. It never reaches a value Forge reads in JavaScript. Channel 2 reaches `ForgeWorkspace` through its `themeOverrides` prop. `PersonaTurret` and `PersonaComposer` take a `colors` prop that `ForgeWorkspace` does not fill, so the host passes the same override to them. Neither channel reaches `PrismEditor` (chrome and direction palettes), `QuillTextEditor` (`workspaceThemes` by scheme), `ForgeDocumentStage` or the default `ForgeIcon` palette. The read counts come from a grep of `packages/studio-workspace/src` at commit `ce4c41e`.

## 6. Migration

All changes are additive first. Old names stay as deprecated aliases that resolve to the new variable, so no consumer breaks and no pixel moves. Counts are references outside the generated CSS and outside the definitions in `build-theme.mjs` (command Q in section 8, `apps/` included). "var" counts `--name` references; "utility" counts Tailwind classes such as `bg-forge-mat`.

| Old | New | Basis | Refs |
|---|---|---|---|
| `--color-forge-surface` | `--color-surface-base` | new role | 2 var |
| `--color-forge-raised` | `--color-surface-raised` | identical value | 1 var, 1 utility |
| `--color-forge-mat` | `--color-surface-sunken` | identical value | 1 utility |
| `--color-forge-border` | `--color-border` | identical value | 1 var, 2 utility |
| `--color-forge-text` | `--color-text` | identical value | 1 var, 1 utility |
| `--color-forge-muted` | `--color-text-muted` | identical value | 1 var, 1 utility |
| `--color-forge-accent` | `--color-accent` | identical value | 1 var, 1 utility |
| `--color-forge-on-accent` | `--color-on-primary` | identical value | 0 |
| `--color-forge-tint` | `--color-primary-tint` | new role | 0 |
| `--color-forge-paper`, `-paper-ink`, `-paper-muted` | `--color-paper`, `--color-paper-text`, `--color-paper-text-muted` | new role | 0 |
| `--color-forge-error` | `--color-danger` | identical value | 0 |
| `--spacing-forge-target` | `--spacing-target` | same 44px | 0 (defined in `build-theme.mjs` only) |
| `--radius-forge-control` | `--radius-control` | identical value | 7, all in `style.css` |
| `--font-forge-editorial` | `--font-editorial` | same stack | 0 (defined in `build-theme.mjs` only) |

Only `persona-composer.tsx` (7 utility classes), `style.css` (13 references) and one `apps/example` test (`verify-native-styles.cjs`, 1) use the old names, so the rename is small. `theme.ts` keys keep their names (`accent`, `deep`, ...) and gain the mapping in the JSON `ts-key` entries (13 workspace colour keys, 22 scale keys, 9 icon colour keys, 7 icon sizes, 9 icon motion keys, 9 interaction events).

Sequence, each step independently revertible:

1. Extend `build-theme.mjs` to emit the new variables and the old names as aliases. No component edits. The generated values are identical.
2. Add a value test: for every JSON entry, the resolved token value equals the literal it replaces.
3. Codemod the 307 numeric literals, 58 hex, 18 derived expressions in `packages/` using the JSON `migrations` list.
4. Screenshot-diff the studio preview before and after at 390, 768, 1280 widths, dark and light, compact and comfortable (the matrix `docs/ux/FORGE_2046_DESIGN_SYSTEM.md` already requires). Zero diff is the gate.
5. Add the CI check scoped to `packages/` (decision 7): no hex, no numeric style literal outside the token files.

## 7. Owner decisions

1. Colour drift D1 to D5 and the Prism blue versus launcher purple. Default: keep every value as its own token (this document). Any unification changes pixels.
2. Density-invariant literals (`--spacing-fixed-*`). Moving them to the density-aware tokens leaves `standard` identical and changes `compact` and `comfortable`.
3. `presentation` density: stay a hit-target hint, or become a fourth scale.
4. Rebrand scope: accent family only (3 keys) or accent plus neutrals (9 keys), and whether radius may ever be overridden.
5. Approve the `theme` field in `brand.schema.json`.
6. Values for `--ease-standard` and `--ease-emphasized`, which `interaction-policy.ts` names but no file defines. Also whether to merge the four press and four detent durations.
7. Upstream the five Forge-only colour roles to NYC-Tron, or keep them Forge-local.
8. `stage.tsx`: separate document palette (this document) or fold into `--color-paper` (changes pixels).
9. The three unused icon colours (`accentBright`, `cyan`, `warning`): keep as tokens or retire.
10. Z-index role names (inferred from usage) and the duplicate swatch list in `prism-editor.tsx` and `forge-directions.ts`.

## 8. Counts and commands

Run from the repo root at `ff3abae`. `G` is `/usr/bin/grep`. `L` is the file list from line A. `HEX`, `TOK` and `NUMRE` are defined in the first lines of the block. The full script is reproduced so each number can be re-run.

```bash
G=/usr/bin/grep
L() { git ls-files packages | $G -E '\.(ts|tsx|js|mjs|css)$' | $G -Ev '(\.test\.|/tests?/|\.d\.ts$|/rust/|/node_modules/)'; }
HEX='#([0-9a-fA-F]{8}|[0-9a-fA-F]{6}|[0-9a-fA-F]{4}|[0-9a-fA-F]{3})\b'
TOK='packages/studio-workspace/src/(theme\.ts|theme\.css|theme\.native\.css|forge-directions\.ts)$|packages/icons/src/tokens\.js$'
NUMRE='\b(borderRadius|fontSize|lineHeight|padding[A-Za-z]*|margin[A-Za-z]*|gap|rowGap|columnGap|width|height|minWidth|minHeight|maxWidth|maxHeight|top|left|right|bottom|borderWidth|border[A-Za-z]*Width|zIndex|opacity|letterSpacing|hitSlop): *-?[0-9]*\.?[0-9]+\b'
# A  L | wc -l
# B  L | xargs $G -ohE "$HEX" | $G -vx '#face' | wc -l
# C  L | $G -E "$TOK" | xargs $G -ohE "$HEX" | $G -vx '#face' | wc -l
# D  L | $G -Ev "$TOK" | xargs $G -ohE "$HEX" | $G -vx '#face' | wc -l
# E  L | xargs $G -ohE "$HEX" | $G -vx '#face' | tr A-F a-f | sort -u | wc -l
# J  L | $G -Ev "$TOK" | xargs $G -ohE "$NUMRE" | wc -l
# K  L | $G -Ev "$TOK" | xargs $G -ohE "fontWeight: *'[0-9]+'" | wc -l
# M  $G -ohE "$HEX" apps/studio-preview/src/style.css | wc -l
# O  L | xargs $G -ohE 'scale\.(space|size|radius|type)\.[a-zA-Z]+ *[+-] *[0-9.]+' | wc -l
# Q  git grep -hoE -e '<old-name>([^a-z-]|$)' -- packages apps ':!packages/studio-workspace/src/theme.css' ':!packages/studio-workspace/src/theme.native.css' | wc -l
```

Results:

```text
A files in scope: 153
B hex occurrences, all in scope: 397
C hex in token files: 339
D hex in component files: 58
E distinct hex all in scope: 156
F forge-directions.ts hex: 149 distinct 88
G per file:
  149 packages/studio-workspace/src/forge-directions.ts
  78 packages/studio-workspace/src/theme.css
  52 packages/studio-workspace/src/theme.native.css
  51 packages/studio-workspace/src/theme.ts
  42 packages/studio-workspace/src/stage.tsx
  9 packages/icons/src/tokens.js
  5 packages/studio-workspace/src/prism-editor.tsx
  5 packages/studio-workspace/src/prism-canvas.tsx
  3 packages/studio-workspace/src/index.tsx
  2 packages/icons/src/ForgeIcon.js
  1 packages/studio-workspace/src/persona-composer.tsx
H stage.tsx distinct hex: 22
I rgba/hsl call sites: packages/pitch/src/office-cluster.ts:4 packages/prism/src/canvas-cluster.ts:3 packages/studio-workspace/src/prism-layers.ts:1 packages/studio-workspace/src/stage.tsx:5 packages/studio-workspace/src/text-editor.tsx:1 
J numeric style literals, components: 307
K quoted fontWeight: 15
L numeric by file:
  85 packages/studio-workspace/src/prism-editor.tsx
  75 packages/studio-workspace/src/stage.tsx
  63 packages/studio-workspace/src/index.tsx
  22 packages/studio-workspace/src/persona-composer.tsx
  17 packages/studio-workspace/src/persona-turret.tsx
  13 packages/studio-workspace/src/text-editor.tsx
  8 packages/studio-workspace/src/turret-motion.tsx
  7 packages/studio-workspace/src/prism-canvas.tsx
  5 packages/studio-workspace/src/turret-motion.native.tsx
  5 packages/icons/src/ForgeIcon.js
  4 packages/studio-workspace/src/interaction-policy.ts
  2 packages/pitch/src/office-cluster.ts
  1 packages/media-ui/src/video/NativeVideoMonitor.tsx
M style.css hex: 33 distinct 22
N other apps/studio-preview/src hex: 5
O derived scale expressions: 16
P ms literals in components: 18
```

Cross-checks. Command C (339) plus D (58) is B (397). Component hex by file: `stage.tsx` 42, `prism-editor.tsx` 5, `prism-canvas.tsx` 5, `index.tsx` 3, `ForgeIcon.js` 2, `persona-composer.tsx` 1, total 58. Token sources: `forge-directions.ts` 149, `theme.css` 78, `theme.native.css` 52, `theme.ts` 51, `tokens.js` 9, total 339. Other `apps/studio-preview/src` hex outside `style.css` (command N): 5 in `main.tsx`, `app-launcher.tsx`, `turret-lab.tsx`. The 18 derived expressions are the 16 of command O plus two compound forms the regex cannot match (`scale.space.group + scale.space.stack`, `scale.space.element / 2 + 2`, both in `index.tsx`).

Line P counts `duration` and `delay` props with numeric values: 18 total, 10 in `interaction-policy.ts`, 2 in `NativeAudioPreview.tsx`, 3 in `audioPlayback.ts`, 1 each in `recording.ts`, `NativeVideoMonitor.tsx`, `frameSession.ts`.

## Appendix A. Literal-to-token detail

The full list of 365 entries (file, property, value, count, target token, class) is in `tokens.map.json` under `migrations`. Classes: `on-scale`, `off-scale-preserved`, `exempt-zero`, `exempt-document-constant`, `fixed-literal-preserved`, `document-colour`, `derived-from-scale`, `rename-keep-deprecated-alias`, `rename-keep-ts-key`.

## Appendix B. Chrome, lab and instrument values

Chrome and lab (`workbenchChrome`, `labCanvas`):

| Token | Dark | Light |
|---|---|---|
| `--color-chrome-body` | `#1E2024` | `#ECEDEF` |
| `--color-chrome-edge` | `#3A3D44` | `#737882` |
| `--color-chrome-rule` | `#2E3036` | `#CDD0D6` |
| `--color-chrome-well` | `#141518` | `#DADCE1` |
| `--color-chrome-selected` | `#2B3846` | `#D3E4F4` |
| `--color-chrome-text` | `#F2F3F5` | `#1F2228` |
| `--color-chrome-muted` | `#B8BBC4` | `#555B66` |
| `--color-chrome-selected-muted` | `#D5E3F0` | `#2F4357` |
| `--color-chrome-disabled-ink` | `#858991` | `#6B707A` |
| `--color-chrome-accent` | `#66B9FF` | `#086CB8` |
| `--color-chrome-press` | `#FFFFFF14` | `#1F222814` |
| `--color-chrome-chip-edge` | `#FFFFFF59` | `#1F222859` |
| `--color-chrome-chip-ring` | `#F2F3F5` | `#1F2228` |
| `--shadow-chrome-depth` | `0 1px 0 #FFFFFF0F inset, 0 6px 14px #00000059` | `0 1px 0 #FFFFFF inset, 0 6px 14px #1B1D2124` |
| `--color-lab-mat` | `#18191D` | `#D9DBDF` |
| `--color-lab-paper` | `#FFFEFC` | `#FFFEFC` |
| `--color-lab-paper-ink` | `#303440` | `#303440` |
| `--color-lab-ground` | `#121316` | `#E4E6EA` |

Instrument tier (`forgeDirections.*.materials`, depth shadows). The `-0` and `-1` suffixes are array positions in `face` and `bezel`:

| Token | Dark | Light |
|---|---|---|
| `--color-instrument-workbench-panel` | `#1E2024` | `#ECEDEF` |
| `--color-instrument-workbench-panel-edge` | `#3A3D44` | `#C3C6CD` |
| `--color-instrument-workbench-panel-solid` | `#1E2024` | `#ECEDEF` |
| `--color-instrument-workbench-face-0` | `#3A3D45` | `#FFFFFF` |
| `--color-instrument-workbench-face-1` | `#191B1F` | `#CDD0D7` |
| `--color-instrument-workbench-lathe` | `#FFFFFF` | `#1F2228` |
| `--color-instrument-workbench-bezel-0` | `#565A64` | `#FFFFFF` |
| `--color-instrument-workbench-bezel-1` | `#141518` | `#9EA3AD` |
| `--color-instrument-workbench-knurl` | `#6A6F7A` | `#7D828D` |
| `--color-instrument-workbench-notch` | `#08090B` | `#3E434C` |
| `--color-instrument-workbench-text` | `#F2F3F5` | `#1F2228` |
| `--color-instrument-workbench-muted` | `#B8BBC4` | `#555B66` |
| `--color-instrument-workbench-face-text` | `#F2F3F5` | `#1F2228` |
| `--color-instrument-workbench-accent` | `#66B9FF` | `#086CB8` |
| `--color-instrument-workbench-accent-halo` | `#08090B` | `#FFFFFF` |
| `--shadow-instrument-workbench-panel` | `0 1px 0 #FFFFFF0F inset, 0 6px 14px #00000059` | `0 1px 0 #FFFFFF inset, 0 6px 14px #1B1D2124` |
| `--shadow-instrument-workbench-dial` | `2px 3px 6px #00000073` | `2px 3px 6px #1B1D2138` |
| `--color-instrument-optics-panel` | `#1C1E25C7` | `#FAFAFCDB` |
| `--color-instrument-optics-panel-edge` | `#FFFFFF24` | `#FFFFFFCC` |
| `--color-instrument-optics-panel-solid` | `#1C1E25` | `#F4F5F8` |
| `--color-instrument-optics-face-0` | `#17191E` | `#20232A` |
| `--color-instrument-optics-face-1` | `#0C0D10` | `#121418` |
| `--color-instrument-optics-lathe` | `#66B9FF` | `#66B9FF` |
| `--color-instrument-optics-bezel-0` | `#66B9FF` | `#086CB8` |
| `--color-instrument-optics-bezel-1` | `#7CDCCF` | `#0F8C80` |
| `--color-instrument-optics-bezel-2` | `#B7A5FF` | `#6950D1` |
| `--color-instrument-optics-bezel-3` | `#66B9FF` | `#086CB8` |
| `--color-instrument-optics-knurl` | `#8FA4BC` | `#5D6E82` |
| `--color-instrument-optics-notch` | `#050607` | `#050607` |
| `--color-instrument-optics-text` | `#F2F3F5` | `#1F2228` |
| `--color-instrument-optics-muted` | `#C2C6D0` | `#4F5562` |
| `--color-instrument-optics-face-text` | `#F2F3F5` | `#F2F3F5` |
| `--color-instrument-optics-accent` | `#66B9FF` | `#086CB8` |
| `--color-instrument-optics-accent-halo` | `#050607` | `#FFFFFF` |
| `--shadow-instrument-optics-panel` | `0 1px 0 #FFFFFF24 inset, 0 10px 28px #0000004D` | `0 1px 0 #FFFFFF inset, 0 10px 28px #1B1D211F` |
| `--shadow-instrument-optics-dial` | (none) | (none) |
| `--color-instrument-atelier-panel` | `#2A2C31` | `#FAFAF8` |
| `--color-instrument-atelier-panel-edge` | `#44474F` | `#DCDDE1` |
| `--color-instrument-atelier-panel-solid` | `#2A2C31` | `#FAFAF8` |
| `--color-instrument-atelier-face-0` | `#43464E` | `#FFFFFF` |
| `--color-instrument-atelier-face-1` | `#34373E` | `#ECEDEF` |
| `--color-instrument-atelier-lathe` | `#FFFFFF` | `#1F2228` |
| `--color-instrument-atelier-bezel-0` | `#4C4F58` | `#F2F3F5` |
| `--color-instrument-atelier-bezel-1` | `#3A3D44` | `#DADCE0` |
| `--color-instrument-atelier-knurl` | `#5D616B` | `#A3A7AF` |
| `--color-instrument-atelier-notch` | `#1A1B1F` | `#6B707A` |
| `--color-instrument-atelier-text` | `#F2F3F5` | `#1F2228` |
| `--color-instrument-atelier-muted` | `#BEC1CA` | `#555B66` |
| `--color-instrument-atelier-face-text` | `#F2F3F5` | `#1F2228` |
| `--color-instrument-atelier-accent` | `#66B9FF` | `#086CB8` |
| `--color-instrument-atelier-accent-halo` | `#1A1B1F` | `#FFFFFF` |
| `--shadow-instrument-atelier-panel` | `0 2px 4px #0000002E, 0 18px 40px #00000059` | `0 2px 4px #1B1D2114, 0 18px 40px #1B1D2129` |
| `--shadow-instrument-atelier-dial` | `0 10px 22px #00000066` | `0 10px 22px #1B1D2133` |
