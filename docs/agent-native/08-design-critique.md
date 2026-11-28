# Agent-native phase 1: design critique of the docs site

Status: step 8 (decision 37). The rendered site was inspected on 2026-11-20 and the blockers and majors below were fixed in the generator sources (`tooling/docs/build-site.mjs`, `tooling/docs/site-assets.mjs`). `docs/site/` was regenerated, never edited by hand. `build-site.mjs --check` and `check-docs.mjs` pass.

## 0. Method and limits

- Pages served with `python3 -m http.server` from `docs/site/` and opened in Chrome through the claude-in-chrome tool at 1280 px. The 390 px views are an iframe 390 px wide inside a wrapper page kept in the scratchpad, not in the repo. The window cannot go below about 500 px, so the iframe is the only true 390.
- Pages looked at: home, `components/prism-editor.html` (has prerequisites), tokens, install, search, plus `engines/ignition.html` and `components/studio-theme.html` for the automated sweeps.
- Automated sweep per page, at 390 and 1280, dark and light: horizontal overflow, text contrast (computed colour against the first opaque background), interactive target size, tab order.
- Keyboard: real Tab presses on the home page (skip link, header controls, menu summary). Other pages: tab order read from the DOM, focus ring read from computed style.
- Copy: the Copy button and Copy page were clicked on `prism-editor.html` with `navigator.clipboard.writeText` wrapped to record the argument. Both copied the right text.
- Search: all 20 queries in `retrieval-queries.json` that have an expected item were replayed on the live page, plus a query with no possible match.
- Judged against `06-docs-direction.md`, `07-mobbin-references.md`, WCAG 2.1 AA (the site also meets the 2.2 target-size rule except where listed) and the honesty rules (nav never 404s, no dead controls, honest empty states, six states, "no data" distinct from "could not check").
- The screenshot tool draws a mouse cursor into the 1280 images; it is not part of the site.
- Content claims were not changed. No a11y status, install command or count was edited. The 18 versus 17 registry item count in the direction doc is a content difference (`brand-theme` is in `registry.json`), left as is.

## 1. Totals

| Severity | Found | Fixed | Left |
|---|---|---|---|
| Blocker | 4 | 4 | 0 |
| Major | 8 | 8 | 0 |
| Minor | 12 | 1 | 11 (section 8) |

## 2. Shell (every page)

What works: skip link first and visible on focus; one `h1` and one `main` per page; 2 px accent focus ring on header controls and links; header and nav targets are 44 px; both schemes and the Prism brand pass the build's 28 colour pairs; footer status line states the placeholder tag, 0.0.0 and no npm.

| # | Sev | What fails | Fix | Before | After |
|---|---|---|---|---|---|
| S1 | Blocker | At 390 px every page scrolled sideways: the three header selects wrapped past the edge (`scrollWidth` 419 against 390). WCAG 1.4.10 reflow. | `site-assets.mjs`: at 700 px and below the controls become a three-column grid with `min-width:0` selects. "System scheme" shortened to "System" so the three labels fit (the select keeps `aria-label="Scheme"`). | scroll 419 on 7 of 7 pages | scroll 390 on 6 of 6 pages measured |
| S2 | Major | The "Menu" `<summary>` stayed a tab stop on desktop while visually clipped. Focus showed a 26 px ring over the Home link, and Enter collapsed the whole sidebar with no visible way back. WCAG 2.4.7 and a dead-end control. | `summary` is `display:none` from 701 px up. `site.js` re-opens the nav when the window widens past 700 px. | Tab 7 landed on an invisible control | not in the tab order on desktop |
| S3 | Major | The header was sticky and 113 px tall at 390 px, 14% of the screen, and covered anchor targets (jumping to `install.html#chain` hid the heading). | Header is static at 700 px and below, `scroll-padding-top` 12 px there. | sticky, 113 px | static |
| S4 | Major | Copy gave no announcement: the button label changed to "Copied" and nothing reached a screen reader (WCAG 4.1.3). A failed copy was silent. | Polite live region `#live` in every page, "Copied to clipboard" or "Copy failed. Select the text and copy it by hand." The button shows "Copy failed" for 3 s. | no announcement, silent failure | announced, failure visible |
| S5 | Major | Headings from the component sources (`## Scheme`, `## Density`) produced `id="scheme"` and `id="density"`, duplicates of the header selects. `getElementById` returned the first match. | `slug()` appends `-section` to reserved ids. `--check` now fails on any duplicate id. | 4 duplicate ids on 3 pages | 0 |

## 3. Home (`index.html`)

First impression: the status banner and the primary button sit in the first screen, so the caveat (nothing on npm, steps 1 to 3 monorepo only) reaches a reader before any claim. The engine roster is the characteristic content, as the direction asked.

