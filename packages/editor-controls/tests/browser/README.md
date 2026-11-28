# Editor controls rendered web acceptance

These fixtures bundle the `@nitro-forge/editor-controls` sources (`../../src`)
and the demos in `../../examples/native-instruments` through React Native Web
in Chromium. NYC-Tron UI's general primitives (Button, TabBar, Select, the
gesture and shell helpers the controls import) come from the installed
`@nyc-tron/ui` release pinned in [`tooling/nyc-tron.json`](../../../../tooling/nyc-tron.json),
with [`patches/@nyc-tron__ui@1.0.0-rc.2.patch`](../../../../patches/@nyc-tron__ui@1.0.0-rc.2.patch)
applied, resolved through its exports map to its compiled `dist` files.

The lane, its specs and most fixtures came from NYC-Tron UI
([mikevocalz/NYC-Tron-UI](https://github.com/mikevocalz/NYC-Tron-UI)) at commit
[`5a1ea4db`](https://github.com/mikevocalz/NYC-Tron-UI/tree/5a1ea4db/packages/ui/tests/browser),
directory `packages/ui/tests/browser`, when the editor controls moved here from
`@nyc-tron/ui/components/forge`. NYC-Tron UI is MIT licensed, like this
package. Changes from that commit:

- Fixtures import the controls from `../../src/<path>` (they imported
  `packages/ui/src/components/forge/<path>`) and Tron's general components
  from `@nyc-tron/ui/components/<path>`. Pages built on a Lab demo import it
  from `../../examples/native-instruments`.
- Pages that exercised both kinds of component were split, and each lane kept
  its half: `fixture.tsx` (NativeSeekBar and LayerStack here, PrecisionScrubber
  and DragGrabHandle in Tron), `studio-gaps` (the LayerStack panel here, the
  TabBar and Select panes in Tron), `workspace5` (ColorPickerDialog and the
  presenter ink here, the workspace host and file transfer in Tron) and
  `media6` (the audio interruption recovery dialog here, the web media decoder
  in Tron). `spreadsheet.tsx` moved into `fixtures/`.
- `server.mjs` resolves `@nyc-tron/ui/*` and `@nitro-forge/editor-controls/*`
  (the demos import this package by name) through `packages/editor-controls`'
  exports maps, takes the gesture handler and Skia from
  `packages/editor-controls/node_modules`, and has Tailwind scan `../../src`,
  the demos, these fixtures and the installed `@nyc-tron/ui` `dist` (Tron's
  primitives carry their own class names). The default port is 4189.

Tron's own lane, for its general components, stays at
[`packages/ui/tests/browser`](https://github.com/mikevocalz/NYC-Tron-UI/tree/main/packages/ui/tests/browser).
The theme tokens in `theme.css` are the reference values from NYC-Tron UI's
[`docs/THEME_TOKENS.md`](https://github.com/mikevocalz/NYC-Tron-UI/blob/main/docs/THEME_TOKENS.md).
`rn-shim.tsx` forwards `className` to React Native Web as precompiled classes,
standing in for the consumer's Uniwind runtime, and `uniwind-shim.tsx`
reproduces Uniwind's web `ScopedTheme` output.

Install the Forge workspace first (`corepack pnpm install --frozen-lockfile
--ignore-scripts` from the repository root), then, in this directory:

```sh
npm ci --ignore-scripts --no-audit --no-fund
npx --no-install playwright install --with-deps chromium
npm test
```

Set `UI_ACCEPTANCE_PORT` to run the lane on a port other than 4189.
`fixture.tsx` is served at `/` and each `fixtures/<name>.tsx` at `/<name>`.
Captures go to `shots/` and are uploaded as a CI artifact
(`.github/workflows/editor-controls-browser.yml`), not compared as pixel goldens.

`fixture.tsx` renders `NativeSeekBar` and `LayerStack`.
`seekbar.spec.mjs` checks that `NativeSeekBar`'s step buttons and timecode sit
on one row under the slider at 390px and 834px ([NYC-Tron UI #27](https://github.com/mikevocalz/NYC-Tron-UI/issues/27)), that the buttons step
the controlled frame, and that a mouse drag previews on each frame but commits
once on release, as does one arrow-key press. It renders the web build
(`src/NativeSeekBar.web.tsx`) over the `@expo/ui` 58.0.28 universal web build;
`.npmrc` keeps npm from installing that package's `expo` and `react-native`
peers, which the web build does not import.
`layers.spec.mjs` covers LayerStack kind labels and thumbnails, removal by
pointer, Enter and Delete, the fixture's undo, and locked rows refusing removal.
`shots.spec.mjs` captures the seek bar and the layer stack (with a focused
remove button) light and dark at 390 px and 834 px, plus the stack in RTL.

`fixtures/color.tsx` renders the color cluster against one zustand color store; `color.spec.mjs`
drags the disc, ring and tracks, cancels with Escape, types channel values,
swaps chips, searches swatches and undocks the palette past a simulated hinge.
`color-shots.spec.mjs` captures each palette mode at both widths in both themes,
floating, and in RTL.

`fixtures/timeline.tsx` renders the timeline core over a seconds-based
stand-in for Splice that applies each `TimelineEdit` as `moveClip`,
`trimClip` and `splitClip` in the order the edit names. `timeline.spec.mjs`
moves, trims, splits, seeks, marks, zooms and pans with a real mouse and
keyboard; `timeline-shots.spec.mjs` captures both widths in both themes, NTSC
drop-frame with a scope matte, and RTL.

`ink.spec.mjs` loads `/ink` (`fixtures/ink.tsx`, which plays the Forge
board host) and checks `InkToolbar`: the tool radio group, disabled redo
explaining itself, size, color and pressure intent, in-toolbar shortcuts and
44 px targets. It writes `shots/ink-*` captures in light and dark at 390 px (top
bar) and 834 px (right rail), with keyboard focus and the notice line, plus RTL.

`spreadsheet.spec.mjs` loads `/spreadsheet` (`fixtures/spreadsheet.tsx`), the spreadsheet
cluster on a 1,048,576 × 16,384 sheet: bounded rendering while scrolled to row
500,001 (I-01), fill-handle drag and Ctrl+D (I-02), reference outlines and
colored formula text (I-06), SheetTabs select/add/rename/remove with name
validation and a rejected engine call (I-08), ChartBuilder gallery, cell cap and
summary (I-13), SparklineEditor validation and the in-cell sparkline (I-14),
freeze commands and the split divider's keyboard value (I-17), and card
open/step/edit with a rejected commit (I-20). It writes `shots/spreadsheet-*`
captures (light and dark at 390 and 834 px, tabs open, split, card, RTL).

`mixer.spec.mjs` loads `/mixer` (`fixtures/mixer.tsx`), with a zustand store standing
in for the Cadence engine: fader and pan drags commit once, mute/solo with the
silenced-by-solo description, pan arrows and Home, a piano-roll note drag
that commits time and pitch together, Shift+arrow resize, Delete, audition,
a velocity bar drag, step toggles and the A accent key, tap tempo committing
once after the taps stop, time signature and metronome, and a waveform
window scroll plus seek. It writes `shots/mixer-*` captures (light and dark at
390 and 834 px, focus states, RTL) and asserts no horizontal page scroll and
that musical time stays left to right in RTL.

`fixtures/office.tsx` (`/office?part=slides|document|pdf`) renders the office
cluster against in-memory hosts. `office.spec.mjs` drags a slide object onto a
neighbour's edge (snapping), nudges, rotates and deletes it, resizes by the
corner, checks the canvas is not mirrored in RTL (J-05); reorders the filmstrip
by key and by grip on a horizontal phone strip (J-01); range-selects and moves
a block in the sorter and refuses to delete every slide (J-02); validates and
adds animations, including an engine rejection that keeps the form (J-09);
turns a mixed bold selection on and sets color and size (H-03); outdents under
the nesting policy and renumbers (H-07); jumps, collapses and pages through the
outline (H-15); plays, skips and changes speed by key (H-21); searches from
page 2 with page-ordered hits and wrap (K-04); picks tools by letter (K-06);
filters, replies, resolves and deletes comments, and keeps a reply whose save
failed (K-07); and steps pages and shows the no-voice state (K-18).
`office-shots.spec.mjs` writes `shots/office-*` at 390 and 834 px in light and
dark, RTL, search results and text editing.

`fixtures/pairing.tsx` (`/pairing?state=idle|scanning|system-pairing|connecting|awaiting-input|connected`)
renders `DevicePairingDialog` for a pen host that logs each callback.
`pairing.spec.mjs` checks that Stop searching and Close reach different
callbacks, that a linked dialog closes without stopping, the ordered
system-pairing steps and Open Settings, the idle-only intro, 44 px targets and
no horizontal scroll, and writes `shots/pairing-*` captures at 390 and 834 px in
light and dark plus RTL.

`fixtures/timeline2.tsx` renders the second timeline cluster with controlled
Zustand state and a seconds-based engine stand-in. `timeline2.spec.mjs` covers
rename commit-once with a delayed response, marker drafts and Escape, slip and
locked-track refusal, loop drag/cancel, transition application, marker creation,
batch transactions and compact LTR/RTL track settings. `timeline2-shots.spec.mjs`
writes 13 light/dark phone/tablet and RTL review captures. Actual Rust handoff
is checked in Forge's Splice tests, not by this browser stand-in.

`workspace5` covers the color dialog's preview, cancel and apply, and presenter
ink: one commit per stroke, Escape cancel and the eraser. `studio-gaps` checks
that LayerStack rows fit 320, 360 and 390 pt panels with name and remove
visible, that narrow rows open an opacity scrubber popover that commits once
and restores focus, and that a locked row's readout is disabled. `media6`
covers AudioInterruptionRecoveryDialog: a waiting interruption cannot resume,
a recovered recording needs an explicit keep or discard, output loss never
resumes on its own, and a rejected resume stays open with the error.

Every other page is driven by the spec of the same name, with a `-shots` spec
where it captures review images: `analysis`, `automation`, `eqdyn`, `midi2`,
`mixer2` and `routing` (audio and MIDI), `canvas-guides`, `canvas-navigation`,
`gpu-canvas` (Skia's CanvasKit, served at `/skia/canvaskit.wasm`),
`selection-bounds`, `selection-tools`, `multi-selection` and `vector` (canvas
and vector), `color-adjustments` and `color-management`, `layer-panels`,
`layer-tree`, `layer-blend` (with `layer-blend-alpha`), `mask-clip`,
`panel-layout`, `thumbnail-ownership` and `artboard` (layers), the four
`photo-*` pages, `composition-tree` and the eight `motion-*` pages.

Not covered: iOS/Android rendering, native drag and drop, Uniwind itself, the
GestureHandlerDrag transport, screen readers, Safari and Firefox. The stand-in
Zustand hosts are separate from Forge's real-engine tests (Splice, Cadence,
Prism and the others are checked in their own packages).
