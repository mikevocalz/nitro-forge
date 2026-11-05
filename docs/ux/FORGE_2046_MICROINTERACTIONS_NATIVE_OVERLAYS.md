# Forge 2046 — living micro-interactions, native menus and responsive popovers

> **Superseded source, November 5 2026:** Studio controls now come from NYC-Tron UI (rule #38), not `@acme/ui`. The Studio Menu is NYC-Tron's `NativeActionMenu`; Popover and NativeDropdown are deferred (see `studio-refresh/OWN_UI_INTEGRATION.md`). The `@acme/ui` references below are the November 4 record. The motion and placement policy still applies.

> **Status, November 4 2026:** source-backed Menu is already consumed by the Studio host; the shared motion/placement POLICY and a strict **optional** rich-Popover host slot exist in PR #32. The rich @acme/ui Popover implementation and physical cross-platform UX QA are **pending**. Motion budgets below are design targets, not measured runtime animations.

## One authoritative UI source

**All visual menu/popover/drawer/sheet implementations must live in the existing @acme/ui source, not another Forge control library.** Forge contributes instrument meaning, task commands, layout planning and engine transactions. Its adapter is the already-present \`StudioUIProvider\` with \`Menu\`, \`Select\`, \`TabBar\`, \`SegmentedControl\`, \`Button\` and other canonical host components.

Repository source audit:
- \`mikevocalz/nyc-mon/packages/ui/Menu.native.tsx\` already delegates to \`@expo/ui/community/menu\`'s \`MenuView\`: SwiftUI menu/context menu on iOS and Jetpack Compose dropdown on Android. Its \`Menu.types.ts\` contract is \`children\`, \`actions\`, \`onAction\`, \`title\`, optional \`className\` / theme. It is the existing native *action menu*.
- \`mikevocalz/nyc-mon/packages/ui/Menu.web.tsx\` uses source-owned anchored web behavior with top-layer Popover API where supported, content clamping, dismissal, Escape, selection and focus return. The markup lives inside **/ui**, not each studio.
- \`mikevocalz/nyc-mon/packages/ui/ResponsiveDialog.tsx\` already chooses a canonical BottomSheet at compact width and Dialog at medium+; on tabletop folds it treats a horizontal hinge explicitly.
- The Studio host's \`@acme/ui/studio-controls\` export binds \`Menu\` as an actual canonical component. This export is source-owned and not a clone.
- A **general rich-content Popover is not currently exported by this @acme/ui Studio binding**. Forge's optional \`StudioUIComponents.Popover\` contract intentionally fails clearly when requested without a source-owned host implementation. Do not claim popover feature parity until its native source and QA exist.

**Source implementation tracker:** [NYC-MON @acme/ui issue #172](https://github.com/mikevocalz/nyc-mon/issues/172). This is a code work item, not evidence that the native popover has shipped.

**Source implementation PR:** [NYC-MON #173](https://github.com/mikevocalz/nyc-mon/pull/173) now contains source-owned `Popover.ios/.android/.web` implementations, a neutral instrument surface, geometry tests and Storybook fixtures. It is a **draft**, and the canonical Studio binding remains pending until source-version integration and native/device QA. Do not mark runtime parity from source files alone.

### Three distinct UI affordances

| Need | Canonical owner | Native/web behavior | Implementation status |
| --- | --- | --- | --- |
| Overflow, object actions, layer context commands | \`@acme/ui/Menu\` | iOS SwiftUI / Android Compose native menu, web anchored platform-appropriate menu | **Already bound to Studio host**; per-device behavior still needs QA |
| Rich brush settings, Color Space, keyframes, exact-value inspector | **New \`@acme/ui/Popover\` adapter** exposed by Studio provider | iPad/macOS-size SwiftUI Popover; Android native Compose surface; wide web Popover API; small viable pane uses canonical responsive sheet | **Port/interaction policy only**; implement in /ui first |
| Multi-field editor operation, destructive confirmation, limited-space modal | \`@acme/ui/ResponsiveDialog\` / BottomSheet | Canonical sheet/dialog adapts to usable pane and hinge posture | Existing source feature; not yet a Studio provider slot |

Do not call the existing action \`Menu\` a rich-content \`Popover\`, and do not embed a homegrown RN Modal or DOM portal as a hidden fallback. If a platform lacks the native equivalent, implement a documented, accessible canonical adapter in **/ui** and gate release on real device verification.

**Verified Expo 58 APIs for the future native binding:** iOS \`@expo/ui/swift-ui\` exports \`Popover\`, \`Host\`, \`RNHostView\`; Android \`@expo/ui/jetpack-compose\` exports \`DropdownMenu\`, \`Host\`, \`RNHostView\`, with explicit expanded/dismiss handling. The community \`MenuView\` wraps SwiftUI Menu and Compose DropdownMenu. Use platform-specific source files and keep Forge's public semantic API uniform:
- https://docs.expo.dev/versions/v58.0.0/sdk/ui/swift-ui/popover/
- https://docs.expo.dev/versions/v58.0.0/sdk/ui/jetpack-compose/dropdownmenu/
- https://docs.expo.dev/versions/v58.0.0/sdk/ui/drop-in-replacements/menu/

## Micro-interactions are first-class semantics

One interaction vocabulary across Prism, Cadence, Splice, Quill, Tally, Pitch, Folio and Board. \`packages/studio-workspace/src/interaction-policy.ts\` exports current design-budget tokens and has isolated tests; renderers must honor these values or document measured native equivalents.

| Signal | Budget | What the user perceives |
| --- | ---: | --- |
| Hover/pen-hover | 70ms | Precise instrument border and affordance reveal, never a blind pop |
| Press | 90ms | Momentary surface depression or scale; hit target does not move |
| Selection | 120ms | Outline transitions to filled/selected Rive icon; inspector content matches selection |
| Popover open | 150ms | Anchored appear or sheet presentation without large page motion |
| Dock/snap | 190ms | Panels and snap destinations have distinct preview/commit states |
| Detent crossing | 65ms | Brief visible tick and optional *one* haptic per actual detent transition |
| Edit commit | 110ms | Preview settles when engine result arrives; never imply saved before commit |
| Cancel | 85ms | Preview rolls back; document operation does not execute |
| Error | 140ms | Clear inline error state with accessible announcement, not shake-only feedback |

**Reduced motion:** duration and travel immediately become zero, but focus, status and optional legitimate haptics remain. **High contrast:** never encode selection solely with opacity/scale/color; shape and text carry it. **No idle glow** or perpetual micro-animations; never repaint the full document on every pointer hover.

### Event sequence for an instrument

1. Hover/focus: native UI applies the subtle preview affordance, supports keyboard focus ring.
2. Press: immediate feedback with consistent hit rectangle; one real state transition, never a stale timer.
3. Drag: compose/native UI thread handles high-frequency visual movement; Rust receives bounded, revision-aware commands. Live preview must not create one undo item per frame.
4. Snap: show real target and optional source-owned haptic **only when crossing** a detent; cancel invalidates preview.
5. Release: commit exactly one valid engine operation; await result and authoritative document state before success feedback.
6. Menu/popover: source-owned anchor surface opens, focuses its real content, closes with Escape / outside / Android Back, returns focus to the correct trigger. When the viewport/fold changes while open, the source UI repositions or closes safely; content must not remain behind a hinge.
7. Undo/redo: workspace and instrument animations convey revision change without restarting engine session.

**Execution adapters:** use the existing Rive-ready original icons from #21 and verified Kinetrell/Legend Motion adapters for host animation only once real dependencies and cross-platform lifecycle are confirmed. Prefer native/UI-thread animation for interactive feedback. Don't add a JS-per-frame loop, fire fake haptics or claim smoothness from nominal duration constants. \`ForgePrecisionScrubber\` now has live hover/focus/active visual feedback; motion duration/presentation policies are not yet rendered animated components.

## Layout is continuous, not breakpoint theatre

Responsive inputs are **usable pane dimensions**, real safe areas, keyboard/window insets, pointer/pen availability and actual separating hinge/occlusion geometry. No invented desktop "mobile mode" or magic device IDs. Existing adaptive-layout and source-owned reserved-region adapters calculate panes; the Forge overlay planner receives the already valid pane and never spans a blocked region.

| Working space | Workbench composition | Menu / popover |
| --- | --- | --- |
| 1920 / 1280 desktop | Stage-first, multiple docked inspectors and optional bottom timeline/mixer | Anchored source-owned popover; keyboard/pointer precision |
| 768 tablet / split window | Keep stage viable; collapse secondary inspector into a rail | Native popover if content and anchor fit, otherwise responsive sheet |
| 390 / 320 phone | Work stage dominates, compact command capsule, collapsible panels | Native action menus remain menus; rich multi-control tools become sheet |
| Surface Duo book / tabletop | Stable stage in one pane and instrument in the other where supported; no element intersects separating hinge | Anchor within its actual pane or use source-owned sheet; preserve edit/undo/focus |
| iPad Stage Manager / Android multi-window | Recompute on measured window resize, keyboard and orientation change | Reanchor or migrate surface without losing a pending engine operation |
| XR | Own spatial compositor/input contract, not a screen-space modal with CSS widths | World-anchored UI only when actual XR adapter exists |

### Responsiveness is measurable

- Visible target may be compact, but touch and pen hit areas are at least 48 logical px; keyboard/pointer hit areas at least 44.
- Menu placement: trailing align in LTR, leading in RTL; flip above when needed, clamp to pane, scroll only when absolutely necessary. Never render an unreachable bottom row.
- Long-press/secondary-click access must have an explicit tap/keyboard alternative. Native action menus do not require a homegrown animation wrapper.
- Inspected tool popovers have a minimum usable height; when keyboard or fold makes them impossible, use the canonical ResponsiveDialog/BottomSheet rather than squeezing controls into a 50px sliver.
- Sample rate, timeline frame rate, real signal data and document color remain unchanged by responsive recomposition.
- Target uninterrupted interaction render budget: 16.7ms at 60Hz, 8.3ms at 120Hz **where hardware supports it**; measure under real drag/dock/playback workloads, including thermal and lower-end devices. No unmeasured 120fps promises.

## Acceptance, evidence and owner

- **Implemented in PR #32:** independent motion budgets, target sizes, overlay placement policy, native-popover host boundary, immediate hover/focus/drag feedback on the first precision instrument, unit tests and independent CI path.
- **Already in source UI:** native action Menu and responsive Dialog/BottomSheet; reference and reuse them.
- **Still required:** create + visually verify rich \`@acme/ui/Popover\` native iOS, native Android and web source implementations; extend the source-owned \`studioControls\` binding only after tested; then replace inspector flyouts with this component without modifying engine semantics.
- **QA:** 320/390/768/1280/1920 widths; RTL, software keyboard, text scaling; menu flip/outside click/Back/Escape/focus return; both light/dark and reduced-motion modes; long-press, pen-hover, touch and pointer; Surface Duo real hinge and iPad native. Screenshots and videos are required for each, plus performance traces on real hardware.

Do not confuse this document or pure interaction tests with a shipped native rich Popover.

## Expo SDK 58 Material 3 Expressive native dropdowns

**Source implementation:** [NYC-MON PR #174](https://github.com/mikevocalz/nyc-mon/pull/174), stacked on native rich Popover #173. [Expo upstream PR #52598](https://github.com/expo/expo/pull/52598) merged on October 30, 2026; these new `@expo/ui/jetpack-compose` primitives require a release containing the merge (the old 58.0.20 pin predates it). The source branch now targets SDK 58's published `@expo/ui@58.0.27`.

Do **not** confuse this with the interactive Popover: `NativeDropdown` is for a **single, controlled choice** with groups, selection, disabled items and supporting descriptions. On Android it uses the real Compose `Box + DropdownMenuPopup + DropdownMenuGroup + SelectableDropdownMenuItem`; iOS uses its own SwiftUI Menu/Section/Button primitives; web uses the source-owned accessible popover/sheet. Group and item shapes are native Android Material 3 Expressive, not artwork to copy onto iOS. Old `@acme/ui/Menu` action lists remain unchanged.

`@nitro-forge/studio-workspace/ui` now exposes a strictly **optional** `NativeDropdown` host port, with no duplicate RN Modal or fake fallback. Do not claim this is wired into existing Studio consumers until the source-host binding is updated, Expo 58 native client rebuilt and screenshot/accessibility/engine tests pass. Independent pure-model tests are not native acceptance evidence.
