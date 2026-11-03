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
pnpm install --frozen-lockfile
pnpm run build:packages       # compiled ESM + declarations for all 8 packages
cargo build -p nf-cli          # builds every engine
pnpm -r test                   # vitest e2e suites → real Rust engines
cargo test --workspace         # engine unit tests
pnpm --filter @nitro-forge/console demo
```

## Using a package

```ts
import { CliHost } from "@nitro-forge/ignition/cli";
import { TallyDocument } from "@nitro-forge/tally";

const host = new CliHost(process.env.NF_CLI); // Node; supply binary outside repo
const sheet = await TallyDocument.open(host);
await sheet.setCell("A1", "=SUM(1,2,3)");
const bytes = await sheet.save();        // versioned NFD1 envelope
await sheet.close();
await host.dispose();
```

Every document supports `open`/`create` → mutate → `save()` → reopen
(`openSnapshot`) → `undo()`/`redo()` → `close()`. Engines run offline; AI
providers are never required.

## Build and distribution

`pnpm run check:packages` builds and packs Ignition plus all seven engine APIs,
then checks the tarballs from an isolated Node/TypeScript consumer. See
[docs/PACKAGING.md](docs/PACKAGING.md) for export boundaries, the `Forge` type
import migration and native release requirements. Local tarballs are previews;
no Rust binary or linked native module is included.

## Status

See `docs/ROSTER.md` for what is verified vs. pending (native packaging,
on-device UI, performance budgets).

