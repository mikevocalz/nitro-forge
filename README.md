# Nitro-Forge

Native document engines for React Native. Seven products — **Prism** (image),
**Cadence** (audio), **Splice** (video), **Folio** (PDF), **Pitch** (slides),
**Tally** (sheets), **Quill** (rich text) — each a pure-Rust engine behind the
shared **Ignition** contract, exposed to React Native through a single Nitro
Module and to Node/tests through the `nf-cli` protocol host.


## Studio UI and Skia v3

NitroForge is the **independent** source of truth for the seven Ignition engines and their optional shared editor UI. See [Studio suite design](docs/STUDIO_UI.md), [ArtCraft upstream integration policy](docs/UPSTREAM.md) and [Skia v3 requirement](docs/SKIA_V3.md).

The Expo example now **targets `react-native-skia@3.8.1` (Graphite)** with `react-native-webgpu@0.19.2` and Expo SDK 58. Skia v2 and `@shopify/react-native-skia` are not the target. Check versions with `pnpm check:skia-v3`. Before the example can be declared build-ready, **regenerate and commit the pnpm lockfile**, run Nitro codegen and build/test iOS, Android and web on actual targets. An SDK pin is not proof of working GPU rendering.

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
