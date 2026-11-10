# Prism density and real-task review

2026-11-07. Follow-up to `CRITIQUE_BASELINE.md`. Scope: controlled workspace density, direction selection and the actual Prism comparison route. This is a bounded browser/source review, not suite or native acceptance.

## Evidence inspected

Opened all nine PNGs under the private local evidence directory:

`/Users/mikevocalz/recovered-work/2026-11-05/design-reference-audit/prism-workflow/`

The set is `{workbench,optics,atelier}-{compact,standard,comfortable}.png`, captured at 1194 × 834 in dark mode. Reviewed `result.json` in the same directory and source changes in `theme.ts`, `index.tsx`, `prism-editor.tsx` and `apps/studio-preview/src/main.tsx`.

The recorded task used the actual Rust `nf-cli` host through the loopback browser bridge. Its operations show one engine open, layer 2 set to 0.37 opacity, undo returning it to 1, redo returning it to 0.37, a 350278-byte snapshot, a later edit to 0.82, and restore returning it to 0.37. The final describe result identifies layer 2 at 0.37; the captures retain the selected rectangle and 37% readout. The record contains no reported errors.

That is materially stronger than the earlier local-value turret fixture. It establishes this browser task and this document's recorded continuity. It does not prove every action, source format, failure path, reopened process or platform. The critic inspected the supplied run record; it did not execute the task independently. Full test suites remain deferred.

## What improved

- The comparison now shows an actual engine-rendered rectangle, selected layer, editable opacity and file result. It is possible to judge chrome around document work rather than around an isolated control fixture.
- The density contract is explicit and host-controlled. `resolveWorkspaceScale()` defaults to standard and changes chrome spacing/metrics without changing type scale or radius. It does not use density to choose hardware layout.
- The comparison route updates direction/density parameters without keying a fresh `StudioEditor` for each choice. The single-open record and stable selected-layer captures support continuity for this run.
- At this viewport, the artboard and layers inspector have separate usable regions. Neither panel obscures the selected rectangle. This addresses the earlier fixture's most visible composition problem.
- Active chrome remains blue while the authored rectangle/fill remains violet. Source color and selected-control color are visibly distinct.

## Findings

### Comfortable opacity helper text has no remaining separation

In all three comfortable captures, the fine/coarse hint meets the range text at the right edge: `…coarse0 – 100%`. Compact and standard keep a visible gap at the same viewport. The inspector remains bounded while comfortable density increases its padding; the released scrubber has its own hint/range layout.

This is a visible readability defect, not proof of a native clipping bug. Let the hint and range reflow or stack when their measured content no longer fits, through the existing reusable control/layout owner. Do not patch it with an unrelated extra panel width or reduce text size to make the screenshot fit. Recheck translations and text scaling after the fix.

### Comfortable target coverage is partial

The new scale advertises a 48pt comfortable target and host helper buttons receive larger classes. The released PrecisionScrubber still owns its fixed control geometry; its internal +/- controls do not automatically consume the new scale. These screenshots therefore do not establish that every comfortable-density target is 48pt.

Retain the existing accessible target floor. Track which reusable controls expose a density/target contract and extend that owner where necessary. Do not duplicate the scrubber inside Forge to finish the theme.

### Current direction comparison covers only part of each direction

The captures show clear panel-tone differences, especially Atelier's lighter plane. They do not show an open persona instrument, direction-specific transition recording or native material behavior. Retaining an opaque Optics panel is consistent with avoiding fake browser glass, but the resulting still image cannot prove the optical or motion concept.

Keep Workbench as the provisional baseline. Use a color/signal-bearing task and actual interaction evidence before deciding whether the other material treatments improve professional work.

## Bounded score update

| Review area | Assessment |
| --- | --- |
| Real document task | 4/5 for this recorded browser path: exact opacity, undo, redo and snapshot/restore have source results. Failure recovery and other precision domains remain outside the evidence. |
| Content/chrome composition | 4/5 at this viewport: selected work stays unobscured and the inspector has its own region. Portrait, narrow, text-scaled and hinge cases remain unverified. |
| Active-state color ownership | 4/5 for these dark Prism captures: blue chrome is distinct from violet document data. Light/high-contrast and other studios remain unverified. |
| Density craft | 3/5: meaningful spacing differences and stable type/radius, with the comfortable hint collision and incomplete reusable-target coverage above. |
| Native, accessibility, performance and cross-device behavior | Unverified; no numeric score inferred from Chrome images or the Rust operation record. |

