# Nitro-Forge

Native document engines for React Native. Seven products — **Prism** (image),
**Cadence** (audio), **Splice** (video), **Folio** (PDF), **Pitch** (slides),
**Tally** (sheets), **Quill** (rich text) — each a pure-Rust engine behind the
shared **Ignition** contract, exposed to React Native through a single Nitro
Module and to Node/tests through the `nf-cli` protocol host.

## Layout

```
rust/
  ignition-core/   Engine trait, commands, errors, journal, snapshot envelope,
                   session registry, JSON-lines protocol
  nf-cli/          stdin/stdout host binary (test + tooling transport)
  nf-sys/          stable C ABI for the Nitro-generated bridge
packages/
  ignition/        @nitro-forge/ignition — TS contracts, EngineHost
                   (NitroHost on device, CliHost in Node), DocumentHandle,
                   Forge.nitro.ts spec
  prism|cadence|splice|folio|pitch|tally|quill/
                   typed product API + the product's Rust engine (rust/)
apps/
  console/         executable workflow demo across all engines
  example/         Expo app driving the packages on-device
docs/
  ARCHITECTURE.md  ratified contracts (threading, ownership, undo, envelopes)
  ENGINE_OPS.md    authoritative op surface per engine
  ROSTER.md        accountability ledger — what ran, what didn't
```

## Quick start

```bash
pnpm install
cargo build -p nf-cli          # builds every engine
pnpm -r test                   # vitest e2e suites → real Rust engines
cargo test --workspace         # engine unit tests
pnpm --filter @nitro-forge/console demo
```

## Installing in another app

Forge ships as GitHub Release tarballs only and never publishes to npm, so do
not install `@nitro-forge/*` by version from a registry. No release has been
cut yet; once one is, an app lists each package by its release asset URL.
`@nitro-forge/ignition` is a peer dependency of every engine, so the app lists
it too and gets one copy of the native module:

```json
"dependencies": {
  "@nitro-forge/ignition": "https://github.com/mikevocalz/nitro-forge/releases/download/v0.1.0/nitro-forge-ignition-0.1.0.tgz",
  "@nitro-forge/tally": "https://github.com/mikevocalz/nitro-forge/releases/download/v0.1.0/nitro-forge-tally-0.1.0.tgz"
}
```

The packed manifests already point their own `@nitro-forge/*` peers at these
URLs (`node tooling/release/pack-tarballs.mjs`, described in
`docs/release/RELEASE_TRAIN.md`).

## Using a package

```ts
import { createNitroHost } from "@nitro-forge/ignition";
import { TallyDocument } from "@nitro-forge/tally";

const host = createNitroHost();          // Nitro on-device; CliHost in Node
const sheet = await TallyDocument.open(host);
await sheet.setCell("A1", "=SUM(1,2,3)");
const bytes = await sheet.save();        // versioned NFD1 envelope
await sheet.close();
```

Every document supports `open`/`create` → mutate → `save()` → reopen
(`openSnapshot`) → `undo()`/`redo()` → `close()`. Engines run offline; AI
providers are never required.

## Status

See `docs/ROSTER.md` for what is verified vs. pending (native packaging,
on-device UI, performance budgets).
