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

## Shared UI ownership — NYC-Tron UI (2026-11-04)

Reusable presentational components and native controls are owned by the separate
private `mikevocalz/NYC-Tron-UI` repository, under
`packages/ui/src/components/`. Individual Forge instruments live at
`packages/ui/src/components/forge/` and are imported by named subpath
(`@nyc-tron/ui/components/forge/<Component>`) when released.

**Do not create a second permanent generic/Forge UI implementation in this
engine repository.** Keep `@nitro-forge/ignition`, `prism`, `cadence`,
`splice`, `folio`, `pitch`, `tally` and `quill` focused on document state,
commands, transport and per-editor composition. The suite may install all
engines; an embedded consumer installs only the needed engine(s).

Draft branches created before extraction (#18–37) are source references.
Do not delete them or migrate them automatically. After NYC-Tron controls are
published and natively validated, replace their UI implementations in
dedicated integration PRs, preserving behavior, source ownership, and test
evidence. `NYC-Tron-UI -> Nitro-Forge` is forbidden; the dependency direction
must be `Nitro-Forge -> NYC-Tron-UI`. Keep app-provided theme CSS and avoid a
NYC-MON palette dependency.

Read `docs/NYC_TRON_UI_HANDOFF.md` before any Forge controls or studio UI work.
