# 05 Accessibility review (WCAG 2.1 AA), Nitro Forge

Status: phase 1 step 5. Written against branch `agent-native-20261119`, `packages/studio-workspace` and `packages/icons`. The review itself changed nothing under `packages/` or `apps/`. The later tokenization commit (3911299) did edit `packages/`, value-preservingly (`node tooling/codemod/prove-equivalence.mjs` shows zero diffs). The status-line citation in `a11y-status.json` was rechecked against the current tree: the `accessibilityLiveRegion` Text is at `index.tsx:273`.

**Read from source only.** Nothing was rendered. No simulator, device, browser or screen reader was used, and no screenshot was taken. Every FAIL is arithmetic on values in the source or a fact visible in a file at the cited line. Anything that needs a render is UNVERIFIED and names the test that settles it. The one thing that ran is Node: `contrast.mjs` imports `theme.ts` and `forge-directions.ts` directly (Node 26 strips the types, no install), and the repo's own `forge-directions.test.ts` and `interaction-policy.test.ts` pass 17 of 17.

Scope: the 17 admitted items of `03-design-handoff.md`. The four deferred binding adapters are not reviewed (decision 30). Companion files: `contrast.mjs` (`node docs/agent-native/contrast.mjs [--md|--matrix|--json]`), `a11y-status.json`, `02-design-system.md`, `tokens.map.json`. The sibling report for NYC-Tron is `05-accessibility-review.md` in that repo; the status rules below match it.

## Summary

| Status | Count | Items |
|---|---:|---|
| PASS | 6 | studio-gesture, persona-model, instrument-system, workspace-utilities, studio-ui-provider, forge-directions |
| FAIL | 10 | forge-workspace, forge-document-stage, quill-text-editor, prism-editor, prism-canvas, persona-turret, persona-composer, studio-theme, forge-icon, forge-icon-button |
| UNVERIFIED | 1 | nyc-tron-host |
| Total | 17 | |

Colour: 186 pairs computed from source, 18 FAIL, 1 conditional FAIL (hard-coded `#FFFFFF` icon on an active tab whose ground this repo does not set). Colour does not change with density, so the three densities have identical ratios. Targets do change: 44, 44, 48. Every density clears iOS 44 pt. Only `comfortable` clears Android 48 dp.

### The five worst findings

| Rank | Id | Severity | WCAG | Finding | Items |
|---:|---|---|---|---|---|
| 1 | N04 | Major | 1.4.3 | The "Cancel move" button on Prism's move-preview chip is a ghost Button, so its label is `text-text`, drawn on a hard-coded `#111827` chip. In the light scheme that is 1.11:1 (chrome text) or 1.24:1 (reference text). The only way out of a drag by pointer is unreadable in light mode. | prism-canvas |
| 2 | N07 | Major | 4.1.3 | The workspace status line ("Save complete", "Undo complete", errors from `perform`) announces through `accessibilityLiveRegion`, which React Native documents for Android only. On iOS VoiceOver gets nothing. PersonaComposer calls `announceForAccessibility` for the same job; the workspace does not. | forge-workspace |
| 3 | N08 | Major | 1.4.1, 4.1.2 | `ForgeIconButton` takes `status` (`success`, `error`, `recording`). It changes only the glyph colour, and the glyph is hidden from assistive tech. The button's `accessibilityState` carries selected, disabled and busy, never status. | forge-icon-button, forge-icon |
| 4 | N06 | Major | 1.4.11 | PersonaComposer text fields (name, import JSON, export JSON) are bounded only by a 1 px `c.line` border: 1.78/1.16:1 against their own ground and 1.57/1.37:1 against the panel (dark/light). The cause is the theme: `--color-border` is 1.2 to 1.54:1 on every surface it borders. | persona-composer, studio-theme |
| 5 | N05 | Major | 1.4.11 | Light-scheme fill chips in Prism: amber 1.98:1 and rose 2.62:1 against the chrome body, and the hairline that is meant to rescue them is 2.08:1. The visible name is not shown, so the swatch is the only visible cue. | prism-editor |

Next in line: N01 (light-scheme `muted` is 4.43:1 on `base` and 4.01:1 on the stage mat, used for 9 to 11 pt text), N02 (essay placeholder 3.98:1 in both schemes) and N10 (persona stops shrink to 37.4 pt in the narrow ring layout).

## Method and status rules

- **Values.** Colours come from `theme.ts` (`workspaceThemes`, `prismThemes`, `workspaceStatus`), `forge-directions.ts` (`workbenchChrome`, `forgeDirections`, `prismFillSwatches`) and `icons/src/tokens.js`, imported by the script, plus literals in `stage.tsx` and `prism-canvas.tsx` copied into it with their line in the "Where" column. A host can override colours, so the ratios describe the reference palettes, not an app.
- **Thresholds.** Text 4.5:1 (1.4.3), large text 3:1, UI components, state indicators and meaningful graphics 3:1 (1.4.11). Large text is 24 px, or 18.66 px at weight 700. No pair below relies on the large-text allowance. Disabled controls are exempt and listed as `exempt`. A hairline that no control relies on is listed as `decorative` and not judged.
- **Targets.** WCAG 2.1 AA has no target-size criterion (2.5.5 is AAA, 2.5.8 is 2.2). The brief sets the bar at 44 pt iOS and 48 dp Android. A miss against 44 pt counts as FAIL. A control sized at the 44 literal is 4 dp under Material's 48 dp and is reported as guideline finding N11, not counted in FAIL, the same rule the NYC-Tron report uses (its F08).
- **Reduced motion.** 2.3.3 is AAA. Findings are guideline findings and do not change status.
- **PASS.** Nothing in the source breaks an AA criterion and no open question remains beyond the global ones below.
- **FAIL.** The source proves a violation by arithmetic or by a missing semantic. An item that renders another failing item's output inherits it only where it supplies the failing pair itself.
- **UNVERIFIED.** The answer depends on a render, the host, or a screen reader. The reason and the test that settles it are given.
- **NYC-Tron parts** (Button, IconButton, TabBar, SegmentedControl, Toolbar, List, Banner, ErrorMessage, KeyValueList, LayerStack, PrecisionScrubber, DragGrabHandle) are read from the NYC-Tron clone at `1.0.0-rc.2`, the tarball `studio-workspace/package.json` pins. Their own verdicts live in that repo's report. Where a Forge item depends on one, this report cites the literal and does not repeat the verdict.

### Global open questions (apply to every interactive item, not repeated in each status)

| Id | Question | Test that settles it |
|---|---|---|
| GU1 | Do `focus-visible:ring-*` classes (NYC-Tron) and the web outlines in `persona-turret.tsx` paint on web, Windows and macOS hosts? | Web: Tab through every item in Chrome and read the computed `box-shadow` or `outline`. Hosts: the same pass with a hardware keyboard. |
| GU2 | What does each screen reader announce? Roles and labels here are read from props, not heard. | VoiceOver (iOS), TalkBack, NVDA or Narrator on the web build, one pass per item. |
| GU3 | Do the app's palette values match the reference values? | Run `contrast.mjs` with the app's values substituted. |
| GU4 | Do native hardware keyboards deliver `onKeyDown` to a React Native `View`? The Escape handlers (`index.tsx:185`, `prism-canvas.tsx`, `prism-editor.tsx:368`) are written for it and `keyboard-event.ts` reads both shapes. | iPad with keyboard and an Android device with keyboard: start a drag, press Escape. |

## Contrast matrix: light and dark across the three densities

`node docs/agent-native/contrast.mjs --matrix`. `resolveWorkspaceScale` returns space, size, radius, type and font only, so density cannot change a colour ratio. The script checks that (`colourInvariant: true`) and the six columns repeat by construction. The last three rows are the part density does change. `FAIL` marks a verdict below its threshold, `deco` a hairline no control relies on, `ex` an exempt disabled control.