These are local follow-up assessments, not a replacement for the full rubric or a suite-wide average. No whole-row shipping pass is awarded.

## Next evidence

1. Fix the comfortable hint/range layout and capture it again without reducing text or adding an arbitrary panel-width stand-in.
2. Compare light mode, portrait/narrow layout and enlarged text on the same retained document. Record focus/keyboard behavior rather than inferring it from a static image.
3. Continue the same task through the native host before making native/Pencil, screen-reader, motion-thread or performance claims.

Verdict: the phase advances from a visual fixture to a useful real-task comparison. The visible helper-text defect should be fixed before treating comfortable density as ready for review. The implementation remains provisional; full acceptance and shipping approval are open.

No implementation files, dependencies, configuration or tests were changed by this critique. No private design-pack text or third-party images were copied into this report.

## Follow-up: canonical scrubber footer reflow

Inspected `prism-workflow-source/workbench-comfortable.png` under the same private evidence root and the upstream NYC-Tron `PrecisionScrubber.tsx` footer source. The footer now allows wrapping, with explicit horizontal/vertical gaps and shrinkable bounded text. In this capture, the fine/coarse hint remains intact and the `0 – 100%` range moves onto a separate line. The previously reported joined-text defect is visibly corrected without enlarging the layers panel or reducing the type size. The selected rectangle and 37% readout remain visible, and the taller footer does not obscure the artboard at this viewport.

This image comes from a **private source-preview server** that aliases the canonical NYC-Tron source leaf. It is not a capture of the currently pinned alpha.4 tarball. The temporary RN Web adapter is review infrastructure; it does not establish a released integration, native host behavior or a new public package contract. The supplied source-preview result records the Rust snapshot/restore task and nine variant run with one engine open and no reported page errors; this critic inspected that result but did not rerun it. The parent reports a passing NYC-Tron UI build.

The source-level footer fix resolves this particular comfortable-layout finding. Shipping Forge consumers still need a deliberate accepted release/pin update to receive it. Comfortable 48pt target coverage, enlarged text/localization, light/high-contrast modes, portrait/narrow geometry and native/accessibility/performance acceptance remain open. No whole-density or shipping approval is inferred from this follow-up.

## Final responsive follow-up

Inspected the refreshed source-preview `prism-workflow-source/workbench-comfortable.png`, plus `prism-source-phone.png` and `prism-source-portrait-light.png` in the private evidence root. The comparison selectors now sit above the ordinary workspace, leaving document commands in their existing header. This keeps comparison-only controls from competing with the narrow document title/action region. The standard app's density setting is exposed through the Workspace menu rather than adding another permanent header control.

The updated wide comfortable image still shows the selected rectangle at 37%, a cleanly wrapped opacity footer and an unobstructed artboard. The comparison row consumes some vertical space, but is explicitly review infrastructure. It is not proposed as permanent studio chrome.

In the 390 × 844 phone capture, the artwork region, creation tools and lower Fill layer action are visible. Fill layer is inside the viewport rather than below a clipped bottom boundary. The parent reports measured page dimensions of 390 × 844 without overflow and a 48px-high Fill action at y774; this critic inspected the image, not an independent geometry measurement. The compact top row's short metadata is truncated rather than drawn over adjacent controls.

**Phone Save access remains open.** A blue floppy-disk icon is visibly present in the phone header. The parent's visible-button enumeration did not identify Save, so visual presence does not establish its accessible name, keyboard discoverability or working action. Verify the icon control through its real accessibility/keyboard path and save/reopen at this width before claiming the phone task passes. Do not describe it as visually absent, and do not infer its accessibility from the wide screen's labelled Save button.

The portrait-light image shows a labelled Save button, the lower fill strip within the image and a clear document region. These stills are a useful light/narrow composition check; they do not establish high contrast, Dynamic Type, translations, screen-reader order, keyboard focus or native phone/tablet behavior. The phone and portrait-light images show an untitled raster document, so they are not additional proofs of the selected rectangle's saved-state roundtrip.

Verdict: the recorded wide browser task and specific footer/overflow fixes are ready to present as bounded phase evidence. Phone Save discovery/action, complete comfortable target coverage and the wider acceptance matrix remain unresolved. No full responsive, native or shipping approval is given.
