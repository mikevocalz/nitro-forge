# Direction: the Prism persona turret

**Brief: SELF-AUTHORED.** The user said proceed, so the Step 0 questions in
forge-designer-pro are answered here by the designer, not by the user.
Round 1, 2026-11-04, branch `ui/turret-directions`.

## Step 0 brief

| Question | Answer |
|---|---|
| Studio and instrument | Prism (the design studio), the persona turret that switches Vector, Pixel, Layout and Sketch over one open document |
| Professional task | Change what the tool rail offers without losing selection, zoom, color or undo, and see what the next persona cannot do before committing to it |
| Precision | The exact persona, named in full. A peek never commits. One detent per stop: a drag, an arrow key or a screen-reader swipe moves exactly one persona; release, Enter or double-tap commits; Escape or a cancelled gesture returns to the committed persona |
| Three words | machined, exact, quiet |
| References | `design/references/mobbin-studio-switch-{ios,web}.md`: We.Inc lathe-turned detent dial (O1), TentUI rotary knob change/commit split (O2), Tactile UI detent dial state list (O3), GoPro Quik arc dial (iOS 19), Apple Photos tick ruler (iOS 15), Binance commit-to-switch sheet (iOS 23). Hardware: a Teenage Engineering OP-1 encoder, a lathe-turned camera mode dial |
| What exists | `turret.ts` reducer (peek, commit, cancel, end stop), `persona.ts` manifests, `persona-store.ts`, the StudioUIProvider controls from `nyc-mon/packages/ui`, `ForgePrecisionScrubber`, `workspaceScale` tokens |
| Surfaces this round | Web (studio-preview, Chrome) at 390, 768 and 1440 px, dark and light. Native iOS/Android are not captured this round |

### References broken down (moves taken, never UI)

- **We.Inc lathe dial**: concentric lathe rings on the face; every scale label is also a button; reduced motion jumps straight to the stop. Taken: lathe rings, named stops as targets, instant travel under Reduce Motion.
- **TentUI rotary knob**: change fires per detent, commit once on release. Taken: the peek hint differs by input (release for drag, Enter for keys).
- **Tactile UI detent dial**: snap mode, at-an-end and disabled states. Taken: end-stop effect, disabled line.
- **GoPro arc dial, Apple Photos ruler**: a fixed pointer over a scale with the value as the brightest text. Taken: the readout in the face is the largest type on the instrument.
- **Binance mode sheet**: "Current mode" marked before you switch. Taken: the committed stop keeps an accent bar and the accent slot while a peek is open.

## Studio discovery

Read from each `package.json` on this branch:

| Path | Name | Description |
|---|---|---|
| packages/cadence | @nitro-forge/cadence | Nitro-Forge cadence document API. |
| packages/folio | @nitro-forge/folio | Nitro-Forge folio document API. |
| packages/icons | @nitro-forge/icons | Original Rive-ready outline/filled icon system for all Nitro-Forge editor engines |
| packages/ignition | @nitro-forge/ignition | Nitro-Forge native integration layer: engine session contracts, Nitro HybridObject spec, and host transports. |
| packages/pitch | @nitro-forge/pitch | Nitro-Forge pitch document API. |
| packages/prism | @nitro-forge/prism | Nitro-Forge prism document API. |
| packages/quill | @nitro-forge/quill | Nitro-Forge quill document API. |
| packages/splice | @nitro-forge/splice | Nitro-Forge splice document API. |
| packages/studio-layout | @nitro-forge/studio-layout | (none) |
| packages/studio-workspace | @nitro-forge/studio-workspace | (none). Holds PrismEditor, the turret, the scrubber |
| packages/tally | @nitro-forge/tally | Nitro-Forge tally document API. |
| apps/console | @nitro-forge/console | Executable workflow demo: drives every Nitro-Forge engine end-to-end via nf-cli. |
| apps/example | @nitro-forge/example | (none) |
| apps/studio-preview | @nitro-forge/studio-preview | (none). The web harness; the lab lives here |

## The category default refused

Affinity's studio tab bar, Adobe's app grid, Figma's Design/Dev toggle and a
SegmentedControl. All four make a persona look like a page or a tab: one
press rebuilds the workspace, nothing previews, and the current choice is a
filled pill. Slop faces this brief falls toward: the shadcn header toggle
(face 3) and, for Optics, the Liquid Glass overreach (face 4).

