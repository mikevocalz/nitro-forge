# Mobbin harvest: studio persona switcher (iOS)

Purpose: structure and behavior references for a four-stop rotary ring (Vector / Pixel / Layout / Sketch) with detents, peek-without-commit, and a sheet fallback on phones. Visuals are not taken.

Source for every row: Mobbin MCP `search_screens` or `search_flows`, platform `ios`, run 2026-11-04. URLs are the `mobbin_url` values returned by the tool, with the utm query string removed. Each verdict comes from looking at the returned preview image.

Query notes:
- "tool rail ipad" was run as "vertical tool rail in a drawing app". Mobbin's iOS catalog returned iPhone screens only; no iPad results came back.
- "segmented mode switch creative app" was run as "segmented mode switch in a creative app".
- One flow search was added: "switching between editing modes in a photo or design editor".
- Affinity's studio tab bar was not searched on iOS. Canva's home app grid stands in for the app-grid pattern we refuse.

Counts: 36 screen rows (14 TAKE, 22 REJECT) plus 2 flow rows (2 TAKE). Total 38 rows: 16 TAKE, 22 REJECT.

| # | Query | Source | URL | Pattern | Verdict | Reason |
|---|---|---|---|---|---|---|
| 1 | vector editor toolbar | Obsidian (canvas) | https://mobbin.com/screens/f660ba6a-02b7-4f05-9103-2b13a84763dd | Floating vertical pill on the right edge (settings, zoom, fit, undo), a chip bar anchored above the selection, and a bottom nav pill | TAKE | Controls float off the document edge and group by job, which is how the ring should sit over the canvas |
| 2 | vector editor toolbar | Craft (whiteboard) | https://mobbin.com/screens/ff78246e-0c3e-4d29-aaa9-9d4cc2724747 | Two-tier bottom tray: a property row (size, font, align, stroke) sits on top of a persistent tool row | TAKE | The upper tier can carry persona-specific sub-tools while the lower tier stays constant |
| 3 | vector editor toolbar | Apple Notes (markup) | https://mobbin.com/screens/83057132-c8b4-4079-a4c9-9cf8baffad03 | PencilKit pen tray, color popover, chip bar over the selected shape | REJECT | One tool palette for one mode; says nothing about switching personas |
| 4 | vector editor toolbar | Apple Mail (drawing) | https://mobbin.com/screens/2083e4cb-8da4-4bb3-879a-ad3e074ccf60 | Same PencilKit tray and selection chip bar as row 3 | REJECT | Duplicate of row 3 |
| 5 | vector editor toolbar | Freeform | https://mobbin.com/screens/7ebb47c9-24a6-4d7d-b8c4-3b7e72e097b9 | The bottom bar swaps its contents to selection actions (fill, stroke, text, duplicate, delete) when a shape is selected | TAKE | One slot that changes content by state, without a second bar, matches a ring that keeps its position while its sub-tools change |
| 6 | vector editor toolbar | Play | https://mobbin.com/screens/b49e8088-fe77-434f-a611-ec7bda9d90c4 | Bottom sheet with a grab handle and an in-sheet tab bar (Stack, Layout, Position, Appearance, Interactions) | REJECT | The in-sheet tab bar is the category default we refuse. The sheet keeps the canvas visible above it, which is worth noting for the phone fallback |
| 7 | vector editor toolbar | Brave Browser (whiteboard) | https://mobbin.com/screens/4021c94f-160e-4295-a368-5f97fa78b9fa | Fixed top strip of shape tools, bottom strip of undo and erase | REJECT | Generic tool strip, no mode concept |
| 8 | vector editor toolbar | ChatGPT (sketch) | https://mobbin.com/screens/00f07221-255a-4ced-bc78-6c43d03a978d | Shape picker grid in a sheet over a drawing surface | REJECT | Shape insertion, not mode switching |
| 9 | page layout app | Canva (home) | https://mobbin.com/screens/05b3d7bd-2441-47c3-8ad1-d7d6619e26e3 | Row of round app-type entry points (Doc, Whiteboard, Website, More) above a template feed | REJECT | App grid as the entry to each mode is the pattern we refuse (same family as Adobe's app grid) |
| 10 | page layout app | Speechify | https://mobbin.com/screens/48d87f22-6d89-4088-b1cd-4eadce3c1e6d | Column crop handles on a scanned page | REJECT | Search noise; not a layout editor |
| 11 | page layout app | Universe | https://mobbin.com/screens/4c75eeef-f37d-4f34-af74-e7c33e3a9e2f | Bottom sheet split into "Page controls" and "Site controls" sections, with column and row steppers | TAKE | Sheet sections grouped by scope is a good model for what the collapsed phone sheet holds under each persona |
| 12 | page layout app | Play | https://mobbin.com/screens/1d4aa7dc-149d-4abb-868a-bfdb7d4ff62e | Compact "Page 1" title with an up/down chevron and page dots, which opens a page chooser | TAKE | A small current-state label that opens the full choice is how the ring can collapse to one label on phones |
| 13 | page layout app | Photoroom (home) | https://mobbin.com/screens/c06d254a-6651-4853-a8dc-b8895a0f0387 | Bottom tab bar (Home, AI tools, Batch, Content, Products) | REJECT | Tab bar switcher, the category default |
| 14 | page layout app | Google Gemini | https://mobbin.com/screens/fd8912de-4cf7-4da2-a43e-00febc42f1fb | Document list | REJECT | Search noise |
| 15 | raster editing adjustments | Apple Photos | https://mobbin.com/screens/0efba7f9-e477-45f7-b0fa-54eb4ecff72d | Horizontal tick ruler with a fixed center indicator, round tool buttons above it, Adjust/Filters/Crop capsule below | TAKE | The tick ruler with a fixed center mark reads as detents under the finger. The Adjust/Filters/Crop capsule itself is a tab switcher and is not taken |
| 16 | raster editing adjustments | VSCO | https://mobbin.com/screens/d1c1cb70-54ff-4025-99ba-fb8bb03f7101 | Single "Adjust" pill with a chevron that opens the tool list; tick sliders for X and Y skew | TAKE | Current mode shown as one pill, full list behind it: a direct model for the collapsed phone state |
| 17 | raster editing adjustments | Google Photos | https://mobbin.com/screens/f1d8e9d6-b472-40a2-856a-d80de1db0572 | Horizontally scrolling row of adjustment tiles (Brightness, Contrast, Highlights...) | REJECT | Carousel hides options offscreen; four personas should all be visible |
| 18 | raster editing adjustments | Depop | https://mobbin.com/screens/6ddbe876-edc9-4d7b-ba12-90646da8aa7f | Segmented Brightness/Contrast/Saturation over one slider, with Apply | REJECT | Segmented control is the default form we are replacing |
| 19 | raster editing adjustments | GoPro Quik | https://mobbin.com/screens/b2101017-a1c5-40c2-8f15-7660a9e7e540 | Curved arc of ticks under the frame with a centered "0.0°" readout and Reset | TAKE | The closest real arc dial in the set: curved scale, fixed pointer, value readout at the center |
| 20 | raster editing adjustments | Kino | https://mobbin.com/screens/b9b1c7d5-56a2-4004-b446-099ab67ea9a7 | Tick scrubber, discrete chips (AWB, 5302K, weather preset) and a lock button | TAKE | A lock beside the dial guards against accidental turns, which fits a ring that changes the whole workspace |
| 21 | mode switcher | Flo | https://mobbin.com/screens/e02054b8-e01b-49be-8bc2-5f24698cd22f | Light/Dark preview cards with radio checks | REJECT | Theme setting, binary |
| 22 | mode switcher | Rivian (drive mode) | https://mobbin.com/screens/828374fc-5643-4171-b3d9-ac3402fd3d06 | Sheet with a grid of named mode tiles (All-Purpose, Conserve, Sport, All-Terrain, Snow) and an explicit Done | TAKE | Select a mode, then confirm: the phone sheet fallback with a separate commit step |
| 23 | mode switcher | Binance (account mode) | https://mobbin.com/screens/968063e5-d69e-4ec9-acb1-8bf45dbdd98d | Mode cards with a "Current Mode" badge, feature lists, and a Switch button | TAKE | Shows what a mode changes before you commit, and marks where you are now. This is peek-without-commit in sheet form |
| 24 | mode switcher | stoic. | https://mobbin.com/screens/ce30aa52-6aa3-4622-ad2e-206e185e9b15 | Theme tiles grid | REJECT | Theme picker |
| 25 | mode switcher | Riveo (draft mode) | https://mobbin.com/screens/014446d0-23a7-4f72-a5a3-b3e00d9b1084 | Explainer overlay for an On/Off draft mode | REJECT | Binary toggle |
| 26 | mode switcher | TikTok (display) | https://mobbin.com/screens/f7add56f-ec78-459d-8905-fbf0d5e18254 | Light/Dark cards plus "use device settings" switch | REJECT | Theme setting |
| 27 | segmented mode switch creative app | Universe | https://mobbin.com/screens/cd0dbcbe-68dc-4221-b33f-2da4ccc6c814 | VIDEO/STYLE text tabs inside a sheet | REJECT | Tab switcher |
| 28 | segmented mode switch creative app | Bears Gratitude | https://mobbin.com/screens/e8bb98cd-7798-4845-80ea-fd8661335821 | Heading/Text/Bold segmented strip | REJECT | Segmented control |
| 29 | segmented mode switch creative app | VSCO (montage) | https://mobbin.com/screens/a7262532-1725-4ec8-9a58-f339c4c1140c | Studio/Recents text tabs and filter pills | REJECT | Tab switcher |
| 30 | segmented mode switch creative app | Unfold | https://mobbin.com/screens/ad77fe37-e2d1-4c91-a292-97a5c401033d | Two large tiles (Normal, Animated brush) in a sheet | REJECT | Binary choice |
| 31 | segmented mode switch creative app | Givingli | https://mobbin.com/screens/33a87346-6467-48b5-8af5-63b642e123da | Floating Card/Message/Envelope capsule over the object; the object stays centered and the bottom palette changes per facet | TAKE (behavior only) | Switching facets of one object while it stays put and only the tray changes is the behavior we want. The segmented capsule form is rejected |
| 32 | segmented mode switch creative app | Posh | https://mobbin.com/screens/ce8084bd-c63d-41e7-81da-970d431c8b47 | Flyer/Video/Font/Theme button row | REJECT | Tab row |
| 33 | tool rail (run as "vertical tool rail in a drawing app") | Fabric | https://mobbin.com/screens/86f0c2db-75a5-4f85-9aa6-8801e774548c | Left vertical tool rail; a popover attached to the active tool holds color, opacity and size | TAKE | Options open next to the control that owns them, not in a separate panel |
| 34 | tool rail | Microsoft Outlook (drawing) | https://mobbin.com/screens/6e43c07c-95ed-430f-a3ab-a2b1f93182ee | Right-edge vertical color rail | REJECT | Single-purpose color picker |
| 35 | tool rail | Play (borders) | https://mobbin.com/screens/16acfe21-f051-49b9-8e96-c61879b9a619 | Side action icons and an empty Borders sheet | REJECT | Nothing about mode switching |
| 36 | tool rail, plus flow "switching between editing modes" | Pinterest (edit element flow) | https://mobbin.com/flows/36c8c20e-f07e-4978-82d5-23f6eea54cb4 | Right vertical action rail; pressing the pencil reveals an "Edit" label under the canvas before the edit screen opens | TAKE | A press that names the target before committing is a small peek-then-commit step |

Also returned but not given a row: Docusign signature pad (https://mobbin.com/screens/96a81b39-a4d6-4db7-87d1-8c7f902ba80c) is noise, and the Obsidian screen came back again under the tool rail query (row 1).

## Flows

| # | Query | Source | URL | Pattern | Verdict | Reason |
|---|---|---|---|---|---|---|
| F1 | switching between editing modes in a photo or design editor | Google Photos, "Editing a photo" (15 screens) | https://mobbin.com/flows/19e5027b-f61a-471e-8ac2-f306e806ddae | Auto/Actions/Filters/Lighting text row. Under Auto, thumbnail tiles (Enhance, Dynamic, AI Enhance) each show the photo with that result, and tapping one previews it on the main image. Nothing is kept until Save | TAKE | Preview each option on the real document before committing, with the commit kept separate. This is peek-without-commit for the ring. The text row itself is a tab pattern and is not taken |
| F2 | same | Photoroom, "Preview a photo" | https://mobbin.com/flows/17490097-6bf0-47db-b5a8-e5678597977d | Before/After scrub slider wipes between the original and the edited image | TAKE | A scrub that compares two states in place: a model for holding the ring between two stops to compare personas |
