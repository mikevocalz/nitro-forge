# Agent-native phase 1.5: docs site direction

Status: design direction for the static docs site in decision 36 (`docs/site/`, home, component, tokens, install, search, openable from disk, hosting deferred). Written after the references in `07-mobbin-references.md`. Nothing here was rendered or built. Contrast figures were computed from the hex values in `packages/studio-workspace/src/theme.ts` with the WCAG formula; they are measurements of values, not of a rendered page.

Sources read: `02-design-system.md`, `tokens.map.json`, `03-design-handoff.md`, `install-order.md`, `01-user-research.md`, `copy.json`, `a11y-status.json`, `retrieval-queries.json`, `theme.ts`, `forge-directions.ts`, `apps/example/brands/*.json`, decisions 1 to 4, 28, 35 to 37.

## 1. Direction in one paragraph

Paper on graphite. The site borrows the studios' own arrangement: cool graphite chrome around a document sheet, so the page you read behaves like a Quill page inside Forge. Prose, props and commands sit on the `paper` sheet (`#FFFEFC` with `paperInk` `#303440`, identical in both schemes, as in the editor). Navigation, search, the status line and every control sit in the chrome tokens (`base`, `raised`, `deep`, `line`). Accent is the studio accent, and the site can wear two of them (suite violet, Prism blue), because the site is the demonstration of the rebrand contract: three keys change, everything else holds. The one memorable element is the detent rail on the install page: nine stops, each marked by whether a registry add can do it. The same marker vocabulary labels the engines on the home page. A status line at the foot of every page tells the truth about distribution (`r/` built or not, tarballs at `0.0.0`, no npm).

## 2. Plan

### 2.1 Colour

All values come from `theme.ts` and are imported at build time, never retyped. Names here are the theme keys.

| Role | Dark | Light | Used for |
|---|---|---|---|
| `base` | `#1C1E25` | `#F4F5F8` | page ground, sidebar |
| `raised` | `#262932` | `#FFFFFF` | header, cards, search field, props frames |
| `deep` | `#15171D` | `#E7EAF1` | command and code blocks, inset wells |
| `line` | `#393D49` | `#DDE1EB` | dividers only (1.54:1 and 1.20:1 on `base`, so never the only boundary of a control) |
| `text` | `#F0F1F7` | `#252A3A` | chrome text |
| `muted` | `#ADB3C4` | `#687287` | secondary text, on `raised` only |
| `accent` / `ink` / `soft` | `#B7A5FF` / `#211A3D` / `#38304F` | `#6950D1` / `#FFFFFF` / `#EEE9FF` | the three rebrandable keys |
| `paper` / `paperInk` | `#FFFEFC` / `#303440` | same | the reading sheet |
| `error` | `#FFAAA7` | `#B33E46` | locked; build and runtime errors |
| `workspaceStatus.info/success` | `#8AB8FF` / `#6FD08C` | `#1D5FA8` / `#1E7A3C` | locked; status line only |

Measured pairs the site relies on (ratio, WCAG 2.x):

| Pair | Dark | Light | Rule |
|---|---|---|---|
| `text` on `base` | 14.76 | 13.10 | body in chrome |
| `muted` on `raised` | 6.93 | 4.83 | secondary text allowed here only |
| `paperInk` on `paper` | 12.32 | 12.32 | prose |
| light `accent` on `paper` | 5.68 | 5.68 | links in prose, both schemes |
| `ink` on `accent` | 7.69 | 5.72 | primary button |
| `accent` on `base` (focus ring) | 7.80 | 5.25 | focus indicator, needs 3:1 |
| `text` on `soft` | 10.93 | 12.06 | selected row, tint |

Pairs the site must avoid, because the repo's own review (`a11y-status.json`, `05-accessibility-review.md`) and this pass measured them below AA:

- light `muted` on `base` 4.43 and on `deep` 4.01: no secondary text on `base` or `deep` in the light scheme. Use `text`, or move the text onto `raised`.
- `paperMuted` on `paper` 3.98 in both schemes: never used. Sheet captions use `paperInk`.
- `line` as the only edge of a control: search field and buttons use `muted` (4.83 on `raised` in light, 6.93 in dark) as their border.

