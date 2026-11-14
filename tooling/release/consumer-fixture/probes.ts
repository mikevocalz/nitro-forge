import {
  PrismDocument, CadenceDocument, SpliceDocument, FolioDocument,
  PitchDocument, TallyDocument, QuillDocument,
  type DocumentHandle, type EngineHost,
} from './imports';

export const STUDIOS = ['prism', 'cadence', 'splice', 'folio', 'pitch', 'tally', 'quill'] as const;
export type Studio = typeof STUDIOS[number];

interface NativeDocument {
  readonly handle: DocumentHandle;
  save(): Promise<Uint8Array>;
  undo(): Promise<boolean>;
  redo(): Promise<boolean>;
  close(): Promise<void>;
}
export interface Probe {
  readonly document: NativeDocument;
  edit(): Promise<unknown>;
  /** Additional authoritative fields where describe only reports counts. */
  readState?(): Promise<unknown>;
}

// Sort only object keys. Preserve all document fields and array ordering;
// these seven probes do not exclude source revisions or other engine data.
export function canonical(value: unknown): string {
  const encoded = JSON.stringify(value, (_key, item: unknown) => {
    if (item && typeof item === 'object' && !Array.isArray(item)) {
      return Object.fromEntries(Object.entries(item).sort(([left], [right]) => left < right ? -1 : left > right ? 1 : 0));
    }
    return item;
  });
  if (encoded === undefined) throw new Error('Engine returned no JSON document state');
  return encoded;
}
export async function describe(probe: Probe): Promise<string> {
  if (probe.readState) return canonical(await probe.readState());
  return canonical((await probe.document.handle.apply('describe', {})).data);
}
function numberField(data: unknown, name: string): number {
  if (!data || typeof data !== 'object' || !(name in data)) throw new Error(`Missing engine field ${name}`);
  const value = (data as Record<string, unknown>)[name];
  if (typeof value !== 'number' || !Number.isFinite(value)) throw new Error(`Invalid engine field ${name}`);
  return value;
}

/** Typed package operations backed by the caller's actual Nitro host.
 * openSnapshot creates a fresh native document; it never reuses old handles. */
export async function openProbe(kind: Studio, host: EngineHost, bytes?: Uint8Array): Promise<Probe> {
  switch (kind) {
    case 'prism': {
      const document = bytes ? await PrismDocument.openSnapshot(host, bytes) : await PrismDocument.open(host, 32, 32);
      return { document, edit: async () => {
        const data = (await document.describe()).data;
        return document.resize(numberField(data, 'width') + 1, numberField(data, 'height'));
      } };
    }
    case 'cadence': {
      const document = bytes ? await CadenceDocument.openSnapshot(host, bytes) : await CadenceDocument.open(host, 120);
      return { document, edit: async () => document.setTempo(numberField((await document.describe()).data, 'tempo_bpm') + 1) };
    }
    case 'splice': {
      const document = bytes ? await SpliceDocument.openSnapshot(host, bytes) : await SpliceDocument.open(host, 30);
      return { document, edit: () => document.addSource(1, 'F6 source') };
    }
    case 'folio': {
      const document = bytes ? await FolioDocument.openSnapshot(host, bytes) : await FolioDocument.create(host, 1);
      return {
        document,
        edit: () => document.addAnnotation(0, [10, 10, 20, 20], 'F6 annotation', 'Highlight'),
        readState: async () => ({
          document: (await document.describe()).data,
          annotations: (await document.listAnnotations(0)).data,
        }),
      };
    }
    case 'pitch': {
      const document = bytes ? await PitchDocument.openSnapshot(host, bytes) : await PitchDocument.open(host, 'F6 fixture');
      return { document, edit: () => document.addSlide('blank') };
    }
    case 'tally': {
      const document = bytes ? await TallyDocument.openSnapshot(host, bytes) : await TallyDocument.open(host);
      return { document, edit: () => document.addSheet() };
    }
    case 'quill': {
      const document = bytes ? await QuillDocument.openSnapshot(host, bytes) : await QuillDocument.open(host);
      return { document, edit: () => document.insertText({ block: 0, offset: 0 }, 'F6 ') };
    }
  }
}
