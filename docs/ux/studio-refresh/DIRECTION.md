# Studio refresh direction

Brief: finish the existing Studio workspace and dock work. User supplied the separate-app contract, PhotoCraft and Affinity for iPad references, slight rounding, Web Designer Pro workflow and REA analysis tool. Affinity for iPad is primary for Prism's photo/vector experience. Each application opens its own document space; Quill supports essay typing and Word import/export.

Keep: real Rust engine sessions, stable opened documents, Zustand state, magnetic docking, responsive panels, accessible 44pt targets, undo authority, shared native/web source, established native window configuration.
Lose: warm amber styling, decorative tilted document mockups in the launcher, marketing-scale app selection headline, repeated panel heading rows and undifferentiated inspector text.
Unknown: native runtime appearance, physical stylus behavior and cross-browser matrix until actually exercised.

## References

PhotoCraft Studio light: cool canvas mat below brighter chrome, subtly rounded inspector cards, inset tab selection, grouped toolrail and compact contextual controls. Source pinned d93e65d0018602913e72ab468b08c4a2973718b9; screenshots inspected from the repository. These are visual moves; no PhotoCraft implementation/assets are included.

Affinity for iPad: primary photo/vector reference supplied by user. Official page inspected 2026-11-03. Canvas remains central, contextual controls close to editing, panels can reveal detailed work without permanently consuming the stage. Do not infer Affinity feature parity from this reference. Independent NitroForge apps remain the user's explicit requirement.

Mobbin iOS photo editor references: Photoroom 17875c39-0946-4b6b-a760-bb3868918e01, Canva a7d2e8f9-cf06-4b76-bd09-50d1a2315114. Both actual images inspected: large stage above a clearly titled layer sheet, row grouping, thumbnail identity, and selected layer accent. Pinterest 039e0db8-7a21-4217-9859-1cab995cefe3 is a collage context toolbar, useful only for contextual placement. Previous source review remains in DESIGN_REFERENCE_AUDIT.md.

REA is an analysis MCP/CLI, not an editor design kit. Its official docs were reviewed; runtime execution and limitations are recorded separately. Do not call reading its README an executed analysis.

## Studies

Exploration source: artifacts/studio-directions/{a,b,c}.html, rendered through Chrome native fallback after browser extension connection changed. Desktop PNGs beside source. These are bounded first-screen studies, not engine-backed UI; they intentionally use the same document task to compare shell treatments. No paid images generated.

A: NitroForge is a light workshop bench. Cool neutral, sans, violet selection, slim rail and inset inspector. Recommended: reference fidelity and calm content hierarchy.
B: NitroForge is a recording control room. Dark slate, mono, teal; broader navigation. Lost: density and technical tone compete with essay and art content.
C: NitroForge is a drawing table. Blue field, humanist sans, canvas with floating command bar. Lost: saturated ground overwhelms the user's work and no permanent toolrail reduces discoverability.

Choose A, retaining dark mode as a designed counterpart. Refuse both the Paper Edition marketing default and the dashboard KPI grid. The launcher is an application directory, the editor is a workshop; neither needs invented recents or metrics.

## Tokens and shell

Source of truth: packages/studio-workspace/src/theme.ts; generated theme.css for browser host. Cool neutral base, lighter raised cards, darker canvas mat; violet only for selection and primary actions. Controls 8, panel cards 12, document page 2px radius. Sans for compact chrome, document type remains distinct from UI. 44pt touch targets retained even where reference desktop buttons are smaller.

Layers: canvas mat, document/artboard, contextual floating menu. Shadows only on the paper or truly floating controls. Docks use 8pt insets and fine borders. Content owns most of the area. Phone uses bottom panel toggles and horizontal contextual toolbar rather than squeezing desktop docks.

Signature: existing magnetic dock preview on drag; explicit Arrange mode, projected drop region, commit on release; cancel by Escape or Cancel move. Reduced-motion preserves a still preview and removes icon animation.

Content: actual engine state only. Apps directory lists Quill, Prism, Tally, Pitch, Folio, Splice, Cadence with existing task labels. Open/Continue reflects actual mounted sessions. Document details and layers come from real describe data. No unsupported filters, PSD support or fake history entries.

## Validation limits

Exploration phone renders and automated multi-OS browser matrix are not yet recorded. Native app runtime remains unverified. Source typechecks and engine integration are reported only when run. Browser screenshots include browser chrome because the extension connection was unavailable and native Chrome was used.

REA execution completed with pinned rea-agents 6.8.0 and temporary official npm
Node 26.12.1. Source-only analysis parsed five JS/TS files with zero parse errors,
retaining 68 observations. The source graph is partial because workspace
packages lie outside the selected directory. Observations are not defects and
this does not validate runtime or visual behavior. Bounded evidence is in
rea-summary.json; full 2.9MB report remains in ignored artifacts/rea. Neither
system Node nor global agent configuration was changed.
