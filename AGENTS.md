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

<!-- BEGIN:turborepo-agent-rules -->

# This is NOT the Turborepo you know

Turborepo configuration, task behavior, and CLI commands can vary between installed versions and may differ from your training data. Resolve the `turbo` package from this file's directory or relevant workspace; in monorepos, it may not be visible from the repository root. For example, run `node -p "require.resolve('turbo/package.json')"` from a workspace that depends on `turbo`.

Read `docs/README.md` inside that installed package first, then read the relevant pages from its `docs/` directory before changing Turborepo configuration or commands. Heed deprecation notices. These bundled docs match the installed package version and are available without network access.

This block is written and re-added by `turbo` before repository-scoped commands when an AI agent is detected. In the Turborepo source repository, its template is defined in `crates/turborepo-cli/src/cli/agent_guidance.rs`. Removing the managed block while updates are enabled means a later qualifying invocation will add it again. Set `"agentGuidance": false` in the root `turbo.json` or `turbo.jsonc` to opt out; this does not remove an existing block. Keep the block committed with your work to avoid an uncommitted change on the next agent invocation.
<!-- END:turborepo-agent-rules -->
