import { Buffer } from 'node:buffer';
import { expect, it, vi } from 'vitest';
import { PrismDocument } from '../../prism/src/index';
import { CadenceDocument } from '../../cadence/src/index';
import { SpliceDocument } from '../../splice/src/index';
import { FolioDocument } from '../../folio/src/index';
import { PitchDocument } from '../../pitch/src/index';
import { TallyDocument } from '../../tally/src/index';
import { QuillDocument } from '../../quill/src/index';
import type { EngineHost } from '../src/host';

const wrappers = [PrismDocument, CadenceDocument, SpliceDocument, FolioDocument, PitchDocument, TallyDocument, QuillDocument];
function borrowed(kind: 'buffer' | 'view') {
  const backing = Buffer.alloc(32, 99);
  const frame = Buffer.from([78, 70, 68, 49, 0, 2, 0, 0, 0, 123, 125]);
  backing.set(frame, 5);
  return { source: kind === 'buffer' ? backing.subarray(5, 16) : new Uint8Array(backing.buffer, backing.byteOffset + 5, 11), backing };
}
for (const wrapper of wrappers) for (const kind of ['buffer', 'view'] as const) {
  it(`${wrapper.name} owns ${kind} bytes before opening a native session`, async () => {
    let opened!: (handle: number) => void;
    const pending = new Promise<number>(resolve => { opened = resolve; });
    const restore = vi.fn(async () => {}), close = vi.fn(async () => true);
    const host = { open: vi.fn(() => pending), restore, close } as unknown as EngineHost;
    const { source, backing } = borrowed(kind), expected = Uint8Array.from(source);
    const loading = wrapper.openSnapshot(host, source);
    expect(host.open).toHaveBeenCalledOnce();
    backing.fill(0); opened(19);
    const document = await loading;
    expect(restore).toHaveBeenCalledExactlyOnceWith(19, expected);
    await document.close();
    expect(close).toHaveBeenCalledExactlyOnceWith(19);
  });
}