| Pair | dark compact | dark standard | dark comfortable | light compact | light standard | light comfortable |
|---|---:|---:|---:|---:|---:|---:|
| workspace text/base | 14.76 | 14.76 | 14.76 | 13.1 | 13.1 | 13.1 |
| workspace text/raised | 12.89 | 12.89 | 12.89 | 14.28 | 14.28 | 14.28 |
| workspace muted/base | 7.94 | 7.94 | 7.94 | 4.43 FAIL | 4.43 FAIL | 4.43 FAIL |
| workspace muted/raised | 6.93 | 6.93 | 6.93 | 4.83 | 4.83 | 4.83 |
| workspace muted/deep | 8.55 | 8.55 | 8.55 | 4.01 FAIL | 4.01 FAIL | 4.01 FAIL |
| workspace accent/base | 7.8 | 7.8 | 7.8 | 5.25 | 5.25 | 5.25 |
| workspace accent/soft | 5.77 | 5.77 | 5.77 | 4.83 | 4.83 | 4.83 |
| workspace ink/accent | 7.69 | 7.69 | 7.69 | 5.72 | 5.72 | 5.72 |
| workspace error/raised | 8 | 8 | 8 | 5.68 | 5.68 | 5.68 |
| workspace error/base | 9.16 | 9.16 | 9.16 | 5.21 | 5.21 | 5.21 |
| workspace paperInk/paper | 12.32 | 12.32 | 12.32 | 12.32 | 12.32 | 12.32 |
| workspace paperMuted/paper | 3.98 FAIL | 3.98 FAIL | 3.98 FAIL | 3.98 FAIL | 3.98 FAIL | 3.98 FAIL |
| workspace line/base | 1.54 deco | 1.54 deco | 1.54 deco | 1.2 deco | 1.2 deco | 1.2 deco |
| workspace line/raised | 1.34 deco | 1.34 deco | 1.34 deco | 1.31 deco | 1.31 deco | 1.31 deco |
| workspace accent/raised | 6.81 | 6.81 | 6.81 | 5.72 | 5.72 | 5.72 |
| workspace accent/deep | 8.39 | 8.39 | 8.39 | 4.75 | 4.75 | 4.75 |
| workspace white/accent | 2.13 FAIL | 2.13 FAIL | 2.13 FAIL | 5.72 | 5.72 | 5.72 |
| workspace info/raised | 7.18 | 7.18 | 7.18 | 6.45 | 6.45 | 6.45 |
| workspace success/raised | 7.66 | 7.66 | 7.66 | 5.38 | 5.38 | 5.38 |
| workspace onError/error | 10.19 | 10.19 | 10.19 | 5.68 | 5.68 | 5.68 |
| prism text/base | 13.96 | 13.96 | 13.96 | 12.74 | 12.74 | 12.74 |
| prism muted/base | 8.08 | 8.08 | 8.08 | 4.64 | 4.64 | 4.64 |
| prism muted/raised | 6.76 | 6.76 | 6.76 | 5.21 | 5.21 | 5.21 |
| prism accent/base | 7.35 | 7.35 | 7.35 | 4.66 | 4.66 | 4.66 |
| prism ink/accent | 8.11 | 8.11 | 8.11 | 5.46 | 5.46 | 5.46 |
| prism accent/deep | 8.32 | 8.32 | 8.32 | 3.94 | 3.94 | 3.94 |
| prism error/raised | 7.14 | 7.14 | 7.14 | 5.45 | 5.45 | 5.45 |
| prism line/deep | 1.78 FAIL | 1.78 FAIL | 1.78 FAIL | 1.16 FAIL | 1.16 FAIL | 1.16 FAIL |
| prism line/base | 1.57 FAIL | 1.57 FAIL | 1.57 FAIL | 1.37 FAIL | 1.37 FAIL | 1.37 FAIL |
| prism text/deep | 15.82 | 15.82 | 15.82 | 10.77 | 10.77 | 10.77 |
| chrome text/body | 14.69 | 14.69 | 14.69 | 13.6 | 13.6 | 13.6 |
| chrome muted/body | 8.5 | 8.5 | 8.5 | 5.83 | 5.83 | 5.83 |
| chrome muted/selected | 6.23 | 6.23 | 6.23 | 5.26 | 5.26 | 5.26 |
| chrome selectedMuted/selected | 9.15 | 9.15 | 9.15 | 7.85 | 7.85 | 7.85 |
| chrome accent/body | 7.73 | 7.73 | 7.73 | 4.66 | 4.66 | 4.66 |
| chrome disabledInk/well | 5.2 ex | 5.2 ex | 5.2 ex | 3.62 ex | 3.62 ex | 3.62 ex |
| chrome edge/body | 1.5 deco | 1.5 deco | 1.5 deco | 3.78 deco | 3.78 deco | 3.78 deco |
| chrome chipRing/body | 14.69 | 14.69 | 14.69 | 13.6 | 13.6 | 13.6 |
| chrome chipEdge/body | 3.2 | 3.2 | 3.2 | 2.08 FAIL | 2.08 FAIL | 2.08 FAIL |
| chrome text/accent15>body | 10.95 | 10.95 | 10.95 | 11.15 | 11.15 | 11.15 |
| chrome fill violet/body | 2.85 FAIL | 2.85 FAIL | 2.85 FAIL | 4.89 | 4.89 | 4.89 |
| chrome fill teal/body | 4.24 | 4.24 | 4.24 | 3.28 | 3.28 | 3.28 |
| chrome fill amber/body | 7.04 | 7.04 | 7.04 | 1.98 FAIL | 1.98 FAIL | 1.98 FAIL |
| chrome fill rose/body | 5.31 | 5.31 | 5.31 | 2.62 FAIL | 2.62 FAIL | 2.62 FAIL |
| **target (pt)** | 44 | 44 | 48 | 44 | 44 | 48 |
| **meets iOS 44** | yes | yes | yes | yes | yes | yes |
| **meets Android 48** | NO | NO | yes | NO | NO | yes |

Other target sizes by density, from `theme.ts`: rail 64 / 72 / 80, header 52 / 60 / 68, toolbar 44 / 52 / 60, status 24 / 28 / 32 (not a control). `theme.css` holds `--spacing-forge-target: 44px` as one constant, so a CSS consumer stays at 44 in `comfortable` where the TypeScript scale gives 48 (finding N11).

### Direction materials (persona-turret, 3 directions by 2 schemes, 42 pairs)

All 42 pass. Lowest text ratio 5.83 (workbench light `muted` on the solid panel). Lowest UI ratio 4.66 (workbench light `accent` on the solid panel, against 3:1). The dial readout drawn at opacity 0.78 holds 5.94 at the lowest. The glass panels (optics) are covered by `forge-directions.test.ts`, which I ran: 17 of 17 pass, including glass over three backdrops, the committed-slot halo at 3:1 and the editor chrome at 4.5:1 and 3:1.

### Drifted pairs from 02-design-system

Decision 5, 16 and 20 keep these as separate tokens, so they stay as they are. This table says what the drift costs in contrast if a host falls back to the icon defaults.

| Drift | Pair | Dark | Light | Verdict |
|---|---|---:|---:|---|
| D4 ink | icon `ink` `#18202D` / `inkInverse` `#F8FAFC` on workspace base | 15.91 | 15.01 | pass |
| D4 ink | icon `ink` on workspace raised | 13.88 | 16.36 | pass |
| D4 ink | icon default `appearance="light"` ink `#18202D` on the dark workspace base `#1C1E25` (host passes neither `appearance` nor `color`) | 1.02 | n/a | **FAIL** |
| D4 muted | icon `muted` `#737F91` on workspace base (disabled, exempt) | 4.10 | 3.72 | exempt, passes 3:1 |
| D1 accent | icon `accent` `#6859E8` on workspace base | 3.31 | 4.61 | pass |
| D1 accent | icon `accent` `#6859E8` on workspace raised | 2.89 | 5.02 | **FAIL dark** |
| D3 success | icon `positive` `#139E75` on raised (workspace `success` for comparison) | 4.27 (7.66) | 3.40 (5.38) | pass, weaker than workspace |
| D3 danger | icon `negative` `#D94462` on raised (workspace `error` for comparison) | 3.43 (8.00) | 4.24 (5.68) | pass, weaker than workspace |
| D5 stage paper | `#283329` ink on stage paper `#f7f5ed` vs on workspace paper `#FFFEFC` | 12.06 vs 13.06 | same | pass both |
| D5 stage paper | stage paper `#f7f5ed` against the light mat `#E7EAF1` (edge only) | 16.41 | 1.10 | decorative |
| Prism blue | prism accent vs workspace accent (dark `#66B9FF` / `#B7A5FF`, light `#086CB8` / `#6950D1`) | 1.01 | 1.05 | info only, they differ in hue not luminance |
| Prism blue | prism accent vs launcher purple `#9C5FE6` | 1.92 | 1.35 | info only |
| Icon surface | icon ink on its own surface `#FFFFFF` / `#11131B` | 17.72 | 16.36 | pass |
| Icon surface | icon `accent` on `#11131B` | 3.69 | 5.02 | pass |

The shipped call sites in `packages/studio-workspace/src` all pass an explicit `color`, so the two drift FAILs have no live instance today. They bite a host that renders `<ForgeIcon name="save" />` as the handoff example does (finding N09).

## ForgeIcon specifically

**Decorative or labelled.** Decorative, always. `ForgeIcon` wraps its output in `accessible={false}`, `accessibilityElementsHidden`, `importantForAccessibility="no-hide-descendants"` and `aria-hidden` (`ForgeIcon.js:73-74`), and the inner `Svg` repeats `accessible: false, focusable: false, aria-hidden` (`ForgeIcon.js:11`). It has no `label` prop and cannot be named. The name comes from the control around it. `ForgeIconButton` requires a non-blank `label` and throws a `TypeError` without one (`ForgeIcon.js:88-89`). Every icon-only control in the workspace goes through NYC-Tron's `IconButton`, whose type requires `aria-label` (`ui.tsx`, `StudioIconButtonProps`). So no shipped icon is the sole carrier of a name.

**Does the 47-of-1,463 gap produce an unlabelled fallback.** No fallback of any kind. `getGlyph` returns `undefined` for a name with no artwork, and `ForgeIcon` then returns `null` (`ForgeIcon.js:63`) with no warning. So a missing glyph is not an unlabelled graphic, it is nothing. The accessibility cost is on the sighted side: `ForgeIconButton` with an undrawn name still renders a 44 by 44 `Pressable` with a label and `role=button`, which a screen-reader user hears and a sighted user sees as empty space. The numbers, counted by running `icons/src/glyphs.js` and `catalog.js`:

| Count | Value |
|---|---:|
| Drawn glyphs (`glyphIds`) | 47 |
| Catalog ids (`iconIds`) | 1,463 |
| Catalog ids that resolve to artwork (`getGlyph` matches the last path segment) | 42 |
| Drawn glyphs that are not catalog ids (`brush`, `scissors`, `table`, `pdf`, `music`, `sparkles`) | 6 |
| Distinct icon names used by `packages/studio-workspace/src` (literals) | 23, all drawn |

Two consequences. First, `hasIconId('brush')`, `hasIconId('table')`, `hasIconId('pdf')` and `hasIconId('music')` are false, yet `appIcons` in `index.tsx:39` uses all four for Prism, Tally, Folio and Cadence. A validator built on the catalog would reject names the workspace ships. Second, 1,421 catalog ids render nothing. The registry text must say "47 drawn" (decision 8) and must not suggest `ForgeIcon` can draw any catalog id. The owner can choose to warn in development or draw a neutral placeholder; I did not add either because both change behaviour.

**Other ForgeIcon facts.** State is never carried by colour alone for selection (outline to filled), but is for `status` (N08). `reducedMotion` defaults to `false` and the component does not read the OS setting, so a host that omits it gets a 225 ms crossfade, a press spring and an 850 ms looping rotation while loading (guideline only). Every workspace call site passes `reducedMotion`. A host-supplied `renderRive` result is returned directly, before the hidden wrapper (`ForgeIcon.js:64-69`, the `return rive` is line 69), so the Rive node is not hidden from assistive tech unless the host hides it.

## Per item

Each item lists: (a) contrast, (b) focus and keyboard path, (c) touch target, (d) screen-reader roles, labels and states, (e) reduced motion, (f) status. Ratios are dark/light. Line numbers are in the file named in the heading.

### forge-workspace

Source: `packages/studio-workspace/src/index.tsx`, `model.ts`, `keyboard-event.ts`, `drag-transport.ts`, `drag-transport.native.ts`

