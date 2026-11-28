# @nitro-forge/tally

Spreadsheet documents for React Native: cells, formulas, sheets and XLSX/CSV
import and export, computed by a Rust engine on the device.

**Status:** in the v1 release set (`@nitro-forge/ignition` and the seven
engines named in [RELEASE_TRAIN.md](../../docs/release/RELEASE_TRAIN.md)).
v1 is not released yet; gate status is in
[v1-readiness.json](../../docs/release/v1-readiness.json).

## Install

Forge is not published to npm. Each release attaches one tarball per package
to its [GitHub Release](https://github.com/mikevocalz/nitro-forge/releases),
with a `SHA256SUMS` file. No release exists yet, so `<version>` below is a
placeholder: replace it with the release version after the first release.

```bash
BASE=https://github.com/mikevocalz/nitro-forge/releases/download/v<version>
pnpm add "$BASE/nitro-forge-ignition-<version>.tgz" "$BASE/nitro-forge-tally-<version>.tgz" \
  react-native-nitro-modules@1.0.0-alpha.nightly.136.gdb81de61bd32 \
  nitro-core@1.0.0-alpha.nightly.136.gdb81de61bd32
```

The two Nitro packages are peer dependencies of `@nitro-forge/ignition`; Tally
itself declares none. Tally depends on `@nitro-forge/ignition`, which is not on
npm either, so point that dependency at the same tarball in
`pnpm-workspace.yaml`:

```yaml
overrides:
  "@nitro-forge/ignition": https://github.com/mikevocalz/nitro-forge/releases/download/v<version>/nitro-forge-ignition-<version>.tgz
```

Check each tarball against the release's `SHA256SUMS` before you commit the
lockfile. The engine runs inside the Ignition Nitro module, so the app needs a
native development build; Expo Go cannot load it.

## Usage

<!-- readme-example -->
```ts
import { createNitroHost } from "@nitro-forge/ignition";
import { TallyDocument } from "@nitro-forge/tally";

const host = createNitroHost();
const sheet = await TallyDocument.open(host);
await sheet.setCell("A1", "10");
await sheet.setCell("A2", "32");
const total = await sheet.setCell("A3", "=SUM(A1:A2)");
console.log(total.data.computed); // 42

const bytes = await sheet.save(); // NFD1 snapshot
await sheet.close();

const reopened = await TallyDocument.openSnapshot(host, bytes);
await reopened.setCell("A1", "20");
console.log((await reopened.getCell("A3")).data.computed); // 52
await reopened.undo();
console.log((await reopened.getCell("A3")).data.computed); // 42
await reopened.redo();
console.log((await reopened.getCell("A3")).data.computed); // 52
await reopened.close();
await host.dispose();
```

Every method maps to one engine op and resolves to `{ data, events }`. A
rejected call throws `EngineError` and leaves the document unchanged. A value
that starts with `=` is a formula; numeric strings are stored as numbers.

`importXlsx(bytes)`/`exportXlsx()`, `importCsv(text)`/`exportCsv()` and the TSV
pair read and write files. They return or take bytes and strings; writing them
to disk or a share sheet is the app's job.

This example runs in CI: `tests/readme-example.e2e.test.ts` runs it against the
Rust engine through `nf-cli`, with `createNitroHost()` replaced by `CliHost`.

## Entry points

| Import | Use it for |
| --- | --- |
| `@nitro-forge/tally` | `TallyDocument`, the `OPS` name table and the document types. |
| `@nitro-forge/tally/grid-adapter` | Windowed reads and writes for the `SpreadsheetGrid` editor control, plus A1 address helpers. Targets the active sheet. |
| `@nitro-forge/tally/grid-cluster` | Callbacks for sheet tabs, fill handle, cards view and the other spreadsheet controls. Operations the engine lacks are listed in `TALLY_DEFERRED_OPS` and get no callback. |
| `@nitro-forge/tally/transfer` | CSV, TSV and XLSX format descriptions for the file import/export sheet. |

None of these import React or a UI package.

## Reference

- Ops and payloads: [ENGINE_OPS.md, tally-engine](../../docs/ENGINE_OPS.md#tally-engine--tallyenginenew)
- Threading, undo, snapshot envelope and error codes: [ARCHITECTURE.md](../../docs/ARCHITECTURE.md)
