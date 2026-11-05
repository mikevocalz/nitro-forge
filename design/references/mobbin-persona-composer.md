# Mobbin references: Persona Composer

Pass run 2026-11-04 for `packages/studio-workspace/src/persona-composer.tsx`.
Queries: "drag to reorder toolbar customization" (iOS), "custom workspace
builder" (web), "save custom preset" (iOS). Six screens kept, each with what
the composer takes or rejects. Behavior references only; no chrome, icons or
copy are copied.

| App | Screen | Take or reject |
|---|---|---|
| Insight Timer | [Edit Library](https://mobbin.com/screens/672ed90e-b14b-46aa-8944-5e94b79e3498) | **Take.** Chosen items sit on top with drag handles; unchosen items sit below with no handle. The composer splits the rail (ordered, handles, Move up/Move down) from "Add to rail" (unordered). |
| How We Feel | [Edit cards](https://mobbin.com/screens/832483ee-0d24-443e-9270-8aab1014567a) | **Take** the lifted row while dragging, so the drop position is visible. The composer marks the target row and writes "Drop at position 2 of 3" in a live region. **Reject** the all-caps title. |
| Copilot | [App sections](https://mobbin.com/screens/02cafda3-902f-4a89-a247-2baa6ed6170b) | **Reject.** Reordering is long-press only, explained in a paragraph. The composer gives every row Move up and Move down buttons plus screen-reader actions, and drag is an extra. |
| BitePal | [Home layout](https://mobbin.com/screens/9af8deca-9ae5-4372-bfb3-d5f79a5e185f) | **Reject.** The floating Save pill covers the reorder hint. The composer's Save sits in the flow under the preview, with its disabled reason written next to it. |
| Garmin Connect | [Save Course](https://mobbin.com/screens/f95756a2-054c-499e-8d95-c95be8c31ada) | **Take.** Name field and one exclusive choice in the same place as Save. The composer pairs Name with Surfaces, where "Every surface / Chosen surfaces" is a SegmentedControl, not radios built by hand. |
| Insight Timer | [Presets](https://mobbin.com/screens/f2941500-f4de-4f34-8ca6-68c091e8bfae) | **Take** "My presets" as a list separate from the library. "Your personas" lists saved and imported personas with an overflow Menu (Export, Remove); built-ins stay listed and say why they cannot be removed. **Reject** the inline "Plus" upsell. |

Web "workspace builder" results (Remote, Wix, Plane) were automation and site
builders with a side palette of actions. Nothing there fit an ordered rail, so
none is kept.