- (a) Contrast: `text`/`base` 14.76/13.10; `muted`/`base` 7.94/**4.43** (header caption 11 pt, status line 11 pt, rail labels 9 pt at `index.tsx:190,196`); `accent`/`base` 7.80/5.25; `ink`/`accent` for Save 7.69/5.72; `error`/`raised` 8.00/5.68; `accent`/`soft` for the arrange banner 5.77/4.83. The hard-coded `#FFFFFF` icon on the active dock tab (`index.tsx:175`) is 2.13:1 on the dark accent. Its ground is NYC-Tron's TabBar, so that one is conditional (N15). The selected-button fill `bg-ink-800` (`index.tsx:115`) is a class no file in this repo defines, so the selected cue may be icon colour only.
- (b) Focus and keyboard: Escape cancels a drag through `onKeyDown` on the root View (`index.tsx:185`, GU4). The drag has a non-gesture route: a Dock position `SegmentedControl`, Move before, Move after, Narrower and Wider buttons in arrange mode. Order follows the tree: header, toolbar, rail, docks, stage, bottom bar, status. No `tabIndex` is set. Focus ring is NYC-Tron's `focus-visible:ring-2 ring-focus` (Button.tsx:55) with `--color-focus` equal to accent, 6.81/5.72 on `raised`; a transparent border keeps the shape under Windows High Contrast (`index.tsx:114`).
- (c) Target: every `button()` passes `targetSize: scale.size.target` (`index.tsx:112-115`): 44 compact, 44 standard, 48 comfortable, plus `min-h-12 min-w-12` in comfortable. iOS 44 passes in all three. Android 48 misses in two (N11). Menu trigger `minHeight`/`minWidth` `scale.size.target`; rail width 64/72/80. NYC-Tron's `DragGrabHandle` and `TabBar` sizes are not set here (UNVERIFIED, their report).
- (d) Screen reader: `TabBar aria-label="<dock> dock panels"`, `SegmentedControl aria-label="Dock position for <panel>"`, icon buttons carry `aria-label`, toggles pass `accessibilityState.selected` (`index.tsx:111`), drag handle label "Drag <panel> to a dock edge". Gaps: `accessibilityLabel="Studio panels"` sits on a View with no role (`index.tsx:253`, N12, fix M3); "Document history" is a plain `Text` (`index.tsx:144`, fix M2); the status line uses `accessibilityLiveRegion="polite"` (`index.tsx:272`), Android and web only (N07).
- (e) Reduced motion: no authored animation. `AccessibilityInfo.isReduceMotionEnabled` feeds `ForgeIcon.reducedMotion`; the store starts at `true` (`index.tsx:49`), so the safe value shows until the OS answers. Pass.
- (f) Status: **FAIL**.
  - N01 1.4.3: light `muted` on `base` 4.43:1 for 9 to 11 pt text.
  - N07 4.1.3: status messages are not announced on iOS.
  - Also N11 (guideline), N12 (metadata).
  - UNVERIFIED: selected cue when `bg-ink-800` is undefined (N16); active-tab icon on dark (N15); drag handle target and focus (NYC-Tron report); Escape on native (GU4). Tests: render dark scheme and screenshot a selected rail button; Tab and VoiceOver pass.

### forge-document-stage

Source: `stage.tsx`

- (a) Contrast: ink `#283329` on stage paper `#f7f5ed` 12.06; `#66735f` captions 4.60 (13 pt and 12 pt); `#798373` blank-slide hint 12 pt **3.63**; `#637161` on `#e5e9dd` for Tally column and row headers 12 pt **4.19**; clip labels `#ffffff` on `#637660` 4.89 and `#725d7c` 5.88 at 10 pt; track names `#b9c7ba` on `#222829` 8.51; stage caption `#99a19d`/`#556359` on the mat 6.77/5.26; heading `#eef0e9`/`#202923` on the mat 15.59/12.43. Paper edge against the light mat is 1.10:1 and is a page boundary, not a control (decorative).
- (b) Focus and keyboard: nothing interactive. Text is `selectable`. Scrolling uses `ScrollView`; a keyboard scroll path on web is UNVERIFIED.
- (c) Target: none.
- (d) Screen reader: no roles anywhere. The Tally projection is 12 rows of six `Text` cells with no table, row or cell roles (`stage.tsx:30-31`), so cell and header association is lost (N13, 1.3.1). Pitch objects and Prism shapes are positioned Views with no label; the `heading()` detail line gives counts and size ("3 layers", "800 × 600 px") but not the content. Headings are `Text` with no header role (`stage.tsx:17`, fix M1).
- (e) Reduced motion: no motion. Pass.
- (f) Status: **FAIL**.
  - N03 1.4.3: `#798373` 3.63:1 and `#637161` 4.19:1 at 12 pt.
  - N13 1.3.1: Tally grid has no table semantics.
  - Also N12 (heading role).

### quill-text-editor

Source: `text-editor.tsx`

- (a) Contrast: essay ink `paperInk`/`paper` 12.32/12.32; placeholder `paperMuted` `#797F8D` on `#FFFEFC` **3.98**/**3.98** (`text-editor.tsx:151`); word-count line `muted` 11 pt on the stage mat: 8.55 dark, **4.01** light (N01). Banner and Button colours are NYC-Tron's.
- (b) Focus and keyboard: one multiline `TextInput`, an Apply button and, on conflict, a Discard button. Order: Apply, essay, Discard. Apply is disabled when the draft is clean, busy or in conflict. `keyboardShouldPersistTaps="handled"`. The essay field draws no focus style (`borderWidth: 0`, transparent ground); on web whether the browser ring shows depends on React Native Web's default (UNVERIFIED, test: Tab into the field in Chrome).
- (c) Target: Apply and Discard `targetSize: scale.size.target` 44/44/48, `min-h-12 min-w-12` in comfortable. iOS pass, Android guideline (N11). The text field is a large area.
- (d) Screen reader: `accessibilityLabel="Essay text"`, `aria-label="Apply essay text"`, `aria-label="Discard draft and load latest document"`. Errors and conflicts render in `Banner` with `live="alert"`, dirty status with `live="status"` (3.3.1 met). Busy sets `loading` on the button (NYC-Tron maps it to `busy`).
- (e) Reduced motion: icons get a constant `reducedMotion`. No other motion. Pass.
- (f) Status: **FAIL**.
  - N02 1.4.3: placeholder 3.98:1 in both schemes (needs `#717683` or darker on `#FFFEFC`).
  - N01 1.4.3: word count 4.01:1 in light.
  - Also N11 (guideline).

### prism-editor

Source: `prism-editor.tsx`, `prism-layers.ts`, `prism-layer-label.ts`, `prism-layout.ts`, `prism-transform.ts`, `rgba-png.ts`

- (a) Contrast: Workbench chrome `text`/`body` 14.69/13.60; `muted`/`body` 8.50/5.83; `selectedMuted`/`selected` 9.15/7.85; `accent`/`body` 7.73/4.66; persona trigger label over the 15 percent accent wash 10.95/11.15; chosen-chip ring 14.69/13.60; disabled glyph 5.20/3.62 (exempt). Fill chips: dark teal 4.24, amber 7.04, rose 5.31, violet 2.85 (rescued by its 3.20 hairline); **light** amber **1.98**, rose **2.62**, hairline **2.08** (N05). Layer rows read 4.5:1 per the repo test (ran, passes).
- (b) Focus and keyboard: the persona panel is `role="dialog"` with `aria-modal`, `accessibilityViewIsModal` on the sheet, and Escape closes it (`prism-editor.tsx:368`). On web, closing returns focus to the trigger (`prism-editor.tsx:283`). No focus trap is written, so Tab can leave the dialog while `aria-modal` is set (UNVERIFIED, test: Tab from the last control in Chrome). Dragging a shape has a keyboard route: the Transform menu lists ten move and scale actions (`prism-transform.ts:3-14`). Persona turret is keyboard operable (see that item).
- (c) Target: fill chips `scale.size.target` square (`prism-editor.tsx:444`); persona trigger `minHeight: scale.size.target`; toolbar `minHeight: scale.size.target + 4`; Transform trigger View `minHeight`/`minWidth` target. `control()` passes no `targetSize` (`prism-editor.tsx:199-209`), so tool buttons take NYC-Tron's defaults at rc.2: IconButton `sm` is 44 by 44 (IconButton.tsx:46), Button `sm` is `minHeight: 40` plus `hitSlop` 2, a 44 pt hit area (Button.tsx:59,61). iOS pass. Android guideline (N11).
- (d) Screen reader: persona trigger `role=button` with label "Persona: <name>", hint, `aria-expanded`; fill chips `role=button`, "Choose violet fill", `selected`; composite `Image` "Prism canvas composite"; layers toggle `selected`. Gaps: `accessibilityLabel="Creation tools"` (`prism-editor.tsx:428`) and the fill bar label (`prism-editor.tsx:439`) sit on Views with no role (N12, fix M4); a swatch's name is spoken but never shown (N05). Persona changes are announced through `announceForAccessibility` on native and a live region on web.
- (e) Reduced motion: no authored animation outside the turret; icons use a constant `reducedMotion`; the persona panel closes after `forgeFeedbackMotion.commit.ms` through a timer, not an animation. Pass.
- (f) Status: **FAIL**.
  - N05 1.4.11: light fill chips 1.98, 2.62 and a 2.08:1 hairline.
  - Also N11, N12.
  - UNVERIFIED: dialog focus trap; LayerStack and PrecisionScrubber behaviour (NYC-Tron report, both UNVERIFIED there).

### prism-canvas

Source: `prism-canvas.tsx`, `prism-canvas-model.ts`

- (a) Contrast: move-preview caption `#FFFFFF` on `#111827` 17.74. The "Cancel move" Button is `variant="ghost"`, whose label class is `text-text` (NYC-Tron Button.tsx, `variants.ghost`), on that same chip: chrome text dark 15.98, **light 1.11**, reference light `#252A3A` **1.24** (N04). The selection outline is `props.color`, a host value against a checker of `#FFFFFF`/`#EDEFF3`: UNVERIFIED (3:1 needs a host colour of about `#767676` or darker).
- (b) Focus and keyboard: the artboard View is `focusable` and takes focus on pointer begin (`prism-canvas.tsx:87`). Escape, scroll, resize and blur cancel a gesture. This item has no keyboard move of its own. The keyboard route is PrismEditor's Transform menu, so a standalone host must supply one (2.1.1, UNVERIFIED for standalone use). No focus indicator is drawn on the artboard.
- (c) Target: the artboard is the gesture surface. "Cancel move" is a Button `sm`, a 44 pt hit area via `hitSlop`; Android guideline (N11).
- (d) Screen reader: `accessibilityLabel="Prism artboard. Select layers or use Transform for accessible move actions."` is on a View that is not `accessible` and has no role (`prism-canvas.tsx:89`). React Native does not expose a label on a non-accessible View to VoiceOver. UNVERIFIED on iOS. Setting `accessible` would merge the children and hide the Cancel button from VoiceOver, so this is not a metadata fix (deferred table D07). "Move preview" text is not a live region.
- (e) Reduced motion: none. Pass.
- (f) Status: **FAIL**.
  - N04 1.4.3: Cancel move label 1.11:1 (chrome light) and 1.24:1 (reference light).
  - UNVERIFIED: artboard label on iOS; selection outline colour; standalone keyboard move. Tests: VoiceOver swipe to the artboard; sample the outline over the checker; keyboard-only move on a standalone mount.

