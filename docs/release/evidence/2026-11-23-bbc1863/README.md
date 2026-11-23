# F3 deferred rows: re-run at bbc1863, 2026-11-23

Evidence commit: `bbc18637e59244bdc3c94634ca8d927280f22ec2`, the head of
`claude/blissful-faraday-5jovmd` fetched on 2026-11-23 and checked out as
`f3-gate-evidence`. Every command below ran on that checkout with no source
edits. The only new file outside this folder is
`apps/studio-preview/verify-f3-rows.mjs` (see I-15/E-35 browser check).

This is a fresh execution record for gate F3's three rows (I-15, E-35, B-11).
It is not a reviewer signature, and it does not change
`docs/release/v1-readiness.json`.

## Environment

- Linux (cloud container), kernel 6.18.44.
- Node `v22.23.5`. The repository asks for `>=24.3.0` (`package.json`
  `engines.node`); every run here used 22.23.5, below that floor.
- pnpm 12.18.0 (as reported by `pnpm install`), cargo 1.97.0.
- Chromium: `/opt/pw-browsers/chromium-1243/chrome-linux64/chrome`
  (Google Chrome for Testing 153.0.8010.12), headless, driven by Playwright 1.62.1.
- Setup: `pnpm install --frozen-lockfile` (done, lockfile unchanged) and
  `cargo build --locked -p nf-cli` (finished; `cadence-engine` printed 3
  compiler warnings).

Full logs are in `logs/`. Pass/fail counts below are copied from them.

## Commands and results

| Command | Result |
|---|---|
| `cargo test --locked -p tally-engine` | 231 passed, 0 failed, 0 ignored (unit); doc-tests 0 |
| `cargo test --locked -p cadence-engine` | 78 passed, 0 failed, 0 ignored; doc-tests 0 |
| `cargo test --locked -p nf-sys` | 29 passed, 0 failed, 0 ignored; doc-tests 0 |
| `cargo test --locked -p prism-engine` | 177 passed, 0 failed, 0 ignored; doc-tests 0 |
| `apps/studio-preview`: `npx vitest run tests --reporter=verbose` | 2 files, 6 tests passed |
| `apps/studio-preview`: `node --test src/*.test.ts` | 34 passed, 0 failed |
| `packages/studio-workspace`: `pnpm test` | 157 passed, 0 failed |
| `apps/studio-preview`: `node verify-prism-blend.mjs <this folder>` | 5 of 5 scenarios PASS |
| `apps/studio-preview`: `node verify-f3-rows.mjs <this folder>` | 2 of 2 scenarios PASS |

Both browser scripts ran with
`PLAYWRIGHT_CHROMIUM_EXECUTABLE_PATH=/opt/pw-browsers/chromium-1243/chrome-linux64/chrome`.
Each starts its own Vite dev host; the host serves the real engines through the
loopback nf-cli bridge (`/api/engine`).

## I-15 Tally PivotFieldList

Engine (`logs/cargo-tally-engine.log`, all `ok`):
`pivot_ops::tests::empty_filter_means_all_and_round_trips`,
`pivot_ops::tests::insert_validation_is_atomic`,
`pivot_ops::tests::refresh_honors_columns_filters_sort_and_all_aggs`,
`pivot_ops::tests::undo_redo_restores_specs` and the other 15 `pivot_ops` tests.
C ABI (`logs/cargo-nf-sys.log`):
`ffi_v1::tests::v1_ffi_carries_cadence_markers_and_tally_all_filter ... ok`.

nf-cli e2e (`logs/vitest-preview-verbose.log`):

```
✓ tests/f3-rows.e2e.test.ts > I-15 PivotFieldList wiring on Tally > a filters assignment stores an "All" filter and refreshes to the unfiltered grid 11ms
```

Node tests: the studio-preview `I-15` subtests are among the 34 passes
(for example `ok 27 - I-15 reads the sheet pivot and per-column numeric flags from computed values`).

Browser (`logs/verify-f3-rows.log`), Tally at 1280x1000, visible controls only:

1. Typed A1=5, A2=7, A3=`=SUM(A1:A2)` in the formula bar; A3 reads 12.
2. Name box `A1:A3`, Go to range, Pivot tab, "Use selection as pivot source".
3. "Add Column A to filters": the panel still reads "Draft pivot over A1:A3"
   and no pivot write reached the bridge (host keeps the draft).
4. "Add Column A to values": exactly one `insertPivot`, observed payload
   `{"pivot":{"source":{"sheet":"Sheet1","range":{"from":"A1","to":"A3"}},"rows":[],"columns":[],"values":[{"field":0,"agg":"sum"}],"filters":[{"field":0,"values":[]}],"output":"C1"},"sheet":"Sheet1"}`.
   The filter's value list is empty ("All").
