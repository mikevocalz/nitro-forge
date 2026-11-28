---
name: "Tally"
namespace: "@nitro-forge"
subpath: "@nitro-forge/tally"
tier: 2
docs: "generated"
platforms: []
category: "forge"
tokens: []
registryDependencies: []
a11yStatus: "unverified"
---

# Tally

## Purpose

<!-- generated:begin purpose source=packages/tally/package.json,packages/studio-workspace/src/app-manifest.ts -->
Nitro-Forge tally document API. Studio task line (APP_MANIFESTS): "Open a spreadsheet". Not a registry item. Decision 3. The engine needs the Rust binary through @nitro-forge/ignition. The package is 0.1.0 in the monorepo and no tag, release or tarball has been cut for it. A source copy cannot carry the binary.
<!-- generated:end purpose -->

## Install

<!-- generated:begin install source=packages/tally/package.json,compatibility.v1.json,tooling/docs/examples/tally.ts -->
- Package: `@nitro-forge/tally`
- Import: `import { TallyDocument } from '@nitro-forge/tally';`
- Peers: none
- Requires: `@nitro-forge/ignition` (native host, install-order.md step 1)
- Command: not available. No tag, release or tarball exists (compatibility.v1.json distribution status NOT RUN), and the package is 0.1.0 inside a monorepo. Install by `workspace:*` inside this repo.
- Installs: none
- Files: `packages/tally` in the repo; nothing is copied by shadcn
<!-- generated:end install -->

## Props

<!-- generated:begin props source=packages/tally/package.json,packages/tally/src/index.ts -->
Not a component, so there are no props. 4 entry points: `@nitro-forge/tally`, `@nitro-forge/tally/grid-adapter`, `@nitro-forge/tally/grid-cluster`, `@nitro-forge/tally/transfer`. Top-level exports of `src/index.ts` (51): `OPS`, `CellValue`, `CellError`, `CellInfo`, `BorderSide`, `BorderStyle`, `CellBorder`, `CellFormat`, `CellFormatPatch`, `FormatTarget`, `SheetTabTone`, `WorkbookInfo`, `NamedRangeInfo`, `ValidationCriteria`, `ValidationRuleInfo`, `CellValidation`, `FunctionInfo`, `ConditionalFormat`, `ConditionalRuleInput`, `ConditionalRuleInfo`, `ConditionalMatch`, `SortKey`, `FilterRuleInfo`, `FilterRowVisibility`, `FilterRowMatch`, `ChartKind`, `ChartSeriesInput`, `ChartInput`, `ChartInfo`, `ChartPatch`, `SparklineKind`, `SparklineInfo`, `SparklineTarget`, `SheetViewFilter`, `SheetViewInfo`, `CommentInfo`, `CommentAnchor`, `PivotAgg`, `PivotValueInput`, `PivotFilterInput`, and more.
<!-- generated:end props -->

## Variants

<!-- generated:begin variants source=packages/tally/package.json -->
none
<!-- generated:end variants -->

## States

<!-- generated:begin states source=packages/ignition/src/document.ts,packages/tally/package.json -->
A document is live from `open` or `openSnapshot` until `close`. After `close`, every call throws `document handle <id> is closed`. A failed op throws `EngineError` and leaves the document, its ids and its undo history unchanged. `save()` returns the NFD1 snapshot bytes that `openSnapshot` reads. `undo()` and `redo()` resolve `false` when there is nothing to move.
<!-- generated:end states -->

## A11y

<!-- generated:begin a11y source=packages/tally/package.json -->
Not UI. The engine renders nothing on screen, so there is nothing to review here. The studio components that show tally state carry their own A11y sections in docs/components/.
<!-- generated:end a11y -->

## Example

<!-- generated:begin example source=tooling/docs/examples/tally.ts,docs/ENGINE_OPS.md -->
`pnpm test:docs-examples` runs this file (`tooling/docs/examples/tally.ts`) against the real engine through nf-cli (`tooling/docs/examples.test.ts`). It fails if the example sends an op it does not declare, or declares one that is missing from the tally-engine section of docs/ENGINE_OPS.md or from the package source. Ops: `new`, `setCell`, `getCell`.

The example takes an `EngineHost`. In an app that is `createNitroHost()` from `@nitro-forge/ignition`; in Node it is `new CliHost()` from `@nitro-forge/ignition/cli`, after `cargo build --locked -p nf-cli`.

```ts example=tally
import assert from 'node:assert/strict';
import type { EngineHost } from '@nitro-forge/ignition';
import { TallyDocument } from '@nitro-forge/tally';

export const ops = ['new', 'setCell', 'getCell'];

export async function example(host: EngineHost) {
  const doc = await TallyDocument.open(host);
  await doc.setCell('A1', '10');
  await doc.setCell('A2', '20');
  const sum = await doc.setCell('A3', '=A1+A2');
  assert.equal(sum.data.computed, 30);

  const bytes = await doc.save();
  await doc.close();

  const reopened = await TallyDocument.openSnapshot(host, bytes);
  assert.equal((await reopened.getCell('A3')).data.computed, 30);
  await reopened.setCell('A1', '15');
  assert.equal((await reopened.getCell('A3')).data.computed, 35);
  assert.equal(await reopened.undo(), true);
  assert.equal((await reopened.getCell('A3')).data.computed, 30);
  assert.equal(await reopened.redo(), true);
  assert.equal((await reopened.getCell('A3')).data.computed, 35);
  await reopened.close();
}
```
<!-- generated:end example -->

## Do/Don't

<!-- generated:begin dont source=registry-excluded.json -->
### Do

- Read the tally-engine section of `docs/ENGINE_OPS.md` for op names and payloads before calling `apply`.
- Group several edits that must undo together with `handle.applyBatch` (one undo step).
- Treat `@nitro-forge/tally` as a monorepo dependency until a tarball release exists.

### Don't

- Do not run `shadcn add` for this package; it has no registry item (@nitro-forge/tally needs the Rust binary).
- Do not claim an npm install; `compatibility.v1.json` records npm as not used.
- Do not keep your own undo stack; the engine records one entry per mutating op.
<!-- generated:end dont -->