### studio-gesture

Source: `studio-gesture.tsx`, `studio-gesture.native.tsx`, `studio-gesture-types.ts`

- (a) Contrast: draws nothing.
- (b) Focus and keyboard: pointer and touch recognition only: `Race(Pan, Tap)` on native, `PanResponder` on web. A plain tap runs begin and release at the same point, so a single-pointer, non-path route exists (2.5.1). A second finger cancels (`onTouchesDown`). No key handling, which is correct for a wrapper. Callers own the keyboard route (checked in prism-canvas, persona-turret).
- (c) Target: none of its own.
- (d) Screen reader: sets no role, label or state and does not alter the child's. Nothing missing for a wrapper.
- (e) Reduced motion: none.
- (f) Status: **PASS**. Reason: no output, no semantics changed, single-pointer.

### persona-turret

Source: `persona-turret.tsx`, `turret.ts`, `turret-motion.tsx`, `turret-motion.native.tsx`, `turret-motion-types.ts`

- (a) Contrast: 42 direction pairs, all pass (table above). Stop names `m.text`/`m.muted` on the solid panel 14.69/8.50 workbench dark, 13.60/5.83 workbench light. Readout `faceText` on the face 8.50 to 17.50 dark and 10.32 to 16.61 light, 5.94 at opacity 0.78. Committed ring on its halo 5.46 to 9.61.
- (b) Focus and keyboard: the ring is `focusable`, `accessibilityRole="adjustable"` with `increment`, `decrement`, `activate` and `escape` actions (`persona-turret.tsx:411-419`), so VoiceOver swipe up and down works without a gesture. Web keys go through `onKeyDown` (`persona-turret.tsx:377`). A focus ring is drawn 5 px outside the bezel at `focusColor` (accent, `Highlight` under forced colours), and each stop gets a 2 px outline when focused. Blur cancels a pending preview.
- (c) Target: stop names are `minHeight: frame.labelHeight` (44, or 44 times the text scale) by 80 wide. In the ring layout the whole box is scaled by `frame.scale` (`persona-turret.tsx:399`), and the layout stays a ring until the scale falls under `TURRET_MIN_RING_SCALE = 0.85` (`turret.ts:150`). So a panel narrower than the dial box (300 to 320 pt at text scale 1) draws stop targets at 37.4 to 44 pt (N10). The stacked layout draws rows at full height. Android guideline (N11).
- (d) Screen reader: `radiogroup` with a label, each stop `role=radio` with `accessibilityState.checked` and `aria-checked`, a spoken name that includes the shortcut digit, `aria-valuemin`, `aria-valuemax`, `aria-valuenow`, `aria-valuetext` on web, and `accessibilityValue` on native. Changes are announced with `announceForAccessibility` natively and a hidden live region on web.
- (e) Reduced motion: Reduce Motion sets detent travel to 0 ms, replaces the end-stop nudge with an opacity pulse, and sets the press transition to `0ms`. Reduce Transparency and Increase Contrast turn glass off. The prefs store starts with `reduceMotion: false` and fills from the OS asynchronously (`persona-turret.tsx:109,135`), so the first frames can animate. Pass, with that note.
- (f) Status: **FAIL**.
  - N10 target: stop targets fall to 37.4 pt in the narrow ring layout.
  - Also N11.

### persona-composer

Source: `persona-composer.tsx`, `persona-composer-model.ts`

- (a) Contrast: Prism palette `text`/`base` 13.96/12.74, `muted`/`base` 8.08/4.64, `text`/`deep` (field text) 15.82/10.77, `error`/`raised` 7.14/5.45. Field border `c.line` against the field's ground `c.deep` **1.78/1.16** and against the panel `c.base` **1.57/1.37** (N06). The light segmented control keeps text ink because `muted` fails on its well, which the source comments on (`persona-composer.tsx:70-76`).
- (b) Focus and keyboard: reorder has a non-drag route, Up and Down buttons with `aria-label="Move <name> up"` (`persona-composer.tsx:313-314`), plus the drag handle. Segmented and button focus rings are NYC-Tron's plus `aria-checked:focus-visible:ring-2` on the surface control. Toggles and folds are Pressables in tree order.
- (c) Target: name field, toggles, folds, list rows and the empty rail `minHeight: scale.size.target`; row menu `minWidth`/`minHeight` target. Up, Down and Remove take NYC-Tron `sm` defaults (44 hit area). Manifest status lines are `minHeight: 28` and not interactive. Android guideline (N11).
- (d) Screen reader: headings `accessibilityRole="header"` with `aria-level` 1 and 2, `list` and `listitem` roles, labels on all three text inputs ("Persona name", "Persona JSON to import", "<name> as JSON"), `expanded` and `selected` states, `announceForAccessibility` on native for moves, save and import errors, and a hidden live region on web.
- (e) Reduced motion: none authored. Pass.
- (f) Status: **FAIL**.
  - N06 1.4.11: field boundaries 1.16 to 1.78:1.
  - Also N11.

### persona-model

Source: `persona.ts`, `persona-store.ts`

