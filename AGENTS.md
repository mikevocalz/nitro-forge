# Nitro-Forge — agent guide

## What this is
Monorepo of 12 document engines, each a pure-Rust crate implementing
`ignition_core::Engine`, exposed to TypeScript through `@nitro-forge/ignition`
(Nitro in production, `nf-cli` in tests). `ENGINE_KINDS` in
`packages/ignition/src/types.ts` lists them: prism, cadence, splice, folio, pitch,
tally, quill, photo, motion, design, draft, scene. The first seven are the original
engines. `STUDIOS` in `packages/studio-layout/src/index.ts` lists 11 studios; scene
has none yet. The count was checked against those two files on 2026-11-20.

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

## Existing UI controls first

User requirement (2026-11-03), moved to NYC-Tron UI by rule #38 (2026-11-05:
Forge imports NYC-Tron): use the NYC-Tron UI inventory (release pinned in
`tooling/nyc-tron.json`, bound in `packages/studio-workspace/src/nyc-tron-host.tsx`)
before assembling custom controls. Use its TabBar for tab panels and its
SegmentedControl for mutually exclusive choices, alongside the existing native
Menu/Select, semantic ui/html and input components. Extend the strict Studio UI
provider when a canonical component is missing from that boundary. Preserve
rounded-sm (4px) Studio chrome. Do not substitute action buttons or fake modes
for existing controls; keep app navigation, tabs and radio choices distinct.

## Advanced native UI extraction

NYC-Tron UI is the single owner of reusable native controls. The release pinned in `tooling/nyc-tron.json` is [NYC-Tron `v1.0.0-rc.2`](https://github.com/mikevocalz/NYC-Tron-UI/releases/tag/v1.0.0-rc.2) (GitHub Release tarballs, not npm; the controls came in via NYC-Tron PR #2). Forge adds only Rust/native engine behavior and typed adapters. Inspect [the source-port roster](docs/ADVANCED_NATIVE_PORT_ROSTER.md) before introducing an upstream port; file-level license review is mandatory. Never recreate the knob, graph, crop overlay, or generic native popup inside Forge.

## Writing and native skills

User requirement (2026-11-06): apply `nyc-mon/skills/no-ai-slop/SKILL.md` to
user-facing updates and documentation. Use the relevant React Native, Nitro v1,
Swift/Kotlin/C++ and native testing skills before implementation or debugging.
Keep each skill's platform/version guidance aligned with this repository's
pinned runtime and preserve its state, window and ownership contracts.

User requirement (2026-11-07): use subagents for scoped implementation and independent review. Apply relevant native, domain and project skills, and the no-ai-slop skill, to implementation and reports.

## Agent-native

The studio UI ships as a shadcn registry, `@nitro-forge`, built from this repo. Agents
read `llms.txt`, `SKILL.md` and `docs/components/<item>.md` first.

- Provider first. Every studio component throws without `StudioUIProvider`. Install
  `studio-ui-provider` and `nyc-tron-host` before any other item.
- The registry holds 18 items: the 17 admitted in `docs/agent-native/03-design-handoff.md`
  and `brand-theme`. `registry-excluded.json` lists what is not in it (4 binding adapters,
  12 engines, ignition, studio-layout) with the reason and the condition for returning.
- Do not edit `registry.json`, `r/`, `components.json`, `registry-excluded.json`,
  `docs/components/`, `docs/engines/`, `docs/site/`, `llms.txt` or `llms-full.txt` by hand. Change the
  source, then rebuild:
  `node tooling/registry/build.mjs`, `node tooling/docs/build-docs.mjs`,
  `node tooling/docs/build-site.mjs`. CI regenerates them and fails on a diff.
- Checks: `node tooling/registry/check-imports.mjs` (reads NYC-Tron's registry: `--nyc-tron-registry <path|url>`), `node tooling/registry/validate-registry.mjs`,
  `node tooling/docs/check-docs.mjs`.
- Import specifiers are rewritten only in the generated `r/*.json` (decision 39). Source files
  keep `@nyc-tron/ui/components/...` and `@nitro-forge/...` imports. Never rewrite them in `packages/`.
- NYC-Tron owns reusable controls. Forge items name them as `registryDependencies` with
  `@nyc-tron/<export key>`. Do not copy a control into this registry.
- A rebrand changes three keys per scheme (`accent`, `ink`, `soft`) in `brand.theme.json`.
  The other keys, the 4 px radius and the status colours are locked.
- `a11yStatus` is `reviewed-pass`, `reviewed-fail` or `unverified`. `verified` is reserved for a
  rendered check. Do not set it from a source read.
- The registry URLs use two moving refs in `tooling/registry/config.json`: `nitroForgeRef` (`master`)
  and `nycTronRef` (`main`). They are branches, not release tags. When the owner cuts tags, run
  `node tooling/registry/set-ref.mjs <nitroForgeRef> [nycTronRef]` and commit the regenerated files.
- "No hard-coded values" means what `tooling/codemod/check-no-hardcoded.mjs` checks, listed in its
  header: hex colours, numeric style properties, numeric JSX size props, Tailwind arbitrary values and
  `fs(x + n)` offsets in `packages/*/src`. SVG geometry, data arrays, native code, `apps/` and tests are
  outside it. The gate reports 76 findings, all allowlisted in `tooling/codemod/allowlist.json` with a
  reason. Do not read that as "zero numbers remain".
- Rebrand has two channels: `brandCssVariables` (CSS variables for the NYC-Tron controls) and
  `brandThemeOverrides` (JS colours for `ForgeWorkspace`, `PersonaTurret`, `PersonaComposer`). See
  `docs/components/brand-theme.md`.
- Native code is out of scope for registry and docs work (decision 38).
