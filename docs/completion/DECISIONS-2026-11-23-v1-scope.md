# v1 scope decisions, 2026-11-23

Decider: the repository owner. Recorded by the integrator (A0) from the owner's
written v1 brief dated 2026-11-23. Each decision changes gate text in
`docs/release/v1-readiness.json` only through the reviewed change that adds this
file; the gate owner and reviewer roles are unchanged.

## D1. Desktop (F5) is out of v1

Confirms the 2026-11-13 strike recorded in
[`docs/proposals/F5-desktop-scope.md`](../proposals/F5-desktop-scope.md), which
said owner confirmation was pending. The owner has now confirmed it.

- F5 status becomes `descoped`. No desktop spike or desktop target runs for v1.
- `tooling/validate-v1.mjs` accepts `descoped` only with a `decision` path under
  `docs/completion/`, the gate's reviewer role (R1 for F5) as signer, and a
  review date. A signed descoped gate does not block stable and is reported
  separately from passed gates.
- F5 item 4 (every studio's top toolbar clears the system window controls when
  the app is windowed on iPad) moves to F8 as item 6. It is mobile work and stays
  in v1.
- Return condition: the ABI and runtime conditions in `F5-desktop-scope.md`.
  Reopening F5 needs a new owner decision.

## D2. F7 component acceptance for v1 is the rendered row set on iOS, Android and web

The component program adopted from NYC-Tron UI (PRs #92 and #93) lists 341
baseline rows and five additions, each with eight platform columns. v1 requires
accepted iOS, Android and web proof for every ledger row that a studio or lab
renders. That set is derived from source imports by a committed script; its
committed output is the list R1 inspects.

Every other row, and the macOS, Windows, visionOS, Quest and PICO columns for
all rows, stay in the ledgers. They are recorded NOT RUN with a post-v1 label.
No row is deleted.

This narrows the eight-platform text #93 added to F7. That text conflicted with
D1: it required macOS and Windows evidence for a release that has no desktop
target.

## D3. The release candidate may ship on Tron rc.2

`1.0.0-rc.1` may ship pinned to NYC-Tron UI `v1.0.0-rc.2`
(`0e09d3be8263b3dbb2eab1a78e5dd66b83b68e44`). Stable `1.0.0` ships only after
the F2 repin to Tron `1.0.0` passes. If Tron `1.0.0` does not exist when every
other gate has passed, that is reported as the single stable blocker. Forge does
not change Tron to get there.

F1 said "all 22 workflows". `.github/workflows` holds 25 files at the commit
that adds this record, so its text now says 25.
