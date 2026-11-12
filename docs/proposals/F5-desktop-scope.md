# F5: desktop scope for Forge v1

Status: Decided, conditional. Nothing in this file is implemented.
Date: 2026-11-12
Deciders: the repository owner (decision taken on the owner's instruction to decide, using BUILD / STRIKE / DEFER)
Baselines read: nitro-forge `master` at `7f4d0cc`; `compatibility.v1.json` desktop entries as committed there

This record answers the F5 owner input: which studios get a desktop build for
v1. It follows the ADR layout of [F3-deferred-rows.md](F3-deferred-rows.md),
with the decision in place of the options.

---

## ADR F5-1: which studios get a desktop build for v1

### Context

Forge runs on React Native 0.88.1 and loads its Rust engines through the
Nitro v1 bridge in `@nitro-forge/ignition`
([NITRO_V1_HOST_INTEGRATION.md](../native/NITRO_V1_HOST_INTEGRATION.md)).
The macOS desktop lane is Legend Spark, which is on React Native 0.83.10 and
Nitro 0.37. The Nitro v1 alpha bridge is not available in that lane.

The current Apple archive from `packages/ignition/scripts/build-apple.sh`
covers iPhone arm64 and Apple Silicon iOS simulators only. No macOS slice of
the engines exists.

Two load paths do not depend on Nitro v1:

- the stable C ABI in `rust/nf-sys` (`nf_v1.h`), and
- the JSON-lines host services (the `nf-cli` wire shape).

`compatibility.v1.json` lists `desktop-macos` and `desktop-windows` as
`NOT RUN`, with the note "No desktop target exists. See gate F5."

### Decision

| Scope | Decision | Condition |
| --- | --- | --- |
| Suite app and Prism (image studio) on macOS through Spark | BUILD, conditional | The F5 spike below passes |
| Same scope if the spike fails | STRIKE from Forge v1 | Returns when the Spark lane runs React Native `>=0.88`, or Nitro v1 runs in that lane |
| Windows desktop | DEFER past v1 | None set for v1 |
| Quill, Tally, Pitch, Folio, Splice, Cadence | No desktop build in v1 | They get the iPad windowed-mode toolbar clearance (F5 item 4) only |

Prism is the desktop studio because it sets the grammar the other studios
inherit (prompt §2.5).

### The spike that gates BUILD

The spike must show that a Forge Rust engine loads in the Spark lane
(React Native 0.83.10, Nitro 0.37) and round-trips a document: open, apply an
op, read the result back, close. It must use the `nf-sys` C ABI or the
JSON-lines host services. A result that goes through the Nitro v1 alpha
bridge does not count.

The spike's receipt names the lane, the commit, the engine, the load path,
and the round-trip it ran. Until that receipt exists, desktop stays out of
v1.

### Consequences

- If the spike passes, F5 items 2 and 3 (window title bar, menus and
  shortcuts) apply to the suite app and Prism on macOS only.
- If the spike fails, `compatibility.v1.json` keeps `desktop-macos` as
  `NOT RUN` and out of v1, with the return condition above. F5 items 2 and 3
  then have no v1 target.
- `desktop-windows` stays `NOT RUN` for v1 either way.
- This record does not edit `compatibility.v1.json`, `ROSTER.md`, any code,
  validator or test. Their entries change with the evidence that F0 and F7
  regenerate.