## The metaphor

One physical object: **a machined four-stop turret with detents.** A
graphite dial with a knurled bezel, a slot cut at each persona, a pointer
milled into the face, and the persona name engraved beside its slot. Every
mark encodes state: knurl is the grip, slots are the stops, the accent slot
is the committed persona, the pointer is the shown persona, the face
readout is the value.

## Copy (written before layout)

All strings live in `turretCopy` in `persona-turret.tsx`.

| Slot | String |
|---|---|
| Ring name | Persona |
| Stops | Vector, Pixel, Layout, Sketch (full names beside each slot, 44 pt targets) |
| Stop shortcut (web, desktop) | ⌘1, ⌘2, ⌘3 |
| Face readout | `Pixel` over `2 of 3` (tabular figures) |
| Idle, touch | Drag the ring or tap a name · 3 stops |
| Idle, keyboard | Drag, or arrows to preview · ⌘1 to ⌘3 |
| Peek by drag | Release to switch to Layout |
| Peek by key | Enter switches to Pixel · Esc keeps Vector |
| Screen reader hint | Swipe up or down to preview a persona, double-tap to switch |
| Screen reader value | Pixel, previewing |
| Screen reader stop | Vector, current, Command 1 |
| Rotor actions | Next persona · Previous persona · Switch to previewed persona · Cancel preview |
| Capability lines | From `personaManifest`: "Paths and nodes: not in this build", "Pages: not in this build", "Data merge: desktop and web only", "Sketch: iPad and XR only" |
| All ready | Everything in Pixel works here. |
| No stops | No persona runs on this device |
| Disabled | Persona switching waits for the engine to finish |
| Switch error | From `persona-store.ts`, shown by PrismEditor: "Unknown persona 'x'", "Sketch: iPad and XR only" |

## Three directions on the same controls

Lab route: `#/lab/turret?direction=workbench|optics|atelier&theme=dark|light&surface=web|ipad`
(`apps/studio-preview/src/turret-lab.tsx`). Each renders the real
`PersonaTurret`, the shipped `ForgePrecisionScrubber` (Layer opacity, 0 to
100 %, detents at 25 % steps) and Prism's four fill swatches over an
800 × 600 px artboard. Tokens: `packages/studio-workspace/src/forge-directions.ts`.

| | Machined Workbench | Chromatic Optics | Spatial Atelier |
|---|---|---|---|
| Material | Graphite billet (dark), white ceramic (light), knurled bezel | Dark glass well; frosted chrome pane | Matte ceramic, soft bezel |
| Light model | One key light from the upper left: bezel and face gradients run along −45°, a specular rim on the lit side | Light enters at the rim: the bezel carries the accent and its neighbouring hues (blue, teal, violet) | Ambient, top-lit, low contrast between face and bezel |
| Depth model | Three planes, one hard short shadow under the dial (2,3 px) and a tight panel shadow | Three planes by translucency; no dial shadow; `backdrop-filter: blur(18px) saturate(1.4)` on the chrome only | Three planes by two stacked soft shadows; the panel stands off the canvas |
| Motion | `snap`: 120 ms, `cubic-bezier(0.22, 1, 0.36, 1)` | `reveal`: 200 ms, `cubic-bezier(0.16, 1, 0.3, 1)` | `dock`: 280 ms, `cubic-bezier(0.25, 1, 0.5, 1)` |
| Curve family | ease-out quint, no overshoot | ease-out expo | ease-out quart, no overshoot |
| Shared grammar | Geometry, copy, reducer, 4 pt radius, 44 pt targets, accent only on state, tabular readout | same | same |

Glass is on chrome only. Optics falls back to the opaque `panelSolid` under
`prefers-reduced-transparency`, `prefers-contrast: more` (web) and Reduce
Transparency (iOS); `forge-directions.test.ts` checks 4.5:1 for panel text
on the solid panel and on glass over the dark mat, the light mat and white
paper, and on both ends of every face gradient.

