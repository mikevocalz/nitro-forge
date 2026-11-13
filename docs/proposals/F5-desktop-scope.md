# F5: desktop scope for Forge v1

Status: Decided, STRIKE for desktop v1. No desktop implementation or spike result is claimed.
Date: 2026-11-13
Decider: the integrator (A0), on the owner's instruction to drop the F5 spike.
Owner confirmation: pending.
Baselines read: nitro-forge PR #80 at `f0634479a60f006fa0180eae6de8aea9cddfc8b8`; `master` at `93783680d7bf9a757170dc1cbec93c2c476c8e34`.

This supersedes the conditional BUILD decision dated 2026-11-12. The owner
instructed the integrator to drop the spike; the strike does not mean that a
spike ran or failed.

## ADR F5-1: which studios get a desktop build for v1

### Context

Forge runs on React Native 0.88.1 and loads its Rust engines through the
Nitro v1 bridge in `@nitro-forge/ignition`
([NITRO_V1_HOST_INTEGRATION.md](../native/NITRO_V1_HOST_INTEGRATION.md)).
The macOS desktop lane is Legend Spark, on React Native 0.83.10 and Nitro
0.37. The existing Forge Nitro v1 alpha bridge has no verified load path in
that lane.

The Apple archive script at the master baseline above,
`packages/ignition/scripts/build-apple.sh`, builds arm64 iPhone and universal
arm64/x86_64 iOS simulator slices. It has no macOS target or slice.

The `nf-sys` C ABI (`nf_v1.h`) and the JSON-lines host protocol are possible
alternative load paths. Neither has a receipt showing a Forge engine loaded
inside the Spark desktop app. Their existence does not prove desktop ABI
compatibility.

`compatibility.v1.json` keeps `desktop-macos` and `desktop-windows` at
`NOT RUN`: no desktop target exists.

### Decision

Decided 2026-11-13 by the integrator (A0) on the owner's instruction to drop
the F5 spike. Owner confirmation: pending.

| Scope | Decision | Return condition |
| --- | --- | --- |
| Suite app and Prism on macOS through Spark | STRIKE from Forge v1; drop the spike | Reconsider after the Spark lane runs React Native `>=0.88` or supports the pinned Nitro v1 bridge; then require a macOS engine artifact and an actual Spark-hosted document round-trip receipt before claiming support |
| Windows desktop | DEFER past v1 | A separately approved Windows host/runtime plan and its own native engine round-trip receipt |
| Quill, Tally, Pitch, Folio, Splice, Cadence | No desktop build in v1 | A later scoped desktop proposal and target evidence |

Dropping the desktop spike does not waive F5 item 4. Every studio still needs
iPad windowed-mode toolbar-clearance verification. This change records no
iPad result.

### Consequences

- There is no v1 desktop target for F5 items 2 and 3 (window title bar, menus
  and shortcuts), and no desktop build or test is claimed.
- The previous planned spike is cancelled. No pass/fail result is inferred.
- F5 is recorded as `blocked` in `docs/release/v1-readiness.json`. Its
  `statusReason` records the strike and the remaining iPad check. The current
  schema has no `struck` status; neither the validator nor its status values
  change, and F5's acceptance text stays intact.
- Stable readiness continues to require every gate to pass as written. This
  ADR does not satisfy F5 or authorize a validator exception.
- `compatibility.v1.json` and `ROSTER.md` remain unchanged. F0 and F7 refresh
  those records when new platform evidence exists.
