import type { BinaryCheckpointStorage } from "./autosave";

/** The binary subset of a host-owned react-native-mmkv v4 instance. */
export interface MMKVCheckpointPort {
  getBuffer(key: string): ArrayBuffer | undefined;
  set(key: string, value: ArrayBuffer): void;
}

// The existing checkpoint codec permits a 256 MiB NFD1 snapshot plus NFC1's
// five-byte engine header. This adapter adds no envelope or document state.
const MAX_RECORD_BYTES = 256 * 1024 * 1024 + 5;

/**
 * Adapt the host's existing MMKV instance to createCheckpointStore and
 * DocumentAutosave. Every record is one scoped, synchronous binary MMKV set;
 * metadata and snapshot bytes cannot become separate logical writes.
 *
 * The port must retain the previous record if set throws. Successful native
 * MMKV replacement is not a claim of fsync durability across power loss.
 * This module imports no native runtime and creates no MMKV instance.
 */
export function createMMKVCheckpointStorage(
  mmkv: MMKVCheckpointPort,
  options: { readonly scope: string; readonly maxCheckpointBytes?: number },
): BinaryCheckpointStorage {
  const { scope } = options;
  const maximum = options.maxCheckpointBytes ?? MAX_RECORD_BYTES;
  if (typeof scope !== "string" || !scope || scope.length > 256 || !Number.isSafeInteger(maximum) ||
      maximum < 1 || maximum > MAX_RECORD_BYTES) {
    throw new RangeError("MMKV checkpoint storage requires a bounded scope and byte budget");
  }
  const prefix = `nitroforge.checkpoint.v1/${encodeURIComponent(scope)}/`;
  const keyFor = (key: string): string => {
    if (typeof key !== "string" || !key || key.length > 256) throw new RangeError("MMKV checkpoint key must be nonempty and bounded");
    return prefix + encodeURIComponent(key);
  };
  return {
    async read(key) {
      const buffer = mmkv.getBuffer(keyFor(key));
      if (buffer === undefined) return undefined;
      if (!(buffer instanceof ArrayBuffer) || buffer.byteLength < 1 || buffer.byteLength > maximum)
        throw new RangeError("MMKV checkpoint exceeds its binary storage budget");
      // Own the read even if the host port returns a reused native buffer.
      return Uint8Array.from(new Uint8Array(buffer));
    },
    async write(key, bytes) {
      const storageKey = keyFor(key);
      if (!(bytes instanceof Uint8Array) || bytes.byteLength < 1 || bytes.byteLength > maximum)
        throw new RangeError("MMKV checkpoint exceeds its binary storage budget");
      // Copy exactly this view: byteOffset/byteLength may describe a small
      // slice of a larger ArrayBuffer or Node Buffer pool.
      const owned = new Uint8Array(bytes.byteLength);
      owned.set(bytes);
      mmkv.set(storageKey, owned.buffer);
    },
  };
}