Motion is discrete state. The indicator is a rotated view whose angle comes
from the committed or peeked stop. On web a CSS transition eases between
detents (verified in Chrome: `transform 0.12s cubic-bezier(0.22, 1, 0.36, 1)`
for Workbench); under `prefers-reduced-motion` the duration is 0 (verified:
`0s`). On native the indicator steps without easing:
`react-native-reanimated` is in the pnpm store but is not a dependency or
peer of `@nitro-forge/studio-workspace`, so it is not resolvable from the
package and no per-frame JS animation was added. Reduce Motion on native is
read with `AccessibilityInfo.isReduceMotionEnabled` and its change event.

motion.md asks the `snap` token to overshoot to 1.04 and settle. The first
cut used overshooting curves for `snap` and `dock`; the impeccable detector
flagged both as bounce easing, and they were replaced with exponential
ease-outs. The detent reads as mass through the short duration instead.

## The pick: Machined Workbench

Workbench is the turret's default (`DEFAULT_TURRET_DIRECTION`), and
PrismEditor passes `direction="workbench"`. Optics and Atelier are selectable
in the lab only.

Why the others lost:

- **Chromatic Optics** lost because a persona is not light. The direction
  exists for instruments whose content is color or signal (Chroma Space,
  scopes, meters); on a mode selector the spectral rim is decoration that
  encodes no state, which slop.md rules out. Its glass pane also sits over
  the artboard the user is editing; the blur showed the violet ellipse
  through the panel at 768 px, which is the content plane bleeding into
  chrome. Its light-mode scrubber track turns into a dark well inside a light
  panel, which reads as a different material from the rest of Prism's chrome.
- **Spatial Atelier** lost because the face and bezel are too close in value
  to read as two parts at phone size, so the detent slots and the pointer
  fade (see `atelier/light-390-open.png`). Its 280 ms dock curve is the right
  token for panels docking into a pane, not for one detent: a professional
  stepping three personas waits 0.84 s. Its layout ideas (docking beside the
  canvas, pane-aware on foldables) belong to the panel, not the turret, and
  stay available for that work.
- **Workbench** wins on the squint test: the dial reads as an object, the
  persona name in the face is the first thing that lands, the accent appears
  only on the committed slot and the active pointer, and the 120 ms snap
  matches one detent. It is the base identity the other two overlay.

## Round 0 defects fixed

| Defect | Fix |
|---|---|
| "Release to switch" overlapped the V and L stops on phone | The hint moved below the dial; the face holds only the name and `n of m` |
| The hint said "Release to switch" for keyboard peeks | Peek source is tracked: drag shows "Release to switch to X", keys show "Enter switches to X · Esc keeps Y" |
| Single-letter stop labels | Full names beside each slot, 80 × 44 pt targets, placed outside the bezel; nothing clipped at 390 px or 320 px (matrix reflow-320 clean) |
| Plain circle ring | Machined dial: knurled bezel (72 cuts), detent slots, lathe-turned face, milled pointer, directional light |
| React warned that `testID`/`accessible` reached DOM elements | Not from the turret. The only DOM element carrying `testid` and `selecttextonfocus` is the scrubber's value `<input>` (`precision-value-input`), rendered by the host kit's web TextInput in `nyc-mon/packages/ui/studio-controls`. The turret emits no such warning. Left for the kit owner |

## Scan and matrix answers

- `shoot.mjs --app`, light and dark, all three directions: one FAIL left,
  "Text under 11px" on the scrubber's `DRAG · FINE ↑ · COARSE ↓` and
  `0 – 100 %` (`precision-scrubber.tsx`, fontSize 10). Not in a file this
  round owns; every turret and lab string is 11 px or larger.
- `matrix.mjs`: windows-125, windows-150, linux, android, reflow-320,
  motion, l10n and l10n-phone clean for all three directions. windows-hc has
  one FAIL, the same scrubber value input without an edge. Firefox and
  WebKit were not installed, so those passes were skipped.
- warn, default-reach font Space Grotesk: it is the face the host theme
  (`nyc-mon/packages/theme`) sets for every Studio control; changing it is a
  suite decision, not a turret one.
- warn, six 11 px elements: the shortcut tags, the `n of m` line and the
  artboard size. They are secondary readouts at the slop.md floor (11 pt
  UI); the persona name in the face is 16 px.

## Not verified

Native iOS and Android hosts, VoiceOver and TalkBack on hardware, Pencil
hover, foldable hinge placement, haptics. The lab artboard is drawn with
views, not the Prism engine composite, because the lab does not need
`nf-cli`.
