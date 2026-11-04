# Affinity editor feel

User request, November 3, 2026: make Studio feel like the new Affinity application,
using Craft Anything. “Infinity” was interpreted from the user's earlier official
Affinity iPad reference. The application editor imagery, rather than its marketing
page layout, is the design reference.

## Evidence and decisions

Craft Anything v0.3.0 captured the official iPad page in Clean room mode. Public
editor images identified by that capture were inspected: Pixel/Curves,
Vector/Logo and Layout/Pages. Exact public URLs and file hashes stay in
`artifacts/craft-anything/inspection/affinity-app-images/provenance.json`.

The visible recipe is a continuous canvas behind floating charcoal controls:
small rounded ribbon, narrow creation-tool capsule, detached contextual panels,
blue selection and modest fine outlines. Reference images and branding are not
included in product code. Studio uses its existing canonical NYC components.

Prism changes:

- Local graphite/blue palette, inset rounded document header, compact file actions.
- Generic panel toggles remain in Workspace; the duplicate outer rail and compact
  bottom panel navigation no longer occupy the canvas.
- Compact selected-layer ribbon, creation-tool capsule and detached Layers panel.
- Artboard fits the editor's measured width and height, preserving document ratio.
  This changes canvas presentation, not native app window dimensions/orientation.
- Stationary floating fill strip; feedback appears above it without shifting
  controls or changing the measured host geometry.
- Opacity uses the canonical native/browser Menu with neutral row presentation.
  Layer ordering retains the shared dock drag controller and measurement guards.

Only real supported actions are shown. No decorative Affinity mode tabs, filters,
curves or editing tools were introduced. Engine document operations and separate
application sessions retain their existing authority.

## Review and validation

Craft Anything's local Studio walkthrough runs use private browser profiles,
with screenshot capture only and network/body/event capture disabled. Local
inspection runs use normal mode so actual clicks are available; the public
reference session remains Clean room. No nested builder or global registration.

Round 1 created a violet rectangle, selected teal, and created an ellipse through
actual engine operations. All actions passed at390/768/1440. Main agent and an
independent critic inspected the images. Findings: the selected-layer strip was
too wide and the opacity field too vivid. Round 2 shortens that capsule, uses a
neutral Menu trigger and keeps the fill strip stationary. Compact final capture
closes Layers so the edited artwork is visible.

The round 2 opacity click was not counted as passing: the tool dispatched the
click, but the engine value stayed at100%. A focused open-menu screenshot
confirmed that the popup was clipped by the Layers panel overflow boundary.
This required a real popup layout fix and another observed engine check;
completed tool steps alone are insufficient verification.

Workspace tests (21), all package typechecks, the production preview build and
seven-engine integration checks passed. The integration covers actual Prism
compositing, opacity, layer order/undo and PNG/snapshot behavior. Existing build
chunk-size warnings remain. Native runtime, physical input, screen readers and
the full OS/browser matrix have not been run. Browser screenshots establish
rendered appearance and the exact recorded actions, not Affinity feature parity.

## Final observed proof

Round3 fixes the popup boundary: Opacity sits above the measured layer-row
scroller, the panel allows its popup to overflow, and only rows retain clipping.
Actual open-menu screenshot confirms all five options are visible. After selecting
50%, tablet and desktop images show both the control and selected layer at50%,
with the engine composite visibly blended. Phone shows that changed composite
and the confirmation after closing Layers. Main agent and continued critic
inspected all three final images; no remaining major visual regression in those
captures. The independent critic confirmed the compact ribbon, neutral opacity
control, stationary fill palette and visible phone artwork.

Committed screenshots:

- `docs/ux/evidence/prism-affinity-feel-390.png`
- `docs/ux/evidence/prism-affinity-feel-768.png`
- `docs/ux/evidence/prism-affinity-feel-1440.png`
- `docs/ux/evidence/prism-affinity-opacity-menu.png`

Raw tool runs, per-step screenshots and parameters remain ignored under
`artifacts/craft-anything/affinity-feel-r{1,2,3}`; focused clipped-menu diagnosis
is in `affinity-feel-r2-menu-debug`. Final1440 evidence:
`ev_20dac44e8bbe3764d36a81276e714d06cd71359a462a719855667197ce0a18bc`.
Craft Anything summaries retain the initial launch subject `about:blank`; recorded
step URLs and screenshots identify the actual local Prism editor.

Final workspace21 tests, typecheck and production build passed after the popup
fix. No native runtime or complete device/browser matrix pass is claimed. The
canonical popup's own district styling remains source-owned NYC UI.

## Canonical control finish — November 3, 2026

The next review compared the actual editor imagery on the
[official iPad page](https://www.affinity.studio/ipad-app), plus Mobbin
[Photoroom](https://mobbin.com/screens/17875c39-0946-4b6b-a760-bb3868918e01)
and [Canva](https://mobbin.com/screens/a7d2e8f9-cf06-4b76-bd09-50d1a2315114)
layer references. The remaining mismatch was the prominence of branded UI:
bold display labels, saturated full-width tabs and stacked panel keylines.
This is an evolution of the chosen editor direction, retaining its typography
family, graphite ground and blue selection, rather than three unrelated concepts.

The canonical NYC components now own opt-in Studio appearances: compact sans
button labels, neutral segmented choices, restrained inspector headings and
12/13px field labels/values. Menu popups use a graphite browser facade while
native menus remain OS-owned; feedback banners retain status colors and live
regions with compact sans labels. Compact TabBar uses a graphite face and a thin blue
active mark; compact Toolbar removes its heavy cornice. Shared native/browser
bindings consume these same components. Default branded appearances remain
available to other consumers. Studio's 4px corners and 44pt hit targets remain.

Prism selection uses a subdued tinted layer row with a thin blue edge. A narrow
wide-screen panel capsule exposes Properties, Commands and History directly;
the Workspace menu remains available at every width. The artboard can grow to
900px while its measured width, height and document ratio still bound it. This
changes editor presentation only. It adds no unsupported editing tools.

Rea 6.8.0 executed a fresh inert analysis of 21 workspace source files with zero
parse errors. Its 326 observations are static facts, not defects or runtime proof.
External graph coverage remains partial. See `rea-workspace-summary.json`.


Final Craft Anything review: six successful first-round cases, then five
successful final cases at1440/768/390 and in light theme. Actual edits create a
rectangle and ellipse, set50% opacity, and open/close Properties to restore
canvas space. The first round's menu and Badge findings were fixed and inspected
again. Final critic scores were4/5 for hierarchy, type, colour, finish, craft,
responsive behavior and retained functionality; screenshot memorability was3/5.
No remaining must-fix defect was observed in those states. This is bounded
Chromium proof; no full platform-matrix or native-runtime pass is claimed.
One final standalone desktop WebSocket failure was excluded; the extended
desktop editing flow subsequently succeeded. Raw results and both critique
rounds remain in ignored `artifacts/craft-anything/affinity-evolution-r{1,2}`.
Representative final screenshots are `docs/ux/evidence/affinity-studio-*.png`.
