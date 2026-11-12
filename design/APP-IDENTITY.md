# App identity: names, identifiers, icons, rebranding

Gate F4. Written 2026-11-11 on `feat/f4-app-identity-20261111`, base `0ad4ed2`.

## Names and identifiers

Every installable Forge app has one brand manifest. `tooling/brand/plugin.cjs`
reads it and sets the Expo `name`, `slug`, `scheme`, iOS bundle identifier,
Android package, icon set and favicon. The launcher shows the short name: iOS
`CFBundleDisplayName` and `CFBundleName`, Android `app_name`, web `short_name`.

| App | Manifest | Full name | Launcher name | iOS bundle id | Android package |
|---|---|---|---|---|---|
| Suite | `apps/example/brands/suite.json` | Nitro Forge | Forge | `ai.nitroforge.suite` | `ai.nitroforge.suite` |
| Prism (image) | `apps/example/brands/prism.json` | Nitro Forge Prism | Prism | `ai.nitroforge.prism` | `ai.nitroforge.prism` |
| Quill (rich text) | `apps/example/brands/quill.json` | Nitro Forge Quill | Quill | `ai.nitroforge.quill` | `ai.nitroforge.quill` |
| Tally (sheets) | `apps/example/brands/tally.json` | Nitro Forge Tally | Tally | `ai.nitroforge.tally` | `ai.nitroforge.tally` |
| Pitch (slides) | `apps/example/brands/pitch.json` | Nitro Forge Pitch | Pitch | `ai.nitroforge.pitch` | `ai.nitroforge.pitch` |
| Folio (PDF) | `apps/example/brands/folio.json` | Nitro Forge Folio | Folio | `ai.nitroforge.folio` | `ai.nitroforge.folio` |
| Splice (video) | `apps/example/brands/splice.json` | Nitro Forge Splice | Splice | `ai.nitroforge.splice` | `ai.nitroforge.splice` |
| Cadence (audio) | `apps/example/brands/cadence.json` | Nitro Forge Cadence | Cadence | `ai.nitroforge.cadence` | `ai.nitroforge.cadence` |
| Audio Lab | `apps/forge-audio-lab/brand.json` | Nitro Forge Audio Lab | Audio Lab | `ai.nitroforge.audiolab` | `ai.nitroforge.audiolab` |
| Media Lab | `apps/forge-media-lab/brand.json` | Nitro Forge Media Lab | Media Lab | `ai.nitroforge.medialab` | `ai.nitroforge.medialab` |
| Cadence QA harness | `examples/native-cadence/brand.json` | Nitro Forge Cadence QA | Cadence QA | `ai.nitroforge.cadence.native` (kept) | `ai.nitroforge.cadence.studio` (kept) |
| Studio preview (web) | `apps/studio-preview/index.html`, `public/manifest.webmanifest` | Nitro Forge | Forge | n/a (web only) | n/a |
| Console (CLI) | none | n/a | n/a | n/a | n/a |

The Cadence QA identifiers are unchanged because receipts under
`docs/completion/evidence/` (P01 to P03, W29, W31, W32) name them; changing
them would orphan those receipts. Only its display name moved, from the
26-character "Nitro Forge Cadence Native", which iOS truncates to
"NitroForgeCad..." on the home screen (see the device capture below).

Before this change: `apps/forge-media-lab` used its slug
`forge-media-controls-lab` as its display name, neither lab had a bundle id or
package, and the suite was "Nitro-Forge" in `app.json`, "NitroForge" on its
home screen and `ai.nitroforge.example` as its id.

### One app, nine installs

`apps/example` builds the suite or any single studio:

```bash
FORGE_BRAND=tally npx expo prebuild     # Nitro Forge Tally, ai.nitroforge.tally
FORGE_BRAND=suite npx expo start        # the suite (default)
```

A single-studio build opens its studio directly, titles the workspace with its
own short name and puts **About** where the suite shows **All apps**. The
strings come from `apps/example/src/brand/surfaces.ts`; screens never spell a
product name.

### Launcher label width

Gate T3 in NYC-Tron UI is building the rendered-width label check that Forge
must use. Until Tron `rc.2` is pinned (F2), Forge has no width check of its
own; the names were chosen to clear what platforms publish:

| Source | What it says | Forge |
|---|---|---|
| Apple, `CFBundleName` | "This name can contain up to 15 characters." | Longest short name is "Cadence QA", 10 |
| Apple, `CFBundleDisplayName` | Shown on the Home Screen; no width published | Same as `CFBundleName` |
| Android, `android:label` | No limit published | `app_name` is the short name |
| Microsoft, MSIX name | Visible length depends on glyph width; "keep it short" | Desktop target is F5 |
| App Store Connect, Google Play | Store name 30 characters | Full names: longest "Nitro Forge Cadence QA", 22 |

Links: `design/references/app-identity-launcher.md`; the §3.3 skill outputs are in `design/APP-IDENTITY-3.3.md`. On the iOS 27 inner
display every Forge short name sits on one line beside existing long-named
apps that truncate (`design/icons/renders/device/`).

## Icon family

Source of every icon: `tooling/brand/icon-family.mjs` (plain SVG, original
artwork). Rasterise with `node tooling/brand/render-icons.mjs`.

### Grid

| Rule | Value |
|---|---|
| Canvas | 1024 px, 16 x 16 units of 64 px, centre (512, 512) |
| Keyline | Every glyph point inside a 304 px radius circle. Android's adaptive safe zone is 66 of 108 dp, 313 px at this canvas |
| Form weight | 64 px (one unit). Detail weight 48 px |
| Gaps | 32 px minimum between parts, so parts separate at 32 px |
| Corners | 16 px on bars and slabs; 32 px caps on meter bars; polygons have a 16 px round join. The launcher mask belongs to the OS (§2.5 exemption) |
| Full-bleed icon | Ground fills the canvas, no transparency. Glyph scaled 1.3 about the centre so it covers the same share of the tile as on Android, where the launcher shows about 72 of the 108 dp layer |
| Android adaptive | Background layer: ground. Foreground: glyph at 1.0 inside the keyline. Monochrome: glyph in one colour for themed icons |
| Favicon | Ground with a 184 px corner, because a browser applies no mask |

### Construction

Each icon is a graphite ground, one form in the studio colour, and one steel
detail (`#E6E8EC`). The ground and the steel detail are shared; the form and
colour carry the identity.

| App | Form | Steel detail | Colour | Colour source |
|---|---|---|---|---|
| Suite | Ingot | Band over the top face | `#F3E7D3` | White heat |
| Prism | Prism | A ray entering the face | `#9C5FE6` | Temper purple |
| Quill | Three set lines | Caret | `#4F77E8` | Temper blue |
| Tally | 3 x 3 cells | The selected cell | `#33B38B` | Copper patina |
| Pitch | Slide | Stand | `#F07C2F` | Forge orange |
| Folio | Page | Turned corner | `#DE4339` | Cherry-red heat |
| Splice | Two overlapping clips | Playhead | `#E3B23D` | Temper straw |
| Cadence | Level meter | Peak bar | `#40B5DB` | Temper light blue |
| Audio Lab | Knob | Pointer | Cadence's | (lab) |
| Media Lab | Play | Cue bar | Splice's | (lab) |
| Cadence QA | Level meter | Peak bar | Cadence's | (lab) |

Grounds: products `#1C1F25` to `#121418` (forged graphite); labs `#2A2E36` to
`#1E2127` with a hatched band along the lower edge, so a test build never
passes for a product on a home screen. Every colour comes from what steel and
copper look like in a forge, which keeps the set from borrowing a category
palette (blue for documents, green for sheets, and so on).

### Renders

`design/icons/renders/<id>/<id>-{16,32,60,1024}.png` for all eleven icons,
`family-{16,32,60}.png` strips on light and dark walls, and
`home-screen-{dark,light}.png` at iPad icon size with the launcher names.
Device capture: `design/icons/renders/device/2026-11-11-base-0ad4ed2-ios27-duo-inner-home.png`
(iOS 27.1 simulator, "Forge Completion iPhone Duo", inner panel, real
`CFBundleDisplayName` and compiled asset catalogue; the binary is a stub, see
"Not verified").

## Rebranding

To ship a studio under another name, replace the name in its manifest:

```bash
node tooling/brand/rebrand-check.mjs --app apps/example \
  --manifest apps/example/brands/prism.json --from Prism --to Lumen --web
```