Prism brand preview (accent family only, on suite neutrals): dark accent `#66B9FF` on `base` 7.88; light accent `#086CB8` on `base` 5.01, on `deep` 4.53, on `paper` 5.42; `ink` on `accent` 8.11 dark, 5.46 light. All clear 4.5:1 for text and 3:1 for focus.

### 2.2 Type

| Role | Family | Size from `workspaceScale.type` | Notes |
|---|---|---|---|
| Sheet headings and prose | Georgia (`workspaceScale.font.serif`) | display 32 for h1, title 20 for h2, `manuscript` 20 for prose | serif body gets line-height 1.6, measure capped at 66ch |
| Chrome, tables, props, labels | system UI sans (`ui-sans-serif, system-ui`), a docs-site choice because `theme.ts` defines no sans | body 14, label 12 | weight 600 for table heads and group headers; sentence case everywhere |
| Commands, code, token names | `ui-monospace` stack ending in `monospace` (`workspaceScale.font.mono`) | body 14 | no syntax colours (a highlighter is a dependency); commands are plain text so agents and humans copy the same bytes |

`micro` 10 is never used for content. Below 700 px prose drops from 20 to 16, a docs-local value named `--docs-prose-narrow`. It is the only size outside the scale and is flagged as a decision in section 9.

No all-caps labels, no tracked eyebrows, no mono microcopy for chrome labels, no arrow glyph appended to links, no middle-dot meta strings. Structure carries meaning, so group headers are plain sentence-case words and the only numbers on the site are the install chain's real sequence.

### 2.3 Layout

Alignment: left-aligned throughout. Sheet measure 66ch (about 720 px at 20 px Georgia). Rail and sidebar widths come from the scale where one exists (`size.header` 60, `size.status` 28, `size.target` 44, `space.*`).

```
1280 px
+--------------------------------------------------------------------+
| header 60: mark | brand preview | [ search  / ] | scheme | density   |
+-----------+--------------------------------------+-----------------+
| sidebar   |  paper sheet (max 720)               | facts column    |
| 240       |  h1, prerequisite, primary action,   | 240, sticky     |
| sticky    |  content blocks                      | label/value     |
+-----------+--------------------------------------+-----------------+
| status 28: registry state | distribution | generated from <sha>      |
+--------------------------------------------------------------------+

390 px
+------------------------------+
| header 52: mark | search | menu|
+------------------------------+
| paper sheet, full width,     |
| 16 px gutter                 |
|   facts column moves under   |
|   the title as label/value   |
+------------------------------+
| status 24 (wraps to 2 lines) |
+------------------------------+
```

Breakpoint 700 px, the same figure `forge-workspace` uses to collapse docks. Below it the sidebar becomes a menu sheet opened from the header (a `<details>` element, no script needed), the facts column folds under the title, and density defaults to `compact` (header 52, status 24, target 44) unless the reader chose another.

### 2.4 Principles

1. The sheet is the content, the graphite is the tool. Nothing decorative sits on the sheet.
2. One accent family, three keys. Everything else is locked, which the tokens page says out loud.
3. Say what is not built. Deferred, unverified and failing items are shown with their reason, never hidden.
4. Every fact is text first. Shapes and colour repeat what a word already says.
5. The page works with no script. Script adds search, copy and the accent preview.
6. Targets are 44 px. Density changes spacing, never text size, radius or layout, as `resolveWorkspaceScale` states.

### 2.5 Review of the plan against defaults

