# Forge 2046 — premium design review and execution playbook

> **Status:** design method and acceptance criteria, not proof that native interfaces are complete. This document supplements [the Forge 2046 constitution](./FORGE_2046_DESIGN_SYSTEM.md) and the [shared Studio workspace](./STUDIO_WORKSPACE.md). It is intentionally original, and does not redistribute a commercially obtained design skill, its scripts, fonts, screenshots or sample templates.

## Why this exists

A functional slider, color wheel or waveform isn't sufficient to make a professional creative studio. The instrument must be legible in a dense workflow, feel carefully manufactured, respond accurately to every supported input, share a recognizable suite identity, and leave the user's artwork unchanged by decorative UI.

This process adapts useful **design practice** from a locally owned Web Designer Pro ZIP (concept exploration, deliberately crafted visuals, critique, device-matrix review), Mobbin observational references and Dribbble concepts. The ZIP is **not** an npm package, Git submodule, CI dependency, code source or permission to reuse proprietary assets. An agent that does not have the ZIP can follow this self-contained playbook.

## Unbreakable suite invariants

- Seven independent editors (Prism, Cadence, Splice, Quill, Tally, Pitch, Folio) and Board share document bar, command grammar, inspector behavior, modal layering, focus feedback, icon family, numeric syntax, input states and accessibility semantics.
- Original icon design: paired outlined/inactive and filled/selected, with Rive transitions only where useful. Native input is not a painted replica of a web button.
- One semantic color system, density scale and typographic hierarchy across apps; instrument-specific channel colors encode data, not arbitrary branding. Light and dark are real variants.
- Document pixels, video scopes, waveform amplitude, music levels, formula references and ink coordinates are authoritative data. Never shade or color-tint underlying work to improve a screenshot.
- Present one coherent instrument experience through shared typed state/commands and native/web render adapters. Rust Ignition owns document edits and undo. No HTML shell or WebView in native.
- Every fancy control needs an equally capable accessible path: precision input, keyboard, pointer, touch/stylus, reduced-motion and high-contrast behavior.

## Explore three directions on the *same real task*

Do not build three unrelated launch screens. The first exploration is **Prism: select an artwork layer, inspect and set exact opacity, choose color, undo, save and reopen**, backed by real engine state. In a second pass, evaluate the same visual decisions with a Cadence transport and Splice frame ruler.

| Direction | Formal visual idea | Signature instrument behavior | Main risk / test |
| --- | --- | --- | --- |
| **A — Machined Workbench (baseline)** | Dark graphite structural rails, barely raised ceramic inspector planes, engraved-feeling ticks, assured neutral typography. Stage remains the loudest object. | Precision scrubber's numeric readout and scale become one clear gesture target; selection uses a deliberately shaped inlay rather than a generic card. | At 390px, inspector must collapse without hiding the numeric value or tool state. |
| **B — Chromatic Optics (selective augmentation)** | Matte workbench with physically plausible light only on glass-like sample wells, active chroma edge and material affordances. Accents follow source/channel semantics. | Color instruments reveal depth through gamut, alpha and compared samples; true scopes are crisp and quantitatively labelled. | Accurate colors, contrast and performance beat glow. Never alter source pixels. |
| **C — Spatial Atelier (posture exploration)** | One composition reorganizes into touch, multi-pane foldable and XR, not a stretched desktop. Stable instrument modules have distinct spatial priority. | A pen-hand inspector can relocate; clips, brush controls and document stay stable through hinge/book/tabletop changes. | Hinge occlusions, hit testing and data persistence on real devices. |

**Decision:** A is the default shared design grammar; B enriches only instruments that communicate chromatic or optical information; C defines responsive/spatial composition rather than a competing theme. Ship no direction until screenshots and tasks justify the choice. The three views must be implemented as original designs; no tracing or HTML-kit conversions.

## Creative review loop (every instrument)

1. **Capture the current truth.** Record real task, current component screenshot, document/engine capability, known bugs, unsupported states, and at least one concrete reference.
2. **Inspect the source.** Use Mobbin to review actual editor screens and flows; link exact canonical screens. Use Dribbble for aesthetic vocabulary, not as evidence of a functioning workflow. Write what is visible versus inferred. Never paste/reference artwork into the public repository.
3. **Make the three directions.** Three native/web-compatible concept compositions for the **same** task and content; write why each differs beyond color or border radius. Prefer one expressive material/behavior per instrument over five decorative flourishes.
4. **Render with real content.** Use the existing Studio host, source media and feature states; preserve meaningful text density and data units. Include normal/selected/focused/disabled/busy/error/empty, touch and keyboard instructions.
5. **Critique independently.** A second reviewer compares the renders to the reference standard and the rest of Forge, with screenshots rather than self-reported quality. Reject generic template defaults, synthetic data presented as real, and beautiful-but-inoperable controls.
6. **Prove the interaction.** Record select > edit > exact input > undo > save > reopen; inspect latency/paint budget and all input modalities. Document unsupported device modes explicitly.
7. **Run the device matrix.** Desktop, tablet, phone, iOS/Android physical native, Surface Duo hinge states and web browsers. XR is a separate capability gate when implemented. Re-review after each responsive recomposition.
8. **Close evidence, not checkboxes.** Only mark a component production-ready when visual quality, engine truth and device accessibility independently pass.

