import type { EngineHost } from '@nitro-forge/ignition';

async function request<T>(op: string, ...args: unknown[]): Promise<T> {
  const response = await fetch('/api/engine', {
    method: 'POST', headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ op, args }),
  });
  const result = await response.json() as { data: T; error?: string };
  if (!response.ok) throw new Error(result.error ?? 'Engine request failed');
  return result.data;
}

export const browserHost: EngineHost = {
  open: kind => request('open', kind),
  apply: (handle, cmd) => request('apply', handle, cmd),
  snapshot: async handle => new Uint8Array(await request<number[]>('snapshot', handle)),
  restore: (handle, bytes) => request('restore', handle, Array.from(bytes)),
  undo: handle => request('undo', handle),
  redo: handle => request('redo', handle),
  close: handle => request('close', handle),
  dispose: async () => {},
};