What works: one primary action; marker plus words ("tarball package"); roster is a real table with `th scope`; at 390 it becomes labelled blocks; reader paths stack; empty and partial wording present.

| # | Sev | Finding | Status |
|---|---|---|---|
| H1 | Minor | The footer status line prints the raw field "status NOT RUN" in capitals. The value is from `compatibility.v1.json` and is a content claim. | Left |
| H2 | Minor | "Wire a component" links to the first provider item (Forge Document Stage), which reads as arbitrary. The direction specifies "first item in the registry list". | Left |
| H3 | Minor | Facts column says "2 foundations" while the page lists 3 (ignition, studio-layout, icons). `icons` is a registry item, so the numbers are both right, but the pairing invites a recount. | Left |

## 4. Component page (`components/prism-editor.html`)

What works: the prerequisite strip is the first element after the lead and names `studio-ui-provider`, `nyc-tron-host`, ignition (step 1) and studio-layout (step 3) with links to the install steps; the install command is one click from the top; facts column gives provider, ignition, studio-layout, accessibility status in words ("reviewed-fail: source read, failures found"), peers and source files; failing items are shown, nothing says "verified".

| # | Sev | Finding | Fix | Before | After |
|---|---|---|---|---|---|
| C1 | Major | The "For agents" block was a bare `<pre>`: the page for agents had no Copy control, unlike the install command above it. | Uses the same copy block, titled "Commands for an agent". | no button | Copy button, copies both commands in order |
| C2 | Minor (fixed) | "Copy page" inherited the 20 px serif of the sheet and looked like a different system from the other controls. | `.sheet .btn` uses the sans UI size. | serif 20 px | sans 14 px |
| C3 | Minor | The handoff body repeats the install command and a long "Requires" run-on list under "Install". It is generated from `docs/components/*.md`, so the fix is in the content. | Left, content | | |
| C4 | Minor | Copy page copies the text including the "Copy" button labels. | Left | | |

## 5. Tokens page (`tokens.html`)

What works: the three-key contract comes first with real swatches and hex text beside each; deferred and locked sets are stated with reasons; drift records are shown with swatches; precomputed ratios give the no-script answer; "no data" and "could not check" are separate in the checker ("not checked. Use six hex digits").

| # | Sev | Finding | Fix | Before | After |
|---|---|---|---|---|---|
| T1 | Blocker | The accent checker was dead. `<h2 id="checker">` and `<div id="checker">` shared an id, so the script bound to the heading and threw on `data-neutrals`. The result area stayed empty for every input. A dead control on the page whose primary action is the checker. | Heading id is now `accent-checker`. Duplicate ids fail the build check. | result area height 0 | six ratios appear, a bad light accent `#CCCCCC` shows 1.61 and "fails" |
| T2 | Major | The direction's "In use" panel (button, selected row, focus ring, link painted by the entered values) was missing, though `site.js` already wrote to `demo-dark` and `demo-light`. | Two panels, one per scheme, using the neutrals from `theme.ts`, updated live. They are `aria-hidden`; the numbers carry the result. | none | present, static values from the suite theme without script |
| T3 | Major | Selects on this page were unstyled browser defaults, 17 px high (tier filter, "Start from"), against the 44 px target. | Shared select style, 44 px min height, 1 px border that clears 3:1. | 17 px | 44 px |

Minor, left: precomputed ratio tables stay visible when the live checker works. They are the no-script fallback and the print output.

## 6. Install page (`install.html`)

What works: banner first; agent prompt with Copy; nine steps numbered 0 to 8 in one ruled container; each step has a marker with text ("registry add: no" and so on); gaps section states "UNVERIFIED"; no invented command.

| # | Sev | Finding | Fix | Before | After |
|---|---|---|---|---|---|
| I1 | Blocker | "Show only steps a registry add covers" did nothing. The CSS rule was `.steps-focus li.hide`, and no `.steps-focus` element exists. All nine steps stayed visible after the box was ticked. | Rule is now `.chain>li.hide{display:none}`. | 9 steps visible | steps 4 to 8 visible, 0 to 3 hidden |
| I2 | Major | `.sheet li{max-width:66ch}` also capped the chain rows, so command blocks cut off at about 75 characters and the sheet's spare width went unused. | Chain rows have no cap and the wide sheet uses the full column. Prose lines inside keep 66ch. | commands clipped around 560 px | commands get about 800 px |

Deviation from the direction, recorded: the direction asked for prose left and command right at 1280. Several commands run past 100 characters (`pnpm --filter ... exec vitest run tests/...`). A right column about 560 px wide clips them, so prose stays above the command. Revisit if the commands are shortened.

Minor, left: the rail is a plain 2 px line. The direction's "one memorable element", a rail marker that settles with a 120 ms snap, is not built. There is no motion on the site, so reduced-motion has nothing to disable (the media rule is in place).

## 7. Search (`search.html`)

