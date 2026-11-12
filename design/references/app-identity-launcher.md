# F4 references: Nitro Forge launcher icon family and launcher labels

Date: 2026-11-11

## How this was gathered

- Mobbin MCP (`search_screens`, mode `standard`). The tool's `platform` parameter accepts only `ios` or `web`. It has no iPad value, and every `ios` result came back as an iPhone screen. **Mobbin has no iPad coverage for either surface.** The usable hits are web (desktop) suite launchers, which show the same structure: one family of icons with short names, in a grid.
- Mobbin queries run:
  - ios: "app switcher listing other apps in the same product suite"
  - ios: "Microsoft Office app home with Word Excel PowerPoint app icons"
  - ios: "office suite app create new menu choosing document, spreadsheet or presentation"
  - web: "app launcher grid menu showing the company's other apps with their icons"
  - web: "Microsoft 365 home with Word, Excel, PowerPoint app icons" (returned Canva, Base44, Plane, Replit and others; no Microsoft 365)
  - web: "Google apps switcher grid with Docs Sheets Slides Drive icons" (returned only Google Gemini; no Workspace switcher)
  - web: "Adobe Creative Cloud apps list with Photoshop Illustrator Premiere icons"
- Because there was no iPad coverage, Dribbble was added through WebSearch (limited to dribbble.com): "dribbble app icon family suite" and "dribbble app icon system set of apps suite icons". The Dribbble URLs below all came from those results. I did not open the shot images, so those verdicts rest on each shot's title and description only.
- Platform guidance: Apple pages were read through their DocC JSON endpoints (`developer.apple.com/tutorials/data/...json`), because the HTML pages render client-side. Android, Microsoft and Google Play pages were read with WebFetch.
- Mobbin URLs have the utm query strings removed. Every row is a structure reference only. The marks themselves are not to be copied.

## 1. Launcher icon family

| # | Query | Source app | URL | Pattern | Verdict | Reason |
|---|---|---|---|---|---|---|
| 1 | web: Adobe Creative Cloud apps list | Adobe (web home) | https://mobbin.com/screens/f5d8b897-8441-4eb4-9e6c-726c09b07312 | "Your apps" grid, 5 per row: the same rounded square, the same dark field, a two-letter monogram, and one accent hue per app (Ps blue, Ai orange, Pr purple, Ae violet, Id pink, Acrobat red) | TAKE | Clearest example of one shared construction with one variable (hue plus mark). Eight icons side by side still read as one family. |
| 2 | web: Adobe Creative Cloud apps list | Adobe (home, recents) | https://mobbin.com/screens/fa4d753b-fd9e-4802-bc59-01c7908a0f85 | The same family icons shrunk to roughly 16 px badges on file thumbnails (Ps, Ai, Lr, Express, PDF) | TAKE | Shows that the family has to survive at badge size, where only hue and a simple shape remain legible. |
| 3 | web: Adobe Creative Cloud apps list | Adobe (Files) | https://mobbin.com/screens/dd2a7dff-0dc8-41b5-84a2-235fce949d71 | File grid where each tile carries a small app badge to show which app owns the file | TAKE | A second small-size proof: a file-to-studio badge, the role a studio icon would play in a suite file browser. |
| 4 | web: Adobe Creative Cloud apps list | Adobe (Apps, Illustration filter) | https://mobbin.com/screens/f964c579-1583-4f38-a20e-dc09ec939cd2 | App cards (icon, short name, one-line purpose) plus a "View all plans" tile showing a cluster of family icons together | TAKE | The cluster tile is the family shown as one object, which is a good model for the suite app's own icon or about screen. |
| 5 | web: Microsoft 365 home | Canva (web home) | https://mobbin.com/screens/403ab002-0600-44ee-9af7-04320b3badd2 | Row of circular "create" icons: same size and shape, one saturated hue each, one white glyph each (Presentation, Video, Doc, Spreadsheet, Whiteboard, Code, Website) | TAKE | The Canva-side reference for the Affinity-by-Canva bar: a doc-type family where hue plus one glyph carries identity across about 12 types. |
| 6 | Dribbble search (no Mobbin iPad) | Kapost (Sara Hill) | https://dribbble.com/shots/2171418-Kapost-App-Suite-Icons | Icon set for a multi-app product suite | TAKE (image not viewed) | Of the shots found, this one most directly matches "suite icon family". Open it before relying on it. |
| 7 | Dribbble search (no Mobbin iPad) | iStat (Bjango, Marc Edwards) | https://dribbble.com/shots/3047583-iStat-app-icon-family | "Family portrait" of the iStat apps, described as a dark grey base with blue and cyan accents | TAKE (image not viewed) | A shared base colour with per-app accents is the same grid-plus-hue structure as Nitro Forge. |
| 8 | Dribbble search (no Mobbin iPad) | Osmo (Ramotion) | https://dribbble.com/shots/3079347-Osmo-Family-App-Icons | Described as a design system for a suite of Osmo apps | TAKE (image not viewed) | A family system for several apps from one maker. |
| 9 | Dribbble search (no Mobbin iPad) | Bitstrips / Bitmoji (Matt Grantham) | https://dribbble.com/shots/1785863-Bitstrips-App-Icon-Suite | Described as a standardised parent logo plus a system for new products (blue comic bubble, green chat bubble) | TAKE (image not viewed) | Shows a parent mark rule that extends to future apps, which a suite app plus seven studios will also need. |
| 10 | Dribbble search (no Mobbin iPad) | Personal Metis (Piet van Dongen) | https://dribbble.com/shots/1026365-Personal-Metis-iOS-App-Icon-Family | Proposed family of icons for three apps in one domain | REJECT | Only three apps and an older iOS style. Weaker than rows 6 to 9. |
| 11 | ios: app switcher in same suite | Neo Financial | https://mobbin.com/screens/d4835d81-b763-4321-8769-eb4337b4816d | "Explore products" list of two accounts with grey glyph icons | REJECT | iPhone, banking, and only two items with no colour coding. |
| 12 | ios: Office app home | Trainline | https://mobbin.com/screens/a0eebc8d-5d4a-4216-bc82-da6174ecdafe | Alternate app icon picker | REJECT | iPhone, and these are variants of one app's icon, not a family of apps. |
| 13 | web: app launcher grid | Squarespace | https://mobbin.com/screens/fb58dc29-6823-4ac5-8602-938d6f1c852d | Monochrome grid of third-party service glyphs | REJECT | Third-party integrations, not a first-party family. Monochrome, so no colour system. |

