# Contributing

[AGENTS.md](AGENTS.md) is the full guide for anyone changing this repository,
person or agent. This page covers setup, the checks to run and the rules a
review will hold you to.

## Setup

You need Node 24.3 or later, pnpm 12.18.0 (`corepack enable` picks it up from
`package.json`) and a Rust toolchain.

```bash
pnpm install
cargo build --locked -p nf-cli                    # the JSON-lines host the TypeScript tests spawn
pnpm --filter @nitro-forge/editor-controls build  # declarations that some packages typecheck against
```

The tests find `nf-cli` at `target/debug/nf-cli`. Set `NF_CLI` to use a binary
somewhere else.

## Checks

```bash
cargo test --locked --workspace           # engine, contract and FFI tests
pnpm -r test                              # vitest suites against the real engines through nf-cli
pnpm -r typecheck                         # tsc --noEmit per package
pnpm run test:completion-backends         # photo, motion, design, draft and scene
pnpm run test:readme-examples             # every package README example, run against its engine
pnpm --filter @nitro-forge/console demo   # all-engines workflow demo
```

`turbo run typecheck` builds editor-controls first. If you typecheck one
package on its own, build editor-controls before you do.

Run the checks for what you touched, and say in the pull request which ones
you ran and what they printed. Do not claim a check you did not run. Record
verification in [docs/ROSTER.md](docs/ROSTER.md) as it happened.

## Engine rules

- Engines are synchronous, single-threaded, I/O-free, `Send`-only state
  machines.
- `apply` is atomic: validate everything before mutating, and leave the state
  unchanged on error.
- A mutating op records a `Journal` undo entry before it mutates and emits
  `document:changed`. A read-only op records nothing and emits nothing.
- Snapshots use the NFD1 envelope (`ignition_core::encode_envelope`).
  `restore` rejects bad input without touching state.
- Op names and payloads live in [docs/ENGINE_OPS.md](docs/ENGINE_OPS.md). When
  you change one, change the doc, the Rust engine and the TypeScript API in the
  same pull request.
- No `unsafe` in product engines. FFI lives in `rust/nf-sys` only.

## UI rules

- General app UI comes from the NYC-Tron UI release pinned in
  `tooling/nyc-tron.json`. If a control is missing, add it to NYC-Tron UI and
  move the pin; do not rebuild it in Forge.
- Editor controls live in `packages/editor-controls`. Extend the existing
  control rather than writing a second one, and never import
  `@nyc-tron/ui/components/forge/*`. `pnpm run verify:nyc-tron` fails if
  anything does.
- Code ported from another project needs a file-level license review and an
  entry in `packages/editor-controls/THIRD_PARTY_NOTICES.md`. Check
  [the source-port roster](docs/ADVANCED_NATIVE_PORT_ROSTER.md) first.

## Documentation

Write plain sentences that say what the code does. Each public package README
has one usage example under a `<!-- readme-example -->` marker. CI runs it
against the real engine and compares each `console.log` with the value in its
trailing `// comment`. After you edit an example, run:

```bash
node tooling/readme-example.mjs --write   # copy each example into tests/readme-example.ts
pnpm run test:readme-examples
```

Add user-facing changes to the `Unreleased` section of
[CHANGELOG.md](CHANGELOG.md).

## Releases

Forge ships as GitHub Release tarballs: one `pnpm pack` tarball per package
plus `SHA256SUMS`. It is never published to npm, so never run `npm publish` or
`pnpm publish`. The procedure is in
[docs/release/RELEASE_TRAIN.md](docs/release/RELEASE_TRAIN.md).

## Security

Report vulnerabilities privately, as [SECURITY.md](SECURITY.md) describes.
