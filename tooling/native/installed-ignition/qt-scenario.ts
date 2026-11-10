import { createNitroHost, createNativeForgeFactory, ENGINE_KINDS } from '@nitro-forge/ignition';

function check(value: unknown, message: string): asserts value {
  if (!value) throw new Error(message);
}
async function exercise() {
  const host = createNitroHost();
  for (const kind of ENGINE_KINDS) {
    const handle = await host.open(kind);
    await host.apply(handle, { op: 'new', payload: kind === 'prism' ? { width: 4, height: 4 } : {} });
    const before = await host.apply<Record<string, unknown>>(handle, { op: 'describe', payload: {} });
    const snapshot = await host.snapshot(handle);
    check(snapshot[0] === 78 && snapshot[3] === 49, `${kind} did not return NFD1`);
    const reopened = await host.open(kind);
    await host.restore(reopened, snapshot);
    const after = await host.apply<Record<string, unknown>>(reopened, { op: 'describe', payload: {} });
    // Draft's revision belongs to a native session and advances on restore.
    if (kind === 'draft') { delete before.data.source_revision; delete after.data.source_revision; }
    check(JSON.stringify(before.data) === JSON.stringify(after.data), `${kind} lost state on reopen`);
    await host.close(handle);
    await host.close(reopened);
  }
  await host.dispose();

  const factory = createNativeForgeFactory();
  const document = await factory.open('tally');
  await document.apply({ op: 'new', payloadJson: '{}' });
  const first = document.apply({ op: 'setCell', payloadJson: '{"addr":"A1","value":"42"}' });
  const second = document.apply({ op: 'setCell', payloadJson: '{"addr":"A1","value":"8"}' });
  await Promise.all([first, second]);
  check(await document.undo(), 'native undo failed');
  check(JSON.parse((await document.apply({ op: 'getCell', payloadJson: '{"addr":"A1"}' })).dataJson).raw === '42',
    'native FIFO/undo lost the saved cell');
  check(await document.redo(), 'native redo failed');
  const snapshot = await document.snapshot();
  const task = document.startTask({ op: '__snapshot', payloadJson: '{}' });
  const result = await task.result();
  check(result.output instanceof ArrayBuffer, 'native task did not return bytes');
  check(result.output.byteLength === snapshot.byteLength && task.progress >= 0 && task.progress <= 1,
    'native task snapshot/progress failed');
  let rejected = false;
  try { await document.apply({ op: 'unknown', payloadJson: '{}' }); } catch { rejected = true; }
  check(rejected, 'native engine failure did not reject its JavaScript promise');
  const cache = factory.createMediaCache(4);
  await cache.put('a', new Uint8Array([1, 2]).buffer);
  const cached = await cache.get('a');
  check(cached && new Uint8Array(cached)[0] === 1 && cache.byteSize === 2, 'native media cache failed');
  await cache.close();
  await document.close();
  await document.close();
  rejected = false;
  try { await document.snapshot(); } catch { rejected = true; }
  check(rejected, 'closed native document accepted work');
}

Object.assign(globalThis, { nativePackageDone: false, nativePackageResult: undefined });
exercise().then(() => {
  Object.assign(globalThis, { nativePackageDone: true });
}, (error: unknown) => {
  Object.assign(globalThis, { nativePackageDone: true, nativePackageResult: String(error) });
});
