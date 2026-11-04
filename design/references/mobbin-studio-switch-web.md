# Mobbin harvest: studio persona switcher (web)

Purpose: structure and behavior references for a four-stop rotary ring (Vector / Pixel / Layout / Sketch) with detents, peek-without-commit, and a sheet fallback on phones. Visuals are not taken.

Source for Mobbin rows: Mobbin MCP `search_screens`, platform `web`, run 2026-11-04. URLs are the `mobbin_url` values returned by the tool, with the utm query string removed. Each verdict comes from looking at the returned preview image.

Query notes:
- "tool rail ipad" was run as "vertical tool rail in a design editor".
- "segmented mode switch creative app" was run as "segmented mode switch in a creative app".
- One extra query, "Figma Dev Mode toggle", was run to log the Figma Design/Dev toggle as a reject anchor.
- Affinity's studio tab bar and Adobe's app grid were not searched by name. Higgsfield's top nav and Krea's mode bar stand in for the app-grid pattern we refuse.

Counts: 36 Mobbin rows (7 TAKE, 29 REJECT). Dribbble: 13 rows (4 TAKE, 9 REJECT). Other retrieved references: 4 rows (4 TAKE). Total 53 rows: 15 TAKE, 38 REJECT.

## Mobbin

| # | Query | Source | URL | Pattern | Verdict | Reason |
|---|---|---|---|---|---|---|
| 1 | vector editor toolbar | Rive | https://mobbin.com/screens/2af97f58-b072-486f-8ea7-04332d089b68 | Design/Animate two-state toggle in the top-right header, switching the whole editor over one file | REJECT | Header toggle between modes of one document is the category default we refuse, same family as Figma Design/Dev |
| 2 | vector editor toolbar | Framer | https://mobbin.com/screens/93ab00f1-a175-4bd6-8a19-f5c87d3eff85 | Bottom floating tool pill, Agent/Style tabs on the right inspector | REJECT | Inspector tabs, no persona concept |
| 3 | vector editor toolbar | Jitter | https://mobbin.com/screens/fbe1d53f-f1b0-4211-a397-0c73f9c2a0c1 | Design/Animate tabs at the top of the inspector | REJECT | Same two-state mode toggle as row 1 |
| 4 | vector editor toolbar | Magnific | https://mobbin.com/screens/8af25a4a-dbbe-45cf-b6f1-12ba2bc5fda8 | Floating left tool rail, a three-button chip bar anchored above the selected block, right inspector | TAKE | Selection-anchored chip bar keeps per-object actions out of the mode control, so the ring only has to carry personas |
| 5 | vector editor toolbar | Figma (Draw) | https://mobbin.com/screens/63bfebbd-3c13-4dd4-9db5-f1144fe51c60 | Bottom toolbar swaps to pen and brush tools in Draw; a Basic/Dynamic/Brush tabbed stroke popover | REJECT | Figma's Design/Draw/Dev switch is the toggle we refuse |
| 6 | vector editor toolbar | MagicPath | https://mobbin.com/screens/2fa6609f-7a79-4c26-b728-46ee99109c58 | Vertical tool rail detached from the window edge, floating over the canvas | TAKE | A detached floating control leaves the canvas edge free and can be dragged aside, which the ring needs on wide screens |
| 7 | vector editor toolbar | Runway (sketch layout) | https://mobbin.com/screens/395f2c42-ce3e-4221-897d-c7293f2f8de8 | Bottom floating tool strip with an Export button | REJECT | Generic strip |
| 8 | vector editor toolbar | Fibery (whiteboard) | https://mobbin.com/screens/fd082957-c4ff-4fab-ba56-22fbd584c4da | Bottom tool dock plus a floating text-format bar | REJECT | Generic whiteboard tools |
| 9 | page layout app | Figma (version history) | https://mobbin.com/screens/5c5e083c-f517-4584-b298-548be59d0714 | Version history panel | REJECT | Search noise for this query |
| 10 | page layout app | Mobbin | https://mobbin.com/screens/0e726a6b-f532-4b27-92ca-0190ed10080e | Catalog browse page | REJECT | Search noise |
| 11 | page layout app | ClickUp | https://mobbin.com/screens/8320a641-8b3c-4b17-b5ca-d517645b7695 | Shared-tab capture of a catalog page | REJECT | Search noise |
| 12 | page layout app | Runway (publish as app) | https://mobbin.com/screens/efbb908f-971c-43e1-b454-6cea623b6629 | Inputs/Outputs segmented control | REJECT | Segmented control |
| 13 | page layout app | Higgsfield | https://mobbin.com/screens/63ba3e12-d1b2-42de-97de-fe4373e01734 | Top nav of product sections (Image, Video, Audio, studios) | REJECT | Per-mode app sections in a nav bar, the app-grid pattern we refuse |
| 14 | page layout app | Klaviyo | https://mobbin.com/screens/814cae88-638c-4379-b6fb-e2c0c1d0fb8c | Admin table | REJECT | Search noise |
| 15 | raster editing adjustments | Wix (Photo Studio) | https://mobbin.com/screens/42d8fc05-9625-4d3f-93f5-44896acc0596 | Left vertical rail of modes (Crop, Adjust, Filters, Object Eraser, Cut Out, Text...), each opening its own panel; an Auto Enhance toggle has a tooltip that says what it will change | TAKE | Each stop owns a panel and the canvas stays put. The tooltip describes the effect before you engage it, a text form of peek |
| 16 | raster editing adjustments | Telegram | https://mobbin.com/screens/13087df5-e5d4-45cc-8d93-018664fa19d5 | Icon tab row above a slider stack | REJECT | Tab switcher |
| 17 | raster editing adjustments | Kit | https://mobbin.com/screens/df8408f6-861f-4b84-b88f-410687feae8c | Crop/Filter/Colors/Markup icon tabs at the top | REJECT | Tab switcher |
| 18 | raster editing adjustments | Google Ads (edit image) | https://mobbin.com/screens/fe721080-6b71-43b7-be6a-13aa1450c5fc | Adjust color panel with live sliders, Reset, and an explicit Cancel/Apply pair | TAKE | Changes preview live and are only kept on Apply. This is the preview and commit split the ring needs |
| 19 | raster editing adjustments | Instagram (web) | https://mobbin.com/screens/cd0465b6-cced-40eb-adf0-6740e6434990 | Filters/Adjustments tabs | REJECT | Tab switcher |
| 20 | raster editing adjustments | Etsy | https://mobbin.com/screens/b294207c-55dc-4873-8d2a-7c22d5f9e16d | Adjust/Transform pill toggle above a row of adjustment buttons | REJECT | Segmented toggle |
| 21 | mode switcher | Better Stack | https://mobbin.com/screens/47f13a6b-5547-4aa6-bb4d-b8aa640e35d8 | Light/Dark/System preview cards | REJECT | Theme setting |
| 22 | mode switcher | OpenSea | https://mobbin.com/screens/d87be0af-fe3b-4289-9c24-844b5d5d5d49 | Collector Mode vs Pro Mode cards, each with a preview of the UI it produces and a line on who it is for; copy says "You can change this at any time" | TAKE | Modes framed as personas, each with a preview and a reassurance that the choice can be reversed |
| 23 | mode switcher | Revolut Business | https://mobbin.com/screens/01159cfd-e97b-4a41-a4ac-a04647a1ea72 | Transparent/System mode cards, background swatches | REJECT | Theme setting |
| 24 | mode switcher | Microsoft Loop | https://mobbin.com/screens/7f465d89-117e-4f2b-bda0-5bbddd3ef7a2 | System/Light/Dark thumbnails in a settings dialog | REJECT | Theme setting |
| 25 | mode switcher | Grok | https://mobbin.com/screens/e5aafdde-2235-443b-bcd1-5834f497d1ef | Light/Dark/System segmented buttons | REJECT | Segmented theme toggle |
| 26 | mode switcher | Amplitude | https://mobbin.com/screens/75fb4ce8-674d-41a2-9877-12c21d704c37 | Large preview tiles that render what the whole interface looks like in each mode, with the current one checked | TAKE | A full-workspace preview per option, which is what a peek on the ring should show |
| 27 | segmented mode switch creative app | Epidemic Sound | https://mobbin.com/screens/fb440529-d62b-441f-b74c-11429cd704cd | Length presets as a segmented row (15 s, 30 s, 45 s, 60 s, Custom) | REJECT | Segmented control |
| 28 | segmented mode switch creative app | Adobe Express | https://mobbin.com/screens/99f33ad6-4cbf-44d1-816e-887e237725de | Edit/Animation segmented control in the shape panel; left rail of app sections | REJECT | Segmented toggle plus app-section rail |
| 29 | segmented mode switch creative app | hilos | https://mobbin.com/screens/73a59bad-7bcf-4c0a-9f29-529ac49c4c38 | System/Light/Dark segmented control and style tiles | REJECT | Theme setting |
| 30 | segmented mode switch creative app | Krea AI | https://mobbin.com/screens/27d19f3c-5851-4cf9-bc3c-3df0777d682c | Top floating icon bar where each icon is a separate tool (image, video, enhance, edit, 3D) | REJECT | App grid flattened into a toolbar, the pattern we refuse |
| 31 | segmented mode switch creative app | Google AI Studio | https://mobbin.com/screens/1c92bfbf-6425-466d-911a-ff7e8f011966 | Code Editor/Visual Editor two-button toggle in a dialog | REJECT | Binary editor toggle |
| 32 | segmented mode switch creative app | Jasper | https://mobbin.com/screens/8705dad3-0b5a-46ca-9d34-f943d5c45abc | Text-to-image/Upload/Unsplash tabs | REJECT | Tab switcher |
| 33 | tool rail (run as "vertical tool rail in a design editor") | Recraft | https://mobbin.com/screens/12bf793a-4693-452c-82f3-488aed6d2c54 | Floating left rail, bottom prompt bar | REJECT | Generic rail |
| 34 | tool rail | Base44 | https://mobbin.com/screens/c079c927-736b-46ad-a53f-19a06fcf81ca | Preview/Dashboard/Edit toggle in the header, right floating rail | REJECT | Header mode toggle, the category default |
| 35 | tool rail | GoDaddy (design editor) | https://mobbin.com/screens/dba941bc-26f0-43a1-b3e8-a8cd6d9da4bf | Left rail with icon plus label (Brand Kit, Image, Font, Element, Shape, Template); the active stop is filled and opens a drawer beside the canvas | TAKE | Icon plus label at every stop, a clear active state, and a drawer that opens without leaving the canvas |
| 36 | Figma Dev Mode toggle | Figma (Dev Mode) | https://mobbin.com/screens/fb73f09d-1f19-4257-8c65-855f85dc116e | The `</>` toggle in the bottom toolbar swaps the whole UI to an inspect panel with Ready-for-dev status | REJECT | Logged as the reject anchor named in the brief: a binary toggle that rebuilds the workspace |

