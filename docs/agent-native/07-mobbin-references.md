# Agent-native phase 1.6: Mobbin references for the docs site

Status: references gathered before the direction was finalised (`06-docs-direction.md` cites this file). Searches ran on 2026-11-20 through the Mobbin MCP (`search_screens`, web platform, deep mode). Nothing was saved to a Mobbin collection. Each screen below was opened as a preview image and described from what the image shows. Links use the canonical Mobbin screen URL without tracking parameters.

## 0. Method and limits

- Five queries, one per screen, 8 candidates each, 3 kept per screen. Queries: developer documentation home for a UI component library; component documentation with props table and code example; design tokens documentation with colour swatches; installation guide with numbered steps and terminal commands; documentation search dialog with grouped results.
- Mobbin indexes product screens, not public docs sites. Almost every hit is an in-product docs view, a quickstart inside a console, or an app-level search palette. The structural lessons transfer. Visual styling does not, and none of it is copied.
- No reference shows Forge's three unusual needs: a provider prerequisite before everything else, a rebrand contract with deferred keys, and a mixed install chain where only some steps are `shadcn add`. Those are designed from the repo, not from a reference. Section 6 lists the gaps.
- Previews are low resolution. Where a detail could not be read at preview size, it is not claimed.

## 1. Home

| # | Reference | What it shows | Structure taken | Not taken |
|---|---|---|---|---|
| H1 | [GitBook, developer platform home](https://mobbin.com/screens/fe599a23-5716-457d-b26f-dd072de38429) | Title and one-line welcome, then a row of three cards (No code, Hosted, API reference), each with an icon, a title and two lines of text. | A single row of three entry cards that route readers by intent. Forge uses it for the three reader paths: install a studio, wire a component, rebrand. | The editor chrome, the cover photograph, the trial banner, the illustrated card art. |
| H2 | [Snowflake, Getting Started with Native Apps](https://mobbin.com/screens/620c1b18-a8ab-453e-a652-1ad8aa1c2749) | Page title, one sentence, one primary button at the top right ("Start building"). Below, plain headings (Foundations, What's New, Build) over flat bordered tiles with a title and one line each. | One primary action in the page header, right-aligned. Sections as a heading plus flat link tiles of title and one sentence, no icon art. Forge uses the tile form for the 12 engines and the registry items. | The product left nav, the dated "What's New" tiles (Forge has no release or date to show), the trial widget. |
| H3 | [Mintlify, starter kit introduction](https://mobbin.com/screens/d4ce0aef-c205-432b-8f31-b4267315dc35) | Top bar with a centred search field carrying a shortcut hint, an "Ask Assistant" button and a theme toggle. A "Copy page" control beside the title. A callout under the intro. | Search field in the header with its shortcut shown. A "Copy page" control on every page. The callout slot under the title, which Forge uses for the status banner (registry not built, tarballs at 0.0.0). | The assistant side panel, the icon cards, the green accent, the left nav styling. |

## 2. Component page

| # | Reference | What it shows | Structure taken | Not taken |
|---|---|---|---|---|
| C1 | [Relume, Navbar 5 code view](https://mobbin.com/screens/b2e28cc0-3db1-4e21-adfc-378e9a859787) | Breadcrumb, a dark code block with a Copy button, and a right-hand Details column (Category, Last updated, React version, Tailwind version) plus a "Need help?" line. | A narrow facts column beside the main content, as label and value rows. Forge fills it with: needs provider, needs ignition, needs studio-layout, a11y status, source files. Copy sits in the code block header. | The Image/Code toggle (no component renders outside a native or react-native-web runtime, so the site has no preview), the "Also available on" integrations, an always-dark code surface. |
| C2 | [GitBook, API reference with schemas](https://mobbin.com/screens/c4f952a6-56db-4c48-8d3f-72534a4698a9) | A response schema as collapsed rows, each a type name with a "Show properties +" control, next to a JSON example. | Props as one row per prop or per type, expandable. On the static site this is a `<details>` element, so it works without JavaScript. | The "Test it" panel, HTTP status badges, the two-column response layout. |
| C3 | [Subframe, snippet card](https://mobbin.com/screens/21e41149-8a3f-403c-8487-b585f5cfe29e) | A framed card with a title bar ("Custom Snippet") and a two-option segmented control (Preview, Code) that switches the body. | The framed block with a title bar and a small segmented control that swaps between two views of the same thing. Forge uses it for the example block (tabs: Use, Provider), so the provider setup sits one click from every example. | Live preview, the edit and delete actions, the black-and-white demo image. |

## 3. Tokens page

| # | Reference | What it shows | Structure taken | Not taken |
|---|---|---|---|---|
| T1 | [Replit, Modern Design System overview](https://mobbin.com/screens/eeccd36c-86ef-4ac2-b70a-629058c4ab6a) | Core palette tiles labelled Primary, Secondary, Accent. A Typography panel. An "In use" panel with a small form built from those tokens. A row of component variants. | The "In use" panel: real components painted by the tokens, beside the swatches. Forge uses it for the live accent preview. | The three-swatch limit, the cream and terracotta sibling variant, the long left nav of form controls. |
| T2 | [MagicPath, design system manager, Colors tab](https://mobbin.com/screens/f8e624cc-3d18-4981-ac3c-002fabb8f184) | Tabs (Colors, Typography, Spacing & Radius, Shadows). Each colour tile has a name, a value and a one-line role ("Primary action color, buttons, active states"). Foreground partners sit next to their fill. A light and dark toggle. | A token cell is name, value and one-line role. A fill and its on-fill partner sit adjacent. A scheme toggle. Forge's `--color-primary` / `--color-on-primary` pair and its `role` field in `tokens.map.json` already have this shape. | OKLCH values (Forge stores hex), the modal frame, Save, Reset and Export actions, the preset list. |
| T3 | [Canva, brand guidelines colour page](https://mobbin.com/screens/b53729cd-a239-40de-86b1-257eaaecb158) | Colour tiles with hex, RGB and CMYK. Below, a row of "Aa" samples, one per colour, each with a green check. | Contrast pairs rendered as sample text on the fill, with a pass mark. Forge adds the ratio number and shows failures too: light `muted` on `deep` is 4.01:1 and fails. | CMYK and print values, check marks with no number, a pass-only presentation. |

## 4. Install page

| # | Reference | What it shows | Structure taken | Not taken |
|---|---|---|---|---|
| I1 | [Clerk, quickstart steps](https://mobbin.com/screens/382be08d-b9cd-412e-b88f-aca632720e08) | A vertical rule with numbered circle markers. Prose on the left, dark code blocks on the right, each with a filename header and a Copy button. An "Important" callout inside a step. Package manager tabs. | The two-column step: prose left, command right, filename header on every block. The in-step callout for the one exception (steps 1 to 3 do not reproduce outside the monorepo). Markers on a rule, since Forge's steps are a true sequence. | Package manager tabs (the repo pins pnpm 12.18.0), masked env values. |
| I2 | [LangChain, Studio quickstart](https://mobbin.com/screens/568fff70-41fd-4660-a3b6-eb843e6e14d9) | One bordered card holding numbered rows separated by hairlines. Each row has a title and a tinted code block. A language toggle (Python, TypeScript) at the top right. | The chain reads as one object: a single container, ruled rows, a number gutter. Forge's nine rows (0 to 8) sit in one container. | The language toggle, the inline "Generate API Key" button, the tinted-blue code surface. |
| I3 | [Featurebase, messenger installation](https://mobbin.com/screens/91be0f8a-b32d-4d5e-a8b5-7ea14a8f624c) | A block "Install with your agent" with a Copy prompt button and the line "Paste it into Cursor, ChatGPT, or Claude". Below it "Install manually" with a package command. A "Prompt copied" toast. | An agent block first, a manual block second. Forge's agent block copies a plain-text prompt that states the order and the three steps an agent cannot run outside the monorepo. | The one-prompt promise. Featurebase can install in one paste. Forge cannot, and the block must say so. |

## 5. Search

| # | Reference | What it shows | Structure taken | Not taken |
|---|---|---|---|---|
| S1 | [Coda, in-doc search](https://mobbin.com/screens/9d2e6129-e275-4386-8da0-d4b4fe0bd89d) | Query field, a scope toggle (In this doc, All docs), result groups (Pages, Text, Docs) with collapse chevrons, an Enter hint on the active row, a preview pane on the right. | Scope toggle, collapsible groups, an Enter hint on the active row. | The right preview pane (no room at 390, and the result snippet carries the same facts), the feedback link. |
| S2 | [Customer.io, search with filter](https://mobbin.com/screens/d6ebb7ec-1bb2-4406-8f94-3684981e13d0) | Query field and a Category filter popover with a radio list. Results on the left, a detail pane on the right. A footer key legend: Esc Close, up and down Navigate, Enter Select, Cmd Enter Open in new tab. | The footer key legend, and the filter vocabulary as a flat list of categories. Forge's categories: Components, Tokens, Install, Engines. | The detail pane, the nested popover, the product left nav behind the dialog. |
| S3 | [Langdock, grouped search results](https://mobbin.com/screens/9c45e8ef-bc96-4b1c-bd22-f49b9118a7c3) | Query "design". Group headers with counts, including zero (Agents 0, Workflows 0, Chats 3). Result rows with a title, a relative time and a snippet with the match highlighted. | Group headers that show their count even at zero, so an empty group is visible and not silently dropped. Snippets with the match highlighted. | The relative time (a static docs site has no dates), the modal-over-app frame. |

## 6. Where the references are weak

- Search (S1 to S3) is the weakest set. All three are app-level search palettes over user data. None searches a static docs site, none shows a "built from an index that may be stale" state, and none handles a no-JavaScript fallback. The static index, the zero-result guidance and the no-JS state in `06-docs-direction.md` come from the repo (`retrieval-eval.mjs`, `retrieval-queries.json`), not from a reference.
- Home (H1 to H3) is second weakest. These are product home pages and in-product docs views. No hit is a public component-library docs home. The engine roster, with its registry versus tarball encoding, has no reference.
- Component page (C1 to C3): no hit puts a prerequisite before the title block. The prerequisite-first order is a Forge requirement from `install-order.md` (every studio component throws without `StudioUIProvider`).
- Tokens (T1 to T3): no hit shows a locked set, a deferred set or a drift pair. The honest-status treatment of the rebrand contract and drift records is designed from `tokens.map.json` and `02-design-system.md`.
- Install (I1 to I3) is the strongest set, and still shows no chain where steps differ in kind. The method encoding (registry add, tarball, native build, app edit, toolchain) is Forge's own.
