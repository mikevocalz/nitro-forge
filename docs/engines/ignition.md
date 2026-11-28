---
name: "Ignition"
namespace: "@nitro-forge"
subpath: "@nitro-forge/ignition"
tier: 2
docs: "generated"
platforms: []
category: "primitive"
tokens: []
registryDependencies: []
a11yStatus: "unverified"
---

# Ignition

## Purpose

<!-- generated:begin purpose source=packages/ignition/package.json -->
Nitro-Forge native integration layer: engine session contracts, Nitro HybridObject spec, and host transports. Not a registry item. Decision 4. shadcn copies files. It cannot run nitrogen, pod install or CMake. Documented as a prerequisite with the exact commands in docs/agent-native/install-order.md.
<!-- generated:end purpose -->

## Install

<!-- generated:begin install source=packages/ignition/package.json,compatibility.v1.json,tooling/docs/examples/ignition.ts -->
- Package: `@nitro-forge/ignition`
- Import: `import { DocumentHandle, EngineError, type EngineHost } from '@nitro-forge/ignition';`
- Peers: `react-native-nitro-modules`, `nitro-core`
- Requires: Rust, Xcode or the Android NDK; see docs/agent-native/install-order.md steps 0 and 1
- Command: not available. No tag, release or tarball exists (compatibility.v1.json distribution status NOT RUN), and the package is 0.1.0 inside a monorepo. Install by `workspace:*` inside this repo.
- Installs: none
- Files: `packages/ignition` in the repo; nothing is copied by shadcn
<!-- generated:end install -->

## Props

<!-- generated:begin props source=packages/ignition/package.json,packages/ignition/src/index.ts -->
Not a component, so there are no props. 14 entry points: `@nitro-forge/ignition`, `@nitro-forge/ignition/cli`, `@nitro-forge/ignition/nitro`, `@nitro-forge/ignition/v1-host`, `@nitro-forge/ignition/workspace`, `@nitro-forge/ignition/transfer`, `@nitro-forge/ignition/workspace-ui`, `@nitro-forge/ignition/transfer-ui`, `@nitro-forge/ignition/autosave`, `@nitro-forge/ignition/transactions`, `@nitro-forge/ignition/collaboration`, `@nitro-forge/ignition/collaboration-http`, `@nitro-forge/ignition/collaboration-checkpoint`, `@nitro-forge/ignition/app.plugin.cjs`.
<!-- generated:end props -->

## Variants

<!-- generated:begin variants source=packages/ignition/package.json -->
none
<!-- generated:end variants -->

## States

<!-- generated:begin states source=packages/ignition/src/document.ts,packages/ignition/package.json -->
A `DocumentHandle` is live from `open`, `openInitialized` or `openSnapshot` until `close`. After `close`, every call throws `document handle <id> is closed`. A failed `apply` throws `EngineError` and leaves the document, its ids and both history stacks unchanged; `applyBatch` takes 1 to 64 commands and commits them as one undo step. `undo` and `redo` resolve `false` when there is nothing to move. Contract: docs/ARCHITECTURE.md.
<!-- generated:end states -->

## A11y

<!-- generated:begin a11y source=packages/ignition/package.json -->
Not UI. Nothing in this package renders, so there is nothing to review. The studio components that render engine state carry their own A11y sections in docs/components/.
<!-- generated:end a11y -->

## Example

<!-- generated:begin example source=tooling/docs/examples/ignition.ts,docs/ENGINE_OPS.md -->
`pnpm test:docs-examples` runs this file (`tooling/docs/examples/ignition.ts`) against the real engine through nf-cli (`tooling/docs/examples.test.ts`). It fails if the example sends an op it does not declare, or declares one that is missing from the tally-engine section of docs/ENGINE_OPS.md or from the package source. Ops: `new`, `setCell`, `getCell`, `__batch`.

The example takes an `EngineHost`. In an app that is `createNitroHost()` from `@nitro-forge/ignition`; in Node it is `new CliHost()` from `@nitro-forge/ignition/cli`, after `cargo build --locked -p nf-cli`.

```ts example=ignition
import assert from 'node:assert/strict';
import { DocumentHandle, EngineError, type EngineHost } from '@nitro-forge/ignition';

export const engine = 'tally';
export const ops = ['new', 'setCell', 'getCell', '__batch'];

export async function example(host: EngineHost) {
  const doc = await DocumentHandle.openInitialized(host, 'tally', (d) => d.apply('new', {}));
  await doc.apply('setCell', { addr: 'A1', value: '2' });
  await doc.applyBatch([
    { op: 'setCell', payload: { addr: 'A2', value: '3' } },
    { op: 'setCell', payload: { addr: 'A3', value: '=A1*A2' } },
  ]);
  const cell = async (addr: string) => (await doc.apply<{ computed: unknown }>('getCell', { addr })).data.computed;
  assert.equal(await cell('A3'), 6);

  await assert.rejects(doc.apply('setCell', { addr: '!!', value: 'x' }), EngineError);
  assert.equal(await cell('A3'), 6);

  const bytes = await doc.snapshot();
  await doc.close();

  const reopened = await DocumentHandle.openSnapshot(host, 'tally', bytes);
  const value = async (addr: string) => (await reopened.apply<{ computed: unknown }>('getCell', { addr })).data.computed;
  assert.equal(await value('A3'), 6);
  await reopened.apply('setCell', { addr: 'A1', value: '5' });
  assert.equal(await value('A3'), 15);
  assert.equal(await reopened.undo(), true);
  assert.equal(await value('A3'), 6);
  assert.equal(await reopened.redo(), true);
  assert.equal(await value('A3'), 15);
  await reopened.close();
}
```
<!-- generated:end example -->

## Do/Don't

<!-- generated:begin dont source=registry-excluded.json -->
### Do

- Create the host once per app with `createNitroHost()`; in Node tests use `new CliHost()` from `@nitro-forge/ignition/cli` after `cargo build --locked -p nf-cli`.
- Prefer an engine facade (`TallyDocument`, `PrismDocument` and the rest) over raw `apply` calls; the facades carry the payload types from docs/ENGINE_OPS.md.
- Check `registry-excluded.json` for the reason and the condition for returning.

### Don't

- Do not call `__undo`, `__redo` or `__snapshot` through `apply`; they are host ops. Use `undo()`, `redo()` and `snapshot()`.
- Do not run `shadcn add` for this package; shadcn cannot run nitrogen, pod install or CMake (decision 4).
- Do not publish or invent a release URL for it.
<!-- generated:end dont -->