Also returned but not given a row: a second Figma Dev Mode screen (https://mobbin.com/screens/d2cb09f0-f500-44df-a69d-03437e2c4a95), a duplicate of row 36; MagicPath (https://mobbin.com/screens/b4050eef-0c4e-4060-8ea9-18502f0449ff), Magnific (https://mobbin.com/screens/c2ef399d-01af-4b72-96e8-f57045b6b138) and Jitter (https://mobbin.com/screens/46f65180-3df4-41aa-a62d-7a91632cc742) under the tool rail query, duplicates of rows 6, 4 and 3.

## Dribbble

Retrieval: three Exa searches (rotary dial, vector editor, page layout) returned page text for the rows marked "Exa, page text read". Exa then hit its free-tier rate limit on the fourth search ("mode switch"). Two WebSearch calls restricted to dribbble.com covered "mode switch" and "rotary dial"; rows marked "WebSearch listing" have a URL and title from that search only. Direct WebFetch of three Dribbble shot pages failed (one returned an empty page, two returned a server error), so the bodies of those shots were not read. Verdicts on listing-only rows rest on the title and the search summary.

| # | Query | Source | URL | Retrieval | Pattern | Verdict | Reason |
|---|---|---|---|---|---|---|---|
| D1 | rotary dial UI | Taylor Dekker, "Numpad Ft. Rotary Encoder" | https://dribbble.com/shots/17487996-Numpad-Ft-Rotary-Encoder | Exa, page text read | Hardware numpad paired with a rotary encoder | TAKE | Pairs a turning control with discrete keys. The ring should have direct keys (1 to 4) next to the turn |
| D2 | vector editor | Ravinder Nain, "Illustrator CC Tools panel ui Freebie" | https://dribbble.com/shots/3482217-Illustrator-CC-Tools-panel-ui-Freebie | Exa, page text read | Replica of Illustrator's tools panel | REJECT | A copy of a tool panel; no switching |
| D3 | vector editor | Jurre Houtkamp for Framer, "Framer - Path Tool" | https://dribbble.com/shots/4062409-Framer-Path-Tool | Exa, page text read | Path tool with angle locking and segment editing | REJECT | Tool feature, not a mode control |
| D4 | vector editor | Kenny Ho for Konpo, "Import/ Export feature - Vectornator" | https://dribbble.com/shots/15185452-Import-Export-feature-Vectornator | Exa, page text read | Marketing site section for Vectornator | REJECT | Website, not app UI |
| D5 | vector editor | Laurent Baumann, "DrawIt app" | https://dribbble.com/shots/14179642-DrawIt-app | Exa, page text read | History of the app that became Sketch | REJECT | Historical note, no switcher pattern |
| D6 | page layout | Patrick M., "Publisher Software – Web App – Sidebar Color Schemes" | https://dribbble.com/shots/5967492-Publisher-Software-Web-App-Sidebar-Color-Schemes | Exa, page text read | Sidebar color scheme variants | REJECT | Theming |
| D7 | page layout | Jorn van Dijk for Framer, "Redesigned Framer App" | https://dribbble.com/shots/3459850-Redesigned-Framer-App | Exa, page text read | Detachable canvas replacing a fixed split screen | REJECT | Workspace layout, not mode switching |
| D8 | page layout | RomaTesla, "Figma macOS concept preview" | https://dribbble.com/shots/9553494-Figma-macOS-concept-preview | Exa, page text read | Native macOS restyle of Figma | REJECT | Visual restyle only |
| D9 | mode switch | Danny Saltaren for mendesaltaren, "Twicket Segmented Control" | https://dribbble.com/shots/2976216-Twicket-Segmented-Control | WebSearch listing | Selector with inertia that can be thrown to the other side and lands on a stop (open source on GitHub per the listing) | TAKE (behavior only) | A fling that settles on the nearest stop is the detent behavior for a fast spin of the ring. The segmented form is rejected |
| D10 | mode switch | Jardson Almeida, "Navbar Segmented Controls Animation" | https://dribbble.com/shots/2473987-Navbar-Segmented-Controls-Animation | WebSearch listing | Switch between options by tap or by drag | TAKE (behavior only) | Accepting both a tap on a stop and a drag across stops is the input model the ring needs |
| D11 | mode switch | Yancy Min, "Tab Switcher - Perspective Animation" | https://dribbble.com/shots/11704577-Tab-Switcher-Perspective-Animation | WebSearch listing | Tab switcher with a perspective transition | REJECT | Tab switcher |
| D12 | rotary dial UI | Benjamin Keating, "Skeuomorphic Range Sliders and Rotary Encoder" | https://dribbble.com/shots/6896701-Skeuomorphic-Range-Sliders-and-Rotary-Encoder | WebSearch listing | Rotary built to behave like a quadrature encoder, in HTML/CSS/JS | TAKE (behavior only) | Encoder-style relative stepping, not absolute angle, suits a ring that moves one persona per notch. The skeuomorphic look is not taken |
| D13 | rotary dial UI | Ildiko Gaspar, "Dial Pad Ui Design" | https://dribbble.com/shots/2908584-Dial-Pad-Ui-Design | WebSearch listing | Phone dial pad | REJECT | Telephone keypad, not a rotary selector |

Browse pages returned by the searches, not rated (index pages, no single shot): https://dribbble.com/search/dial-ui, https://dribbble.com/tags/dial, https://dribbble.com/tags/knobs, https://dribbble.com/tags/knob?page=14, https://dribbble.com/tags/rotary_dial, https://dribbble.com/tags/rotating-dial, https://dribbble.com/search/rotary-knob, https://dribbble.com/tags/segmented-control, https://dribbble.com/Core00/collections/81488-Dial-UI, https://dribbble.com/Volorf/tags/switch.

## Other retrieved references (not Dribbble)

These came back in the Exa rotary dial and page layout searches. Exa read the page text for each one. They are component docs and a case study, so they carry behavior and accessibility detail that the Dribbble shots do not.

| # | Query | Source | URL | Pattern | Verdict | Reason |
|---|---|---|---|---|---|---|
| O1 | rotary dial UI | We.Inc, "Lathe-Turned Metal Dial Switch with Detents" | https://we.inc/components/toggles/lathe-turned-metal-dial-switch-with-detents-and-light-that-stays-put | Three-way rotary selector. It resists leaving a stop, drops into the next, and springs back past the end of travel. A tap steps to the next position, and each scale label is also a button. The real control is a `radiogroup` with `role="radio"` on the labels, a roving tab stop, arrow and Home/End keys, and a polite live region that announces the new mode and what it does. Reduced motion jumps straight to the stop. The docs say four entries work without other changes | TAKE | Closest match to the planned control: named detented stops, tap and label shortcuts, and an accessibility model to copy. The metal visuals are not taken |
| O2 | rotary dial UI | TentUI, "Rotary Knob" | https://tentui.com/components/rotary-knob | Labelled `stops`. `onValueChange` fires on each detent landed; `onValueCommit` fires once on release. Keyboard map (arrows, PageUp/Down, Home/End), wheel at one detent per notch, a tick and selection haptic per detent throttled to one per 35 ms, a firmer cue at end stops, `slider` role with `aria-valuetext` taken from the stop label | TAKE | The change-versus-commit split is peek-without-commit in API form: preview on each detent, switch persona on release |
| O3 | rotary dial UI | Tactile UI, "Detent Dial" | https://tactileui.dev/objects/detent-dial | Detent count, detent pull strength, snap mode ("a selector rather than a level"), sweep angle, tap on the scale to set, 12 documented states including settling, at-an-end, disabled, asleep and reduced motion | TAKE | A complete state list to check the ring against; snap mode with four detents is our case |
| O4 | page layout | Israel Hale, "Designing the Shell: UX Architecture for a Desktop Publication Tool" | https://israelhale.com/pages/case-studies/publication-design-app.html | Four panel states (docked, undocked by dragging the handle, collapsed to a rail, and so on), each persistent on its own; an infinite pasteboard with rulers, origin indicator and page panel as anchors | TAKE | Shows how one shell can adapt from a 24-inch desktop to a laptop with persistent states. Applies to how the ring docks, floats and collapses |