### Critique scorecard

Review each item from 0 (absent) to 4 (exceptional, with evidence). **No score may be inferred from unrun tests or decorative mockups.** A release candidate needs >=3 on every line and no blocker from the functional gates below.

| Axis | Evidence required |
| --- | --- |
| 1. Recognizable Forge family | Studio-wide comparison with at least three different editor surfaces |
| 2. Visual authorship | One distinct material/interaction signature, not a borrowed kit arrangement |
| 3. Content dominance | Artwork, track, page or spreadsheet clearly gets editing priority |
| 4. Precision legibility | Values, units, scale and state visible at compact and comfortable density |
| 5. Interaction affordance | User can predict gesture, target, cancellation and focus feedback |
| 6. Data fidelity | Visualization compared against real engine/media/source output |
| 7. Motion causality | Every transition communicates change; still/reduced-motion state works |
| 8. Responsive recomposition | 390/768/1280/1920 logical-width evidence with no clipped controls |
| 9. Accessibility craftsmanship | Contrast, focus order, spoken labels, keyboard and touch alternatives |
| 10. Production restraint | No excessive glow, filler cards, disconnected accent colors, emoji toolbars or phantom status |
| 11. Professional workflow | Successful full edit/undo/save/reopen on actual document session |
| 12. Suite coherence | Docking, inspect, time/numeric semantics and command patterns consistent across app boundaries |

**Gate A: design:** >=36/48 total, with each axis >=3 and independent critique notes. This is a design-review threshold, not an award claim.

**Gate B: engineering:** actual native/web renders, physical input and accessibility checks, engine-backed edits, undo/save/reopen, no fake signal data, memory/performance traces, color accuracy where relevant, failure recovery and packaging. A high visual score never replaces Gate B. A passed unit test never replaces visual evidence.

## Studio-specific evidence to request

| Studio | Showcase exercise | Instrument-specific fidelity |
| --- | --- | --- |
| Prism | Paint or select layer, change color and exact opacity, inspect undo | Brush pressure, selection, real gamut/profile and compositing |
| Cadence | Zoom multitrack waveform, set gain, scrub by bars/beats, automate | Peak/RMS and musical clock come from actual audio project |
| Splice | Frame-trim clip, drag playhead, compare grade, undo | Rational frame clock, actual preview frames and scope signal |
| Quill | Edit multi-page writing, style paragraph, review history | Reading typography, cursor position and pagination without clutter |
| Tally | Enter formula, trace dependencies, inspect range and fix error | Keyboard navigation and exact cell reference semantics |
| Pitch | Align objects, animate transition and preview a slide | Vector precision, timeline and presenter stage clarity |
| Folio | Review annotated page and prepare export | True page rendering, provenance, warnings and visual comparison |
| Board | Draw with pressure/tilt, pan canvas, dock layers while folding | Stylus latency, cancel semantics and real hinge-safe pane recovery |

## Required evidence packet (per PR)

- `docs/ux/reviews/<instrument>-DIRECTION.md`: actual task, three concepts, selected direction, rationale, references with exact Mobbin links, originality note.
- `docs/ux/reviews/<instrument>-CRITIQUE.md`: 12 scored axes, independent reviewer, before/after observations, unfinished defects.
- Screenshot and short interaction capture paths: desktop 1920/1280, 768, 390; iPad/Android; light/dark; compact/comfortable; high-contrast and reduced-motion when available. Include device/OS/app-build metadata; do not vendor licensed reference screenshots.
- Engine proof: operation names, test command and run URL, actual round-trip and undo evidence, performance measurement and unsupported capability list.
- Any license/permission restrictions and provenance for fonts, artwork, screenshots or sound samples.

## Subagent ownership, not speculative signoff

Design lead owns the suite language; source researcher owns Mobbin/Dribbble notes; interaction architect owns states/precision/input; platform lead owns SwiftUI/Compose/web adaptation; native renderer owns Skia and document pixels; accessibility reviewer verifies parity; independent visual critic scores rendered outputs; QA lead captures physical devices and build proof. Subagents report what they *observed and ran*, never infer a pass from another workstream's plan.

## Practical first slice

**Prism precision opacity** from PR #32 is the first checkpoint. Capture the actual existing component and build the three original compositions without changing the Rust command. Compare side-by-side in all four widths; then improve its visual weight, focus, response and exact-input states. Next repeat the method for **Splice waveform/playhead** and **Cadence fader/mixer** with the media UI groundwork in PRs #24–#26.

The commercial Web Designer Pro ZIP remains only a **local research input**, never committed or executed in CI. Its product assumptions (marketing heroes, photo-based landing pages, conversion copy) do **not** override the precision, trust or native interaction needs of creative software.
