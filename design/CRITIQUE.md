# Critique, round 2: Prism turret, editor, Composer

Paths are under the local capture folders (not committed). No new captures were taken.

## Scores

| # | Line | Score | Evidence |
|---|---|---|---|
| 1 | Concept | 4 | The dial reads as a detented turret (`r2/desktop-peek-key.png`), but its trigger is a plain "Vector" text button. |
| 2 | Category average | 4 | The turret is like no competitor's (`r1/sheet-workbench-wide.png`), but the layers panel and fill bar are stock cards (`r2/desktop-open.png`). |
| 3 | Slop face | 3 | The Composer is face 3: label rows and ten outline "Add" buttons (`r2/desktop-composer.png`). |
| 4 | Grammar | 3 | The flat kit buttons "New persona" and "Close" sit under the machined dial in one popover (`r2/desktop-open.png`). |
| 5 | Precision | 4 | `2 of 3`, the detents and the Enter/Esc split are exact, but ⌘ tags show on a touch phone (`r2/phone-open.png`). |
| 6 | Typography | 3 | Toolbar and layer meta render at 9 px (`r2/desktop-open.png`), and Composer supporting text matches the titles (`r2/desktop-composer.png`). |
| 7 | Colour | 3 | The accent is on state only on the turret, but spread across ten "Add" outlines (`r2/phone-composer.png`). |
| 8 | Depth | 4 | The turret has three planes and a key light (`r1/workbench/dark-768-open.png`), but the popover has no arrow and no anchor (`r2/desktop-open.png`). |
| 9 | Micro-interactions | 2 | Web has a 120 ms CSS transform only. Native steps, and no haptic or press state is verified. |
| 10 | Craft | 3 | A white artboard strip shows under the phone panel (`r2/phone-open.png`), and there is an 80 px gap between "New persona" and "Close". |
| 11 | Adaptive | 2 | The phone panel is an inline card that hides the canvas (`r2/phone-peek-key.png`). There is no tablet, fold or XR capture of the editor. |
| 12 | Everyone's device | 3 | The web matrix is clean except the scrubber (`r1/matrix/*/matrix.md`). There is no Dynamic Type or screen-reader pass. |
| 13 | Native-ness | 1 | No native capture exists yet (known), and the score stays here until one does. |
| 14 | Copy | 4 | The peek copy is specific, but "Built in. Can't be removed…" repeats four times (`r2/desktop-composer.png`). |
| 15 | Screenshot test | 3 | The dial alone would hold up next to an OP-1 (`r1/workbench/dark-768-peek-key.png`). The editor around it would not (`r2/desktop-open.png`). |

## Change to 5

1. Make the trigger a dial glyph with the persona name, so it reads as a mode.
2. Give the layers panel and fill bar the turret's material and edge light.
3. Replace the Composer's per-row "Add" buttons with a dense toggle grid and a numbered rail strip.
4. Move Close into the panel header as an icon, as in the lab, and make "New persona" a quiet footer.
5. Hide the ⌘ tags on coarse pointers, and show the active persona's shortcut on the trigger.
6. Set an 11 px floor for chrome metadata, and set supporting text at label size in the muted colour.
7. Use the accent only on chosen items.
8. Anchor the popover to its trigger with an arrow, and keep the artboard edge visible.
14. Write the built-in note once as a group caption. Rename the buttons "Close personas" and "Compose new persona".
15. Follows from 1–8.

Lines 9, 11 and 12 also need moving: 9 to native press, detent, end-stop and commit motion with haptics via `onEffect`, captured; 11 to a phone bottom sheet plus iPad, Duo and XR captures; 12 to Dynamic Type XXL, Android 200 % and VoiceOver/TalkBack walks.

## Defects, most severe first

1. **The phone panel covers the canvas.** A stray artboard strip shows under it (`r2/phone-open.png`, `r2/phone-peek-key.png`). Owner: `prism-editor.tsx`, `persona-panel` (`left:12,right:12`). Present it as a sheet through `onOpenPersonas`.
2. **⌘ shortcuts show on touch at 390 px** (`r2/phone-open.png`). Owner: `persona-turret.tsx` `keyboardHost()`, which tests `surface === 'web'` instead of the pointer type.
3. **Text under 11 px.** The toolbar subline and the layer meta are 9 px, and "Fill" is 10 px (`r2/desktop-open.png`). Owner: `prism-editor.tsx`, the `fontSize: 9` and `fontSize: 10` entries.
4. **The popover is not anchored.** The panel starts at x≈106, the trigger sits at x≈280, there is no arrow, and the panel covers the artboard edge (`r2/desktop-open.png`). Owner: `prism-editor.tsx`, `left: 76`.
5. **The persona panel's layout is inconsistent.** The dial is centred, the buttons are left-aligned, there is an 80 px gap, and Close sits at the bottom here but in the header in the lab (`r2/desktop-open.png` against `r1/workbench/dark-768-open.png`). Owner: `prism-editor.tsx`, the persona panel children.
6. **Composer hierarchy collapses.** Supporting text matches the titles, and one sentence repeats four times (`r2/desktop-composer.png`). Owner: the `persona-composer.tsx` `supportingText`; the kit ListItem stays as it is.
7. **The action menu uses the wrong glyph.** ≡ reads as a drag handle (`r2/desktop-composer.png`). Owner: `persona-composer.tsx` `ForgeIcon name="menu"`, which should be an ellipsis.
8. **Save is buried on the phone**, below ten rows (`r2/phone-composer.png`). Owner: the `persona-composer.tsx` narrow layout. Pin the preview and Save, or collapse "Add to rail".
9. **Disabled "Raise" and "Lower" are about 2:1** (`r2/desktop-open.png`). Owner: the `control()` ghost-disabled tone in `prism-editor.tsx`.
10. **"Back to Prism" is bare text with no chevron** (`r2/phone-composer.png`). Owner: the Composer route in `apps/studio-preview`.

## Stop rule

Done needs every line at 4 or above, and lines 5, 9 and 12 at 5. Lines 9, 11 and 13 are at 2 or below. The plateau rule does not apply: the turret improved over round 1. This is round 2 of 4.

**Another round is required.** Fix defects 1–8 first. Line 13 waits on device captures, and line 9 needs the native motion and haptics work.