5. "Refresh pivot output": C1 `sum:0`, C2 `24` (5 + 7 + 12, nothing filtered out).
6. Undo: C1 and C2 empty, "Pivot … reads A1:A3" still shown, A1:A3 unchanged.
   Redo: C2 is 24 again.

```
  insertPivot payload: {"pivot":{...,"filters":[{"field":0,"values":[]}],"output":"C1"},"sheet":"Sheet1"}
  after refresh: C1 "C1, sum:0", C2 "C2, 24"
PASS I-15 Tally: filters-only draft stays in the host; All filter refreshes to the unfiltered total; Undo/Redo
```

Capture: `f3-i15-tally-all-filter-refreshed-1280x1000.png`, taken by the
script with `page.screenshot` (full 1280x1000 viewport, unmodified) right
after step 5, mouse parked at (0,0). The field zones sit below the fold of the
detail panel and are not in the frame.

## E-35 Cadence BeatDetectionMarkerLane

Engine (`logs/cargo-cadence-engine.log`, all `ok`):
`sensitivity_half_reproduces_the_recorded_pre_sensitivity_output`,
`sensitivity_moves_the_onset_threshold`,
`add_markers_is_one_undo_step_and_round_trips`, `update_and_remove_marker`,
`marker_ops_validate_before_mutating`,
`marker_id_exhaustion_rejects_before_journal_or_document_mutation`,
`restore_validates_markers_and_accepts_saves_without_them`,
`restored_markers_are_sorted_by_ticks_then_id_before_commit`.
C ABI: the same nf-sys test as above.

nf-cli e2e:

```
✓ tests/f3-rows.e2e.test.ts > E-35 BeatDetectionMarkerLane wiring on Cadence > detects at two sensitivities, stores beats as markers, and undoes each run as one step 140ms
```

Node tests: the studio-preview `E-35` subtests (conversion, sensitivity
pass-through, dedupe/cap, add/update/remove mapping, cancellation, sub-frame
tick preservation) are among the 34 passes.

Browser, Cadence at 1280x1000, visible controls only:

1. Commands: "Add MIDI track", then "Add C-major clip to first track".
2. MIDI tab, velocity lane: ArrowDown on "Velocity of E4 note 2" until it
   reads 28, so one onset is quiet.
3. Analysis > Beat markers. Sensitivity 0, Detect: `detectBeats` carried
   `sensitivity: 0`; 1 onset found, 1 marker added. Undo: no markers. Redo: 1.
4. Sensitivity 1, Detect: `detectBeats` carried `sensitivity: 1`; 2 onsets
   found, 1 new marker added. Undo: 1 marker. Redo: 2.
5. Selected the first marker, typed "Reviewed beat" in Marker name, Tab to
   blur. One `updateMarker` with `{"id":4,"name":"Reviewed beat"}`; the next
   `listMarkers` returned id 4, ticks 348, length_ticks 0, the new name
   (before: same id/ticks/length, name "Beat 1"). Saved as
   `f3-e35-marker-rename-observed.json`.

```
  E4 note 2 velocity set to 28 through the velocity lane
  sensitivity 0: 1 onsets, 1 added
  sensitivity 1: 2 onsets, 1 added
  updateMarker payload: {"id":4,"name":"Reviewed beat"}
  before: {"id":4,"length_ticks":0,"name":"Beat 1","ticks":348}; after: {"id":4,"length_ticks":0,"name":"Reviewed beat","ticks":348}
PASS E-35 Cadence: detectBeats at sensitivity 0 and 1, one undo step per run, marker rename keeps ticks
```

The five marker ops: `addMarkers`, `updateMarker` and `listMarkers` were
exercised in the browser. `addMarker` and `removeMarker` were covered by the
Rust, nf-sys and node tests above, not in this browser run.

Capture: `f3-e35-cadence-renamed-marker-1280x1000.png`, taken by the script
with `page.screenshot` (full viewport, unmodified) after step 5, mouse at (0,0).

## B-11 Prism blend and opacity (D7 split)

Engine (`logs/cargo-prism-engine.log`): `tests::set_layer_opacity`,
`tests_v2::blend_modes_render`, `tests::flatten_composites_with_opacity`
and the rest of the 177 pass.

nf-cli e2e:

```
✓ tests/prism-blend.e2e.test.ts > B-11 Layers panel controls > the blend mode MenuButton carries its name and current mode 11ms
✓ tests/prism-blend.e2e.test.ts > B-11 Layers panel controls > the opacity scrubber steps 1 % and reports whole percent 13ms
✓ tests/prism-blend.e2e.test.ts > B-11 Layers panel controls > the shared mode list is exactly the modes the Prism API accepts 1ms
✓ tests/prism-blend.e2e.test.ts > B-11 Layers panel commands on Prism > maps mode to setLayerBlend and opacity to setLayerOpacity, each one undo step 8ms
```

The first of these printed `Unexpected text node: Normal. A text node cannot
be a child of a <View>.` to stderr and still passed.

