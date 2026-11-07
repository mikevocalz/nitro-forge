import { validateCheckpoint, type BinaryCheckpointStorage } from "./autosave";
import type { EngineKind } from "./types";

/** Private application recovery state produced by DocumentCollaboration.checkpoint.
 * Scope its storage key to the service, account and document. Never treat an
 * imported user file as trusted collaboration revision metadata. */
export interface CollaborationCheckpoint {
  readonly version: 1;
  readonly documentId: string;
  readonly kind: EngineKind;
  readonly revision: number;
  readonly dirty: boolean;
  readonly bytes: Uint8Array;
  /** Exact upload retained across an ambiguous response, including later edits. */
  readonly pending?: { readonly bytes: Uint8Array; readonly matchesCurrent: boolean };
}
/** Atomic private recovery storage for DocumentCollaboration checkpoints. */
export interface CollaborationCheckpointStore {
  read(key: string): Promise<CollaborationCheckpoint | undefined>;
  write(key: string, checkpoint: CollaborationCheckpoint): Promise<void>;
}
// NCC1 has independent fixed engine tags; persisted formats never depend on
// the ordering of the runtime engine list.
const TAGS: Readonly<Record<EngineKind, number>> = { prism: 0, cadence: 1, splice: 2, folio: 3, pitch: 4, tally: 5, quill: 6 };
const KINDS = new Map(Object.entries(TAGS).map(([kind, tag]) => [tag, kind as EngineKind]));
const HEADER = 24, CAP = 256 * 1024 * 1024;

/** Checks revision invariants and returns independently owned snapshot buffers. */
export function ownCollaborationCheckpoint(value: CollaborationCheckpoint): CollaborationCheckpoint {
  if (!value || value.version !== 1 || typeof value.documentId !== "string" || !/^[\w.:-]{1,256}$/.test(value.documentId) ||
      !Object.hasOwn(TAGS, value.kind) ||
      !Number.isSafeInteger(value.revision) || value.revision < 0 || typeof value.dirty !== "boolean" ||
      (value.revision === 0 && !value.dirty) || !(value.bytes instanceof Uint8Array))
    throw new Error("Invalid collaboration checkpoint metadata");
  if (value.pending !== undefined) {
    if (!value.pending || !value.dirty || typeof value.pending.matchesCurrent !== "boolean" || !(value.pending.bytes instanceof Uint8Array))
      throw new Error("Invalid pending collaboration upload");
  }
  const size = HEADER + 4 + value.documentId.length + value.bytes.length + (value.pending?.bytes.length ?? 0);
  if (size > CAP) throw new RangeError("Collaboration recovery record exceeds 256 MiB including pending upload");
  const local = Uint8Array.from(value.bytes), pending = value.pending === undefined ? undefined : Uint8Array.from(value.pending.bytes);
  validateCheckpoint(local); if (pending) validateCheckpoint(pending);
  return Object.freeze({ version: 1 as const, documentId: value.documentId, kind: value.kind,
    revision: value.revision, dirty: value.dirty, bytes: local,
    ...(value.pending && pending ? { pending: Object.freeze({ bytes: pending, matchesCurrent: value.pending.matchesCurrent }) } : {}) });
}

// CRC protects revision/dirty/upload metadata as well as both NFD1 frames.
// Yield each MiB so a large recovery record cannot monopolize the UI thread.
const CRC_TABLE = Uint32Array.from({ length: 256 }, (_, index) => {
  let crc = index;
  for (let bit = 0; bit < 8; bit++) crc = (crc >>> 1) ^ ((crc & 1) ? 0xedb88320 : 0);
  return crc >>> 0;
});
async function checksum(bytes: Uint8Array): Promise<number> {
  let crc = 0xffffffff;
  for (let offset = 0; offset < bytes.length; offset++) {
    crc = CRC_TABLE[(crc ^ bytes[offset]!) & 255]! ^ (crc >>> 8);
    if ((offset & 0xfffff) === 0xfffff) await new Promise<void>(resolve => setTimeout(resolve, 0));
  }
  return (crc ^ 0xffffffff) >>> 0;
}

/** NCC1 wraps a local document, remote base and ambiguous upload in one atomic
 * CRC-checked record. The combined record is capped at 256 MiB. Storage failures
 * must preserve the previous good record, as required by BinaryCheckpointStorage. */
export function createCollaborationCheckpointStore(storage: BinaryCheckpointStorage): CollaborationCheckpointStore {
  return {
    async write(key, raw) {
      const value = ownCollaborationCheckpoint(raw);
      const pending = value.pending;
      const size = HEADER + value.documentId.length + value.bytes.length + (pending?.bytes.length ?? 0) + 4;
      const bytes = new Uint8Array(size), view = new DataView(bytes.buffer);
      bytes.set([78, 67, 67, 49, TAGS[value.kind], (value.dirty ? 1 : 0) | (pending ? 2 : 0) | (pending?.matchesCurrent ? 4 : 0)]);
      view.setFloat64(6, value.revision, true);
      view.setUint32(14, value.bytes.length, true); view.setUint32(18, pending?.bytes.length ?? 0, true);
      view.setUint16(22, value.documentId.length, true);
      bytes.set(Array.from(value.documentId, c => c.charCodeAt(0)), HEADER);
      let offset = HEADER + value.documentId.length;
      bytes.set(value.bytes, offset); offset += value.bytes.length;
      if (pending) bytes.set(pending.bytes, offset);
      view.setUint32(size - 4, await checksum(bytes.subarray(0, size - 4)), true);
      await storage.write(key, bytes);
    },
    async read(key) {
      const raw = await storage.read(key); if (!raw) return undefined;
      if (raw.length < HEADER + 4 + 1 + 9 || raw.length > CAP) throw new Error("Invalid collaboration recovery length");
      const bytes = Uint8Array.from(raw), view = new DataView(bytes.buffer);
      if (String.fromCharCode(...bytes.subarray(0, 4)) !== "NCC1" ||
          view.getUint32(bytes.length - 4, true) !== await checksum(bytes.subarray(0, bytes.length - 4)))
        throw new Error("Corrupt collaboration recovery record");
      const kind = KINDS.get(bytes[4]!), flags = bytes[5]!;
      const localLength = view.getUint32(14, true), pendingLength = view.getUint32(18, true), idLength = view.getUint16(22, true);
      if (!kind || flags > 7 || !idLength || idLength > 256 || localLength < 9 ||
          (flags & 2 ? pendingLength < 9 : pendingLength !== 0) || ((flags & 4) !== 0 && (flags & 2) === 0) ||
          HEADER + idLength + localLength + pendingLength + 4 !== bytes.length)
        throw new Error("Invalid collaboration recovery framing");
      const offset = HEADER + idLength;
      return ownCollaborationCheckpoint({ version: 1, documentId: String.fromCharCode(...bytes.subarray(HEADER, offset)),
        kind, revision: view.getFloat64(6, true), dirty: !!(flags & 1), bytes: bytes.slice(offset, offset + localLength),
        ...(flags & 2 ? { pending: { bytes: bytes.slice(offset + localLength, -4), matchesCurrent: !!(flags & 4) } } : {}) });
    },
  };
}