| First draft | Why it was a default | Change |
|---|---|---|
| Near-black page, one violet accent, hairline cards | Matches the "dark with a single bright accent" cluster and the SaaS card kit | Reading surface moved to a `paper` sheet inside graphite chrome. Cards removed from prose pages; the sheet is the only large surface. |
| Numbered markers on every section | Numbers imply sequence | Numbers only on the install chain, where `install-order.md` defines steps 0 to 8. Elsewhere plain headings. |
| Mono uppercase labels over each block | Template chrome | Sentence-case headings, no labels above content. |
| Hero with a headline, a gradient and three stat tiles | Default landing treatment | Home opens with the status line content and the 12-engine roster, the most characteristic thing in this subject. |
| Per-studio accent picker with 11 colours | Inventing values changes pixels; only Prism has an override | Two brands only: suite and Prism. Other studios show "no accent override defined". |

## 3. Shared shell

- Header: Forge mark (text "Nitro Forge", no logo asset is specified), brand preview select (suite, Prism), search field (submits `search.html?q=`, `/` focuses it), scheme toggle (system, dark, light), density toggle (compact, standard, comfortable). All four are plain controls that work without script except the toggles, which are hidden without script rather than shown dead.
- Sidebar: Components (17, grouped: needs provider, no provider needed), Tokens, Install, Engines (home anchor). Current page marked with `aria-current="page"` and the `soft` fill plus a 2 px accent bar (the bar and the text weight both carry it).
- Status line (`<footer role="contentinfo">`): three facts, each computed at build time. Registry: "r/ built, tag `<tag>`" or "r/ not built, `shadcn add @nitro-forge/...` resolves nothing yet". Distribution: "GitHub release tarballs, 0.0.0, no npm" read from `compatibility.v1.json`. Provenance: generated-from commit, date. On a build with a missing source file the line shows the failure (see Error state).
- Skip link to `main`, visible on focus. Focus ring: 2 px `accent` outline with 2 px offset, 3:1 against `base` in both brands.
- Motion: one moment. The detent rail marker for the step in focus settles with `snap` (120 ms, `cubic-bezier(0.22, 1, 0.36, 1)`, the Workbench direction's own curve in `forge-directions.ts`). `prefers-reduced-motion` makes it 0 ms. No entrance animations, no hover transitions beyond colour.
- Print and forced colours: `@media print` drops chrome and prints the sheet; `forced-colors` keeps markers readable because each carries a text label.

## 4. The six states

Every screen defines these six, in the same words, so a reader learns them once.

| State | Meaning on a static site |
|---|---|
| Default | All data present, script running |
| Empty | Valid data, zero items to show |
| Loading | A script-driven part is not ready yet (search index parse, copy in progress). Static content never loads. |
| Error | The build or a script step failed, and the page says what and where |
| Partial | Some source data is missing, deferred or unverified. The page shows the rest and labels the gap. |
| Degraded | No script, print, forced colours or reduced motion. Content and links still work. |

## 5. Screens

### 5.1 Home (`index.html`)

Purpose: tell a first-time reader, human or agent, what exists, what installs how, and where to begin.

Primary action: "Read the install order" (button, links to `install.html`). One per page.

Content blocks, in order:

1. Title and one sentence: what Nitro Forge is, in the repo's terms (document studios on one Rust engine, delivered as registry items plus tarball packages). Wording is a copy decision for the final pass and must pass `no-ai-slop`.
2. Status banner (callout slot, after Mintlify's pattern): registry built or not, tarballs at `0.0.0`, no npm, and the sentence "Steps 1 to 3 of the install cannot be reproduced outside the monorepo today." Source: `install-order.md`. Links to `install.html#step-1`.
3. Three reader paths as one row: install a studio (`install.html`), wire a component (first item in the registry list), rebrand (`tokens.html#rebrand`).
4. Engine roster, 12 rows from `ENGINE_KINDS` (prism, cadence, splice, folio, pitch, tally, quill, photo, motion, design, draft, scene). Columns: engine, task line (from `APP_MANIFESTS` where a studio exists, else the `package.json` description), package form, registry items that need it, link. Marker per row, with a text label:
   - ring, "tarball package" for every engine today (decision 3 defers engine registry items);
   - filled disc, "registry item" for the items in block 5.
   A row whose studio is absent from `STUDIOS` says "no studio". Below the roster, a foundations row for non-engine packages: `ignition` (ring, native host, decision 4), `studio-layout` (ring, private), `icons` (disc, item `forge-icon`).
5. Registry items, 17 from `copy.json`, in two groups with counts: "Needs StudioUIProvider" and "No provider needed". Each row: title, one-line description, a11y status word, link. The icon item's line uses the corrected wording from decision 35: "47 glyphs drawn; 42 of 1,463 catalog ids resolve to one; 6 drawn glyphs are not catalog ids".
6. Footer links: `llms.txt` if present, the repo, `AGENTS.md`.

States:

| State | Home |
|---|---|
| Default | All five blocks present, `r/` status resolved |
| Empty | Registry items list empty (no `copy.json`): group headers stay with count 0 and the line "No registry items admitted yet", as Langdock keeps zero groups visible |
| Loading | None; the page is static |
| Error | A required source is unreadable: the banner turns to the `error` colour with the file path and the build exits non-zero, so a broken home is never published |
| Partial | Engine task line missing for an engine: row shows the `package.json` description and the word "no studio manifest" |
| Degraded | No script: everything present; the brand and density toggles are absent |

390 px: reader paths stack; roster becomes a definition list (engine name as heading, then labelled values) because a 5-column table does not fit; registry rows stay two-line. 1280 px: paths in one row, roster as a table with sticky header, facts column shows page counts and the generated-from commit.

Human and LLM: a human gets the honest status and a route in three clicks. An LLM gets the roster as a real `<table>` with `<th scope>`, the registry list as `<ul>` with item ids in `id` attributes, and a "Copy page" control that copies the sheet's text. The marker is text-labelled, so a text-only parser sees "tarball package" or "registry item".

### 5.2 Component page (`components/<id>.html`, 17 pages)

Purpose: let a reader install one item correctly the first time and know what it needs and where it fails.

Primary action: "Copy install command" (`npx shadcn@latest add @nitro-forge/<id>`). Item ids with slashes keep them (decision 33), so the page path nests.

Content blocks, in order. The first block is the prerequisite, before anything else, per `install-order.md` (every studio component throws without `StudioUIProvider`).

1. Title, one-line description from `copy.json`.
2. Prerequisite strip (full sheet width, `soft` fill, text label first): one of
   - "Needs StudioUIProvider" with the two items to install first (`studio-ui-provider`, `nyc-tron-host`), the theme step, and a link to `install.html#step-7`; or
   - "No provider needed". `copy.json` says this in terms for `studio-gesture`, `persona-model`, `instrument-system` and `workspace-utilities`. `studio-ui-provider` is the provider. For `studio-theme`, `forge-directions`, `forge-icon` and `forge-icon-button` the description is silent, so the generator marks them "provider not stated" (Partial state) until `copy.json` says. The generator reads the sentence and hardcodes no list.
   Item-specific native prerequisites follow in the same strip: `prism-editor` "needs `@nitro-forge/ignition` first (step 1)", `forge-workspace` and `forge-document-stage` "need `@nitro-forge/studio-layout` (step 3)".
3. Install block (framed, title bar, segmented control Use | Provider, after Subframe): command with Copy; peers line; `registryDependencies` list.
4. Props, one expandable row per prop (`<details>`), type and default in the summary line.
5. Variants (`studioId`, `density`, `width` where the item has them).
6. States table, from the handoff's State, How it is set, What the code does columns.
7. Example: the handoff's snippet, plus the Provider tab.
8. Accessibility: a11y status as a word and a reason. Values: reviewed-pass, reviewed-fail, unverified (decision 34). Failures from `a11y-status.json` are listed with their criterion, for example `forge-workspace`: "1.4.3: light muted on base 4.43:1". "Verified" is never shown, since nothing was rendered.
9. Do and Don't.
10. Facts column: needs provider (yes or no), needs ignition, needs studio-layout, a11y status, source files, peers, last generated.

States:

| State | Component page |
|---|---|
| Default | All blocks present |
| Empty | An item with no props: the Props block says "This item takes no props." and stays |
| Loading | Copy button shows "Copied" for 2 s; nothing else loads |
| Error | The item is in `copy.json` but has no section in the handoff: the build fails and names the id; a page with a stub body is never emitted |
| Partial | Add command shown with the banner "`r/` not built: this command resolves nothing yet" when the registry check fails. `prism-canvas` appears in `copy.json` while decision 30 defers its adapter; the page follows `copy.json` and adds "adapter deferred (decision 30)" |
| Degraded | No script: command is selectable text; tabs become two stacked blocks; `<details>` still open and close |

390 px: the prerequisite strip stays first after the title. The facts column becomes a label/value list under the install block. Command block scrolls horizontally inside its frame and never wraps mid-token; Copy stays 44 px. 1280 px: facts column right, sticky; sheet 720 px.

Human and LLM: the prerequisite strip is the first element after `h1`, so a reader who stops after two screens of text has the dependency. For an agent, the page ends with a "For agents" block in plain text: the exact commands in order, with each prerequisite step named by number, and the sentence that steps 1 to 3 cannot be installed outside the monorepo. Meta description equals the `copy.json` description, so search result and registry line match.

### 5.3 Tokens page (`tokens.html`)

Purpose: show what a rebrander can change, what is locked, what is deferred and why, and where values disagree.

Primary action: "Check your accents" (the live checker, block 2). The alternative, a copy button for the starter file, is secondary.

Content blocks, in order:

1. Rebrand contract (anchor `#rebrand`). Table of the three keys, per scheme, with the CSS variables each feeds: `accent` to `--color-primary`, `--color-accent`, `--color-focus`; `ink` to `--color-on-primary`; `soft` to `--color-primary-tint`. Minimum override: 3 keys by 2 schemes, 6 values. Starter file shape follows decision 24: a separate `brand.theme.json`, not a `theme` field in `brand.schema.json`.
2. Accent checker (script). Six inputs (three keys, two schemes) prefilled with the suite values, a brand select (suite, Prism), and an "In use" panel (after Replit) that paints a button, a selected row, a focus ring and a link with the chosen values. Three live checks per scheme, thresholds from `02-design-system.md` section 5: `ink` on `accent` 4.5:1, `accent` as focus on `raised` 3:1, `text` on `soft` 4.5:1. Each shows the ratio and the words "passes" or "fails", with a sample "Aa" (after Canva) and the number (Canva shows no number). The other pair checks in `02` (`text` and `muted` on surfaces) cannot move, since neutrals are locked.
3. Deferred (shown, not hidden). The six neutral keys (`base`, `raised`, `deep`, `line`, `text`, `muted`) with the reason: decision 23 defers them until the owner supplies a contrast check. Radius override: struck (decision 23), with the reason, 4 px chrome in `AGENTS.md`.
4. Locked. The nine locked groups from `tokens.map.json` (`error`, `workspaceStatus`, `paper*`, every scale, hit targets, chrome, stage, instrument, lab and document tiers), one line each.
5. Drift. Five records D1 to D5 from `tokens.map.json`, each as a table of source and value, with the sentence "Kept as separate tokens. Unification changes pixels and is the owner's call (decisions 5 and 20)." Swatches rendered from the actual hex, with value text beside each. Example D1: icons selected `#6859E8`, workspace light accent `#6950D1`, dark accent `#B7A5FF`, Prism `#66B9FF` and `#086CB8`, launcher `#9C5FE6`.
6. Token table, 234 rows from `tokens.map.json`: name, tier, role, dark, light, status, overridable. Filter box (script) and a tier `<select>`; without script the whole table prints. Each row's swatch is a 16 px square plus the hex as text.
7. Densities. Compact, standard, comfortable and what they change and never change (`tokens.map.json` `densities`).

States:

| State | Tokens page |
|---|---|
| Default | All seven blocks |
| Empty | A filter matches nothing: "No token matches `<query>`. 234 tokens are indexed. Clear the filter." |
| Loading | None beyond the checker's first compute, instant |
| Error | A hex input is not valid: the field shows "Use six hex digits, for example `#6950D1`", the checks for that scheme show "not checked", no stale result is kept |
| Partial | Contrast of the six deferred neutral keys is not measured by the checker: block 3 says so. A drift pair has no rendered swatch if the value is not a hex: shown as text |
| Degraded | No script: checker block shows the shipped suite and Prism values with their precomputed ratios (computed at build), the table is unfiltered |

390 px: contract table becomes two cards per key (dark, light); the checker inputs stack; the token table becomes a list of definition blocks with name first, then labelled values; swatches stay 16 px with hex text. 1280 px: contract and checker side by side (checker right), token table with sticky head and horizontal scroll disabled up to six columns.

Human and LLM: a human can try a brand and see the number that decides. An LLM gets every token as a table row with the name in a `<code>` cell, `id` anchors per token name (`#--color-primary`), and the contract as a literal JSON block it can copy. The page states the 3-key limit in the first sentence of block 1, which is also the answer to the most common rebrand question.

### 5.4 Install page (`install.html`)

Purpose: give the nine-step chain in order and show which steps a registry add covers.

Primary action: "Copy this step's commands", on the step in focus (the page opens at step 0). One primary button at a time; the others are secondary.

Content blocks, in order:

1. Banner: "Nothing here is published to npm. Steps 1 to 3 cannot be reproduced outside the monorepo today: no tarball or release exists for `ignition`, the engines or `studio-layout`." Source: `install-order.md`.
2. Agent block (after Featurebase): a Copy prompt button and the prompt text in a `<pre>`. The prompt names the nine steps in order, marks 1 to 3 as monorepo-only, and tells the agent to stop and ask rather than invent a release URL.
3. Filter (script): "Show only steps a registry add covers" (steps 4 and 8, plus the file parts of 5, 6, 7).
4. The chain, one container, nine rows in a single ruled column (after LangChain), numbered 0 to 8 to match `install-order.md`. Each row, two columns at 1280 (after Clerk): left the step title and a one-line why; right the command block with filename header and Copy.
   | Step | Title | Marker |
   |---|---|---|
   | 0 | Toolchain (Node >=24.3.0, pnpm 12.18.0, Rust, Xcode or Android NDK with `cargo-ndk`) | ring, "registry add: no" |
   | 1 | `@nitro-forge/ignition` native host | ring |
   | 2 | Engine package, for example `@nitro-forge/tally` | ring |
   | 3 | `@nitro-forge/studio-layout` | ring |
   | 4 | `@nitro-forge/icons` via item `forge-icon` | disc, "registry add: yes" |
   | 5 | NYC-Tron tarballs | half disc, "registry add: partly" (packages no, wrapper items yes) |
   | 6 | Theme CSS | half disc (files yes, build step no) |
   | 7 | `StudioUIProvider` and host | half disc (files yes, host wiring is app code) |
   | 8 | Studio components | disc |
   The marker is a 16 px shape plus the words, so the encoding never relies on shape or colour alone. Ring, half disc and disc differ by fill area, and each has a text label.
5. Registry versus tarball table (from the end of `install-order.md`), as a real table.
6. Known gaps, verbatim in substance: no verify command is stated in the repo for any step ("verification: not stated, UNVERIFIED"); Apple archive script and integration doc disagree on Intel simulators; three of seven NYC-Tron packages unexplained. Each is labelled UNVERIFIED as in the source.

States:

| State | Install page |
|---|---|
| Default | Nine steps, banner, agent block, filter off |
| Empty | The registry-only filter is on and the chain data has no registry steps: "No step is covered by a registry add." (cannot happen with today's data; the state exists so the filter never shows a blank page) |
| Loading | Copy shows "Copied" for 2 s |
| Error | `install-chain.json` and the table in `install-order.md` disagree on step count: build fails naming both counts |
| Partial | A step's command is "not stated in the repo": the row shows that sentence and a link to the source file, never an invented command. Step 5 shows the pinned tarball source `tooling/nyc-tron.json` rather than URLs the page cannot verify |
| Degraded | No script: filter and Copy absent; commands selectable; every step visible; rail drawn in CSS only |

390 px: single column, prose above command; command blocks scroll horizontally, Copy 44 px; the step number gutter stays at 32 px with the marker below the number. 1280 px: two columns per row inside the 720 px sheet widened to 960 on this page only, since command blocks need width; facts column drops.

Human and LLM: a human sees at a glance which steps `shadcn add` does not cover. An LLM gets a `<ol start="0">` of nine `<li id="step-N">`, each with its method as text, plus the agent block, and the page does not hide a command behind a tab.

### 5.5 Search (`search.html`)

Purpose: find an item, token, step or engine by name or by the words an agent would use.

Primary action: submit the query (Enter). No other primary.

Content blocks, in order:

1. Query field (44 px target, `muted` border), scope chips: All, Components, Tokens, Install, Engines. Chips are radio buttons in a `fieldset`.
2. Result groups, each with a count shown even at zero (after Langdock): Components (17 items), Tokens (234), Install (9 steps), Engines (12). Rows: title, a snippet with the match in `<mark>`, a path. Groups collapse (`<details open>`). The active row shows an Enter hint (after Coda).
3. Footer key legend (after Customer.io): `/` focus, up and down move, Enter open, Esc clear.
4. Index note: "Indexed from `copy.json`, `tokens.map.json`, the install chain and the engine roster at <commit>." Gives the stale-index fact the references lacked.

Index: one JSON blob inline in `search.html` (`<script type="application/json" id="index">`), not a separate file, so the three-file limit holds and the page opens from disk. Matching: lowercase, split on non-alphanumerics, the stemming rules already in `retrieval-eval.mjs`, AND across terms with title weighted above description. The index text is exactly the registry `title + description`, so `retrieval-queries.json` can be replayed against it as an acceptance test.

States:

| State | Search |
|---|---|
| Default | Query with results in several groups, counts shown |
| Empty | No query: all four groups listed collapsed with counts and the line "Type a name or a task. Try `provider` or `rebrand`." (the two examples must each return results; a build check enforces it) |
| Loading | The index parses on page open (under 40 KB); a "Reading the index" line shows until it is ready and never longer than one frame in practice |
| Error | Index JSON fails to parse: "The search index could not be read. Browse the lists on the home page." with links, and the error text for agents |
| Partial | Query matches nothing in a group: the group stays with "0" and no rows. Query matches nothing at all: "No results for `<query>`. Searched 17 components, 234 tokens, 9 steps, 12 engines. Some items are not registry items (engine packages, `ignition`); search Engines." |
| Degraded | No script: the page lists every entry in all four groups as plain links, so the index is also a sitemap |

390 px: chips wrap onto two lines; groups full width; footer key legend hidden (no keyboard); snippets clamp at three lines. 1280 px: groups in one column inside the sheet, key legend visible.

Human and LLM: a human gets grouped results with counts. An LLM that can only fetch HTML still gets the whole index on the page with no script, plus the query string route (`search.html?q=provider`), which a script-less fetch ignores. The no-script list is therefore the machine surface.

## 6. Reading rules for LLMs, site-wide

- Content in the HTML source, never injected by script. Script only adds behaviour.
- One `h1` per page, strict heading order, `<main>`, `<nav aria-label>`, real `<table>` with `<th scope>`.
- Stable ids: `#step-N`, `#--color-primary`, `#<component-id>`, `#engine-<id>`.
- Every command in a `<pre>` as plain text, one command per line, no prompt characters, no line-continuation tricks.
- Every page states its own limits near the top: not built, deferred, unverified. A model that quotes the first screen gets the caveat.
- A "Copy page" control copies the sheet's text as Markdown-like plain text.
- Links to `llms.txt` and `AGENTS.md` in the footer when the files exist.
- Meta description and `<title>` follow the `copy.json` title and description for item pages.

## 7. Implementation constraints (decision 36)

Generator: one Node script, no dependencies, at `docs/site/build.mjs`. It runs on the repo's Node (>=24.3.0, `package.json` `engines`), which strips types, so it can `import` `packages/studio-workspace/src/theme.ts` directly, the way `build-theme.mjs` does (install-order step 6). Not run on this machine; UNVERIFIED until the build step exists.

Output under `docs/site/`: HTML pages, `site.css` (target under 20 KB), `site.js` (target under 8 KB, no `fetch`, no `import`). All links relative and computed from page depth. Every link names its file (`index.html`), so the site opens from `file://` with no server. No external font, script, style or image: a check fails the build on any `http(s)://` in `src`, `href` to a non-allowlisted host in CSS and JS.

Inputs: `theme.ts`, `docs/agent-native/copy.json`, `a11y-status.json`, `tokens.map.json`, `retrieval-queries.json`, `compatibility.v1.json`, `ENGINE_KINDS` (parsed from the array literal in `packages/ignition/src/types.ts` by regex), `APP_MANIFESTS`, the per-item sections of `03-design-handoff.md`, and a new hand-authored `docs/site/data/install-chain.json` (nine steps) cross-checked against the table in `install-order.md`. Item bodies come from a minimal Markdown renderer limited to headings, paragraphs, tables, fenced code, lists, inline code and links. Any other syntax fails the build and names the file and line.

`site.js` does only: persisted scheme, density and brand (in `try`, falling back to defaults), copy buttons, "Copy page", the accent checker, the registry-only filter, token filter, search, `/` shortcut. It depends on no layout.

Build checks (`node docs/site/build.mjs --check`):

1. Every internal link and anchor resolves.
2. One `h1`, one `main` per page.
3. Every colour pair in section 2.1 meets its threshold, computed from `theme.ts`, for suite and Prism. A new pair fails the build until it is declared.
4. `retrieval-queries.json`, replayed on the inline index, returns the same relevant ids as `retrieval-eval.mjs`.
5. Install chain has nine steps and matches `install-order.md`.
6. Roster has 12 engines and equals `ENGINE_KINDS`.
7. Page sizes: each HTML under 150 KB.
8. No `http(s)://` resource loads.

## 8. How the plan meets the brief's five forge specifics

- Install page as a 9-step chain with partial registry coverage: block 4 of 5.4, rail markers (ring, half, disc) plus words, filter for registry-only.
- Provider prerequisite before anything else on a component page: block 2 of 5.2, directly under the title, with item-specific native prerequisites in the same strip.
- Tokens page: the three-key contract first, the six deferred neutrals and the struck radius override shown with reasons, five drift records with real hex swatches, and the measured failures stated.
- Home: 12 engines with ring (tarball package) and 17 registry items with disc, foundations row for `ignition`, `studio-layout`, `icons`.
- Rebrandable: brand preview in the header applies the suite or Prism accent family to every page and demonstrates that neutrals hold.

## 9. Open items and unverified claims

1. UNVERIFIED: `import` of `theme.ts` from a plain Node script on Node >=24.3.0. `install-order.md` says `build-theme.mjs` does this; no run was made here.
2. UNVERIFIED: Georgia is the serif on every reader's machine. It is the token (`workspaceScale.font.serif`) and has no bundled file, so Linux and some Android browsers fall back to another serif. Line length is capped by `ch`, so a fallback keeps the measure.
3. Decision needed: `--docs-prose-narrow` at 16 px, the one value outside the type scale. The alternative is 14 (`body`), which is small for serif prose.
4. Decision needed: whether item bodies come from `03-design-handoff.md` sections (this plan) or from per-item pages once decision 11's tiering exists.
5. `prism-canvas` is in `copy.json` and its adapter is deferred in decision 30. The plan follows `copy.json` and labels it. Resolve in `copy.json`.
6. Only suite and Prism have accent overrides. Other studios have launcher accents in `icon-family.mjs` that differ from in-app colour (decision 5, owner call), so the brand preview offers two.
7. No verify command is stated for any install step; the page says so instead of inventing one.
8. The 1280 and 390 behaviours are specified, not seen. Step 8 (design-critique, decision 37) judges the rendered site.