`rebrand()` in `tooling/brand/brand.cjs` rewrites `id`, `productName`,
`shortName`, `slug`, `scheme` and both identifiers in every spelling
("Nitro Forge", "nitro-forge", "nitroforge", "nitro_forge"). It leaves
`engine` (the code binding) and `icons` alone. A full rename replaces each name
the brand uses: for the suite that is "Forge", which also rewrites "Nitro
Forge" and `nitroforge`.

The check then fails if the old name is left in:

- the resolved Expo config (name, slug, scheme, identifiers, web names, `extra.forgeBrand`)
- the title bar and About strings (`brandSurfaces()`, the function the screens call)
- the generated iOS project: project and target names, `Info.plist`
  (`CFBundleDisplayName`, `CFBundleName`), `PRODUCT_BUNDLE_IDENTIFIER`, and
  every text file outside `Pods` and `build`
- the generated Android project: `app_name`, `applicationId`, `namespace`,
  the Kotlin package path, and every text file outside `build`
- the web build: `<title>` and the app config embedded in the bundle

CI (`.github/workflows/app-identity.yml`) runs it on Prism (to Lumen) and the
suite (to Anvil), then renames Audio Lab to Sound Bench and compiles it for
Android and the iOS Simulator, reading the label and id back from the APK and
the built `Info.plist`.

## Accessibility

- Contrast of each form against its ground (WCAG 2.1 1.4.11, 3:1): Prism 4.1,
  Quill 4.0, Folio 3.9 (lowest), Tally 6.3, Pitch 6.0, Cadence 7.0, Splice 8.4,
  suite 13.5. Steel against the ground is above 13.
- Steel against the studio colour is under 3:1 for Splice (1.6), Cadence
  (1.9), Tally (2.2) and Pitch (2.2). In Tally and Cadence a 32 px ground gap
  separates them; Splice's playhead and Pitch's stand touch the form. The
  icons stay identifiable by form and ground contrast; the detail is
  secondary.
- Colour is never the only cue: no two studios share a form.
- The About screen's rows are single accessibility elements ("Version: 0.1.0")
  with 44 pt rows; the suite's About link is 44 pt high.

## Critique (§2.2, §2.5)

Continuing from `design/CRITIQUE-r4.md`, which covered the Prism turret and
did not touch launcher identity.

| Line | Finding | Response |
|---|---|---|
| Kare, small sizes | At 16 px the first pass of the ingot read as a light trapezoid with no top. | Lifted the top face into a separate steel band with a 32 px gap; at 16 px it reads as two shapes |
| Flarup, presence | First pass drew the glyph to the Android keyline on the iOS tile too, filling about 45 % of it; it looked lost beside system icons | Full-bleed icons scale the glyph 1.3 (about 59 %) |
| §2.5 grammar | One construction, one variable: the same ground, steel detail, weights and keyline, with form and colour as the only differences. On the device capture the eight read as one set beside Safari and Settings | Kept |
| §2.5 accent rule | The UI rule is accent for state only. Icons are identity, so each carries its colour; inside the apps, nothing changed | Kept, recorded here |
| Category default | Office suites letter their icons (W, X, P) or use a page with a letter. Forge uses one form per job with no letters, so names can change without redrawing | Kept; this is also what makes a rename possible without new artwork |
| Labs vs products | Without a marker, Cadence QA and Cadence were identical | Labs take the lighter bench ground and hatched band |
| Open | Splice's clips and Quill's lines both read as horizontal bars at 16 px; colour and the steel playhead separate them | Watch in the Android capture |
| Open | "Pitch" and "Prism" are names other products use; that is a trademark question for the owner, not a design one | Raised in the PR |

## Not verified

- Android launcher capture: emulator-5554 was assigned to another gate. Pending.
- The home-screen capture used a stub binary carrying the real launcher name,
  bundle id and compiled icon. The studio apps themselves have never been
  built natively (`docs/ROSTER.md`, "apps/example on simulator/device: NOT
  RUN"). The native compile proof is the rebranded Audio Lab in CI.
- iPad hardware, Dynamic Type at the largest size on the home screen,
  localised names, Windows and macOS icon formats (no desktop target before F5).
- The label width check: NYC-Tron UI gate T3, adopted when Tron rc.2 is pinned.
