# Critique, round 4: Prism turret, editor, Composer

Paths are under local capture folders (not committed). No new captures were needed.

## Scores

| # | Line | r4 | r3 | Evidence |
|---|---|---|---|---|
| 1 | Concept | 5 | 5 | The dial glyph, persona name and `⌘1` still name the turret before it opens (`r4/turret/light-1440-open.png`). |
| 2 | Category average | 4 | 4 | The layers panel and fill bar wear the Workbench panel but are still a stock row list and swatch strip (`r4/turret/dark-1440-open.png`). |
| 3 | Slop face | 5 | 4 | The offset-slab lists are gone: rail rows and Personas rows are flat 1 px tiles (`r4/composer/dark-1440-filled.png`). |
| 4 | Grammar | 4 | 4 | Rail names now match tile size, but in light theme Open and the Surfaces control stay dark slabs (`r4/composer/light-390-empty.png`). |
| 5 | Precision | 5 | 5 | `2 of 3` and "Enter switches to Pixel · Esc keeps Vector" hold on phone (`r4/turret/light-390-peek-key.png`). |
| 6 | Typography | 4 | 4 | The face count is no longer in the 11 px list (`final-scan/scan.json`) and stop names grow, but at 200 % they reach about 24 px while the face readout stays 16 px. The readout stops being the largest type (`r4/turret/text200-1440-open.png`). |
| 7 | Colour | 4 | 4 | Light theme now has ceramic chrome and dial (`r4/turret/light-1440-open.png`), but the dark import error puts error red on the info navy (`r4/composer/dark-390-import-error.png`). |
| 8 | Depth | 5 | 4 | Composer shadows are flat and the phone sheet leaves the artboard visible (`r4/turret/dark-390-open.png`). |
| 9 | Micro-interactions | 3 | 3 | Unchanged: nothing has been seen or felt on hardware yet. |
| 10 | Craft | 4 | 4 | The sheet is on one 16 px gutter and the subline is full at 1440, but at 200 % text the tool rail overlaps the toolbar and Save is clipped at 390 (`r4/turret/text200-390-closed.png`). |
| 11 | Adaptive | 3 | 3 | RTL now mirrors All apps (`r4/turret/rtl-390-open.png`). There is still no iPad, Duo or XR capture. |
| 12 | Everyone's device | 4 | 3 | Swatches keep their colour in forced colours, but the opacity scrubber track goes blank there, so its position is invisible (`r4/turret/forced-1440-peek-key.png`). |
| 13 | Native-ness | 1 | 1 | Capped: no native capture exists. |
| 14 | Copy | 4 | 4 | The import error now gives the fix ("Ends early at character 31. Paste the whole file and try again.", `r4/composer/light-1440-import-error.png`), but layer rows print the raw enum `rect · 100%` beside `Raster · 100%` (`r4/turret/light-1440-open.png`). |
| 15 | Screenshot test | 4 | 4 | The ceramic dial holds up; the phone artboard sits off-centre, 76 px left and 20 px right (`final-scan/390.png`). |

## Verified fixed since round 3

Stop-name scaling, forced-colour swatches, light Workbench material, the 16 px sheet gutter, flat Composer lists, RTL chevrons, the 1440 subline, import copy and the Open focus ring (`final-scan/open-focus2.png`). No FAILs. Phone Composer dead space is only partly fixed (defect 6).

## Defects, most severe first

1. **The scrubber track goes blank in forced colours** (`r4/turret/forced-1440-peek-key.png`). Owner: `studio-workspace/src/precision-scrubber.tsx`.
2. **200 % text breaks the shell.** At 390, Save is clipped and the tool rail overlaps the toolbar. At 1440, the layers panel runs under the right rail and the popover covers the toast (`r4/turret/text200-390-closed.png`, `text200-1440-open.png`). Owners: the studio-preview header and the `prism-editor.tsx` rail and panel offsets.
3. **The face readout does not scale**, so stop names outgrow it at 200 % (`text200-1440-open.png`). Owner: `persona-turret.tsx`.
4. **The dark import error uses the info ground** (`r4/composer/dark-390-import-error.png`). Owner: `persona-composer.tsx`. "Dismiss" also sits 12 px right of the message text.
5. **Open and the Surfaces control render as dark slabs in light theme** (`r4/composer/light-390-empty.png`). The kit is fixed, so the fix is to pick a theme-following variant in `prism-editor.tsx` and `persona-composer.tsx`.
6. **The phone Composer has two left edges** (x16 and x28), with about 60 px gaps after Name and after Capabilities (`r4/composer/light-390-empty.png`). Owner: the `persona-composer.tsx` narrow layout.
7. **Layer rows print the raw `rect` enum.** Owner: `prism-editor.tsx` line 274.
8. **The phone artboard is off-centre** (`final-scan/390.png`). Owner: the `prism-editor.tsx` canvas layout.
9. **Warn left unanswered:** "Picture renders as a flat block" at 1440 is the empty white Layer 1. Note it as a true state or seed content (`final-scan/scan.json`).

## Stop rule

Done needs every line at 4 or above, lines 5, 9 and 12 at 5, no FAILs, and every warn answered. That is not met. Round 4 used up the base budget, and no plateau has been reached: lines 3, 8 and 12 improved.

**At their web ceiling, blocked only by device evidence:** line 9 (120 Hz detent travel, end-stop nudge, commit rim, haptics on iPhone and Android), line 13 (native host, predictive back, VoiceOver one stop per swipe), and line 11 (iPad anchored popover, Duo hinge-safe sheet, XR panel; nothing more can be shown on web).

**Line 12 is not at its web ceiling.** Defects 1 and 2 are web work. After them, line 12 needs only the Dynamic Type XXL, Android 200 %, VoiceOver and TalkBack walks.

**Web work remains**, all small and owned in this repo: defects 1–9. They lift lines 4, 6, 7, 10, 12, 14 and 15. Decision: one optional "go for 5" web pass on defects 1–9, verified by recapture rather than a full round, then device testing.
