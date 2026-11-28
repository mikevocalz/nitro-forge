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

Packages that import `@nitro-forge/editor-controls` typecheck against its
declaration build (`packages/editor-controls/dist`, not committed). `turbo run
typecheck` builds it first. Before typechecking one package on its own, run
`pnpm --filter @nitro-forge/editor-controls build`.

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

## Existing UI controls first

User requirement (2026-11-03), moved to NYC-Tron UI by rule #38 (2026-11-05:
Forge imports NYC-Tron), revised by the owner on 2026-11-28: Forge consumes
NYC-Tron UI's general app UI from the release pinned in `tooling/nyc-tron.json`
(bound in `packages/studio-workspace/src/nyc-tron-host.tsx`), and NYC-Tron UI
never depends on Forge. Use that inventory before assembling custom controls.
Use its TabBar for tab panels and its SegmentedControl for mutually exclusive
choices, alongside the existing native Menu/Select, semantic ui/html and input
components. Do not recreate NYC-Tron's general controls inside Forge; if one is
missing, add it to NYC-Tron UI and move the pin. Extend the strict Studio UI
provider when a canonical component is missing from that boundary. Preserve
rounded-sm (4px) Studio chrome. Do not substitute action buttons or fake modes
for existing controls; keep app navigation, tabs and radio choices distinct.

## Advanced native UI extraction

Owner decision (2026-11-28): the editor controls (audio, timeline, spreadsheet,
canvas, color, layers, photo, motion, office and the rest) live in Forge, in
`packages/editor-controls` (`@nitro-forge/editor-controls`). They moved there
unchanged from NYC-Tron UI's `packages/ui/src/components/forge/` at commit
`5a1ea4db`; see `packages/editor-controls/README.md` for the import mapping.
Import them as `@nitro-forge/editor-controls/<path>`. Nothing in Forge may
import `@nyc-tron/ui/components/forge/*`; `node tooling/verify-nyc-tron-pin.mjs`
fails if anything does.

The editor controls build on NYC-Tron's general primitives (gestures, stores,
styles, shell inputs) from the pinned release
[NYC-Tron `v1.0.0-rc.2`](https://github.com/mikevocalz/NYC-Tron-UI/releases/tag/v1.0.0-rc.2)
(GitHub Release tarballs, not npm). rc.2 lacks 20 of the subpaths they import,
so `patches/@nyc-tron__ui@1.0.0-rc.2.patch` adds those export-map entries;
delete it when the pin moves to the next release. Forge packages add Rust and
native engine behavior and typed adapters. Keep one implementation of each
control: extend the knob, graph, crop overlay and the other controls in
`packages/editor-controls` rather than writing new ones in another package, and
take generic native popups from NYC-Tron UI. Inspect
[the source-port roster](docs/ADVANCED_NATIVE_PORT_ROSTER.md) before introducing
an upstream port; file-level license review is mandatory, and ported files are
listed in `packages/editor-controls/THIRD_PARTY_NOTICES.md`.

## Writing and native skills

User requirement (2026-11-06): apply `nyc-mon/skills/no-ai-slop/SKILL.md` to
user-facing updates and documentation. Use the relevant React Native, Nitro v1,
Swift/Kotlin/C++ and native testing skills before implementation or debugging.
Keep each skill's platform/version guidance aligned with this repository's
pinned runtime and preserve its state, window and ownership contracts.

User requirement (2026-11-07): use subagents for scoped implementation and independent review. Apply relevant native, domain and project skills, and the no-ai-slop skill, to implementation and reports.

## Library dependency and application acceptance ownership

Owner direction (2026-11-22): NYC-Tron is an independent UI library; Forge
consumes its public APIs and owns its own application acceptance program in F7.
Tron never imports, waits on or is gated by Forge. Reusable control changes
belong in Tron; document/engine behavior and application acceptance belong here.

Use `docs/completion/library-progress.json` for the adopted source/acceptance
record, `components.json` for Forge's separate completion gates, and the
completion-plan CI validators for each. Preserve the canonical baseline and
five separately counted window-control additions. Keep all eight required
platforms unless the owner makes a separate Forge decision. A Tron library
release does not promote Forge completion, acceptance or platform evidence.
Measure new acceptance against the exact release in `tooling/nyc-tron.json`.
The adoption source pin is historical provenance, and the consumer remains on
rc.2 until the separate release-pin PR is verified. Preserve all dated proof.
