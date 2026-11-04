# Critique, round 3: Prism turret, editor, Composer

Paths are under local capture folders under shots/r3/ (not committed). I took no new captures; the r3 set covered every state I needed.

## Scores

| # | Line | r3 | r2 | Evidence |
|---|---|---|---|---|
| 1 | Concept | 5 | 4 | The trigger is now a dial glyph, the persona name and `⌘1`, so the toolbar names the turret before it opens (`turret/dark-1440-open.png`). |
| 2 | Category average | 4 | 4 | The turret and the Composer's numbered rail are unlike any competitor's, but the out-of-scope layers panel and fill bar are still stock cards (`turret/dark-1440-open.png`). |
| 3 | Slop face | 4 | 3 | Face 3 is gone: a toggle grid and a numbered rail replaced the ten "Add" rows, but the kit lists keep a zero-blur offset slab shadow (`composer/dark-1440-filled.png`). |
| 4 | Grammar | 4 | 3 | The popover is one family now (icon Close in the header, quiet footer), but the Composer puts flat 4 px tiles beside night-slab lists with 18 px names (`composer/dark-1440-filled.png`). |
| 5 | Precision | 5 | 4 | ⌘ tags are gone on touch (`turret/dark-390-open.png`), the trigger carries the shortcut, and `2 of 3` plus "Enter switches to Pixel · Esc keeps Vector" is exact (`turret/dark-768-peek-key.png`). |
| 6 | Typography | 4 | 3 | Chrome meets the 11 px floor and Composer supporting text is muted and smaller, but the face count `1 of 3` is 11 px, under the 13 pt phone readout floor (`turret/shoot-dark/scan.json`). |
| 7 | Colour | 4 | 3 | The accent sits only on chosen tiles and the committed slot (`composer/dark-1440-filled.png`), but in light theme the toolbar, popover and layers stay dark slabs with no light material (`turret/light-1440-commit-flash.png`). |
| 8 | Depth | 4 | 4 | The popover is anchored with an arrow on the trigger's centre (x≈293) and the phone sheet keeps the artboard visible above it (`turret/dark-1440-open.png`, `turret/dark-390-open.png`), but the Composer's hard offset shadows fail the craft floor (`composer/light-768-import-error.png`). |
| 9 | Micro-interactions | 3 | 2 | Pointer travel, the end-stop nudge and the commit rim now run on Reanimated, and an expo-haptics driver maps every effect, but none of it has been seen or felt on hardware. |
| 10 | Craft | 4 | 3 | The artboard strip and the 80 px gap are fixed, but the phone sheet has three left edges: title x20, captions x45, footer x30 (`turret/dark-390-open.png`). |
| 11 | Adaptive | 3 | 2 | The phone sheet, the anchored desktop popover, 320 reflow and the RTL mirror are all captured (`turret/rtl-390-open.png`). There is no iPad, Duo or XR capture. |
| 12 | Everyone's device | 3 | 3 | Forced colours hold the turret, but the fill swatches go blank (`turret/forced-1440-peek-key.png`), and at 200 % the stop names stay small while the captions double (`turret/text200-390-open.png`). |
| 13 | Native-ness | 1 | 1 | Capped: no native capture exists yet. |
| 14 | Copy | 4 | 4 | The built-in note appears once and the buttons say what they do, but "Persona file is not valid JSON" names the problem without a fix (`composer/light-768-import-error.png`). |
| 15 | Screenshot test | 4 | 3 | The dial and its popover would hold up next to an OP-1 (`turret/dark-768-peek-key.png`). The layers panel beside them would not. |

## Fixed since round 2

Defects 1 to 10 from round 2 are all closed: the phone sheet, ⌘ tags on touch, the 9 px text, the anchor and arrow, the panel layout, the Composer hierarchy, the ellipsis glyph, Save reachable on the phone (`composer/dark-390-phone-save-reachable.png`), the disabled tone and the Back chevron.

## Change to 5

