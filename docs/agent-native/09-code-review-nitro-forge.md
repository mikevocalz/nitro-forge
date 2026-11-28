# Independent review: Nitro Forge agent-native change set

Branch `agent-native-20261119` vs `origin/master` (10 commits, 169 files). Reviewer ran everything below on a read-only clone; scratch scripts are in this directory.

## Verdict: MERGE AFTER FIXES

Behaviour preservation holds, independently. The generated CSS is a strict superset, the theme build reproduces byte for byte, and `r/`, `docs/` and `llms*.txt` rebuild identically. Merging the repo content is safe. The registry as published would not install working code, and CI has one certain failure. Fix F1 to F4 before tagging or relying on the registry.

Counts: blocker 0, major 5, minor 9.

## Findings

| id | sev | where | what | failure scenario | fix |
|---|---|---|---|---|---|
| F1 | major | `tooling/registry/config.json` `nycTron.importPrefix`; `r/*.json` (20 imports) | Forge files import `@/components/ui/<key>`. The NYC-Tron registry (`tron/tooling/registry/config.json`, `r/Button.json`) installs to `@components/nyc-tron/ui/components/<key>.tsx` and its own files import `@/components/nyc-tron/ui/components/...`. The config note says "ASSUMED, not verified"; the Tron registry now exists and contradicts it. `check-imports` passes only because it trusts the same assumed prefix. | `npx shadcn add @nitro-forge/forge-workspace` copies files, then `tsc` fails on `@/components/ui/Toolbar` (no such path) unless the consumer hand-writes a path alias. | Set `importPrefix` to `@/components/nyc-tron/ui/components/`, rebuild, and make `check-imports` verify against the Tron `r/` targets. Delete the "assumed" caveats in SKILL.md and config. |
| F2 | major | `components.json:17`, `config.json` `tag`; llms.txt, SKILL.md, 36 site pages | One placeholder tag `v0.1.0-agent-native` is applied to both namespaces. Tron has tag `v1.0.0-rc.2`; its `r/` is absent at that tag and on `main` (only on Tron's unmerged `agent-native-20261119`). The 22 `@nyc-tron/*` names do exist in Tron's registry (22 of 22 matched), so naming is right and publication is not. | Even after Forge tags, every `registryDependencies` fetch of `@nyc-tron/*` returns 404. | Split the tag per namespace (the config note already suggests it). Publish Tron's registry first. Gate the Forge tag on a fetch of one Tron item. |
| F3 | major | `.github/workflows/registry.yml:50-56` | Last step runs `check-no-hardcoded.mjs`, which needs `ts-morph`. The job has no `pnpm install`. | Reproduced: `env -u CODEMOD_TOOLS_DIR node tooling/codemod/check-no-hardcoded.mjs` throws "ts-morph not found". The registry job fails on a clean checkout after the other four steps pass. | Add corepack + `pnpm install --frozen-lockfile --ignore-scripts` (the lockfile already carries ts-morph 28.0.0), or a scoped install. Do not use the `-f` skip as a fallback. |
| F4 | major | `tooling/codemod/check-no-hardcoded.mjs:36-45,87-100`, `allowlist.json` | "Zero hardcoded values except 66 documented" is true only for the gate's definition: property assignments on 43 style names plus hex strings. Not covered: JSX `size={14..23}` (35 sites incl. Tailwind), `rounded-[4px]` (about 20), `fs(scale.type.label + 1)` offsets, `strokeWidth={1}`, SVG numerics. Of 49 "Not listed in tokens.map.json" numeric sites, 24 have an exact same-valued token that already exists (for example `paddingHorizontal: 40` is `spacing.off40`, `top: 22` is `off22`, `outlineWidth: 2` is `borderWidth.strong`). | The mission claim reads as complete; a reviewer who greps `size={` finds dozens of literals. The reason text "no exact token to apply" is wrong for 24 of them. | State the gate's scope in the PR and AGENTS.md, correct the allowlist reason for the 24, extend the gate to JSX numeric props and `[Npx]` classes. Mapping the 24 is value-preserving and can follow. |
| F5 | major | `tooling/registry/theme/brand-theme.ts:23-27`; `packages/studio-workspace/src/index.tsx:48` | Rebrand fan-out sets only NYC-Tron CSS names. `ForgeWorkspace`, stage, icons and turret read `colors.accent/ink/soft` from JS `workspaceThemes` plus `themeOverrides`, not from the CSS variables. `brandCssVariables` does not touch them, and no doc ties `themeOverrides` to `brand.theme.json`. | Install `brand-theme`, apply `brandCssVariables` in a `TokenScope`: Button and TabBar recolour, workspace header, rail label, icons and persona turret keep the old accent. "One rebrandable registry" is only half true. | Document the `themeOverrides` step, or add a helper that returns a `WorkspaceColors` partial from `BrandTheme`. Add that to the docs example. |
| F6 | minor | `brand-theme.ts:75-96` | `brandThemeProblems` checks structure only; contrast is a separate call. `checkBrandTheme` assumes a valid input: missing `light.soft` throws `TypeError` (slice of undefined), a 3-digit hex gives `NaN` ratios with `pass:false`. Docs do say to run both. | A caller who runs only `checkBrandTheme` on user JSON crashes. | Have `checkBrandTheme` call `brandThemeProblems` first, or fold both into one `validateBrandTheme`. |
| F7 | minor | `.github/workflows/*.yml` | No CI step runs `tokens.test.ts`, `tokens:check`, `tokens:prove`, or `build-theme` plus `git diff`. `tokens.test.ts` uses `includes`, not equality, for the CSS check. Drift between `tokens.ts` and `theme.css` would pass CI unless `turbo test` runs it elsewhere. | Someone edits `tokens.ts`, forgets `build:theme`; stale CSS ships. (Missing-declaration case is caught; changed-value of an old declaration is not.) | Add `pnpm --filter @nitro-forge/studio-workspace build:theme && git diff --exit-code` to a workflow. |
| F8 | minor | `README.md:3` | Still says "Seven products". AGENTS.md now says 12 engines (verified: `ENGINE_KINDS` 12, 12 matching package dirs, `STUDIOS` 11). | Reader sees two counts. | Update README. |
| F9 | minor | `docs/agent-native/05-accessibility-review.md:3` and `:272` citations | Header says "Nothing under packages/ changed"; false after commit 3911299. Status-line citation `index.tsx:272` is the wrapper; the `accessibilityLiveRegion` Text is line 273. | Stale statement, off-by-one cite. | Edit. |
| F10 | minor | `docs/site/site.js` search `mk()` | Highlighting runs after `esc()`. A query token `amp`, `lt`, `gt` or `quot` matches inside `&amp;` and splits the entity, so the user sees `&a` + `mp;`. Not XSS: tokens are `[a-z0-9]`, results are escaped first, empty and error messages use `textContent`, checker output uses validated hex and numbers, JSON index escapes `<`. | Cosmetic glitch on a query like "amp". | Mark on raw text, then escape segments. |
| F11 | minor | `registry.yml` triggers | `docs/agent-native/**` not in registry.yml paths although `copy.json` and `a11y-status.json` feed the build (only those two listed); fine. `docs.yml` `check` omits `check-imports`. | Low. | None needed beyond noting. |
| F12 | minor | `SKILL.md`, `llms.txt` | All 41 non-site files mentioning the placeholder tag do disclose it as a placeholder (SKILL.md:59, llms.txt:3, install page badge). User-facing leaks: `llms.txt` (links x about 12), `llms-full.txt`, `components.json`, all 36 site pages (footer/badge), `docs/site/install.html`. | 404s for every raw URL until tag exists. | Covered by F2; rebuild after tag. |
| F13 | minor | `docs/agent-native/03-design-handoff.md` etc. | Counts of 17 vs 18 are consistent where used: "17 admitted + brand-theme". `registry.json` has 18; a11y statuses 6 pass, 10 fail, 2 unverified (brand-theme, nyc-tron-host); SKILL says 17 admitted: 6/10/1. Correct. No stale 17-for-18 found. | n/a | none |
| F14 | minor | `.mcp.json` | Adds `npx shadcn@latest mcp` (unpinned) while everything else pins 4.23.0. | Supply-chain drift. | Pin. |

## 1. Behaviour preservation (verified)

- `prove-equivalence.mjs`: PASS, 0 diffs, 11 files, 337 refs.
- My own check (`subst.mjs`): replaced every `tokens.*` / `icon*` reference with the token's runtime value (read from tokens.ts, tokens.js), normalised, compared to base text. 9 of 11 files identical. The 2 flagged by my script are artefacts: ForgeIcon.js differs only by the added import names; stage.tsx by 3-level `.dark/.light` access my regex first mishandled, and I re-checked the 12 lines by eye (`stageCaption`, `stageHeading` light/dark map to the exact replaced hex). state.js: one `0.52` to `iconOpacity.disabled`.
- Derived sites remain as expressions (`scale.space.inset + 2`, `scale.size.target+4`, `scale.space.element / 2 + 2`, etc.); `tokenize --dry-run` finds nothing further to replace (idempotent); `git status` clean afterwards.
- Negative `-0.2` and the ternaries (`active ? tokens.fontWeight.semibold : '400'`, `peeking ? tokens.fontWeight.bold : '400'`) intact. `stage.tsx` fixed "0.4" style cases fine. No non-style position rewritten (all substitutions were style values, and `size={..}`, `strokeWidth={1}` were left alone except `visuallyHidden` width 1 to `borderWidth.hairline`, value 1, which is semantically odd: a 1 px clip box named hairline, equal value, no behaviour change).
- Beyond-the-map sites: 35 allowlisted "not listed" site-instances, plus 12 offsets, 8 arithmetic, 6 k-factors, 1 shadow class. I could not map them to the author's count of 13; counts differ by method. 24 of the 49 have an existing exact token (F4).
- CSS: my own tokenised declaration diff (`cssdiff.mjs`, selector-aware, media-aware) on theme.css (84 old declarations) and theme.native.css (58): 0 missing, 0 overridden by a later value. Added 431 and 336 declarations. The shipped `css-superset.mjs` crashes when run with no args (usage `--git <ref> <path>` or two files); not a defect in the proof itself.
- `build-theme.mjs` rerun in an isolated copy of theme.ts, tokens.ts, forge-directions.ts, interaction-policy.ts: both CSS files byte-identical (`cmp`).
- Density: compact and comfortable blocks hold only values differing from standard, equal to `resolveWorkspaceScale`. `--spacing-fixed-*` equal the standard scale. One risk: base `@theme` now declares `--spacing-element`, `--spacing-rail` etc. at standard values, and `[data-density]` overrides them; nothing in the old CSS did that, so any consumer utility named `p-element` is new surface, not a changed one. Tron variable-name collisions: none found for `--color-*` additions in the Tron registry names I checked.
- `tokens.test.ts`: 8 tests pass under `node --test`. They compare tokens against independent sources (icons tokens.js, theme.ts, forge-directions) and check CSS names; the CSS test uses `includes`, so it detects missing declarations only (F7). Meaningful, not tautologies, except "derived tokens read the sources that own them", which compares a value to the thing it was assigned from.
- Not verifiable here: rendered pixels, `tsc` typecheck (no node_modules; the repo's `typecheck` was not run).

## 2. Registry

- 18 items; r/registry.json equals registry.json; no `@nitro-forge` cycles (DFS); 51 installed files, no target collisions; `validate-registry` OK; `check-imports` OK (92 relative, 26 @nyc-tron, 20 npm, 5 declared prerequisites).
- Full rebuild in a copy (`git archive`, `npx shadcn@4.23.0`): `registry.json`, `components.json`, `registry-excluded.json` and all `r/*.json` identical; `build-docs`, `build-site --check` and `check-docs` pass with docs and site identical.
- Moves verified: `keyboard-event.ts`, `drag-transport*.ts` in studio-gesture; `tokens.ts` in forge-directions (which depends on studio-theme and instrument-system, matching tokens.ts's imports of theme, forge-directions, interaction-policy).
- `providedBy` entries are right: Tron's `PanResponderDrag`, `GestureHandlerDrag` list `gestures/drag-transport`; `LayerStack` lists `forge/layers/layer-model`.
- `check-imports` false-pass analysis: handles `import`, `export from`, `export * from`, side-effect, dynamic `import()` and `require`; strips comments and strings; template-literal specifiers are skipped (acceptable). It resolves against the installed closure. Weakness: the `@nyc-tron` side resolves against config assumptions, not Tron's real targets (F1). `.d.ts` counts as satisfying a relative import.
- Prerequisites: `prism-editor` (ignition, via direct import) and `studio-layout` (forge-workspace, forge-document-stage, workspace-utilities) are in `meta.prerequisites` and the `docs` text.
- brand-theme validator, my inputs (`brand/run.mjs`): good 1 (Prism preset), good 2 (suite purple, compact), good 3 (green) pass both checks. Bad 1 (extra `base` key): "dark.base is locked". Bad 2 (light accent `#F2F2F2`): structure ok, contrast 1.12 fails two rules. Bad 3 (`accent:'blue'`, missing `soft`, extra `radius`): three structure problems, but `checkBrandTheme` throws (F6). Bad 4 (3-digit hex): flagged, NaN ratios. Bad 5 (`defaultDensity:'huge'`) is NOT rejected by `brandThemeProblems` (it ignores `defaultDensity` values; only the JSON schema rejects it) - add to F6.

## 3. Icon wording

Source recount (`icons.mjs`): 47 drawn glyphs, 1,463 catalog ids, 42 ids resolve (slug match), 41 distinct drawn glyphs map to them (duplicate slugs like `delete`, `star` explain 42 vs 41), 6 drawn glyphs are not catalog slugs (brush, scissors, table, pdf, music, sparkles). The sentence "47 glyphs drawn; 42 of 1,463 catalog ids resolve; 6 drawn glyphs not catalog ids" is correct. It appears identically in SKILL.md:95, llms.txt:31, forge-icon.md:20, 06-docs-direction.md:151. Remaining "1,463 icons; 47 are drawn" occurrences (forge-icon.md:103, 03-design-handoff.md:1665, 04-ux-copy.md:30) are negated or compatible; no wrong number.

## 4. Accessibility claims

Re-derived from `theme.ts` and `forge-directions.ts` (`c3.mjs`): 16 of 17 sampled pairs match the doc to two decimals (muted/base 4.43, muted/deep 4.01, paperMuted 3.98 both schemes, prism line 1.78/1.57/1.16/1.37, amber 1.98, rose 2.62, violet 2.85, white on accent 2.13, cancel chip 1.11, icon ink 1.02, icon accent 2.89). The one "DIFF" is my pair choice (chipEdge vs body in light; doc uses the chip against `body` of a different role); the doc's own row recomputes to 2.08 from its stated hexes. The doc's 94 six-digit table rows recompute with 0 mismatches; `contrast.mjs --json` has 186 results (149 pass, 18 FAIL, 1 COND-FAIL, others exempt) and an independent formula flips none. Items: registry statuses 6 pass, 10 fail, 2 unverified match the doc.
- "Status line Android-only": true; `accessibilityLiveRegion` at `index.tsx:273`; persona-composer and turret call `announceForAccessibility` on native, workspace does not.
- "ForgeIconButton status is colour-only": true (`status` goes to `resolveIconState` colour; `accessibilityState` is selected, disabled, busy).

## 5. Docs and AGENTS.md

- AGENTS.md diff vs master: 36 additions, 3 deletions; the only deletion is the "seven engines" paragraph, replaced with the 12-engine one. Every other pre-existing rule preserved.
- Commands in SKILL.md, AGENTS.md and install-order.md that I could resolve exist: the 9 node tooling scripts, `pnpm --filter @nitro-forge/ignition codegen` (script `nitrogen`), `@nitro-forge/console demo` (apps/console), `tests/nitro-host.test.ts`, `tooling/verify-nyc-tron-pin.mjs`. Not run: cargo, nitrogen, `shadcn add` against a live host (the docs say so).
- 12 engines vs 24 package dirs: 12 engine dirs plus 12 others (icons, ignition, studio-*, media-ui, ...). Correct.
- llms.txt: H1, blockquote, H2 sections of `- [name](url): note`, as llmstxt.org specifies.

## 6. Site

No `fetch`, XHR, beacon, analytics, iframes, fonts or external hrefs in the site assets (grep). Copy buttons use `navigator.clipboard` with a textarea fallback and report failures. Secret and path grep (`/Users/`, `/private/tmp`, `mikevocalz@`, `ghp_`, `sk-`, `AKIA`) over every file this branch adds or changes (r, docs/site, docs/components, docs/engines, llms, tooling, workflows): zero hits. (Pre-existing master files under `docs/recovery`, `docs/design` contain `~/...`; not in this diff.) `.mcp.json` is unpinned (F14).

## 7. CI

- `registry.yml`: checkout, setup-node 24, `build.mjs` (npx shadcn, needs network), `git diff --exit-code` over r, registry.json, components.json, registry-excluded.json (passes: build is deterministic), `check-imports`, `validate-registry` (passes), then `check-no-hardcoded` FAILS (F3). First failure on a clean checkout: that last step.
- `docs.yml`: should pass (rebuilt and compared: docs/components, engines, site, llms identical; `check-docs` passes). `git diff --exit-code` covers generated dirs but not `r/`. Needs no ts-morph.
- Placeholder tag leaks to: `components.json`, `tooling/registry/config.json`, `llms.txt`, `llms-full.txt`, SKILL.md:59, and all 36 `docs/site/**` pages (badge/footer; the install page prints it). `docs/components/*.md` and `docs/engines/*.md` do not contain it.

## 8. Admitted-unverified items

- Could verify: names of the 22 `@nyc-tron/*` registryDependencies (exist in the Tron clone); icon counts; contrast arithmetic; token and CSS equivalence; build reproducibility; generated site is free of network calls.
- Could not verify: rendered pixels and screen-reader behaviour; `tsc` typecheck and Metro bundling (no install); `shadcn add` against a live Forge host; raw.githubusercontent fetch (tag does not exist); install-order cargo/Xcode/NDK steps; whether shadcn expands `@components/...` targets the way the docs assume (both registries use it, so it is consistent but untested in a real project).

---

## Resolution (appended after the fix pass, commits 911f01d, 43baa61, 649a70c)

| Finding | Status |
|---|---|
| F1 install prefix for NYC-Tron controls | Fixed. Prefix derived from NYC-Tron's real targets; check-imports and validate-registry read Tron's registry (`--nyc-tron-registry`). Install proof: 18 Forge items plus Tron dependencies, 228 imports across 108 files resolve, 0 unresolved. |
| F2 placeholder tag in URLs | Fixed. `nitroForgeRef=master`, `nycTronRef=main`, `set-ref.mjs`. Moving refs until the owner cuts tags. |
| F3 CI step order, ts-morph missing | Fixed. registry.yml installs ts-morph, adds equivalence proof, token-map, build-theme --check and token tests. Run under `env -i` locally. |
| F4 narrow "zero hardcoded" gate | Fixed. Gate now covers JSX numeric props, Tailwind arbitrary values and `fs(x+n)`; 32 sites moved to existing same-valued tokens. Honest count: 76 findings on 53 lines, all allowlisted with reasons. |
| F5 two rebrand channels | Fixed in docs and code: documented in SKILL.md, brand-theme page, 02-design-system 5.1; `checkBrandTheme` no longer throws; `defaultDensity` validated; 7 tests. |
| Minors | README engine count, a11y review line, search highlight fixed. F11, F13 needed no change. `shadcn@latest` in `.mcp.json` kept (mission specifies it) with a pinning note. |

Not verifiable here: rendered pixels, tsc, Metro, a live fetch from raw.githubusercontent.com.
