# @nitro-forge/telemetry

Consent-gated timings, failures and debug traces for Forge engine calls, plus
a capturing adapter for tests. Payloads and document content are never
recorded.

**Status:** deferred. Not in the v1 release set:
[RELEASE_TRAIN.md](../../docs/release/RELEASE_TRAIN.md) names Ignition and the
seven engines only, so v1 releases attach no tarball for this package. The
source and tests stay in this repository.

## Install

There is no release tarball. Inside this repository, add it as a workspace
dependency:

```json
{ "dependencies": { "@nitro-forge/telemetry": "workspace:*" } }
```

It depends on [`@nitro-forge/ignition`](../ignition/README.md), whose peer
dependencies are `react-native-nitro-modules` and `nitro-core` at
`1.0.0-alpha.nightly.136.gdb81de61bd32`. Telemetry declares no peer
dependencies of its own.

## Usage

<!-- readme-example -->
```ts
import { createNitroHost } from "@nitro-forge/ignition";
import { PrismDocument } from "@nitro-forge/prism";
import { createTelemetry, instrumentHost } from "@nitro-forge/telemetry";

const telemetry = createTelemetry({ consent: "local" }); // keep events on the device
const host = instrumentHost(createNitroHost(), telemetry);

const image = await PrismDocument.open(host, 16, 16);
const layer = (await image.addRasterLayer("Private name")).data.layer_id;
await image.fillLayer(layer, [0, 0, 255, 255]);
const bytes = await image.save(); // NFD1 snapshot
await image.close();

const reopened = await PrismDocument.openSnapshot(host, bytes);
await reopened.setLayerOpacity(layer, 0.25);
await reopened.undo();
await reopened.redo();
await reopened.close();
await host.dispose();

const trace = telemetry.exportTrace(); // for a bug report
const spans = trace.events.filter((e) => e.type === "span").map((e) => e.name);
console.log(spans.includes("engine.undo") && spans.includes("engine.redo")); // true
console.log(JSON.stringify(trace).includes("Private name")); // false
```

`instrumentHost` wraps any `EngineHost` and returns one that behaves the same:
same results, same errors. It records `engine.open`, `engine.apply` (engine
and op name), `engine.snapshot`, `engine.restore`, `engine.undo`,
`engine.redo` and `engine.close`.

Consent decides what happens to events:

| Consent | Effect |
| --- | --- |
| `off` | Nothing is recorded. |
| `local` | Events stay in a bounded on-device buffer that `exportTrace()` returns. Nothing is sent. |
| `diagnostics` | As `local`, and batches go to the app's `sink`. Sink batches carry error codes, never failure messages. |

Lowering consent with `setConsent` clears what the old setting allowed.
Attribute strings that do not look like identifiers are dropped.

This example runs in CI: `tests/readme-example.e2e.test.ts` runs it against the
Rust engine through `nf-cli`, with `createNitroHost()` replaced by `CliHost`.

## Entry points

| Import | Use it for |
| --- | --- |
| `@nitro-forge/telemetry` | `createTelemetry`, `instrumentHost`, `redactAttributes`, `scrubMessage` and the event types. |
| `@nitro-forge/telemetry/testing` | `createTestTelemetry`: a `diagnostics` telemetry with a manual clock and a capturing sink, for asserting what an engine flow records. |

## Reference

- The host contract it wraps: [ARCHITECTURE.md](../../docs/ARCHITECTURE.md)