2. Restyle the layers panel and the fill bar in the turret's material, in a later scoped round.
3 and 8. In `persona-composer.tsx`, render the rail and the Personas list without the kit's offset-slab variant, using a flat ListItem stack on the tile material.
4. In the Composer, set rail row names at the tile type size so the list and the grid read as one instrument.
6. Set the face count to 13 px on phone (`scale.type.micro + 1`, line 373).
7. Give the light theme its own material for the persona popover and the toolbar: ceramic body, dark engraving.
9. Capture on hardware: a 120 Hz screen recording of detent travel, the end-stop nudge and the commit rim, with haptics confirmed on iPhone and on Android.
10. Put the phone sheet's title, captions and footer on one 16 px gutter.
11. Capture the iPad anchored popover, the Duo hinge-safe sheet and the XR panel.
12. On web, add `forced-color-adjust: none` to the fill swatches and grow the dial with the text scale instead of capping the stop names at 1.3. On device, walk Dynamic Type XXL, Android 200 %, VoiceOver and TalkBack.
13. Capture on a physical iPhone and an Android phone: the turret sheet in the native host, predictive back dismissing it, and VoiceOver on the adjustable ring stepping one stop per swipe.
14. Make the import error say where the file fails and what to do, for example "Ends early at character 31. Paste the whole file and try again."
15. Follows from 2, 4 and 7.

## Defects, most severe first

1. **Turret stop names do not follow text scale.** They are capped at 1.2 and 1.3 while the captions around them double (`turret/text200-390-open.png`). Owner: `persona-turret.tsx` `FACE_TEXT_MAX_SCALE` and `STOP_TEXT_MAX_SCALE`, and the fixed dial size.
2. **The fill swatches lose their colour in forced colours** (`turret/forced-1440-peek-key.png`). Owner: the fill bar in `prism-editor.tsx`.
3. **Light theme leaves the editor chrome dark** (`turret/light-1440-commit-flash.png`). Owner: the light material tokens in `forge-directions.ts` and the popover in `prism-editor.tsx`.
4. **The phone sheet is misaligned:** three left edges at 390, and captions at x10 against the title's x14 at 320 (`turret/dark-390-open.png`, `turret/dark-320-peek-key.png`). Owner: `persona-turret.tsx` caption block and the `prism-editor.tsx` sheet footer.
5. **The Composer's offset-slab shadow and type clash** (`composer/dark-1440-filled.png`). Owner: `persona-composer.tsx`, which picks the List variant. The kit itself stays untouched.
6. **The face count is 11 px** (`turret/shoot-dark/scan.json`). Owner: `persona-turret.tsx` line 373.
7. **"← All apps" does not mirror in RTL** (`turret/rtl-390-open.png`). Owner: the studio-preview shell.
8. **The phone Composer leaves about 70 px of dead space** under the collapsed Instruments and Capabilities headers (`composer/light-390-empty.png`). Owner: the `persona-composer.tsx` narrow layout.
9. **The toolbar truncates "Shape layer · 256 ×…" at 1440** when there is room to spare (`turret/dark-1440-open.png`). Owner: `prism-editor.tsx` toolbar subline.
10. **The import error gives no recovery step** (`composer/light-768-import-error.png`). Owner: the `persona-composer.tsx` import copy.

## Stop rule

Done needs every line at 4 or above and lines 5, 9 and 12 at 5. Line 5 is now at 5. Lines 9, 11, 12 and 13 are below 4. The plateau rule does not apply, since ten lines improved. This is round 3 of 4.

**Decision: one more web round, then device.** Defects 1 to 10 are web work and can lift lines 6, 7, 8, 10 and 14, plus the web half of line 12.

Lines **9 and 13 are blocked only by device evidence**: the native motion and haptics are built and bundle-checked but have not been run on hardware. Lines 11 and 12 need both: the web fixes above, then iPad, Duo and XR captures for 11, and Dynamic Type, Android 200 %, VoiceOver and TalkBack walks for 12.
