# F4: §3.3 sequence on app identity

Surfaces: each app's launcher icon and label, the About screen and title bar
of a studio build, and the header of each lab. Every step below was run on
2026-11-12 with its skill loaded through the Skill tool, at commit `80c0001`
or later on `feat/f4-app-identity-20261111`. The first version of this
section (PR #79 body at `46b753c`) was written without loading the skills; R2
rejected it, and nothing from it is carried over unless re-derived here.

| Step | Skill | Status |
|---|---|---|
| 1 | `design:user-research` | Run. Desk research only; no participants |
| 2 | Mobbin, then Dribbble | NOT MET (no iPad coverage; Dribbble images not opened) |
| 3 | `design:design-system` | Run |
| 4 | `design:ux-copy` | Run; one copy change made |
| 5 | `frontend-design:frontend-design` | Run for the launcher; lab-header captures NOT RUN |
| 6 | `design:accessibility-review` | Run; one failure found and fixed |
| 7 | `design:design-critique` | Run |
| 8 | `design:design-handoff` | Run |
| 9 | `engineering:code-review` | Self-review run; the independent review is R2's |
| §3.2 | `engineering:testing-strategy` | Run |

## 1. `design:user-research`

The skill asks for a method choice before findings. Usability testing with 5
to 8 people is the method that fits launcher recognition (find the app on a
home screen, say what it opens). No sessions were run, so the notes below are
desk research from the repository, not findings, and the plan that follows
is how to turn them into findings.

| Product | Who installs it | What they already run | Where the current path loses them |
|---|---|---|---|
| Forge (suite) | Developers and testers who want every studio in one build | Affinity v3, Adobe and Office suites, where one launcher opens many tools | Before F4 the app was "Nitro-Forge" in config, "NitroForge" on screen and had Expo's blank icon, so the home screen gave no hint it was a suite |
| Prism, Quill, Tally, Pitch, Folio, Splice, Cadence | Someone who wants one kind of document: image, text, sheet, slides, PDF, video, audio | The single-purpose app for that document (Affinity Photo, Word, Excel, PowerPoint, Acrobat, LumaFusion, Logic Pro) | Studios could only be reached inside the suite; no studio had its own icon, label or About, so a studio build could not be told apart from the suite |
| Audio Lab, Media Lab | Forge developers testing native audio and transport controls | Xcode and Android Studio sample apps | Media Lab's launcher label was its slug `forge-media-controls-lab`; neither lab had an app id; the Audio Lab header named a product ("Nitro Forge · Native Audio Lab") the manifest did not |
| Cadence QA | The acceptance harness run by agents and testers | The other Forge labs | Its heading read "Cadence / Native", a description of the build, not of the job |

Plan to replace the desk notes: five participants who use Affinity or Office
on iPad; show the iPad home screen with the eleven icons and their labels,
ask them to open "the app for slides" and "the test build of the audio
engine", record time to tap and wrong taps, then ask what they expect About
to show. Not run: there is no iPad build to put in front of anyone yet (F5
picks desktop studios; no studio has compiled natively, `docs/ROSTER.md`).

## 2. Mobbin, then Dribbble: NOT MET

Mobbin's tools return iPhone captures for `platform: ios` and desktop pages
for `web` and `search_sections`; five queries across `search_screens`,
`search_flows` and `search_sections` returned no iPad screen. Dribbble shots
that may show iPad screens were found, but their images could not be opened
from this session (the site returns an empty bot-check page, and the browser
extension was not connected), so none is used. Queries, results and the shot
list are in `design/references/app-identity-launcher.md`.

## 3. `design:design-system` audit

Components reviewed: icon family source (`tooling/brand/icon-family.mjs`),
About screen (`apps/example/app/about.tsx`), lab headers. Issues found: 6.

### Naming consistency

| Issue | Where | Action |
|---|---|---|
| Comment pointed at `design/icons/ICON-GRID.md`, which does not exist | `tooling/brand/icon-family.mjs:3` | Fixed: points at `design/APP-IDENTITY.md` |
| Comment named `rebrand.mjs`; the file is `rebrand-check.mjs` | `tooling/brand/brand.cjs:3` | Fixed |
| Lab headers named the app three ways ("Nitro Forge · Native Audio Lab", "Forge media controls · SDK 58", "Cadence / Native") while the manifests say "Nitro Forge Audio Lab", "Nitro Forge Media Lab", "Nitro Forge Cadence QA" | lab `App.tsx` files | Fixed: headers read `productName` from `extra.forgeBrand` |
| "Cadence QA" keeps the ids `ai.nitroforge.cadence.native` / `.studio` | `examples/native-cadence/brand.json` | Kept: evidence receipts name those ids |

### Token coverage

| Category | Defined | Hardcoded values found |
|---|---|---|
| Icon colour | `FAMILY[*].colour`, `GROUNDS`, `STEEL` in one file | 0 outside that file |
| Icon geometry | `CANVAS`, `UNIT`, `KEYLINE_RADIUS`, `SQUARE_SCALE` | Glyph coordinates are literal numbers on the 64 px grid; acceptable for artwork, checked by the keyline test |
| About screen colour | `workspaceThemes` | 0 |
| About screen type | none (no type tokens in `workspaceScale`) | `fontSize` 22 and 13, `lineHeight` 28 |
| Lab colour | none | Audio Lab 5 hex values, Media Lab 3; the labs do not use `workspaceThemes` (F8 scope) |

### Cross-studio consistency (icon family)

| App | Ground | Form | Colour | Steel detail |
|---|---|---|---|---|
| Forge | product | ingot | white heat `#F3E7D3` | top band |
| Prism | product | prism | temper purple `#9C5FE6` | ray |
| Quill | product | three lines | temper blue `#4F77E8` | caret |
| Tally | product | 3 x 3 cells | verdigris `#33B38B` | selected cell |
| Pitch | product | slide | forge orange `#F07C2F` | stand |
| Folio | product | page | cherry red `#DE4339` | turned corner |
| Splice | product | two clips | temper straw `#E3B23D` | playhead |
| Cadence | product | level meter | temper light blue `#40B5DB` | peak bar |
| Audio Lab | lab (hatched) | knob | Cadence's blue | pointer |
| Media Lab | lab (hatched) | play triangle | Splice's straw | cue bar |
| Cadence QA | lab (hatched) | level meter | Cadence's blue | peak bar |

Every product has a unique form and colour. Cadence and Cadence QA share both
and differ only in ground; see critique item 1.

### Radius inventory (views F4 adds or touches)

| View | Radius | §2.5 rule | Status |
|---|---|---|---|
| Launcher icon mask | OS-owned | Exempt | OK |
| Favicon corner | 184 of 1024 px, drawn in the artwork | Not a view | OK |
| About card (`about.tsx:14`) | `workspaceScale.radius.panel`, 4 px | Outer view: `rounded-md`, 6 px | Deferred to F8's radius pass |
| Lab headers | none | n/a | OK |
| Cadence QA cards (not touched by F4) | 12, 9, 4 px literals (`App.tsx:196-374`) | `rounded-sm`/`rounded-md` only | Pre-existing; for F8's inventory |

### Priority actions

1. F8: move the About card to `rounded-md` and the Cadence QA literals to the two tokens.
2. F8: give the labs `workspaceThemes` instead of literal hex.
3. Owner: decide whether Cadence QA needs its own detail (critique item 1).

## 4. `design:ux-copy`

**Launcher label**: the short name alone ("Prism", "Audio Lab", "Cadence QA").
**Full name**: "Nitro Forge" plus the short name, for store records, the web
title, the About heading and the lab headers.
**Leading button in a studio build**: "About". In the suite: "All apps".
**About**: title "About Prism", heading "Nitro Forge Prism", rows "Version",
"App ID (iOS)", "App ID (Android)".

| Element | Option | Copy | Best for |
|---|---|---|---|
| Studio leading button | A (kept) | About | Narrow title bar; the title already says "Prism" |
| | B | About Prism | Screen readers out of context; costs about 40 pt of bar width |
| About rows | A (kept) | App ID (iOS) | Matches what the row shows |
| | B | Bundle ID | Developer term; the About reader is not always a developer |
| Missing-brand error | before | extra.forgeBrand is missing: add tooling/brand/plugin.cjs to app.json plugins | |
| | after (shipped) | No brand: extra.forgeBrand is missing because tooling/brand/plugin.cjs did not run. Add it to "plugins" in app.json, then restart the bundler. | Says what happened, why, and what to do, the skill's error pattern |

Rationale: inside the suite's own launcher the parent brand is implied, so
labels drop it; "Nitro Forge" returns wherever the app is seen alone.
Localisation: launcher labels are proper nouns and are not translated; "QA"
and "Lab" may need translating ("Labor", "Laboratoire"), which can push
"Cadence QA" past one line. Untested.

## 5. `frontend-design:frontend-design`

Subject: a suite of document studios built by one team. The forge is the
material vocabulary: graphite ground for products, a lighter bench ground
with a hatched lower band for test builds, heat and temper colours for the
studios, one shared steel detail. The one bold element is the colour per
studio; everything else is the same ground, weight and keyline.

Check against the skill's list of generic defaults: the family avoids the
cream-and-terracotta look and the single-accent near-black look by giving
each studio a separate hue tied to steel or copper. Template chrome removed in
this pass: the Audio Lab header's middle-dot join ("Nitro Forge · Native Audio
Lab") is gone. Left for F8: the subtitles "SwiftUI · Jetpack Compose ·
Rust-owned document" and "Open app →" on the suite home are both on the
skill's list.

Captures:
- Before: `design/icons/renders/device/2026-11-11-base-0ad4ed2-ios27-duo-inner-home.png` (suite and studios only; older Forge and Tron builds beside them show truncated names).
- After: `design/icons/renders/device/2026-11-12-27eafbb-ios27-duo-inner-home-all-apps.png` (Forge Completion iPhone Duo, iOS 27.1 simulator, inner panel, argent; all eleven apps as stub bundles with the real `CFBundleDisplayName`, bundle id and compiled icon). Every label sits on one line, "Cadence QA" included.
- Lab header before/after: NOT RUN. It needs a native or web build of each lab, and free disk fell under 10 GB.
- iPad: NOT RUN (same reason; the "F4 iPad" simulator was never created).

## 6. `design:accessibility-review` (WCAG 2.1 AA)

Issues found: 1 failure (fixed), 2 notes.

| # | Issue | Criterion | Severity | Action |
|---|---|---|---|---|
| 1 | About row labels used `colors.muted` (#687287) on the light base (#F4F5F8): 4.43:1 at 13 px | 1.4.3 | Major | Fixed: labels use `colors.text`, 13.10:1. The token itself is shared; F8 should raise `muted` in light |
| 2 | Steel detail against the studio colour is under 3:1 for Splice and Media Lab (1.60), Cadence, Audio Lab and Cadence QA (1.93), Tally (2.15), Pitch (2.24) | 1.4.11 | Note | The detail touches the form, but the form against the ground carries identity (lowest 3.91:1, Folio) |
| 3 | About row dividers are 1.54:1 (dark) and 1.20:1 (light) | 1.4.11 | Note | Decorative; each row is its own accessibility element, so the divider is not needed to find it |

Contrast, measured from the source hex values:

| Element | Foreground | Background | Ratio | Required | Pass |
|---|---|---|---|---|---|
| Icon form, lowest (Folio) | #DE4339 | #1C1F25 | 3.91 | 3.0 | yes |
| Icon form, highest (Forge) | #F3E7D3 | #121418 | 15.09 | 3.0 | yes |
| About text, dark | #F0F1F7 | #1C1E25 | 14.76 | 4.5 | yes |
| About label, dark | #ADB3C4 | #1C1E25 | 7.94 | 4.5 | yes |
| About label, light (after fix) | #252A3A | #F4F5F8 | 13.10 | 4.5 | yes |
| Audio Lab header | #FFFFFF | #101018 | 18.93 | 3.0 (26 pt) | yes |
| Audio Lab note | #9999AF | #101018 | 6.79 | 4.5 | yes |
| Media Lab subtitle | #CBCBDE | #101018 | 11.84 | 4.5 | yes |
| Cadence QA header | #F7F7FA | #101017 | 17.72 | 3.0 | yes |

Screen reader: the three lab headers now carry `accessibilityRole="header"`
(Cadence QA already did), so VoiceOver's heading rotor reaches them. About
rows are single elements announced as "Version: 0.1.0". Target size: About
rows are 44 pt high. Keyboard: no new focusable controls. Not run: VoiceOver
and TalkBack on a device, largest Dynamic Type.

## 7. `design:design-critique`

Continues `design/CRITIQUE-r4.md`, which did not cover launcher identity.
Reviewed: `design/icons/renders/family-16.png` (viewed at 4x),
`home-screen-dark.png` and the 2026-11-12 device capture.

**Overall impression.** At 60 px and on the device the eleven icons read as
one set from one hand: the same dark ground, the same form weight, the same
steel detail. At 16 px the products stay apart by form and colour. The weak
pair is Cadence and Cadence QA.

| Finding | Severity | Recommendation |
|---|---|---|
| 1. Cadence QA is Cadence's glyph in Cadence's colour; at 16 px the hatching is about 2 px and only the lighter ground separates them | Moderate | Owner decision: either accept it (QA is a test build, never installed beside Cadence by an end user) or give QA a distinct steel detail. Not changed here, because it is a design decision (§8) |
| 2. The Audio Lab knob reads as a plain blue dot at 16 px | Minor | Acceptable for a lab; a thicker pointer would survive |
| 3. Splice and Quill are both horizontal bars at 16 px | Minor | Separated by colour (straw against blue) and Splice's vertical playhead |

§2.2 bar. Kare's test (does it read at the smallest size, one idea per
icon): products pass; Cadence QA fails it against Cadence. Flarup's test
(does the set hold together at home-screen size, consistent light and
weight): passes on the device capture.

§2.5 question for identity: would the Affinity team's suite look like this?
One construction with form and colour as the only variables, and test
builds marked by a ground rather than a different style: yes.

Radius rule: the launcher mask is OS-owned and exempt; the favicon corner is
artwork; the About card is 4 px where §2.5 asks 6 px for an outer view,
deferred to F8 (see step 3).

Changes made in response: labs and Cadence QA added to the family sheets and
the home-screen mock so the pair is judged side by side; About label contrast
fixed (step 6).

## 8. `design:design-handoff`

### Overview
One brand manifest per installable app sets every name, id and icon. Screens
read names from `extra.forgeBrand`, never from literals.

### Tokens used

| Token | Value | Usage |
|---|---|---|
| `CANVAS` / `UNIT` | 1024 / 64 px | Icon grid |
| `KEYLINE_RADIUS` | 304 px | Every glyph point inside it; Android's 66 dp safe zone is 313 px |
| `SQUARE_SCALE` | 1.3 | Glyph scale on full-bleed icons |
| `GROUNDS.product` | #1C1F25 to #121418 | Product ground |
| `GROUNDS.lab` | #2A2E36 to #1E2127, plus hatch at 16 % steel | Lab ground |
| `STEEL` | #E6E8EC | Shared detail |
| `workspaceThemes.*` | per theme | About screen |
| `workspaceScale.radius.panel` | 4 px | About card (to become `rounded-md` in F8) |

### Components

| Component | Props | Notes |
|---|---|---|
| `brandSurfaces(brand, version)` (`apps/example/src/brand/surfaces.ts`) | brand from `extra.forgeBrand` | Title bar, document title, leading button, About |
| `labSurfaces(brand)` (each lab's `src/brand/surfaces.ts`) | same | Header title |
| `shownStrings`, `renderedIn` | exported by every surfaces module | Read by the rebrand test |

### States

| Element | State | Behaviour |
|---|---|---|
| Studio workspace | suite build | Title is the studio's own title; leading button "All apps" goes to `/` |
| Studio workspace | studio build | Title is the brand short name; leading button "About" pushes `/about` |
| Any screen | plugin did not run | `readBrand` throws the missing-brand error at startup |

### Edge cases
- Long names: the longest launcher label is "Cadence QA" (10 characters); Apple publishes 15 for `CFBundleName`. Localised "Lab" and "QA" are untested.
- Renaming the suite rewrites the "Forge" word in ids (`ai.nitroanvil.suite`).
- Cadence QA keeps its ids on rename because receipts name them.
- A new app needs a manifest, a surfaces module with `renderedIn`, and a row in `brand.test.mjs`; the rebrand test fails without the module.

### Accessibility notes
Lab headers and the About heading are `header` role; About rows are single
elements of at least 44 pt.

## 9. `engineering:code-review` (self-review; R2 signs)

Diff `46b753c..HEAD`.

| # | File | Issue | Action |
|---|---|---|---|
| 1 | `tooling/brand/brand.cjs` `visibleSource` | The comment stripper removed `//...` after any character but a quote or colon, so a name after `a//b` inside JSX text was hidden: a fail-open path | Fixed: only strips after start of line, whitespace or `;{}(),`; test added |
| 2 | `tooling/brand/rebrand-check.mjs` web export | Metro cached the inlined app config, so a second local run bundled the previous manifest (found when the suite check failed on "Nitro Forge Lumen") | Fixed with `--clear` |
| 3 | `rebrand-check.mjs` short-name check | Any `title: "<old name>"` in the bundle is treated as the studio list, so a hardcoded `title: "Prism"` elsewhere would pass the web check | Accepted: the `renderedIn` source scan catches it in the screens; noted in the code |
| 4 | `renderedIn` | Lists only the screens that show the name; a component elsewhere could still hardcode it | Accepted and documented; the check names what it covers |
| 5 | `.github/workflows/app-identity.yml` Cadence QA step | That workspace pins `pnpm@10.32.1` while the job installs pnpm 12 | Watch CI |

Verdict: request R2 review. No security findings (no input crosses a trust
boundary; manifests are repository files).

## §3.2 `engineering:testing-strategy`

| Layer | What runs | Where | What it can claim | What it cannot |
|---|---|---|---|---|
| Unit | `brand.test.mjs` (17): manifests, ids unique, icon sizes, keyline, rebrand spellings, display-name scan, every app's surfaces module | CI and local | Manifests are valid and each app's title strings come from the brand | That the screens render them |
| Unit | `surfaces.test.ts` (4) | CI and local | Suite and studio title logic | |
| Integration | `rebrand-check` on Prism to Lumen and the suite to Anvil (prebuild and web), Media Lab to Clip Bench, Cadence QA to Groove QA (prebuild) | CI and local | No old name in generated native projects, title strings, listed screens or the web bundle | That the app compiles |
| Build | Audio Lab to Sound Bench, Gradle and xcodebuild, label and id read back from the APK and `Info.plist` | CI only | The plugin's output compiles and the built label is the new name | Anything about studio builds of `apps/example`, which have never compiled natively |
| Simulator | Home-screen capture with stub bundles | Local, iOS 27.1 Duo inner panel | Labels fit on one line at default text size; icons compile through actool | That the real apps launch; iPad; largest Dynamic Type |
| Device | none | | | Everything on hardware |

Gaps: Android launcher capture, iPad capture, Tron's T3 label-width check
(after the rc.2 pin), lab header renders.