What works: groups show counts even at zero (Tokens 0); matches are highlighted; a miss says what was searched and points to the Engines group; the no-script list is also a sitemap; scope chips are radio buttons in a fieldset and are 44 px.

| # | Sev | Finding | Fix | Before | After |
|---|---|---|---|---|---|
| Q1 | Blocker | Matching was AND across every word. A task sentence, which is what an agent sends, almost always returned nothing. Of the first 16 queries with an expected item, 12 returned zero results (q01 to q04, q06, q08, q10, q12 to q16). Only the short ones (q05, q07, q09, q11) returned hits. This contradicts the page's own "or by the task". | Ranking is BM25 over title plus description per group, OR across words, the method of `retrieval-eval.mjs`. Each row says "Matches 2 of 3 words" when the query has several words, so a weak hit is labelled. The ranking code is one shared source used by `site.js` and by the build check. | AND match, most task queries empty | all 20 queries return the expected item in the top 3 of Components (the eval's own check). The query with no possible match still shows the honest "No results" text |

Replay of five of the queries on the live page after the fix:

| Query | Expected | Rank |
|---|---|---|
| workspace shell with docks and panels for a design studio | forge-workspace | 1 |
| error: Studio requires StudioUIProvider | studio-ui-provider | 2 |
| uniwind native theme variables css | studio-theme | 1 |
| artboard with transparency checkerboard and drag to move | prism-canvas | 1 |
| turn a JSON parse error into a readable sentence | workspace-utilities | 1 |

`--check` now replays all 20 and fails the build if any expected item leaves the top 3. The unsatisfiable queries (q21 to q25) are expected to return weak or no hits and are labelled by the match count.

Side effect worth knowing: the tokenizer now splits `StudioUIProvider` into studio, ui and provider (the eval already did), so the query `provider` returns 12 components instead of 5. The extra seven all say they need StudioUIProvider.

Minor, left: no Enter hint and no key legend, and no arrow-key movement through results (direction 5.5 block 3); the empty state shows all groups expanded instead of collapsed with an example line (kept because the same list is the no-script sitemap); the header search and the page search field both show on `search.html`.

## 8. Keyboard, themes, motion

- Tab order on every page: skip link, mark, header search, three selects, nav links, main content, footer links. Focus ring present on controls and links (2 px accent). After S2 there is no invisible stop.
- Dark and light: no text under contrast in either scheme on the seven pages swept. Light-scheme code blocks use the `deep` token (light grey), not black.
- Prism brand checked on a component page in light. The strip and nav pick up the blue family and neutrals hold.
- `prefers-reduced-motion`: the blanket rule `*{transition:none;animation:none}` is present. The site has no animation, so there is no visible change to compare. This was read from the CSS, not toggled in the browser.

## 9. Minors left unfixed

| # | Item | Reason |
|---|---|---|
| H1 | "status NOT RUN" in capitals in the footer | Value comes from `compatibility.v1.json`; changing it edits a content claim |
| H2 | "Wire a component" targets the first provider item | Matches the direction text; a better target needs an owner choice |
| H3 | "2 foundations" beside a 3-row foundations table | Both counts are correct; wording is a copy decision |
| C3 | Duplicate install command and long "Requires" list on component pages | Lives in `docs/components/*.md`, the handoff source |
| C4 | Copy page includes button labels | Needs a copy-friendly clone of the sheet; low value |
| T4 | Precomputed ratios visible with script on | No-script fallback and print output |
| I3 | Detent rail marker and 120 ms snap not built | Direction's one motion moment; no user-facing defect |
| I4 | Two-column install rows not built | See the recorded deviation in section 6 |
| Q2 | No key legend, Enter hint or arrow-key results | Direction detail; the page works with Tab and Enter |
| Q3 | Empty search state fully expanded | Doubles as the no-script sitemap |
| Q4 | Two search fields on `search.html` | Header form is shared by every page |

## 10. Not checked

- No screen reader (VoiceOver, NVDA) was run. The live region and `aria-current` are untested by ear.
- Only Chrome. Safari and Firefox rendering, the `<details>` nav and `:has`-free CSS are untested there. Georgia fallback on Linux and Android is untested (open item 2 of the direction).
- The 390 view is an iframe, not a device. Touch behaviour, the on-screen keyboard and iOS `<select>` sheets are untested.
- The Copy button on the install page and the per-step buttons were not clicked. They share one handler with the two that were. The clipboard fallback path (`execCommand`) was not exercised.
- Brand, scheme and density persistence through `localStorage` was not tested across reloads.
- Print and forced-colours output were not viewed.
- Keyboard-only walk with real key presses covered the home page only; the other pages were checked by tab-order listing.
- Contrast sweep reads the first opaque background of each text element. It cannot see text over gradients or images (the site has none), and it does not replace an Axe or Lighthouse run.
