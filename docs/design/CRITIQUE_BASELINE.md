# Forge design baseline critique

2026-11-07. Round 0: existing direction lab, before this brief's implementation changes.

This review uses product craft, instrument clarity, platform truth and cross-device consistency as standards. Named people and agencies in the design workflow did not participate or endorse the work. The private workflow text and assets are not reproduced here.

## Evidence reviewed

All three images were opened and inspected:

- Workbench: `design-reference-audit/forge-directions/workbench-dark-1194/1194.png`
- Optics: `design-reference-audit/forge-directions/optics-dark-1194/1194.png`
- Atelier: `design-reference-audit/forge-directions/atelier-dark-1194/1194.png`

These paths are relative to the private local evidence directory `/Users/mikevocalz/recovered-work/2026-11-05/`. Each is a Chrome web capture at 1194 × 834. The route's `surface=ipad` parameter selects lab behavior; it does not turn Chrome into native iPadOS or establish an 11in device capture.

Source/context reviewed: `apps/studio-preview/src/turret-lab.tsx`, `design/DIRECTION.md`, `docs/design/BRIEF_V1_AUDIT.md`, `SYSTEM_IMPLEMENTATION_MAP.md` and `IPAD_REFERENCE_OBSERVATIONS.md`.

The lab renders working UI controls against local Zustand values. Its two-shape artboard is a fixture. It is not proof that opacity, color or persona changes reach a real document engine, undo, save or reopen. Historical claims in DIRECTION.md were not rerun for this critique.

## Baseline assessment

Scores below assess what the three static captures establish. Unverified rows have no numeric score: missing evidence is neither a pass nor a measured failure. No overall average is calculated.

| Criterion | Score | Evidence and change needed |
| --- | --- | --- |
| Instrument concept | 3/5 | Workbench's radial selector has a distinct bezel, detents and a central mode name; the opacity inspector remains a conventional bordered field group. Make the precision readout and manipulation surface carry the same authored grammar as the selector. |
| Distinction from common editor UI | 3/5 | The Workbench selector is memorable, while the dark floating rectangles and swatch row could belong to many editors. Compare the same complete editing task, not just the dial, before judging the suite identity. |
| Restraint and avoidance of stock patterns | 3/5 | The captures avoid oversized dashboard cards and glass over the entire stage. Optics adds a multicolor ring to a mode choice without a visible color/signal meaning. Reserve spectral treatment for information it encodes. Native-control styling remains unverified. |
| Shared grammar across studios | Unverified | Only one lab composition is shown. Capture equivalent working controls beside actual Prism artwork, Cadence tracks and Splice clips before claiming family consistency. |
| Precision | Unverified | Workbench visibly shows 64%, a 0–100% range, scale ticks and a fine/coarse hint. Exact entry, reset, cancellation, keyboard and engine acknowledgement were not exercised. Record the exact edit/undo/save/reopen task. |
| Typography | 3/5 | The mode name and direction heading are clear, but the 64% value is visually subordinate to a large panel and dial; help and capability text are small. Give the current value a stronger role without increasing all chrome, then inspect text scaling and numeric alignment. |
| Color and material | 3/5 | Workbench's neutral panel supports readable controls. The direction selector is violet while the committed turret marker and scrub scale are blue, so active-state chrome lacks one clear accent owner. Resolve tokens for active chrome independently from the authored violet artwork. |
| Depth and finish | 3/5 | Workbench's dial has a readable face/bezel boundary; Atelier flattens that boundary and Optics concentrates attention in its rim. Floating panels create depth but consume a disproportionate part of the small artboard. Compose panels around the actual task before adding more surface treatment. |
| Micro-interactions | Unverified | Static PNGs do not establish press, snap, cancel, dock, error, haptic or thread behavior. Native Reanimated source is an implementation clue for that owner, not a measured suite-wide result. |
| Screen craft | 3/5 | No obvious text clipping appears at this viewport. The open persona panel obscures part of the artboard and the lower-right inspector overlays more content, with substantial unused surrounding space. A task-based anchored/docked arrangement should preserve the editable region and explicit return path. |
| Adaptive composition | Unverified | One landscape-sized web viewport does not prove portrait, small/large tablets, phone, foldable hinges, RTL, desktop or XR behavior. |
| Device and accessibility matrix | Unverified | No Dynamic Type, screen reader, high contrast, reduced motion, hardware keyboard, Pencil, ProMotion, thermal or physical-device result was supplied for this round. |
| Native platform behavior | Unverified | These captures cannot establish SwiftUI/Compose menus, native popovers, Pencil behavior, Android back behavior or platform materials. |
| Copy | 3/5 | “Layer opacity,” the percentage, the range and fine/coarse hint are specific. The introductory material descriptions belong to a comparison lab, not production chrome. Capability notices are useful, but their underlying catalog must be checked against current engine operations before reuse in a shipping screen. |
| Visual distinctiveness | 3/5 | The Workbench dial gives the image one recognizable object; the remainder is a sparse fixture around it. This is the reviewer's visual assessment, not evidence of a professional audience's reaction. A coherent real-task screen is the next useful comparison. |

