# Cross-platform GUI acceptance and gap register

Date: 2026-11-05. Status: required acceptance policy; runtime certification NOT RUN.
Applies to all 341 A–N inventory contracts and every future component. The roster is
`docs/COMPONENT_MASTER_INVENTORY.md` on branch
`feat/artcraft-android-expo58-native-signal-seed-2026-11-03` (PR #24, open, not on master).

## Ownership and release rule

NYC-Tron UI owns shared visuals, native controls, theme slots and interaction policies.
Nitro Forge owns Rust document state, processing, engine bindings, persistence and undo.
Do not introduce duplicate visual controls in Forge or app-specific copies.
Consumers import individual NYC-Tron controls and only the Forge engines they need.
Preserve Tailwind/Uniwind customization, semantic tokens and original premium design.

A component is complete only after its real behavior passes on every required target.
Expo Modules v2 and Nitro v1 are implementation choices, never proof of platform parity.
A .native file, platform flag, typecheck, CLI test, stub, disabled control or screenshot
does not establish native integration. Hardware-specific extensions may be unavailable
with a truthful reason; required editing workflows must still work using supported input.
Do not quietly redefine a missing required workflow as an optional capability.

## Required target matrix

| Target | Required evidence |
| --- | --- |
| iOS and iPadOS | Actual compiled consumer; touch, keyboard, Pencil where applicable; resize, lifecycle and accessibility |
| Android phones/tablets | Actual compiled consumer; touch, keyboard/stylus, lifecycle and accessibility |
| Surface Duo and Android foldables | Separate folded/unfolded, hinge/occlusion, rotation and multiwindow acceptance; document session survives changes |
| Web | Browser runtime and actual processing adapter; SSR/import safety; touch/keyboard/pointer; no native-only eager imports |
| macOS | Actual desktop build and AppKit/RN macOS adapter; menus, focus, file lifecycle and keyboard |
| Windows | Actual desktop build and RN Windows/WinUI adapter; menus, focus, file lifecycle and keyboard |
| visionOS | Actual spatial adapter/build; gaze/pinch, focus, window lifecycle and reachable controls |
| Meta Quest and PICO | Separate runtime/device results; controllers/hands, panel lifecycle, spatial input and GPU resource cleanup |

Linux/QNX/Marathon consumers must receive separately named adapter and acceptance rows
before support is advertised; Android or browser results do not certify those native targets.
Watch companions expose deliberately scoped companion APIs, not fictitious full editor parity.

Official Expo documentation describes macOS/tvOS support as experimental and warns that
Apple platform aliases alone are insufficient. Verify each pinned module version and target:
https://docs.expo.dev/modules/overview/
https://docs.expo.dev/modules/additional-platform-support/
Never assume Swift/Kotlin views automatically implement Windows, web or XR.
Use dedicated supported adapters behind the same public contract where necessary.

## Per-component evidence record

Record component ID, visual owner, engine owner, public import, pinned source SHA,
engine operations, target adapter path, build command/result, real interaction evidence,
accessibility, lifecycle, performance workload/results, and remaining blockers.
Use planned / implemented-unverified / verified / blocked per target.
Verified requires links to evidence at the tested commit, device/OS/runtime versions,
and the exact workflow. A later change invalidating that workflow requires retesting.
Aggregate completion cannot be true while any required target is blocked or unverified.

Acceptance must cover:
- real read/edit/commit/undo/redo/save/reopen, including rejection and cancellation;
- one committed engine transaction per gesture and atomic multi-property edits;
- IME composition, RTL, large text, screen readers, focus restoration, reduced motion;
- touch, keyboard, mouse, stylus and target-specific spatial input;
- constrained panes, virtualized content, fold changes and external displays;
- bounded memory, measured frame/latency budgets, background/resume and resource cleanup;
- independently importable packages and consumer integration with no optional-runtime leakage.

This document is a review policy, not an automated CI enforcement implementation.
Follow-up CI must consume per-component evidence records, reject missing target rows
and prohibit aggregate complete status without all required verification. Human/device
evidence remains necessary; a JSON validator cannot certify functional parity.

## Advanced GUI gaps against the 341-contract roster

These are capabilities missing as explicit contracts or insufficiently specified in the
original roster, not claims that no current branch contains related code.
Do not inflate 341 by counting extensions as new components. Reconcile NYC-Tron exports
and active PRs before assigning final component IDs.

| Capability | Extend existing IDs | Required behavior |
| --- | --- | --- |
| Multiwindow workspace and detachable documents | A-01, A-03, A-05 | Window ownership, detach/reattach, close veto, shared document session, crash recovery |
| External-display stage/presenter routing | A-01, J-12, N-09 | Separate presentation output, reconnect, DPI changes, safe window placement |
| Unified command registry and native menu bar | A-18, A-19, A-27, N-07 | Menu/toolbar/palette shortcuts share enabled, checked and busy state; app menu integration |
| Cross-app drag/drop and rich clipboard | B-07, I-07, N-12 | Typed text/image/vector/cell payloads, paste-special, cancellation, file promise handling |
| IME-aware native text bridge | H-01, H-02, H-04 | Composition ranges, grapheme boundaries, bidi selection, marked text and dictation |
| OpenType and variable-font controls | H-04 | Font discovery, missing-font resolution, axes, ligatures, glyphs and font fallback visibility |
| Virtualized tree-grid / outline | B-09, G-01, L-01 | Large hierarchical data, columns, lazy children, keyboard reorder and accessible selection |
| Expression-aware numeric inputs | A-12, A-13 | Safe unit expressions, mixed values, relative edits and validation without arbitrary code execution |
| Customizable radial/marking menu | A-06, A-19, B-34 | Pen/touch quick actions, keyboard alternative, conflict handling and customization |
| Workspace minimap / navigator | B-14, G-14, M-10 | Large-canvas/node navigation, viewport rectangle and accessible zoom/pan |
| Accessible graph editing | G-14, M-10 | Typed ports, cable search, keyboard connect/disconnect, cycle validation and transactional undo |
| Resource relink and dependency inspector | A-22, D-29, N-14 | Missing fonts/media/assets, relink previews, proxy/original identity and portable packaging |
| Recovery and document conflict resolution | A-24, N-10, N-11 | Local recovery previews, revision comparison, conflict choices and transactional restoration |
| Panel portal and overlay coordinator | A-19, A-20, N-08, N-09 | Nested focus, clipping escape, safe anchoring, dismissal, hinge avoidance and spatial occlusion |
| Toolbar and shortcut customization | A-06, A-07, A-27, N-07 | Command rebinding, conflict warnings, import/export, reset and per-workspace persistence |
| Unified pressure/tilt/twist calibration | B-17, N-03, N-04 | Device-specific profiles, input prediction, cancellation and truthful hardware capabilities |
| HDR/display proofing diagnostics | C-08, C-09, C-25 | Display capabilities, output transform, clipping and reference comparisons |
| Job queue and resource monitor | A-26, D-29, G-15, N-13 | Concurrent job budgets, pause/cancel/retry, progress from real work and resumable exports |

Priority: implement multiwindow/commands/clipboard/IME/overlay coordination first; the
menu, palette, text and popover rows above all depend on them. Then font tooling, tree grids, resource relink
and recovery. Extend specialized graphs, pen, color and spatial behavior alongside the
relevant engine/backend work.

## Evidence reviewed

- `docs/COMPONENT_MASTER_INVENTORY.md` on the PR #24 branch (audit 2026-11-03, reconciled
  2026-11-04): 341 planned/unverified contracts, P0 196 / P1 128 / P2 17.
- Forge master AGENTS, ARCHITECTURE, ENGINE_OPS and ROSTER.
- Forge PR #38 (open): reusable controls live in NYC-Tron; Forge imports NYC-Tron, never the reverse.
- Forge PR #40 (open) `docs/ADVANCED_NATIVE_PORT_ROSTER.md`: visual ownership and missing backend operations.
- Forge PR #43 (open): Rust-backed Cadence consumer; platform integration still gated.
- Forge PR #44 (open): native linkage work; physical-device acceptance remains pending.
- NYC-Tron main README: shared visual ownership; status "foundational extraction (not
  published/native-certified release)".

No runtime changes or physical-device tests are included in this documentation change.