## 2. Launcher labels and in-app suite / app-switcher naming

| # | Query | Source app | URL | Pattern | Verdict | Reason |
|---|---|---|---|---|---|---|
| 1 | web: Adobe Creative Cloud apps list | Adobe (web home) | https://mobbin.com/screens/f5d8b897-8441-4eb4-9e6c-726c09b07312 | Labels under icons drop the parent brand: "Photoshop", "Illustrator", "InDesign", "Premiere Pro", "After Effects". Only "Adobe Acrobat" and "Adobe Express" keep it. Variants go on a second line: "Photoshop (web)" | TAKE | Inside the suite's own launcher the parent name is implied and dropped. Labels top out at about 13 characters ("After Effects"). Two-word names wrap to two lines. |
| 2 | web: Adobe Creative Cloud apps list | Adobe (search dropdown) | https://mobbin.com/screens/e023eeb1-baa6-4647-9b67-fcc287634d6e | "Apps & services" list: short name ("Photoshop", "Adobe Express", "Adobe Fonts") plus a one-line descriptor plus a Launch action | TAKE | Pattern for an in-app switcher: short name first, purpose second, never the full legal name. |
| 3 | web: Adobe Creative Cloud apps list | Adobe (Apps, filter) | https://mobbin.com/screens/f964c579-1583-4f38-a20e-dc09ec939cd2 | Category chips (Photo, Video, Illustration, 3D & AR) above cards labelled "Illustrator" / "Photoshop" with one-sentence purpose | TAKE | Shows a split between the studio name (proper noun) and the category (plain noun) that Nitro Forge could also use: "Prism" plus "Image". |
| 4 | web: Microsoft 365 home | Canva (web home, French locale) | https://mobbin.com/screens/403ab002-0600-44ee-9af7-04320b3badd2 | One-word type labels under circle icons: "Présentation", "Vidéo", "Doc", "Tableur", "Tableau blanc", "Site Web" | TAKE | Localisation stress test: "Tableau blanc" and "Réseaux sociaux" wrap to two lines. Short English labels can grow 30 to 50 percent in other languages. |
| 5 | web: Microsoft 365 home | Replit (home) | https://mobbin.com/screens/d1b52508-5edd-424b-bd62-68bd7b9ba239 | Row of mode tiles labelled "Website", "Mobile", "Design", "3D Game", "Slides" | TAKE | Single-word labels of 7 characters or fewer that fit on one line under a small tile. A good length target. |
| 6 | web: Google apps switcher | Google Gemini | https://mobbin.com/screens/f0411b5f-3350-4152-baf6-ea946c9b9646 | Drive file picker with Docs/Sheets type badges on thumbnails | REJECT | Shows type badges but no app switcher and no app names. Mobbin has no Google Workspace app switcher. |
| 7 | ios: app switcher in same suite | Perplexity | https://mobbin.com/screens/91296d89-e2c5-4d3d-b8b8-54a796f9fbd5 | Connector list: "Google Drive", "OneDrive", "Sharepoint", "Outlook" with descriptors | REJECT | iPhone, third-party connectors. Naming is incidental, not a suite switcher. |