## Three highest-impact changes

1. **Use one real Prism task as the comparison surface.** Select an actual artwork layer, enter exact opacity, inspect its color, undo, save and reopen. Keep the same document/state in all three directions and show the work alongside the controls. Retain the lab for isolated control inspection, but do not use it as workflow acceptance.
2. **Establish one active-chrome token owner and a density contract.** The current violet direction choice, blue instrument state and fixture swatches must remain semantically distinct. Use shared neutral roles and explicit user-selected density while preserving existing target, type-scaling and saved-layout contracts. Resolve contrast/material capability centrally before changing individual panels.
3. **Give the edited content an explicit usable region.** The open selector and inspector should dock or anchor according to task and available geometry, with a clear close/restore path. Validate the same arrangement in portrait and under text scaling; do not equate a device-label query parameter with native evidence.

## Direction recommendation

Keep **Machined Workbench as the provisional baseline**. In these images its face, bezel and active marker separate more clearly than Atelier's softer dial, while its mode selector avoids Optics' decorative spectral emphasis. This supports retaining the existing default during implementation; it does not approve a new palette, prove motion quality or select the final suite design.

Optics remains worth exploring for color/signal-bearing instruments where its treatment can encode actual information. Its browser blur is not evidence of a platform-native material. Atelier remains a composition hypothesis for docking and spatial layout; the static dial image does not test that hypothesis.

## Gate and next review

**Baseline recorded; not approved for shipping.** The required native, precision, interaction and device rows remain unverified. The full brief's reference matrix and actual user-job research also remain incomplete. Do not convert these gaps into inferred scores or an award-level claim.

For the next round, supply the real-task captures at the agreed densities/modes, show the fixes above, and attach interaction/native evidence separately. Reuse this critique lane for comparison rather than restarting the scorecard with a new reviewer.

No production code, dependencies, app configuration or tests were changed or run by this critique. No private pack files or third-party images were copied into the repository.

## Follow-up: active-chrome token scope

Inspected `design-reference-audit/forge-directions-r3/workbench-dark-1194/1194.png` and the two-file source diff. The lab now wraps its whole page in the direction's TokenScope rather than limiting that scope to the opacity scrubber. The token adapter also supplies primary fill and its foreground from the source palette. An outer scope alone had left the primary-role lookup unresolved; the r3 image is the relevant result of both changes.

The visible mismatch identified in the baseline is resolved **for this captured dark Workbench lab state**: the selected Workbench segment is now blue, consistent with the turret's active marker and scrubber scale. The authored violet shapes and selected fill swatch remain separate document-color data; they should not turn blue merely to match chrome. This is a useful correction of token coverage, with no need to add another control implementation.

This follow-up does not raise the whole color/material row to a suite-wide pass. Light mode, other directions, focus/disabled/error states, density, contrast preferences and other studio surfaces still need comparison. Typography hierarchy, the fixture-only task and overlapping panel composition remain as recorded above. No new native, engine, interaction, accessibility or performance evidence is established by the PNG. The parent reports passing studio-workspace and studio-preview typechecks; this critic did not rerun those commands.

Verdict: the specific visible accent defect is corrected; retain Workbench provisionally and continue the real-task/density review. No full design or shipping approval.
