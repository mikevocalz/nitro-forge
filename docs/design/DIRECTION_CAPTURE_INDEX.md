# Existing direction comparison

2026-11-07. Rendered the existing `apps/studio-preview` turret lab at 1194 × 834 CSS pixels in headless Google Chrome. The query's `surface=ipad` selects a lab capability scenario; it does not make this a native iPad run.

| Direction | Local capture | Observation |
| --- | --- | --- |
| Machined Workbench | [Workbench baseline](evidence/workbench-baseline-web.png) | Matte panel and restrained turret; current baseline choice remains visible. |
| Chromatic Optics | [Optics baseline](evidence/optics-baseline-web.png) | Bright multicolor turret rim and translucent panel. This web material is not native Liquid Glass evidence. |
| Spatial Atelier | [Atelier baseline](evidence/atelier-baseline-web.png) | Lighter raised panel and solid turret; this fixed web arrangement is not spatial or hinge-safe device proof. |

The linked captures render original Forge UI and are committed for review. Third-party iPad gallery images and private design-pack files remain outside the repository.

The lab exposes actual interactive components, but its artboard is illustrative local UI state. It does not establish real Rust edit/undo/save/reopen behavior. “Not in this build” capability notices remain visible; they must be reconciled with actual engine capabilities before the editor claims those workflows.

The images show the same controls in three materials. They do not establish the brief's complete chrome redesign, all density/mode states, motion or native acceptance. Scans were deliberately not run for this baseline capture; no scan pass is claimed. Review findings are recorded separately in CRITIQUE_BASELINE.md.

## First correction

[Workbench after the token-scope fix](evidence/workbench-token-scope-web.png) shows the direction choice using the same blue chrome accent as the instrument. The first attempt to move TokenScope around the whole lab still left the selected control violet. Source inspection found that `nycTronTokensFor` omitted `--color-primary` and `--color-on-primary`; those roles inherited the suite default. Supplying both roles from the same source palette corrected the rendered selection. The document swatches retain their own colors because they represent artwork content.

`studio-workspace` and `studio-preview` TypeScript checks pass. No full source/browser regression suite or native/device acceptance was run. This correction does not resolve the pending density, panel composition or real-engine workflow work.
