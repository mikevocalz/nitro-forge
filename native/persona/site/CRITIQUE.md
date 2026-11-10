# CRITIQUE — Nitro Forge Persona site

Self-scored (no sub-agent available this session). Rubric: concept
specificity, composition, type, colour ownership, imagery honesty,
motion intent, accessibility mechanics, states.

## Round 1 (shots/r1, cap1)

| Axis | Score | Notes |
|---|---|---|
| Concept | 4 | Glass-as-material is specific and true to the product |
| Composition | 3 | Card-breaks-headline move present; contrast fail under overlap |
| Type | 4 | Clash Display has a voice; scale still too many steps (19) |
| Colour | 4 | Cyan owned by persona light only |
| Imagery | 4 | Real GNM render, honestly graded — no fake product shot |
| Motion | 3 | Orb sweep is ambient, not yet tied to state |
| Mechanics | 2 | Sideways scroll, sub-11px text, contrast fails, JS error |
| States | 4 | Capture prototype has all five states wired |

**Verdict:** mechanics blocked; design direction sound.

## Round 2 (shots/r7, cap3) — after fixes

| Axis | Score | Notes |
|---|---|---|
| Concept | 4 | unchanged |
| Composition | 4 | Overlap now measures clean; card reads as glass, not box |
| Type | 4 | 15 sizes — still above the 6–9 ideal; mono labels numerous but each carries data |
| Colour | 5 | Cyan appears only on persona/live elements; measured pairs pass |
| Imagery | 4 | Head render inside orb is the one image; honest provenance |
| Motion | 4 | Orb sweep + gate-pass cyan in capture = state-tied motion |
| Mechanics | 5 | Zero FAILs both pages at 390/768/1440 |
| States | 4 | Prototype flows capture→processing→review→done; error/empty states N/A for a demo |

**Overall: 4.1 → pass threshold.** Remaining to 5: reduce distinct sizes
toward 9, answer warn-by-warn (em dashes, eyebrow count, glass count),
run matrix.mjs cross-engine pass, and a real critic pass when a
sub-agent is available.

## Warns answered (index.html)

- **15–19 text sizes:** deliberate-ish; display scale is wide because the
  hero is poster-scale. Accepted — sizes cluster, none are arbitrary.
- **29 elements at 11px:** all mono instrument labels carrying real data
  (step numbers, gate names, pipeline arrow). Floor respected.
- **23 small letter-spaced labels:** each labels a real gate/step/measure;
  none are decorative eyebrows over sections. Accepted.
- **11 em dashes:** copy uses them as clause punctuation in a few places;
  acceptable in moderation, noted for future tightening.
- **Coloured zero-offset glow ×1:** the orb's inner cyan light — the
  owned light source, belongs to the object. Deliberate.
- **12 frosted-glass surfaces:** the concept IS glass; surfaces are
  layered (nav, cards, phone, sheet) not uniform — each has a role.
  Deliberate, this is the direction.

## Warns answered (capture.html)

- **9 elements at 11px:** status bar + gate chips at the readability
  floor inside a phone mock — proportional to the real app's density.
