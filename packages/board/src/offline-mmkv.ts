import type { BoardCheckpoint, LocalBoardStorage } from "./offline";
import { CorruptCheckpointError } from "./offline";

/**
 * The binary storage subset of react-native-mmkv v4. Inject the host's
 * existing MMKV instance. No Nitro module is loaded by this portable file.
 */
export interface MMKVBoardPort {
  getBuffer(key: string): ArrayBuffer | undefined;
  set(key: string, value: ArrayBuffer): void;
}

const MAGIC = 0x4e464231; // "NFB1"
const HEADER_BYTES = 32;
const MAX_BYTES = 32 * 1024 * 1024;

/** Detect corrupt/truncated values. Not a cryptographic security checksum. */
function crc32(bytes: Uint8Array, wholeRecord = false): number {
  let crc = 0xffffffff;
  for (let index = 0; index < bytes.length; index++) {
    // The checksum field cannot protect itself. Version 2 protects revision
    // and sync metadata as well as document bytes.
    if (wholeRecord && index >= 28 && index < HEADER_BYTES) continue;
    crc ^= bytes[index]!;
    for (let i = 0; i < 8; i++) {
      crc = (crc >>> 1) ^ ((crc & 1) === 0 ? 0 : 0xedb88320);
    }
  }
  return (crc ^ 0xffffffff) >>> 0;
}

function safeRevision(n: number): boolean {
  return Number.isSafeInteger(n) && n >= 0;
}

function encode(checkpoint: BoardCheckpoint, maxBytes: number): ArrayBuffer {
  if (checkpoint.schemaVersion !== 1 ||
      !safeRevision(checkpoint.revision) ||
      !safeRevision(checkpoint.syncedRevision) ||
      checkpoint.syncedRevision > checkpoint.revision ||
      !(checkpoint.data instanceof Uint8Array) ||
      checkpoint.data.byteLength < 1 ||
      checkpoint.data.byteLength > maxBytes) {
    throw new TypeError("Invalid local board checkpoint for MMKV");
  }
  const bytes = new Uint8Array(checkpoint.data);
  const buffer = new ArrayBuffer(HEADER_BYTES + bytes.byteLength);
  const view = new DataView(buffer);
  view.setUint32(0, MAGIC, false);
  view.setUint8(4, 2);
  view.setBigUint64(8, BigInt(checkpoint.revision), false);
  view.setBigUint64(16, BigInt(checkpoint.syncedRevision), false);
  view.setUint32(24, bytes.byteLength, false);
  new Uint8Array(buffer, HEADER_BYTES).set(bytes);
  view.setUint32(28, crc32(new Uint8Array(buffer), true), false);
  return buffer;
}

function decode(documentId: string, raw: ArrayBuffer, maxBytes: number): BoardCheckpoint {
  if (!(raw instanceof ArrayBuffer) || raw.byteLength < HEADER_BYTES) {
    throw new CorruptCheckpointError(documentId, "MMKV board checkpoint is truncated");
  }
  const view = new DataView(raw);
  const format = view.getUint8(4);
  if (view.getUint32(0, false) !== MAGIC || (format !== 1 && format !== 2)) {
    throw new CorruptCheckpointError(documentId, "MMKV board checkpoint schema is unsupported");
  }
  const revision = Number(view.getBigUint64(8, false));
  const syncedRevision = Number(view.getBigUint64(16, false));
  const len = view.getUint32(24, false);
  if (!safeRevision(revision) || !safeRevision(syncedRevision) ||
      syncedRevision > revision || len < 1 || len > maxBytes ||
      raw.byteLength !== HEADER_BYTES + len) {
    throw new CorruptCheckpointError(documentId, "MMKV board checkpoint header is invalid");
  }
  const bytes = new Uint8Array(raw, HEADER_BYTES, len);
  // Legacy version 1 remains readable; the next successful save writes the
  // stronger envelope. Loading never rewrites a user's stored checkpoint.
  const checksum = format === 1 ? crc32(bytes) : crc32(new Uint8Array(raw), true);
  if (checksum !== view.getUint32(28, false)) {
    throw new CorruptCheckpointError(documentId, "MMKV board checkpoint failed checksum");
  }
  return { schemaVersion: 1, documentId, revision, syncedRevision, data: new Uint8Array(bytes) };
}

/**
 * Return a storage adapter scoped by the host's account/organization AND
 * board identifier. Never reuse an unscoped global 'board' key on shared
 * classroom devices. Use one stored ArrayBuffer so metadata and CRDT bytes
 * cannot be split across independently updated keys.
 *
 * This is a local synchronous MMKV single-key write, not proof of durable
 * fsync across a sudden power loss. Real crash/relaunch tests are required.
 */
export function createMMKVBoardStorage(
  mmkv: MMKVBoardPort,
  options: { readonly scope: string; readonly maxSnapshotBytes?: number },
): LocalBoardStorage {
  const { scope } = options;
  const maxBytes = options.maxSnapshotBytes ?? MAX_BYTES;
  if (!scope || scope.length > 256 || !Number.isSafeInteger(maxBytes) ||
      maxBytes < 1 || maxBytes > MAX_BYTES) {
    throw new RangeError("MMKV board scope and snapshot budget are required");
  }
  const prefix = "nitroforge.board.v1/" + encodeURIComponent(scope) + "/";
  const keyFor = (documentId: string): string => {
    if (!documentId || documentId.length > 256) {
      throw new RangeError("Board identifier must be nonempty and bounded");
    }
    return prefix + encodeURIComponent(documentId);
  };
  return {
    async load(documentId) {
      const buffer = mmkv.getBuffer(keyFor(documentId));
      return buffer === undefined ? null : decode(documentId, buffer, maxBytes);
    },
    async replaceAtomically(documentId, checkpoint) {
      if (checkpoint.documentId !== documentId) {
        throw new TypeError("MMKV board document ID mismatch");
      }
      // MMKV set is synchronous. The returned Promise resolves only after
      // the single-key write has finished (or propagates its error).
      mmkv.set(keyFor(documentId), encode(checkpoint, maxBytes));
    },
  };
}
