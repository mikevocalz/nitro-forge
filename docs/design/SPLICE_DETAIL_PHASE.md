# Splice markers, transitions and batch edits

2026-11-07. This implementation batch composes four existing NYC-Tron controls with Splice's typed timeline adapter. No reusable control, engine operation, compositor or playback host is recreated in the preview.

## Composition

`apps/studio-preview/src/splice-detail-controls.tsx` exports:

- `useSpliceDetailSelection(document)`: a per-document Zustand store for clip multi-selection, the selected cut/transition and the selected marker. Document identity resets that presentation state; density and geometry do not.
- `SpliceTransitionOverlay`: canonical `TransitionHandles` in the existing track stack's `laneOverlay`. It uses the same canonical `stackOrder` as the rendered lanes. Cut selection is checked against the current authoritative view, so moved or removed cuts no longer offer an edit.
- `SpliceDetailControls`: canonical `TimelineMarkers`, `TransitionPresetBrowser` and `BatchEditPanel`. Marker add/update/remove dispatch through the existing callbacks. Transition presets add at a selected valid cut, or update its existing transition instead of attempting a duplicate add. Batch operations remain one adapter batch and one engine undo entry.

The caller supplies the existing adapter, authoritative view, frame rate, viewport and surface `commit` gate. These components never open a document handle. All document writes use that shared gate; alpha.4 void callbacks observe rejections while preserving the original promise. Error presentation remains with the parent surface. Selection is filtered against current markers/clips before it reaches the controls.

The older released controls' local drafts and gestures reset on a new authoritative read. Those revision keys belong to document reads, not window width, density or posture. The selection store remains above that boundary.

## Integration API

Call `useSpliceDetailSelection(document)` unconditionally in the existing Splice surface. Its `selectClip` and `toggleClip` methods bind normal and modifier-key selection to the existing track lane. Pass `selectedClipIds` and `onToggleSelect` to `OverlayAndEffectsTrackStack`; clear the old single-primary highlight when toggling multi-selection. Supply `SpliceTransitionOverlay` through `laneOverlay`, then render `SpliceDetailControls` with the same adapter/view/rate/viewport/selection/commit/disabled values and the host's cursor/theme/density.

`spliceTimelineExtent(view)` provides UI bounds from the maximum of the last clip end, marker/range-marker tails and stored loop out-point. Splice's engine explicitly permits annotations beyond the last clip, including an otherwise empty sequence. The helper does not rewrite the authoritative clip duration. The root must use this same extent for zoom, ruler, playhead, lane and marker bounds so valid later annotations remain reachable.

The host still owns frame/cursor state. Marker jumps change that cursor; they do not claim decoder playback. The batch panel's multi-selection uses the canonical lane's Shift/Control/Command interaction. Touch-only additive selection requires a separate accepted canonical interaction; this batch does not claim it.

## Validation and remaining scope

The new file passed preview TypeScript checking before parallel host integration changes. The parent performs the combined final typecheck and static diff check after wiring. Runtime/browser/native acceptance and full suites are deferred to the user's review gate; prior adapter test results do not certify this new composition.

No loop switch is drawn: canonical `LoopRangeBar` requires a real player-loop binding, which this host does not yet provide. Decoder/compositor output, thumbnails, live peaks, playback, export, effect tracks, stickers and speed keyframes remain governed by `SPLICE_DEFERRED` and the engine/platform plan. Transition diagrams remain diagrams, not video previews. Native gestures, keyboard focus, screen-reader actions, enlarged text, RTL and cross-device layout still need acceptance evidence. Published alpha.4, package pins, window/orientation contracts and unrelated native-media work stay unchanged.

## Integrated host wiring

The existing Splice surface now owns the detail selection hook and passes its filtered clip IDs through the canonical lane's modifier-key selection callbacks. Its existing track stack mounts the transition overlay and the marker/preset/batch panels share the same current adapter, authoritative view and write gate.

Zoom, ruler, playhead, track lanes and marker bounds use spliceTimelineExtent consistently. Removing the last later annotation clamps the view cursor and viewport to the remaining extent. Marker jumps follow the cursor into view through the canonical viewport helper. These are view operations; the underlying engine clip duration and playback state remain unchanged.

The combined preview typecheck and static production build passed. The build retains chunk-size, RN Web directive and future config-loader warnings. This phase ran no runtime/browser/native acceptance suite, per the review gate.
