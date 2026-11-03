# Forge Icons — Original artwork, Rive motion and cross-suite release roster

## Competitive coverage (reference taxonomy, not copied artwork)

- Professional design: Figma, Sketch, Illustrator, Photoshop, Affinity Designer/Photo/Publisher, Canva, Adobe Express, Penpot.
- Office suites: Microsoft Word/Excel/PowerPoint, Google Docs/Sheets/Slides, Apple Pages/Numbers/Keynote, Acrobat and Preview.
- Motion and AV: Premiere, After Effects, Final Cut, DaVinci Resolve, Audition, Logic, Ableton, GarageBand, Rive and Jitter.
- Platforms: iPadOS, Android, Windows, macOS, Surface Duo foldables, Vision Pro and spatial pen interactions.

Sources are used to inventory familiar command concepts (selection, typography,
pivot tables, slide transitions, PDF redaction, keyframes, stroke geometry, etc.).
Do not copy any source SVG, vendor artwork or trademarked design.

## Visual language

1. Original bold 24×24 shapes; rounded 2.35px outline stroke, visually tuned at 16/20/24/28/32.
2. Inactive is outline. Selected is filled. Paired shapes are hand-authored, not merely a CSS opacity change.
3. Theme token colors: ink, inverse, accent, positive, warning, negative; every color can be overridden by the host.
4. On selection use an outline-to-filled crossfade and small scale emphasis, ~225ms.
   Deselect ~175ms, hover ~120ms, press ~110ms.
5. Every icon control is 44×44pt minimum, has text alternative, explicit selected/disabled/busy semantics.
6. Respect OS reduced-motion, color contrast, text scale, VoiceOver/TalkBack, RTL, touch/pen, keyboard.
7. No external icon font, remote icon downloads, raw HTML or duplicate React state store.

## Rive architecture

- Native/web animated SVG renderer is shipped first and does actual opacity/scale/loading motion.
- Optional renderRive adapter receives semantic name, color, selected, loading, disabled and real host-provided status.
- Rive v1 state machine inputs must be compiler-verified (boolean / numeric / trigger), not a made-up API. Host theme colors must use verified data binding or supported runtime properties.
- Rive CLI source, actual .riv files and linked runtime must be produced and independently verified before replacing the native fallback.
- The existing pen connection Rive source in Forge PR #20 is separate and may be reused after compile verification.
- Never show success based on elapsed time: real BLE input validation is required for a pen READY animation.

## Milestones and evidence

| ID | Deliverable | Current stage |
| -- | -- | -- |
| IC-01 | Shared catalog across 25 groups, 1000+ named semantic actions | source |
| IC-02 | First paired original outline and filled glyphs | source |
| IC-03 | Native/web SVG component with real selection/press/loading animation | source |
| IC-04 | 44pt accessible icon-button wrapper | source |
| IC-05 | Node tests, syntax validation and GitHub Actions | new CI |
| IC-06 | Authored Rive state machines, verified RML, compiled .riv artifacts | pending |
| IC-07 | Device visual baselines iPhone/iPad/Duo/Android/web/Vision Pro | pending |
| IC-08 | Integrate into all seven editors + Board & Studio | pending |
| IC-09 | Performance, accessibility and package publish canary | pending |

The semantic catalog is an inventory, not a claim that every named vector
glyph or animation has been drawn. The getGlyph API must return undefined
for names that lack finished original artwork. No fake icons.
