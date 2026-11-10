# Visual reference audit — November 3, 2026

Scope: independent app entry and existing editor chrome. Preserve app routes,
separate document sessions, essay drafts, Word import/export, engine undo/history,
dock actions, presets and measured layouts. User's fault: the delivered UI looked
plain despite the supplied references. This pass targets the repeated generic
button rows, stacked headers, text-only tools and undifferentiated app entries.

## Where the references were found

Current branch: `STUDIO_WORKSPACE.md`, `MOBBIN_REVIEW.md`.
Additional source contracts reviewed with `git show`:
- `origin/feat/ignition-nitro-v1-preview-2026-11-02:docs/STUDIO_UI.md`
- `origin/docs/shared-expo-meta-adaptive-ui-2026-11-02:docs/ui/SHARED_NATIVE_COMPONENTS.md`
- The same branch's `RESPONSIVE_ACCEPTANCE.md` and native adaptive skill.
- `origin/feat/forge-icons-rive-universal-suite-2026-11-02:docs/ui/FORGE_ICONS_RIVE_ROSTER.md`
- Native pen Rive, Skia v3 and renderer extraction documentation from their branches.

Those documents were inspected read-only. This pass does not merge their native
runtime migrations or claim their workstreams are completed.

## Exact Mobbin screens inspected visually

All seven original links were opened in Chrome and their actual screen images
examined. No provider images are copied into this repository.

