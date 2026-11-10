# DIRECTION — Nitro Forge Persona

## Brief (self-authored, user-approved defaults)

- **What:** landing page + guided-capture flow prototype for Nitro Forge
  Persona — phone-captured facial persona for XR headsets.
- **Who:** developers and XR makers evaluating the SDK.
- **One job (10 seconds):** understand "your face, captured on your phone,
  live in a headset" and start a capture.
- **Feel:** Tron/glassmorphism (user pick), designed without photos.
- **Images:** none generated; richness is the real GNM head render
  (`assets/head-glass.png`, actual GNM Head V3 bind-pose geometry rendered
  by our own matplotlib pipeline) plus light inside glass objects.

## Category default refused

XR/avatar products default to dark navy + glowing cyan wireframe head +
"AI-powered" copy + three feature cards. Refused: no wireframe decoration,
no feature-card grid, no stats strip, no "Ready to get started?" band.

## Concept sentences

- A. "Nitro Forge Persona is a pane of glass that learns your face." —
  **Objects/materials**. Chosen.
- B. "Nitro Forge Persona is a flight strip for one face." — Media. Lost:
  competent light-SaaS, least distinctive.
- C. "Nitro Forge Persona is a planetarium dome for a single face." —
  Places. Lost: cinematic dusk reads editorial, not Tron/glass.

## Winner: A — dark glass field

Glass is the literal material: frosted panels, light living inside the
persona orb, the capture screen as a piece of the same glass. Cyan
(#4FE3C1) is owned by exactly one thing — the persona light — and appears
only where the persona is present (orb, live gate verdicts, CTA).

## Tokens

- Ground: `#070B14` near-black blue, two owned radial fields (steel blue
  top-right, deep teal bottom-left) + a centred scrim behind the headline.
- Ink: `#EAF2F8`; muted `#8FA3B8`; faint `#5C6E82` (decorative only).
- Accent: `#4FE3C1` (persona light) on `#04231C` ink for actions.
- Type: **Clash Display** (Fontshare) — heavy grotesque with real
  character for display; reason: Tron-adjacent techno voice without
  resorting to Orbitron/Michroma costume. **Satoshi** (Fontshare) — text
  and UI, warm-neutral grotesque that stays out of the way.
  **IBM Plex Mono** — only for true instrument labels (step counters,
  gate names); never eyebrows over sections.
- Radius family: 999px pills (actions), 28px cards, 36–46px phone shell —
  concentric, glass-appropriate.
- Grain: SVG turbulence overlay at 10% multiply — gives the dark ground
  a material, not a flat fill.

## Imagery / richness source

The GNM Head V3 bind-pose render (`assets/head-glass.png`), produced by
`native/persona/tools` matplotlib pipeline — real pipeline output, not
stock. Grade: desaturated, low-opacity inside the orb (multiply-free,
normal blend) so it reads as light through glass, not a pasted photo.

## Layering plan

- Hero: three-plane composition — dark ground / staggered display
  headline / frosted glass card breaking the middle line, orb lit within.
- Pipeline: horizontal rail of five glass steps; the rail itself is the
  object crossing the section edge (scroll-snap, peeks on phone).
- Gates: five lit glass cards, each with a cyan top hairline — colour
  concentrated in the objects that own it.
- Capture: phone shell (dark bezel, glass screen) floating beside copy —
  the product itself as the image.
- CTA: type-only poster break, cyan reserved for the single word "you".

## Rut items used (finish.md §7)

- Dark ground + display face: justified — the product IS a dark-glass XR
  material; the user picked Tron/glassmorphism.
- Glow: one owned cyan glow inside the orb only; no glows on controls.
- No split hero, no dot-matrix, no red accent, no tilted cards, no
  receipt card. Three rut items would have forced rework; we use one.

## Grammar

Site: hero → pipeline rail → gates → product demo → CTA poster → footer.
Each section answers one visitor question; no filler sections.

App (capture.html): single-screen tool-first shell — viewfinder,
gate chips, bottom sheet. States: capture steps, processing, review
(sliders), done. Reachable states via the flow itself.

## Signature

The persona orb: a conic light sweep rotates slowly inside the orb
(8s linear loop), and the same cyan "breathes" into gate chips as they
pass during capture. Reduced-motion: static orb, instant state changes
(CSS animation is decorative-only; content fully visible without JS
except the capture prototype's step logic, which degrades to step 1).

## Voice

"Your face, captured on your phone." Specific, declarative, no marketing
verbs. Copy names real mechanisms (GNM Head V3, five gates, acknowledged
handoff) — the product's honesty is the brand.

## Content

Written inline in index.html / capture.html — real pipeline facts only:
253+383 coefficients, 17,821 verts, Apache-2.0 GNM, verified gate list.
No fake metrics, testimonials, or logos.
