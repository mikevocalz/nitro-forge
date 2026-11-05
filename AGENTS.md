# Nitro-Forge — agent guide

## What this is
Monorepo of seven document engines (Prism, Cadence, Splice, Folio, Pitch, Tally,
Quill), each a pure-Rust crate implementing `ignition_core::Engine`, exposed to
TypeScript through `@nitro-forge/ignition` (Nitro in production, `nf-cli` in tests).

## Contracts (read before editing)
- `docs/ARCHITECTURE.md` — Engine trait semantics, threading, ownership, undo,
  envelope format, error codes.
- `docs/ENGINE_OPS.md` — authoritative op names/payloads per engine. The TS APIs
  and the Rust engines must stay in sync with it.
- `docs/ROSTER.md` — what has actually been verified.

## Commands
```bash
cargo test --workspace          # all engine + contract + FFI tests
cargo build -p nf-cli           # build the JSON-lines test host
pnpm -r test                    # vitest e2e suites (drive real engines via nf-cli)
pnpm -r typecheck               # tsc --noEmit per package
pnpm --filter @nitro-forge/console demo   # all-engines workflow demo
```

## Rules for contributors (human or agent)
- Engines are synchronous, single-threaded, I/O-free, `Send`-only state machines.
- `apply` must be atomic: validate fully before mutating; errors leave state intact.
- Mutating ops record a `Journal` undo entry before mutation and emit
  `document:changed`; read-only ops record nothing and emit nothing.
- Snapshots are the `NFD1` envelope (`ignition_core::encode_envelope`); `restore`
  must reject bad input without touching state.
- Op names live in `docs/ENGINE_OPS.md` — change the doc and every engine together.
- No `unsafe` inside product engines (FFI lives in `rust/nf-sys` only).
- Never claim verification that wasn't run; update `docs/ROSTER.md` truthfully.

## Advanced native UI extraction

NYC-Tron UI is the single owner of reusable native controls, released as [NYC-Tron `v0.1.0-alpha.1`](https://github.com/mikevocalz/NYC-Tron-UI/releases/tag/v0.1.0-alpha.1) (GitHub Release tarballs, not npm; the controls came in via NYC-Tron PR #2). Forge adds only Rust/native engine behavior and typed adapters. Inspect [the source-port roster](docs/ADVANCED_NATIVE_PORT_ROSTER.md) before introducing an upstream port; file-level license review is mandatory. Never recreate the knob, graph, crop overlay, or generic native popup inside Forge.