## Platform label guidance

| Platform | URL | What it publishes (quoted) |
|---|---|---|
| Apple, Info.plist `CFBundleDisplayName` | https://developer.apple.com/documentation/bundleresources/information-property-list/cfbundledisplayname | "The user-visible name for the bundle, used by Siri and visible on the iOS Home screen." "Use this key if you want a product name that's longer than CFBundleName." Publishes no character limit or width. |
| Apple, Info.plist `CFBundleName` | https://developer.apple.com/documentation/bundleresources/information-property-list/cfbundlename | "A user-visible short name for the bundle." "This name can contain up to 15 characters. The system may display it to users if CFBundleDisplayName isn't set." |
| Apple, App Store Connect app information | https://developer.apple.com/help/app-store-connect/reference/app-information/app-information | Name: "The name must be at least two characters and no more than 30 characters." Subtitle: "This can't be longer than 30 characters." (This is the store name. The Home Screen label is `CFBundleDisplayName`.) |
| Apple HIG, App icons | https://developer.apple.com/design/human-interface-guidelines/app-icons | Publishes no label length. Relevant lines: "In some contexts, your app name already appears nearby, making it redundant to display the name within the icon itself. Although displaying a mnemonic like the first letter of your app's name can help people recognize your app or game, avoid including nonessential words..." and "Keep primary content centered to avoid truncation when the system adjusts corners or applies masking." |
| Android, manifest `<application>` `android:label` | https://developer.android.com/guide/topics/manifest/application-element | "A user-readable label for the application as a whole and a default label for each of the application's components." "The label is set as a reference to a string resource, so that it can be localized like other strings in the user interface." Publishes no character limit. |
| Android, adaptive icons | https://developer.android.com/develop/ui/views/launch/icon_design_adaptive | Publishes no label guidance. Icon geometry: "Size all layers to 108x108 dp." "Use a logo that's at least 48x48 dp. It must not exceed 66x66 dp, because the inner 66x66 dp of the icon appears within the masked viewport." "The outer 18 dp on each of the four sides of the layers is reserved for masking..." |
| Google Play, store listing | https://support.google.com/googleplay/android-developer/answer/9859152 | App name "Your app's name on Google Play.": 30 characters. Short description: 80 characters. Limits "apply to both full-width and half-width characters." (Store name, not the launcher label.) |
| Microsoft, reserve MSIX app name | https://learn.microsoft.com/en-us/windows/apps/publish/publish-your-app/msix/reserve-your-apps-name | "Keep it short. Although your app's name can have up to 256 characters, display space is limited, and longer names may be truncated depending on the user's screen and settings." "Windows uses variable-width fonts. This means the number of visible characters depends on their width (e.g., 30 'i' characters fit in the same space as 10 'w' characters)." "Avoid trailing differentiators... Such details may be cut off in some views." |
| Microsoft, Tiles for Windows apps (UWP) | https://learn.microsoft.com/en-us/windows/apps/design/shell/tiles-and-notifications/creating-tiles | "ShortName: Because there is limited room for your display name to fit on tiles, we recommend that you to specify a ShortName as well, to make sure your app's name doesn't get truncated." Also: "Lives Tiles are a Windows 10 feature that is not supported on later versions of Windows." Publishes no number. |

## Takeaways for drawing and naming

- The one published hard number for a short app name is Apple's 15 characters for `CFBundleName`. All seven studio names (Prism, Quill, Tally, Pitch, Folio, Splice, Cadence) fit with room to spare. "Nitro Forge" is 11 characters.
- No platform publishes a Home Screen label width. Microsoft says outright that visible length depends on glyph width. Test the labels on a real iPad Home Screen at the default and the largest text size.
- Adobe and Canva both drop the parent brand inside their own launcher. Single-word studio names with no "Nitro" prefix follow that pattern.