Node tests (`logs/node-workspace.log`): the seven `B-11` subtests (78-84),
`ok 99 - the Layers panel splits Tron blend mode from Forge opacity` and
`ok 107 - an opacity release is one setLayerOpacity, and an unchanged value is none`
are among the 157 passes.

Browser (`logs/verify-prism-blend.log`):

```
PASS 1280x1000: Straight alpha text, one opacity owner, Multiply commit and Undo
PASS 1280x1000: two presses of "−" take opacity from 100 % to 98 %
  1280x1000: editor [0,148,1228,552], fill bar [422,628,384,52], panel [936,160,280,524], list 208 px, head 316 px (budget 320)
PASS 1280x1000, six layers: mode menu and the whole opacity scrubber reachable without scrolling
  1024x768: editor [0,148,972,320], fill bar [294,396,384,52], panel [680,156,280,304], list 56 px, head 248 px (budget 320)
  1024x768: the panel body scrolls (322 px in 254 px); rows and Raise/Lower are below the head
PASS 1024x768, six layers: mode menu and the whole opacity scrubber reachable without scrolling
PASS forced colours: the opacity track paints its scale in system colours
Prism Layers panel: blend menu, Straight alpha text and opacity scrubber pass in Chromium
```

The 1024x768 line repeats R2's recorded known limit: the layer list sits at its
56 px floor inside a scrolling panel body.

Captures: `f3-b11-layers-six-1280x1000.png` and `f3-b11-layers-six-1024x768.png`,
written by the script's own capture path (six layers, before any blend or
opacity interaction, full viewport, unmodified).

## Browser console during the runs

Not failures under either script's checks (both assert no uncaught page
errors), but recorded: each page logged `Received \`false\` for a non-boolean
attribute \`accessible\`` and the react-native-web `useNativeDriver` fallback
warning. During the Tally scenario the page logged
`Unexpected text node: . A text node cannot be a child of a <View>.` 115 times.

## verify-f3-rows.mjs

No script existed for the I-15/E-35 browser receipts: the 0c8ba55 receipts in
`../2026-11-13-b000c8a/forge-pr81-2026-11-13-c0b000a/RECEIPT.md` were made by
hand over CDP with a separate `.nfd` fixture. This script is modelled on
`verify-prism-blend.mjs`: same Vite/nf-cli host, Playwright locators by role
and label, no store or engine injection. It reads the `/api/engine` traffic
the page sends to check op payloads.

It was not run failing-first against broken source (that would need a source
edit). Its first three runs at this commit failed on script defects, not
product behaviour: the filter path in the `insertPivot` payload was wrong;
both detection runs name their first marker "Beat 1", so selecting by name
was ambiguous; and a non-waiting visibility check ran while the pivot panel
was re-reading after Undo. Each was fixed in the script before the passing run.

## NOT RUN

- Native iOS and Android (no build, simulator, emulator or device).
- Screen reader (VoiceOver, TalkBack, NVDA, Narrator).
- A real Windows High Contrast session. Forced colours were emulated in
  Chromium only, for B-11.
- Any browser other than headless Chromium; light theme; 200 % text; phone
  or tablet viewports.
- I-15 and E-35 at 1024x768 (only 1280x1000).
- Opacity drag in the browser (only "−" presses); E-35 Cancel; `addMarker`
  and `removeMarker` through the browser.
- `cargo test --workspace` (only the four crates above), `pnpm -r test`,
  `pnpm -r typecheck`, `vite build`, `verify-render.mjs`, tooling/validator
  tests, `derive-v1-component-scope.mjs --check`.
- Node 24.3 or later: every run used Node 22.23.5.
- No reviewer has signed these results.

## Review and script fix (2026-11-23)

R2 signed gate F3 against this folder and commit
`bbc18637e59244bdc3c94634ca8d927280f22ec2`. In 1 of R2's 3 runs, made while
cargo tests ran alongside, `verify-f3-rows.mjs` failed E-35. The product
behaved correctly in that run. The cause was in the script: it recorded each
engine op when its response finished, so an older `listMarkers` could land
after a newer one, and the rename check compared the wrong marker. A later
commit records ops in request order, fills in each response afterwards, and
asserts that the latest marker list holds every marker the lane shows. With
that fix the script passed 3 of 3 runs, the second with cargo tests running
alongside.

Follow-ups outside F3, from the same review:
- `apps/studio-preview/src/tally-detail-controls.tsx:128` renders `''` inside a
  View while there is no error (`{state.error&&<Banner …/>}`), which is the
  source of the "Unexpected text node" warnings. It dates from `f327ba7`,
  before F3.
- `apps/studio-preview/tests/prism-blend.e2e.test.ts` renders `MenuButton` with
  a bare string child; the editor passes `Text`.
- The Tally pivot output header reads `sum:0` (a field offset) while the panel
  says "Column A".