| Screen | Observed in its image | Application / boundary |
|---|---|---|
| [Framer](https://mobbin.com/screens/1edcc2ea-d2e4-41a8-97d3-b8b4feca2735) | narrow page tree and compact property sections around a large gray stage; compact document bar | subordinate editor chrome and grouped inspector; no imitation geometry controls |
| [Rive](https://mobbin.com/screens/0deb9a56-af1f-4697-a912-ff87f5ccd09f) | dark chrome, slim icon rail, tool flyout over stage, right design inspector | original outline/filled tool rail; no invented animation timeline behavior |
| [Canva](https://mobbin.com/screens/3f507e35-c583-41b5-afc0-c0422e00e068) | labeled vertical tool rail, contextual top actions, document page and layer pane | separate persistent rail from document-specific actions |
| [Adobe Express](https://mobbin.com/screens/64d24cec-61c2-4907-8d75-84fcbc4314ce) | small document header, left tool rail and assets pane, right version history around central artwork | one header; history is optional instead of permanently taking stage height |
| [Jitter](https://mobbin.com/screens/6c71f040-3f15-43ef-8faf-6e21442f898a) | dark top tool strip, scene tree, selected central object, contextual right design controls | retain document prominence and quiet panel hierarchy |
| [Freeform iOS](https://mobbin.com/screens/30867762-fa72-4721-9ad3-d2bae601e48d) | phone canvas with selection bounds and a contextual action menu | compact context controls; no desktop inspector forced into narrow editing space |
| [Craft iOS](https://mobbin.com/screens/145386bb-3aac-42cb-8d75-501170233bef) | selected rounded shape on a dotted canvas, bottom format controls | this exact screen is a drawing state, not evidence for a prose editor |

Additional writing references actually inspected through Mobbin search:
[Craft document](https://mobbin.com/screens/2b7a1cd3-7a5a-4d63-aedb-78a6820d51c6),
[Craft collection](https://mobbin.com/screens/6a23c8ef-62ce-4dfa-9964-3ad8bb9645d4),
[Craft formatting](https://mobbin.com/screens/dc96d1ea-c937-4b57-91fc-f9368d70de50).
These show a readable document page between a concise outline and a contextual
insert/format inspector. Quill uses a larger writing page and optional panels.
The serif manuscript treatment and launcher artwork are original judgement calls,
not copied reference assets or a claim that Craft uses those exact styles.

## Official editor and native system sources

- [Affinity interface](https://www.affinity.studio/help/workspace-interface/),
  [studios](https://www.affinity.studio/help/workspace-about-studios/),
  [snapping](https://www.affinity.studio/help/design-aids-snapping/): fetched pages
  expose navigation but not their substantive article content to the web reader.
  No exact layout conclusions are attributed to those article bodies.
- [Affinity announcement](https://www.canva.com/newsroom/news/all-new-affinity/):
  reviewed workspace personalization and supplied layout image as reference
  material. Affinity's unified app does not override the user's separate-app entry.
- [Expo design system](https://github.com/expo/skills/blob/a9e5bd3fa00b4e61f632e43f85da73aee1942582/plugins/expo/skills/expo-design-system/SKILL.md),
  [native UI](https://github.com/expo/skills/blob/a9e5bd3fa00b4e61f632e43f85da73aee1942582/plugins/expo/skills/expo-native-ui/SKILL.md),
  [UI](https://github.com/expo/skills/blob/a9e5bd3fa00b4e61f632e43f85da73aee1942582/plugins/expo/skills/expo-ui/SKILL.md),
  [animation](https://github.com/expo/skills/blob/a9e5bd3fa00b4e61f632e43f85da73aee1942582/plugins/expo/skills/expo-animation/SKILL.md):
  semantic tokens, shared component boundaries, platform adapters and reduced motion.
- [Impeccable](https://github.com/pbakaus/impeccable/tree/e89e3ada3e875a89ac2c5d33d11e65ebef6fe285):
  reviewed Operate guidance and craft floor; restrained chrome around working content.
- [No AI Slop](https://github.com/petergyang/no-ai-slop/blob/000650b156983f5159695b441477f4e63b25dc85/skills/no-ai-slop/SKILL.md):
  exact copy and evidence, no invented usage, recents, success or product outcomes.

Moyo source inspected read-only at `/Users/mikevocalz/moyolearn/packages/ui`:
`Toolbar`, `IconButton`, `InspectorSection`, `NativeSlot.native`, grouped controls,
`tw.tsx`, plus `packages/theme/tokens.ts`. Their host slots, semantic themes and
control boundaries inform this existing workspace; their business dependencies
and brand palette are not copied. App-neutral native-control extraction and Moyo
re-export parity remain a separate release gate. Current Expo 54 supports
`@expo/ui ~0.2.0-beta.9` platform subpaths, not Moyo's newer universal root API.
No incompatible universal Host/RNHostView import is introduced.

The existing original icon package is reused from its source branch, including
paired artwork, tests and motion tokens. Icons honor reduced motion and real
selected/disabled states. Compiled Rive assets remain pending; no timed fake
connection or operation success is added. Figma/Adobe/Office/iWork/AV product names
in the icon roster are taxonomy references, not proof that every product screen
was inspected. Kinetrell is conditional in the docs, with no verified adapter;
this pass does not invent one.

## Applied visual moves

1. One document header and one context toolbar. Workspace arrangement/preset
   controls live in an explicit menu, and optional panels are reached from a tool
   rail. History starts collapsed.
2. Original paired icons replace Unicode and text-only tool affordances. Central
   semantic tokens feed RN and the Tailwind v4 web compilation. Hosts can override
   the shared palette; no engine gains a UI dependency.
3. Quill gets an editorial paper surface, measured text width, serif manuscript
   typography and real word/draft state. Defaults reserve more space for writing.
4. The app list keeps its task-based copy and independent routes, with original
   document/grid/artwork/timeline motifs and real opened-session status. These
   motifs are decorative app identities, never fake document thumbnails or recents.

Native/foldable/XR execution and source-neutral Expo UI extraction remain outside
this browser evidence. No orientation, manifest or spatial window contract changed.

## PhotoCraft / Affinity for iPad follow-up (November 3)

User selected [Affinity for iPad](https://www.affinity.studio/ipad-app) as the
primary photo/vector experience. The actual official hero image was downloaded
and inspected: large canvas, narrow toolrail, floating contextual strip, rounded
Layers panel with visible selection and per-layer visibility. Pixel/Sketch/Layout
screens were also inspected by the reference subagent. These observations guide
Prism; they do not establish feature parity or permission to include the reference
artwork. PhotoCraft's Studio light screenshot and pinned theme/toolbar source
were inspected at commit d93e65d0018602913e72ab468b08c4a2973718b9. Its 6/8/12 radius
family, brighter cards, neutral canvas and inset selection informed the shared
8/12 controls/panels. Source: https://github.com/storytold/photocraft.

New Mobbin iOS images actually inspected: [Photoroom layers](https://mobbin.com/screens/17875c39-0946-4b6b-a760-bb3868918e01)
and [Canva layer selection](https://mobbin.com/screens/a7d2e8f9-cf06-4b76-bd09-50d1a2315114).
Both keep a large preview above a titled layer sheet, with grouped rows and clear
selection. [Pinterest collage toolbar](https://mobbin.com/screens/039e0db8-7a21-4217-9859-1cab995cefe3)
was used only for contextual placement, not photo/vector feature evidence.

Web Designer Pro's local skill process was used with source studies and continued
critic rounds. Browser extension state changed mid-session; Chrome's native
accessibility fallback supplied desktop and 390px host-width evidence. No
cross-platform browser matrix or native runtime result is claimed.
