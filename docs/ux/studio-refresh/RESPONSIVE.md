# Responsive Studio verification

User request: ensure the Affinity-style workspace is responsive (November 3, 2026).
This is Prism/browser evidence, not a claim that all products or native devices
were audited. Native app window dimensions, orientation and manifests remain
unchanged.

Craft Anything's private browser walkthroughs use actual engine shape creation,
fill selection, opacity commands and Layers dismissal. The matrix uses CSS-pixel
viewports: 320×480, 320×568, 390×667, 844×390, 1024×768 and 1440×900.

## Reproduced failures

- At 320×568, the Save control extended beyond the right edge.
- At 844×390, the artboard shrank to26×26 because the short-height layout reserved
  another tool row above the canvas plus excessive bottom space.
- Opacity options could fall below the viewport; at320×568 a feedback overlay
  also obscured an option.

Baseline images and exact tool parameters remain in ignored
`artifacts/craft-anything/responsive-r1/baseline`.

## Corrections

The measured narrow Prism header keeps Back, document title and Save in its
primary row. Below 380px, host Preview/theme controls use a secondary row, or the
existing toolbar in short windows. File/edit actions remain horizontally
scrollable rather than shrinking their touch targets.

`prism-layout.ts` derives canvas, panel and palette geometry from the available
editor viewport. Short windows keep the creation tools vertical and reserve only
necessary context/palette space. The 844×286 editor case now fits a 142px square
artboard. Short narrow palettes stay beside the tool capsule and use the native
horizontal ScrollView for overflow. Layers gets a taller usable region in short
windows and its popup sits above feedback.

The canonical NYC browser Menu measures its trigger and visual viewport, clamps
width, chooses the available side, and bounds a scrollable popup height. Browser
Popover support puts it in the top layer; a fixed-position fallback remains.
It updates on open, resize and viewport/ancestor scroll. Native OS menus remain
unchanged. Popup positioning and resources are imperative refs, not serialized
application state. No React useState or new dependencies.

## Checks

Four Prism geometry regressions cover the short-landscape defect, available
width/height across document aspect ratios and viewport sizes, short narrow
raster palette clearance, and invalid aspect input. Workspace suite: 25 tests and
typecheck passed. Canonical Menu has three geometry regressions; NYC full UI
typecheck and scoped lint passed. Actual final browser results are recorded below.

Native runtime, browser/OS matrix, touch hardware, screen readers, and zoomed
visual viewport behavior are not asserted from these Chromium checks alone.

## Final results

All six viewport fixtures completed with visible Save/header controls, a fitted
canvas and usable floating panels. Actual engine edits were observed: rectangle,
teal ellipse, opacity 100% then 50%, and unchanged artwork after dismissing Layers.
At 844×390 the bounded menu scrolls; keyboard focus first revealed the off-screen
option, followed by a visible pointer click that committed the engine change.
Keyboard-only activation was not verified: Craft Anything's press action also
failed to activate the ordinary Rectangle button. No broader accessibility pass
is inferred. One interrupted 1024×768 walk was rerun with the source frozen;
the independent retry completed and its actual opacity states were inspected.

All six application-directory captures fit their viewport widths. Below-fold
list scrolling was not explicitly walked. Success confirmations now clear after
2500ms without changing document state or geometry; errors remain visible.
Focused 320×480 and 844×390 clean-canvas captures verify that confirmations no
longer persist over the artboard.

The original responsive pass used canonical UI commit
`c8ac0ddab89076eb4bc28036c5befd7d7d4ab70c`. The current integration pin and
publication status are documented in OWN_UI_INTEGRATION.md. No remote CI run
is claimed for this responsive pass.

Final checks: all root package typechecks, 25 workspace tests, visual import
boundary and preview production build passed. NYC UI full typecheck, three new
Menu geometry tests and scoped lint passed. Existing bundle-size warning remains.
Raw scripts, exact parameters, screenshots and retry evidence remain under
`artifacts/craft-anything/responsive-r1`; final selected images are in
`docs/ux/evidence/prism-responsive-*.png`.


## Stable tablet canvas follow-up

Layers starts closed when the measured editor is narrower than1100px. Opening
it overlays the artboard on tablet/phone editors; its width, height and position
stay fixed. Wider editors retain reserved space beside Layers. Resizing does
not overwrite an explicit open/close choice. This threshold describes editor
space, not native app window size or orientation.

The geometry regression checks identical artboard dimensions and all placement
insets with Layers closed/open at716px,972px and390px editor widths, plus the
reserved desktop case. All29 workspace tests, all package typechecks, the UI
boundary check and preview production build passed. Browser observation is
recorded below after inspection; no native runtime pass is inferred.


Four fresh Craft Anything scenarios passed at768×1024,1024×768,390×667 and
1440×1000. Actual captured DOM artboard dimensions and parent insets match with
Layers closed/open/closed on overlay layouts:608px portrait tablet,484px
landscape tablet and294px phone. The wide desktop retains its312px right inset
when open and restores20px when closed. Screenshots confirm actual50% engine
opacity and the larger tablet canvas. Main agent and independent reviewer
inspected full-size images. The768px tablet artboard is608px wide, versus315px
in the previous Layers-open default.

The tool's immediate response budget was exceeded by per-step DOM/PNG output;
supported saved-evidence pagination recovered the successful steps and images.
This is not counted as an application failure. Raw proof:
`artifacts/craft-anything/tablet-canvas-r1/verified-summary.json`.
Portable successful script: `apps/studio-preview/qa/affinity-editor-tablet.json`.
Representative images: `docs/ux/evidence/prism-tablet-*.png`.
