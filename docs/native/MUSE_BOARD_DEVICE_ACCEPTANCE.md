# Logitech Muse + native Forge Board: end-to-end hardware acceptance

## Reuse the existing merged SDK work

Source of truth:
- [Viro PR #2](https://github.com/mikevocalz/viro/pull/2) MERGED:
  native visionOS GameController/ARKit spatial accessory input, with the
  existing subscribeSpatialStylus stream.
- [Viro-external PR #49](https://github.com/mikevocalz/viro-external/pull/49)
  MERGED: MusePenInput and QuickDraw BoardInputRouter bridge.
- Forge PR #15 contains the portable spatial-ink normalizer and an additional
  connectMuseToBoardRouter integration that can replace, not duplicate,
  the existing MusePenInput consumer.
- Forge PR #18/#19 own the native Board and Skia v3 rendering/persistence
  contracts. Neither is currently considered device-proven.

**No new Logitech Bluetooth implementation is required for Vision Pro.**
The old libmuse_8.0.9 files from Interaxon are EEG-headband SDKs and are NOT
a stylus drawing SDK; do not import them. The user already has their native
Viro spatial pen implementation.

## Single-owner event flow

Muse paired via Apple visionOS Settings -> merged Viro native stream ->
ONE Forge spatial-ink subscriber -> ONE existing Viro BoardInputRouter ->
ONE existing QuickDraw/Yjs document -> Board rendering surface.

On consumer migration, unmount the old MusePenInput for that board BEFORE
mounting connectMuseToBoardRouter. Avoid dual pointer callbacks, dual
undo stacks and shadow document copies. Preserve raw pressure 0;
missing pressure goes to NaN in the legacy router and must not be fabricated.

## Release gates (real device)

| ID | Required proof | State |
| -- | -- | -- |
| VP-01 | Rebuild and link Viro visionOS native source in the host with SDK 26.2+ | NOT RUN |
| VP-02 | Establish Expo 58 / RN 0.88 Vision Pro target compatibility, or document an isolated compatible target | NOT RUN |
| VP-03 | Pair actual Logitech Muse in Apple Vision Pro Settings; verify tracked native events | NOT RUN |
| VP-04 | Hover, tip contact, pressure zero/full, primary and secondary buttons, measured latency | NOT RUN |
| VP-05 | Calibrate tip-to-board projection; no off-paper drawing; no controller/pen double stroke | NOT RUN |
| VP-06 | Tracking loss cancels once; held-tip release before new stroke; reconnect, focus, immersion change | SOURCE TESTS |
| VP-07 | Pointer samples reach the real Yjs/QuickDraw authority, paint Skia/Viro pixels, undo and redo | NOT RUN |
| VP-08 | Background/kill/restart, scoped MMKV 4 persistence, sync and conflict resolution | NOT RUN |
| VP-09 | Skia Graphite or Viro geometry backend renders consistent ink with readable fallback | NOT RUN |
| VP-10 | 60/90/120Hz stress, rapid scribble, palm rejection, large document, memory/fps | NOT RUN |
| VP-11 | Reduced motion, accessible status and Rive pen-toolbar selected outline→fill animation | NOT RUN |
| VP-12 | Independently validate iPhone/iPad/Android touch routes. No direct Muse support asserted | NOT RUN |

Do NOT mark "Muse-ready" based only on Node tests, a connected BLE GATT
peripheral, nominal app compilation, or a timer-based green animation.
The connected and ready states require proof from actual Viro tracking
AND a rendered+saved stroke.

## Device test fixture

1. Open a board, capture version ID/empty mark count.
2. Pair Muse through visionOS Settings, open immersive scene, confirm tracked events.
3. Select Pen; draw slowly with 0 / 0.25 / 0.75 / 1 measured pressure.
4. Select Highlighter, then Eraser; verify pressure/geometry and undo/redo.
5. Lift pen, move outside board, reenter, deliberately lose tracking while pressed,
   then release and reconnect; verify exactly one cancel and no ghost line.
6. Save, terminate app, reopen same scoped account/board. Confirm identical marks.
7. Toggle offline/online and rejoin collaboration. Confirm no duplicate strokes.
8. Repeat with accessibility enabled, dark/light theme, Rive reduced-motion,
   and during focus/ImmersiveSpace transitions.
9. Record Xcode build, version pins, visionOS device model/build, captures,
   crash reports, latency and frame traces in PR before merge.

## Implementation priorities

The first responsible target is **Vision Pro**, the device with the already
merged Viro Muse SDK input path. Android Bluetooth PR #20 is an optional
independent generic BLE discovery/connection project, not the dependency
for Apple Vision Pro Muse drawing.