- Non-visual store and registry. (a) to (e) not applicable. Error text it produces (for example "'<name>' is built in and cannot be removed") is plain and names the cause (3.3.1 is the host's to render).
- (f) Status: **PASS**. Reason: no rendered output.

### instrument-system

Source: `instrument-system.ts`, `interaction-policy.ts`

- Data and policy, no UI. `forgeHitTarget` returns 48 for `touch`, `pen`, `controller` and the `presentation` density, and 44 for `pointer` and `keyboard` (`interaction-policy.ts:53-56`). That matches iOS 44 and Android 48 for each input kind. `forgeMotionProfile` honours `reducedMotion` (`:44-49`). The repo test "visual density never shrinks touch, pen or accessible hit targets" passes. The durations are a design budget (the file says so), and the two eases are struck (decision 25).
- (f) Status: **PASS**. Reason: policy values meet the bar; no rendered output.

### workspace-utilities

Source: `app-manifest.ts`, `json-problem.ts`

- Non-visual. (f) Status: **PASS**. Reason: no rendered output.

### studio-ui-provider

Source: `ui.tsx`

- A context and 27 slot types. It sets no semantics and passes props through. The types push the right way on names: `StudioIconButtonProps` requires `'aria-label'`, `StudioSegmentedControlProps` requires `'aria-label'`, `StudioPopoverProps` requires `accessibleLabel`. Two optional names remain: `StudioTabBarProps['aria-label']` and `StudioMenuProps` `title` and `triggerLabel` (the host falls back to "Actions"). Making them required is a type change, listed as D11. A missing provider throws, so no unlabelled substitute UI renders.
- (f) Status: **PASS**. Reason: no output; contracts require names where they matter.

### nyc-tron-host

Source: `nyc-tron-host.tsx`, `nyc-tron-options.ts`

- (a) Contrast: none of its own; colour comes from `StudioTokenScope` variables.
- (b) Focus and keyboard: forwards to NYC-Tron parts. The platform menu and popover are host-supplied (`ActionMenu`, `NativePopover`), so their focus trap and Escape behaviour are not in this repo.
- (c) Target: passes `targetSize` to Button and sets `minWidth`/`minHeight` from it (`nyc-tron-host.tsx:44-48`); NYC-Tron throws a `RangeError` under 44 (Button.tsx:47, IconButton.tsx:43), a useful guard.
- (d) Screen reader: Button drops `selected` and `tone` and passes `accessibilityState: { selected }`. NYC-Tron merges `rest.accessibilityState` before `disabled` and `busy` (Button.tsx:65), so selected survives alongside them. Because `selected` is not forwarded, NYC-Tron's own selected styling does not apply to a Button; the caller adds a class instead (N16). Menu label is `triggerLabel ?? title ?? 'Actions'`; Popover label is `"<accessibleLabel>: <title>"`.
- (e) Reduced motion: none.
- (f) Status: **UNVERIFIED**. Reason: menu and popover accessibility is the host's.
  - Test: VoiceOver and TalkBack on the Workspace menu and a popover (open, Escape, focus return); hear a selected Button announced as selected; screenshot a selected Button in dark.

### studio-theme

Source: `theme.ts`, `theme.css`, `theme.native.css`

- (a) Contrast: in dark, every text pair is at least 6.93. In light, `muted` is **4.43** on `base` and **4.01** on `deep`, and `paperMuted` is **3.98** on `paper` in both schemes (suggested floor `#616A7E` on `#E7EAF1` and `#717683` on `#FFFEFC`, same hue, unapplied). The border tokens are 1.54/1.34 (dark) and 1.20/1.31 (light) on the surfaces they edge, the root of N06. Status tokens pass: info 7.18/6.45, success 7.66/5.38, `onError` on error 10.19/5.68. The focus token equals accent: 6.81/5.72 on `raised`, 8.39/4.75 on `deep`.
- (b) to (d): tokens only. `--color-focus` exists, so a ring is possible; whether it paints is GU1.
- (c) Target: `--spacing-forge-target: 44px` is constant in `theme.css`; the TypeScript scale gives 48 in comfortable (N11).
- (e) Motion: no motion tokens (`tokens.map.json` proposes 36).
- (f) Status: **FAIL**.
  - N01 1.4.3: light `muted` on `base` and `deep`.
  - N02 1.4.3: `paperMuted` on `paper`.
  - N06 1.4.11: `--color-border` is 1.2 to 1.54:1 where it is the only edge.

### forge-directions

Source: `forge-directions.ts`

- Palette and policy data for the turret. (a) 42 pairs, all pass (table above); min text 5.83, min UI 4.66; the file ships `luminance`, `contrastRatio`, `glassAllowed` and `detentDurationMs`, and its test (ran, 17 of 17) holds glass to 4.5:1 over three backdrops. (b) to (d) not applicable. (e) `detentDurationMs` returns 0 under Reduce Motion. The 44 pt stop height is in `turretGeometry.labelHeight`.
- (f) Status: **PASS**. Reason: every pair passes and the repo test holds them.

### forge-icon

Source: `packages/icons/src`: `ForgeIcon.js`, `state.js`, `tokens.js`, `glyphs.js`, `catalog.js`, `ForgeIcon.d.ts`, `index.d.ts`, `index.js`

- (a) Contrast: own defaults pass: ink on its surface 17.72/16.36, accent 3.69/5.02, positive 5.45/3.40, negative 4.37/4.24 (all over 3:1), muted 4.57/4.06 (disabled, exempt). The drift table above shows the two defaults that fail on the suite's own dark surfaces: ink with the default `appearance="light"` on `#1C1E25` is **1.02**, and accent `#6859E8` on `raised` `#262932` is **2.89**.
- (b) Focus and keyboard: not interactive.
- (c) Target: none.
- (d) Screen reader: decorative and hidden, see the ForgeIcon section. A host `renderRive` result is not hidden by the component.
- (e) Reduced motion: `reducedMotion` defaults to `false` and is not read from the OS; with it set, all motion stops. Without it the icon animates (guideline only).
- (f) Status: **FAIL**.
  - N09 1.4.11: default `appearance="light"` gives 1.02:1 on a dark host; default accent is 2.89:1 on dark `raised`. The handoff example `<ForgeIcon name="save" />` uses the defaults.
  - N08 1.4.1: `status` success, error and recording change colour only.
  - Not counted: 1,421 catalog ids render nothing (N18).

### forge-icon-button

Source: `packages/icons/src/ForgeIcon.js` (the `ForgeIconButton` export, lines 86-98)

- (a) Contrast: as forge-icon, plus the glyph colour per state (idle ink, selected accent, success positive, error negative). Disabled is exempt at opacity 0.52.
- (b) Focus and keyboard: a `Pressable`, so native focus and Enter or Space on web. It authors no focus style, so web keyboard focus relies on the browser or React Native Web default (UNVERIFIED, test: Tab to it in Chrome and look for a ring, GU1). `hover` and `pressed` are visual state only.
- (c) Target: `minWidth: 44`, `minHeight: 44` and `hitSlop: 4` (`ForgeIcon.js:93-94`), so the touch area is 52. iOS 44 passes. Android 48 passes on the hit area and misses on view bounds (what an accessibility scanner reads), N11.
- (d) Screen reader: `accessibilityRole="button"`, `accessibilityLabel={label}`, `accessibilityState {selected, disabled, busy}`. A blank label throws. `status` is not exposed (N08, fix M5). A name with no artwork gives a labelled, empty 44 pt button.
- (e) Reduced motion: inherits forge-icon; the host passes `reducedMotion` through `...rest`.
- (f) Status: **FAIL**.
  - N08 1.4.1, 4.1.2: `status` is colour only and the glyph is hidden from assistive tech.

## All findings

| Id | Severity | WCAG | Finding | Items |
|---|---|---|---|---|
| N01 | Major | 1.4.3 | Light `muted` `#687287` is 4.43:1 on `base` and 4.01:1 on `deep`, used for 9 to 11 pt text. | forge-workspace, quill-text-editor, studio-theme |
| N02 | Major | 1.4.3 | `paperMuted` `#797F8D` is 3.98:1 on `paper` `#FFFEFC` in both schemes (essay placeholder). | quill-text-editor, studio-theme |
| N03 | Major | 1.4.3 | Stage text `#798373` on `#f7f5ed` 3.63:1 and `#637161` on `#e5e9dd` 4.19:1, both 12 pt. | forge-document-stage |
| N04 | Major | 1.4.3 | "Cancel move" ghost label on the `#111827` chip is 1.11:1 or 1.24:1 in light. | prism-canvas |
| N05 | Major | 1.4.11 | Light fill chips 1.98:1 (amber), 2.62:1 (rose), hairline 2.08:1. | prism-editor |
| N06 | Major | 1.4.11 | Composer field borders 1.16 to 1.78:1; `--color-border` is 1.2 to 1.54:1. | persona-composer, studio-theme |
| N07 | Major | 4.1.3 | Status line live region is Android and web only; iOS silent. | forge-workspace |
| N08 | Major | 1.4.1, 4.1.2 | Icon `status` is colour only and not in the button's state. | forge-icon-button, forge-icon |
| N09 | Major | 1.4.11 | Icon default ink on a dark host 1.02:1; default accent on dark `raised` 2.89:1. | forge-icon |
| N10 | Major | iOS 44 pt | Persona stop targets scale to 0.85 of 44, 37.4 pt, in the narrow ring layout. | persona-turret |
| N11 | Guideline | Material 48 dp | Controls sized by the 44 literal in compact and standard, and the CSS target is 44 in every density. Not counted in FAIL. | forge-workspace, quill-text-editor, prism-editor, prism-canvas, persona-turret, persona-composer, forge-icon-button, studio-theme |
| N12 | Minor | 1.3.1, 4.1.2 | Labels on Views with no role ("Studio panels", "Creation tools", fill bar); headings without a header role. | forge-workspace, prism-editor, forge-document-stage |
| N13 | Minor | 1.3.1 | Tally grid has no table, row or cell roles. | forge-document-stage |
| N14 | Unverified | 4.1.2 | Artboard label on a non-accessible View may not reach VoiceOver. | prism-canvas |
| N15 | Unverified | 1.4.11 | Hard-coded `#FFFFFF` active-tab icon is 2.13:1 on dark accent if the tab ground is accent. | forge-workspace |
| N16 | Unverified | 1.4.11 | `bg-ink-800` is defined nowhere in the repo, and the host Button drops `selected`, so the selected cue may be the icon colour alone. | forge-workspace, nyc-tron-host |
| N17 | Unverified | 2.4.7 | Dialog focus trap, essay field and icon button focus ring on web. | prism-editor, quill-text-editor, forge-icon-button |
| N18 | Minor | 1.1.1, 2.4.6 | An undrawn icon name renders nothing, and `ForgeIconButton` then shows a labelled, empty 44 pt button. 1,421 of 1,463 catalog ids. | forge-icon, forge-icon-button |

## Fixes deferred to owner

Every FAIL changes a pixel, a behaviour or a public type, so none is applied. Ranked as in the summary.

| Id | Finding | Fix proposed | Why it is not applied here | Decision |
|---|---|---|---|---|
| D01 | N04 Cancel move label | Give the chip a scheme-aware ground, or make the label `#FFFFFF`, so it holds 4.5:1. | Changes pixels. | Design call: chip ground vs label. |
| D02 | N07 iOS status | Call `AccessibilityInfo.announceForAccessibility(status)` on iOS when `status` changes, as PersonaComposer does. | Adds behaviour. | Owner: wording and rate limiting for "Undo…" then "Undo complete". |
| D03 | N08 icon status | Expose status in the button's `accessibilityValue` (M5 is the minimal form) and add a non-colour cue for error and success. | Metadata part is safe, the visible cue is not. | Owner: the visible non-colour cue. |
| D04 | N06 field borders and theme border | Raise `--color-border` to 3:1 where it is a field edge, or add a second token for field edges. | Changes pixels across both studios, and NYC-Tron F03 shares the cause. | Design call, coordinate with NYC-Tron. |
| D05 | N05 light fill chips | Darken the hairline to 3:1 (`chipEdge` at a higher alpha) and ring light chips. | Changes pixels. | Design call. |
| D06 | N01 light `muted` | Darken light `muted` to about `#616A7E`, or restrict it to text on `raised` (4.83:1). | Changes pixels. | Design call. |
| D07 | N14 artboard label | Make the artboard `accessible` and expose Cancel move another way, or move the label to a wrapper that is not an ancestor of the button. | Changes the accessibility tree, hides the Cancel button if done naively. | Owner. |
| D08 | N02 placeholder | Darken `paperMuted` to about `#717683` or drop placeholder text for a visible label. | Changes pixels. | Design call. |
| D09 | N03 stage text | Darken `#798373` to about `#6A7365` and `#637161` to about `#5E6B5C`. | Changes pixels. | Design call (decision 27). |
| D10 | N10 persona stop targets | Keep stops at 44 pt by scaling only the dial, or switch to stacked below a width. | Changes layout. | Owner. |
| D11 | N09 icon defaults | Make `appearance` required when `color` is absent, or default selected accent to the surface's own token. | Changes behaviour and the drift decision (5, 16). | Owner. |
| D12 | N13 Tally grid | Add `role="table"`, `row`, `columnheader`, `cell` and `aria-rowindex`. | Verifying roles on React Native needs a device pass, and roles change screen-reader output. | Owner after a VoiceOver and TalkBack pass. |
| D13 | N11 Android 48 dp | Return 48 from `size.target` on Android, and make the CSS target density-aware. | Changes layout. | Design call. |
| D14 | N18 undrawn name | Warn in development, or draw a placeholder. | Changes behaviour. | Owner. |
| D15 | Optional names in `ui.tsx` | Make `StudioTabBarProps['aria-label']` required. | Type change for callers. | Owner, with a version decision. |
| D16 | N07 and GU4 | Wire `onKeyDown` through a documented host contract on native. | Behaviour. | Owner. |

## Safe metadata fixes

Not applied. Each adds an accessibility prop that draws nothing and changes no style, layout or handler. They still change what a screen reader says, so a VoiceOver and TalkBack pass belongs after applying them.

**M1. Stage headings get a header role** (`packages/studio-workspace/src/stage.tsx:17`).

```diff
-  const heading = (title: string, detail: string) => <View style={{ gap: 4, marginBottom: 20 }}><Text style={{ color: theme === 'light' ? '#202923' : '#eef0e9', fontSize: 22, fontWeight: '500' }}>{title}</Text><Text style={caption}>{detail}</Text></View>;
+  const heading = (title: string, detail: string) => <View style={{ gap: 4, marginBottom: 20 }}><Text accessibilityRole="header" style={{ color: theme === 'light' ? '#202923' : '#eef0e9', fontSize: 22, fontWeight: '500' }}>{title}</Text><Text style={caption}>{detail}</Text></View>;
```

**M2. "Document history" header role** (`packages/studio-workspace/src/index.tsx:144`).

```diff
-          <Text style={{ color: colors.text, fontSize: 13 }}>Document history</Text>
+          <Text accessibilityRole="header" style={{ color: colors.text, fontSize: 13 }}>Document history</Text>
```

**M3. "Studio panels" rail role** (`packages/studio-workspace/src/index.tsx:253`).

```diff
-        {canvasStudio && !compact && <View accessibilityLabel="Studio panels" style={{ minWidth: scale.size.canvasRail,
+        {canvasStudio && !compact && <View accessibilityRole="toolbar" accessibilityLabel="Studio panels" style={{ minWidth: scale.size.canvasRail,
```

**M4. "Creation tools" and fill bar roles** (`packages/studio-workspace/src/prism-editor.tsx:428` and `:439`).

```diff
-    <View accessibilityLabel="Creation tools" onLayout={event => {
+    <View accessibilityRole="toolbar" accessibilityLabel="Creation tools" onLayout={event => {
```
```diff
-    <View testID="prism-fill-bar" accessibilityLabel={selected ? 'Fill' : 'New shape fill'} onLayout={event => {
+    <View testID="prism-fill-bar" accessibilityRole="toolbar" accessibilityLabel={selected ? 'Fill' : 'New shape fill'} onLayout={event => {
```

**M5. Icon button exposes `status`** (`packages/icons/src/ForgeIcon.js:93`). The strings are new copy; confirm them first.

```diff
-   accessibilityState:{selected,disabled,busy:loading},hitSlop:4,
+   accessibilityState:{selected,disabled,busy:loading},
+   ...(rest.status==="success"||rest.status==="error"||rest.status==="recording"
+     ?{accessibilityValue:{text:{success:"Done",error:"Failed",recording:"Recording"}[rest.status]}}:{}),
+   hitSlop:4,
```

M1 to M4 cover N12. M5 covers the metadata half of N08; the visible non-colour cue stays in D03.

## UNVERIFIED items and the test that settles each

| Item | Open question | Test |
|---|---|---|
| nyc-tron-host | Menu and popover focus trap, Escape, return; selected Button announced | VoiceOver and TalkBack on the Workspace menu and a popover; Tab and Escape on web |
| forge-workspace | Active-tab icon ground in dark (N15); selected cue without `bg-ink-800` (N16) | Screenshot dark rail and tab bar, sample the two pixels |
| prism-canvas | Artboard label reaches VoiceOver; outline colour over the checker | VoiceOver swipe; sample the outline pixel against `#FFFFFF` and `#EDEFF3` |
| prism-editor | Dialog focus trap on web | Tab from the last control inside the persona dialog |
| quill-text-editor | Focus ring on the essay field on web | Tab into the field in Chrome, read the computed outline |
| forge-icon-button | Focus ring on web | Tab to a `ForgeIconButton` in Chrome |
| all | GU1 to GU4 | As listed in the global table |

## Appendix A. Every pair

Produced by `node docs/agent-native/contrast.mjs --md`. The "Where" column names the source location or use.

| Group | Pair | Mode | Foreground | Ground | Ratio | Needs | Verdict | Where |
|---|---|---|---|---|---|---|---|---|
| workspace | text/base | dark | #F0F1F7 | #1C1E25 | 14.76 | 4.5 | PASS | header title, rail, status |
| workspace | text/raised | dark | #F0F1F7 | #262932 | 12.89 | 4.5 | PASS | panel body, document row |
| workspace | muted/base | dark | #ADB3C4 | #1C1E25 | 7.94 | 4.5 | PASS | header caption 11, rail label 9, status 11 |
| workspace | muted/raised | dark | #ADB3C4 | #262932 | 6.93 | 4.5 | PASS | panel hint 12, inactive tab label |
| workspace | muted/deep | dark | #ADB3C4 | #15171D | 8.55 | 4.5 | PASS | QuillTextEditor word count 11 and status, which sit on the stage mat |
| workspace | accent/base | dark | #B7A5FF | #1C1E25 | 7.8 | 4.5 | PASS | rail label 9 when active, selected button label |
| workspace | accent/soft | dark | #B7A5FF | #38304F | 5.77 | 4.5 | PASS | arrange banner 11 |
| workspace | ink/accent | dark | #211A3D | #B7A5FF | 7.69 | 4.5 | PASS | Save button label and icon (on-primary on primary) |
| workspace | error/raised | dark | #FFAAA7 | #262932 | 8 | 4.5 | PASS | ErrorMessage, composer error 12 |
| workspace | error/base | dark | #FFAAA7 | #1C1E25 | 9.16 | 4.5 | PASS | ErrorMessage on the status line |
| workspace | paperInk/paper | dark | #303440 | #FFFEFC | 12.32 | 4.5 | PASS | essay text |
| workspace | paperMuted/paper | dark | #797F8D | #FFFEFC | 3.98 | 4.5 | FAIL | essay placeholder (placeholderTextColor) |
| workspace | line/base | dark | #393D49 | #1C1E25 | 1.54 | n/a | decorative | hairline, panel border |
| workspace | line/raised | dark | #393D49 | #262932 | 1.34 | n/a | decorative | panel and card border |
| workspace | accent/raised | dark | #B7A5FF | #262932 | 6.81 | 3 | PASS | floating panel border, selected indicator, focus colour |
| workspace | accent/deep | dark | #B7A5FF | #15171D | 8.39 | 3 | PASS | drag preview border, focus ring on stage |
| workspace | white/accent | dark | #FFFFFF | #B7A5FF | 2.13 | 3 | COND-FAIL | active tab icon is hard-coded #FFFFFF (index.tsx); active tab ground is NYC-Tron's, unknown here |
| workspace | info/raised | dark | #8AB8FF | #262932 | 7.18 | 3 | PASS | Banner info mark |
| workspace | success/raised | dark | #6FD08C | #262932 | 7.66 | 3 | PASS | Banner and Badge success mark |
| workspace | onError/error | dark | #2B0703 | #FFAAA7 | 10.19 | 4.5 | PASS | danger Button label |
| prism | text/base | dark | #F2F3F5 | #232428 | 13.96 | 4.5 | PASS | prism header, rail |
| prism | muted/base | dark | #B8BBC4 | #232428 | 8.08 | 4.5 | PASS | prism captions |
| prism | muted/raised | dark | #B8BBC4 | #303136 | 6.76 | 4.5 | PASS | prism panel hint |
| prism | accent/base | dark | #66B9FF | #232428 | 7.35 | 4.5 | PASS | prism selected label |
| prism | ink/accent | dark | #081D2F | #66B9FF | 8.11 | 4.5 | PASS | prism Save label (on-primary on primary) |
| prism | accent/deep | dark | #66B9FF | #18191D | 8.32 | 3 | PASS | prism focus ring, drag preview |
| prism | error/raised | dark | #FFAAA7 | #303136 | 7.14 | 4.5 | PASS | prism error text |
| prism | line/deep | dark | #424348 | #18191D | 1.78 | 3 | FAIL | PersonaComposer text field border (name, import, export): the only edge that marks the field |
| prism | line/base | dark | #424348 | #232428 | 1.57 | 3 | FAIL | PersonaComposer field border against the panel around it |
| prism | text/deep | dark | #F2F3F5 | #18191D | 15.82 | 4.5 | PASS | PersonaComposer field text |
| chrome | text/body | dark | #F2F3F5 | #1E2024 | 14.69 | 4.5 | PASS | toolbar name, layer names |
| chrome | muted/body | dark | #B8BBC4 | #1E2024 | 8.5 | 4.5 | PASS | captions, tool glyphs, Transform label 11 |
| chrome | muted/selected | dark | #B8BBC4 | #2B3846 | 6.23 | 4.5 | PASS | caption on the selected row |
| chrome | selectedMuted/selected | dark | #D5E3F0 | #2B3846 | 9.15 | 4.5 | PASS | secondary text on the selected row |
| chrome | accent/body | dark | #66B9FF | #1E2024 | 7.73 | 4.5 | PASS | selected tool glyph and label |
| chrome | disabledInk/well | dark | #858991 | #141518 | 5.2 | n/a | exempt | unavailable control glyph (exempt, reference only) |
| chrome | edge/body | dark | #3A3D44 | #1E2024 | 1.5 | n/a | decorative | panel chamfer line (decorative: controls carry no border) |
| chrome | chipRing/body | dark | #F2F3F5 | #1E2024 | 14.69 | 3 | PASS | ring around the chosen fill chip |
| chrome | chipEdge/body | dark | #6d6e70 | #1E2024 | 3.2 | 3 | PASS | hairline around a fill chip |
| chrome | text/accent15>body | dark | #F2F3F5 | #293745 | 10.95 | 4.5 | PASS | persona trigger label while open (accent at 15% over body) |
| chrome | fill violet/body | dark | #6950D1 | #1E2024 | 2.85 | 3 | FAIL | fill chip colour is the only cue besides its name label |
| chrome | fill teal/body | dark | #249184 | #1E2024 | 4.24 | 3 | PASS | fill chip colour is the only cue besides its name label |
| chrome | fill amber/body | dark | #E39B4C | #1E2024 | 7.04 | 3 | PASS | fill chip colour is the only cue besides its name label |
| chrome | fill rose/body | dark | #E26D92 | #1E2024 | 5.31 | 3 | PASS | fill chip colour is the only cue besides its name label |
| direction:workbench | text/panelSolid | dark | #F2F3F5 | #1E2024 | 14.69 | 4.5 | PASS | stop name, hint |
| direction:workbench | muted/panelSolid | dark | #B8BBC4 | #1E2024 | 8.5 | 4.5 | PASS | inactive stop name, hint |
| direction:workbench | accent/panelSolid | dark | #66B9FF | #1E2024 | 7.73 | 3 | PASS | committed stop mark, focus ring |
| direction:workbench | faceText/face[0] | dark | #F2F3F5 | #3A3D45 | 9.78 | 4.5 | PASS | dial readout, lit edge of the face |
| direction:workbench | faceText/face[1] | dark | #F2F3F5 | #191B1F | 15.53 | 4.5 | PASS | dial readout, shadow edge of the face |
| direction:workbench | faceText@78/face[1] | dark | #c2c4c6 | #191B1F | 9.86 | 4.5 | PASS | dial sub-readout drawn at opacity 0.78 when not peeking |
| direction:workbench | accent/accentHalo | dark | #66B9FF | #08090B | 9.44 | 3 | PASS | committed slot ring on its halo |
| direction:optics | text/panelSolid | dark | #F2F3F5 | #1C1E25 | 14.99 | 4.5 | PASS | stop name, hint |
| direction:optics | muted/panelSolid | dark | #C2C6D0 | #1C1E25 | 9.73 | 4.5 | PASS | inactive stop name, hint |
| direction:optics | accent/panelSolid | dark | #66B9FF | #1C1E25 | 7.88 | 3 | PASS | committed stop mark, focus ring |
| direction:optics | faceText/face[0] | dark | #F2F3F5 | #17191E | 15.84 | 4.5 | PASS | dial readout, lit edge of the face |
| direction:optics | faceText/face[1] | dark | #F2F3F5 | #0C0D10 | 17.5 | 4.5 | PASS | dial readout, shadow edge of the face |
| direction:optics | faceText@78/face[1] | dark | #bfc0c3 | #0C0D10 | 10.68 | 4.5 | PASS | dial sub-readout drawn at opacity 0.78 when not peeking |
| direction:optics | accent/accentHalo | dark | #66B9FF | #050607 | 9.61 | 3 | PASS | committed slot ring on its halo |
| direction:atelier | text/panelSolid | dark | #F2F3F5 | #2A2C31 | 12.58 | 4.5 | PASS | stop name, hint |
| direction:atelier | muted/panelSolid | dark | #BEC1CA | #2A2C31 | 7.76 | 4.5 | PASS | inactive stop name, hint |
| direction:atelier | accent/panelSolid | dark | #66B9FF | #2A2C31 | 6.62 | 3 | PASS | committed stop mark, focus ring |
| direction:atelier | faceText/face[0] | dark | #F2F3F5 | #43464E | 8.5 | 4.5 | PASS | dial readout, lit edge of the face |
| direction:atelier | faceText/face[1] | dark | #F2F3F5 | #34373E | 10.73 | 4.5 | PASS | dial readout, shadow edge of the face |
| direction:atelier | faceText@78/face[1] | dark | #c8cacd | #34373E | 7.26 | 4.5 | PASS | dial sub-readout drawn at opacity 0.78 when not peeking |
| direction:atelier | accent/accentHalo | dark | #66B9FF | #1A1B1F | 8.15 | 3 | PASS | committed slot ring on its halo |
| workspace | text/base | light | #252A3A | #F4F5F8 | 13.1 | 4.5 | PASS | header title, rail, status |
| workspace | text/raised | light | #252A3A | #FFFFFF | 14.28 | 4.5 | PASS | panel body, document row |
| workspace | muted/base | light | #687287 | #F4F5F8 | 4.43 | 4.5 | FAIL | header caption 11, rail label 9, status 11 |
| workspace | muted/raised | light | #687287 | #FFFFFF | 4.83 | 4.5 | PASS | panel hint 12, inactive tab label |
| workspace | muted/deep | light | #687287 | #E7EAF1 | 4.01 | 4.5 | FAIL | QuillTextEditor word count 11 and status, which sit on the stage mat |
| workspace | accent/base | light | #6950D1 | #F4F5F8 | 5.25 | 4.5 | PASS | rail label 9 when active, selected button label |
| workspace | accent/soft | light | #6950D1 | #EEE9FF | 4.83 | 4.5 | PASS | arrange banner 11 |
| workspace | ink/accent | light | #FFFFFF | #6950D1 | 5.72 | 4.5 | PASS | Save button label and icon (on-primary on primary) |
| workspace | error/raised | light | #B33E46 | #FFFFFF | 5.68 | 4.5 | PASS | ErrorMessage, composer error 12 |
| workspace | error/base | light | #B33E46 | #F4F5F8 | 5.21 | 4.5 | PASS | ErrorMessage on the status line |
| workspace | paperInk/paper | light | #303440 | #FFFEFC | 12.32 | 4.5 | PASS | essay text |
| workspace | paperMuted/paper | light | #797F8D | #FFFEFC | 3.98 | 4.5 | FAIL | essay placeholder (placeholderTextColor) |
| workspace | line/base | light | #DDE1EB | #F4F5F8 | 1.2 | n/a | decorative | hairline, panel border |
| workspace | line/raised | light | #DDE1EB | #FFFFFF | 1.31 | n/a | decorative | panel and card border |
| workspace | accent/raised | light | #6950D1 | #FFFFFF | 5.72 | 3 | PASS | floating panel border, selected indicator, focus colour |
| workspace | accent/deep | light | #6950D1 | #E7EAF1 | 4.75 | 3 | PASS | drag preview border, focus ring on stage |
| workspace | white/accent | light | #FFFFFF | #6950D1 | 5.72 | 3 | COND-PASS | active tab icon is hard-coded #FFFFFF (index.tsx); active tab ground is NYC-Tron's, unknown here |
| workspace | info/raised | light | #1D5FA8 | #FFFFFF | 6.45 | 3 | PASS | Banner info mark |
| workspace | success/raised | light | #1E7A3C | #FFFFFF | 5.38 | 3 | PASS | Banner and Badge success mark |
| workspace | onError/error | light | #FFFFFF | #B33E46 | 5.68 | 4.5 | PASS | danger Button label |
| prism | text/base | light | #25272D | #ECEDEF | 12.74 | 4.5 | PASS | prism header, rail |
| prism | muted/base | light | #656A74 | #ECEDEF | 4.64 | 4.5 | PASS | prism captions |
| prism | muted/raised | light | #656A74 | #FAFAFB | 5.21 | 4.5 | PASS | prism panel hint |
| prism | accent/base | light | #086CB8 | #ECEDEF | 4.66 | 4.5 | PASS | prism selected label |
| prism | ink/accent | light | #FFFFFF | #086CB8 | 5.46 | 4.5 | PASS | prism Save label (on-primary on primary) |
| prism | accent/deep | light | #086CB8 | #D9DBDF | 3.94 | 3 | PASS | prism focus ring, drag preview |
| prism | error/raised | light | #B33E46 | #FAFAFB | 5.45 | 4.5 | PASS | prism error text |
| prism | line/deep | light | #C9CCD2 | #D9DBDF | 1.16 | 3 | FAIL | PersonaComposer text field border (name, import, export): the only edge that marks the field |
| prism | line/base | light | #C9CCD2 | #ECEDEF | 1.37 | 3 | FAIL | PersonaComposer field border against the panel around it |
| prism | text/deep | light | #25272D | #D9DBDF | 10.77 | 4.5 | PASS | PersonaComposer field text |
| chrome | text/body | light | #1F2228 | #ECEDEF | 13.6 | 4.5 | PASS | toolbar name, layer names |
| chrome | muted/body | light | #555B66 | #ECEDEF | 5.83 | 4.5 | PASS | captions, tool glyphs, Transform label 11 |
| chrome | muted/selected | light | #555B66 | #D3E4F4 | 5.26 | 4.5 | PASS | caption on the selected row |
| chrome | selectedMuted/selected | light | #2F4357 | #D3E4F4 | 7.85 | 4.5 | PASS | secondary text on the selected row |
| chrome | accent/body | light | #086CB8 | #ECEDEF | 4.66 | 4.5 | PASS | selected tool glyph and label |
| chrome | disabledInk/well | light | #6B707A | #DADCE1 | 3.62 | n/a | exempt | unavailable control glyph (exempt, reference only) |
| chrome | edge/body | light | #737882 | #ECEDEF | 3.78 | n/a | decorative | panel chamfer line (decorative: controls carry no border) |
| chrome | chipRing/body | light | #1F2228 | #ECEDEF | 13.6 | 3 | PASS | ring around the chosen fill chip |
| chrome | chipEdge/body | light | #a4a6aa | #ECEDEF | 2.08 | 3 | FAIL | hairline around a fill chip |
| chrome | text/accent15>body | light | #1F2228 | #cadae7 | 11.15 | 4.5 | PASS | persona trigger label while open (accent at 15% over body) |
| chrome | fill violet/body | light | #6950D1 | #ECEDEF | 4.89 | 3 | PASS | fill chip colour is the only cue besides its name label |
| chrome | fill teal/body | light | #249184 | #ECEDEF | 3.28 | 3 | PASS | fill chip colour is the only cue besides its name label |
| chrome | fill amber/body | light | #E39B4C | #ECEDEF | 1.98 | 3 | FAIL | fill chip colour is the only cue besides its name label |
| chrome | fill rose/body | light | #E26D92 | #ECEDEF | 2.62 | 3 | FAIL | fill chip colour is the only cue besides its name label |
| direction:workbench | text/panelSolid | light | #1F2228 | #ECEDEF | 13.6 | 4.5 | PASS | stop name, hint |
| direction:workbench | muted/panelSolid | light | #555B66 | #ECEDEF | 5.83 | 4.5 | PASS | inactive stop name, hint |
| direction:workbench | accent/panelSolid | light | #086CB8 | #ECEDEF | 4.66 | 3 | PASS | committed stop mark, focus ring |
| direction:workbench | faceText/face[0] | light | #1F2228 | #FFFFFF | 15.94 | 4.5 | PASS | dial readout, lit edge of the face |
| direction:workbench | faceText/face[1] | light | #1F2228 | #CDD0D7 | 10.32 | 4.5 | PASS | dial readout, shadow edge of the face |
| direction:workbench | faceText@78/face[1] | light | #45484e | #CDD0D7 | 5.94 | 4.5 | PASS | dial sub-readout drawn at opacity 0.78 when not peeking |
| direction:workbench | accent/accentHalo | light | #086CB8 | #FFFFFF | 5.46 | 3 | PASS | committed slot ring on its halo |
| direction:optics | text/panelSolid | light | #1F2228 | #F4F5F8 | 14.62 | 4.5 | PASS | stop name, hint |
| direction:optics | muted/panelSolid | light | #4F5562 | #F4F5F8 | 6.86 | 4.5 | PASS | inactive stop name, hint |
| direction:optics | accent/panelSolid | light | #086CB8 | #F4F5F8 | 5.01 | 3 | PASS | committed stop mark, focus ring |
| direction:optics | faceText/face[0] | light | #F2F3F5 | #20232A | 14.17 | 4.5 | PASS | dial readout, lit edge of the face |
| direction:optics | faceText/face[1] | light | #F2F3F5 | #121418 | 16.61 | 4.5 | PASS | dial readout, shadow edge of the face |
| direction:optics | faceText@78/face[1] | light | #c1c2c4 | #121418 | 10.34 | 4.5 | PASS | dial sub-readout drawn at opacity 0.78 when not peeking |
| direction:optics | accent/accentHalo | light | #086CB8 | #FFFFFF | 5.46 | 3 | PASS | committed slot ring on its halo |
| direction:atelier | text/panelSolid | light | #1F2228 | #FAFAF8 | 15.25 | 4.5 | PASS | stop name, hint |
| direction:atelier | muted/panelSolid | light | #555B66 | #FAFAF8 | 6.54 | 4.5 | PASS | inactive stop name, hint |
| direction:atelier | accent/panelSolid | light | #086CB8 | #FAFAF8 | 5.22 | 3 | PASS | committed stop mark, focus ring |
| direction:atelier | faceText/face[0] | light | #1F2228 | #FFFFFF | 15.94 | 4.5 | PASS | dial readout, lit edge of the face |
| direction:atelier | faceText/face[1] | light | #1F2228 | #ECEDEF | 13.6 | 4.5 | PASS | dial readout, shadow edge of the face |
| direction:atelier | faceText@78/face[1] | light | #4c4f54 | #ECEDEF | 7.02 | 4.5 | PASS | dial sub-readout drawn at opacity 0.78 when not peeking |
| direction:atelier | accent/accentHalo | light | #086CB8 | #FFFFFF | 5.46 | 3 | PASS | committed slot ring on its halo |
| fixed | white/#111827 | both | #FFFFFF | #111827 | 17.74 | 4.5 | PASS | Prism 'Move preview' caption 11 (prism-canvas.tsx) |
| fixed | chrome text dark/#111827 | dark | #F2F3F5 | #111827 | 15.98 | 4.5 | PASS | Cancel move label under PrismEditor, dark |
| fixed | chrome text light/#111827 | light | #1F2228 | #111827 | 1.11 | 4.5 | FAIL | Cancel move label under PrismEditor, light |
| fixed | reference text light/#111827 | light | #252A3A | #111827 | 1.24 | 4.5 | FAIL | Cancel move label with the workspace reference tokens, light |
| fixed | #111827/artboard | both | #111827 | #FFFFFF | 17.74 | 3 | PASS | move preview chip against the artboard checker |
| icon | ink/icon surface | light | #18202D | #FFFFFF | 16.36 | 3 | PASS | ForgeIcon default, appearance=light, surface #FFFFFF |
| icon | ink/icon surface | dark | #F8FAFC | #11131B | 17.72 | 3 | PASS | ForgeIcon default, appearance=dark, surface #11131B |
| icon | accent/icon surface | light | #6859E8 | #FFFFFF | 5.02 | 3 | PASS | ForgeIcon default, appearance=light, surface #FFFFFF |
| icon | accent/icon surface | dark | #6859E8 | #11131B | 3.69 | 3 | PASS | ForgeIcon default, appearance=dark, surface #11131B |
| icon | positive/icon surface | light | #139E75 | #FFFFFF | 3.4 | 3 | PASS | ForgeIcon default, appearance=light, surface #FFFFFF |
| icon | positive/icon surface | dark | #139E75 | #11131B | 5.45 | 3 | PASS | ForgeIcon default, appearance=dark, surface #11131B |
| icon | negative/icon surface | light | #D94462 | #FFFFFF | 4.24 | 3 | PASS | ForgeIcon default, appearance=light, surface #FFFFFF |
| icon | negative/icon surface | dark | #D94462 | #11131B | 4.37 | 3 | PASS | ForgeIcon default, appearance=dark, surface #11131B |
| icon | ink (appearance=light default)/workspace dark base | dark | #18202D | #1C1E25 | 1.02 | 3 | FAIL | ForgeIcon with no appearance and no color on a dark host: appearance defaults to light |
| icon | muted/icon surface | light | #737F91 | #FFFFFF | 4.06 | n/a | exempt | disabled glyph (exempt, reference only) |
| icon | muted/icon surface | dark | #737F91 | #11131B | 4.57 | n/a | exempt | disabled glyph (exempt, reference only) |
| drift D4 | icon ink/workspace base | dark | #F8FAFC | #1C1E25 | 15.91 | 3 | PASS | icon default ink on the workspace base (host passes color today; this is the fallback) |
| drift D4 | icon ink/workspace raised | dark | #F8FAFC | #262932 | 13.88 | 3 | PASS | icon default ink on the workspace raised surface |
| drift D4 | icon muted/workspace base | dark | #737F91 | #1C1E25 | 4.1 | 3 | PASS | icon muted #737F91 on workspace base (workspace muted is a different grey) |
| drift D1 | icon accent/workspace base | dark | #6859E8 | #1C1E25 | 3.31 | 3 | PASS | icon accent #6859E8 on workspace base |
| drift D1 | icon accent/workspace raised | dark | #6859E8 | #262932 | 2.89 | 3 | FAIL | icon accent #6859E8 on workspace raised |
| drift D3 | icon positive/workspace raised | dark | #139E75 | #262932 | 4.27 | 3 | PASS | icon success #139E75 vs workspace success #6FD08C |
| drift D3 | workspace success/workspace raised | dark | #6FD08C | #262932 | 7.66 | 3 | PASS | workspace success, for comparison |
| drift D3 | icon negative/workspace raised | dark | #D94462 | #262932 | 3.43 | 3 | PASS | icon danger #D94462 vs workspace error #FFAAA7 |
| drift D3 | workspace error/workspace raised | dark | #FFAAA7 | #262932 | 8 | 3 | PASS | workspace error, for comparison |
| drift D4 | icon ink/workspace base | light | #18202D | #F4F5F8 | 15.01 | 3 | PASS | icon default ink on the workspace base (host passes color today; this is the fallback) |
| drift D4 | icon ink/workspace raised | light | #18202D | #FFFFFF | 16.36 | 3 | PASS | icon default ink on the workspace raised surface |
| drift D4 | icon muted/workspace base | light | #737F91 | #F4F5F8 | 3.72 | 3 | PASS | icon muted #737F91 on workspace base (workspace muted is a different grey) |
| drift D1 | icon accent/workspace base | light | #6859E8 | #F4F5F8 | 4.61 | 3 | PASS | icon accent #6859E8 on workspace base |
| drift D1 | icon accent/workspace raised | light | #6859E8 | #FFFFFF | 5.02 | 3 | PASS | icon accent #6859E8 on workspace raised |
| drift D3 | icon positive/workspace raised | light | #139E75 | #FFFFFF | 3.4 | 3 | PASS | icon success #139E75 vs workspace success #1E7A3C |
| drift D3 | workspace success/workspace raised | light | #1E7A3C | #FFFFFF | 5.38 | 3 | PASS | workspace success, for comparison |
| drift D3 | icon negative/workspace raised | light | #D94462 | #FFFFFF | 4.24 | 3 | PASS | icon danger #D94462 vs workspace error #B33E46 |
| drift D3 | workspace error/workspace raised | light | #B33E46 | #FFFFFF | 5.68 | 3 | PASS | workspace error, for comparison |
| stage | #283329/#f7f5ed | both | #283329 | #f7f5ed | 12.06 | 4.5 | PASS | quill page body 15 |
| stage | #283329/#FFFEFC | both | #283329 | #FFFEFC | 13.06 | 4.5 | PASS | same ink on the workspace paper, for comparison |
| stage | #66735f/#f7f5ed | both | #66735f | #f7f5ed | 4.6 | 4.5 | PASS | photo, design and draft captions 12 to 13 |
| stage | #798373/#f7f5ed | both | #798373 | #f7f5ed | 3.63 | 4.5 | FAIL | blank slide hint 12 |
| stage | #26372e/#f7f5ed | both | #26372e | #f7f5ed | 11.53 | 4.5 | PASS | pitch slide text, tally cell text |
| stage | #637161/#e5e9dd | both | #637161 | #e5e9dd | 4.19 | 4.5 | FAIL | tally header cells 12 |
| stage | #354638/#f7f5ed | both | #354638 | #f7f5ed | 9.23 | 4.5 | PASS | photo camera line 15 |
| stage | #ffffff/#637660 | both | #ffffff | #637660 | 4.89 | 4.5 | PASS | cadence clip label 10 |
| stage | #ffffff/#725d7c | both | #ffffff | #725d7c | 5.88 | 4.5 | PASS | splice clip label 10 |
| stage | #b9c7ba/#222829 | both | #b9c7ba | #222829 | 8.51 | 4.5 | PASS | track name 11 |
| stage | #eef0e9/#222829 | both | #eef0e9 | #222829 | 13.02 | 4.5 | PASS | motion layer name 13 |
| stage | #99a19d/mat dark | dark | #99a19d | #15171D | 6.77 | 4.5 | PASS | stage caption 11, dark scheme |
| stage | #556359/mat light | light | #556359 | #E7EAF1 | 5.26 | 4.5 | PASS | stage caption 11, light scheme |
| stage | #eef0e9/mat dark | dark | #eef0e9 | #15171D | 15.59 | 4.5 | PASS | stage heading 22, dark scheme |
| stage | #202923/mat light | light | #202923 | #E7EAF1 | 12.43 | 4.5 | PASS | stage heading 22, light scheme |
| stage | #f7f5ed/mat dark | dark | #f7f5ed | #15171D | 16.41 | n/a | decorative | stage paper edge against the dark mat |
| stage | #f7f5ed/mat light | light | #f7f5ed | #E7EAF1 | 1.1 | n/a | decorative | stage paper edge against the light mat |
| stage | #39423f/#222829 | both | #39423f | #222829 | 1.44 | n/a | decorative | track and layer border |
| prism blue | prism accent dark/workspace accent dark | dark | #66B9FF | #B7A5FF | 1.01 | n/a | info | how far Prism blue sits from the suite accent (dark) |
| prism blue | prism accent light/workspace accent light | light | #086CB8 | #6950D1 | 1.05 | n/a | info | how far Prism blue sits from the suite accent (light) |
| prism blue | prism accent dark/launcher purple | dark | #66B9FF | #9C5FE6 | 1.92 | n/a | info | launcher accent for prism in icon-family.mjs |
| prism blue | prism accent light/launcher purple | light | #086CB8 | #9C5FE6 | 1.35 | n/a | info | launcher accent for prism in icon-family.mjs |
