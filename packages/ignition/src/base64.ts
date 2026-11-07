/** Dependency-free base64 — works in RN Hermes, Node, and browsers. */

const ALPHABET =
  "ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+/";

export function bytesToBase64(bytes: Uint8Array): string {
  let out = "";
  for (let i = 0; i < bytes.length; i += 3) {
    const b0 = bytes[i]!;
    const b1 = bytes[i + 1];
    const b2 = bytes[i + 2];
    const n = (b0 << 16) | ((b1 ?? 0) << 8) | (b2 ?? 0);
    out += ALPHABET[(n >> 18) & 63];
    out += ALPHABET[(n >> 12) & 63];
    out += b1 === undefined ? "=" : ALPHABET[(n >> 6) & 63];
    out += b2 === undefined ? "=" : ALPHABET[n & 63];
  }
  return out;
}

const TABLE: number[] = (() => {
  const t = new Array<number>(256).fill(255);
  for (let i = 0; i < ALPHABET.length; i++) t[ALPHABET.charCodeAt(i)] = i;
  return t;
})();

export function base64ToBytes(s: string): Uint8Array {
  const padding = s.endsWith("==") ? 2 : s.endsWith("=") ? 1 : 0;
  const length = s.length - padding;
  const remainder = length % 4;
  if (remainder === 1 || (padding > 0 && (s.length % 4 !== 0 || padding !== 4 - remainder)))
    throw new Error("invalid base64 input");
  // Validate before allocating. Out-of-table UTF-16 code units are not alphabet entries.
  for (let i = 0; i < length; i++) {
    const value = TABLE[s.charCodeAt(i)];
    if (value === undefined || value === 255) throw new Error("invalid base64 input");
  }
  const last = length === 0 ? 0 : TABLE[s.charCodeAt(length - 1)]!;
  if ((remainder === 2 && (last & 15) !== 0) || (remainder === 3 && (last & 3) !== 0))
    throw new Error("invalid base64 trailing bits");
  const out = new Uint8Array(Math.floor((length * 3) / 4));
  let acc = 0;
  let bits = 0;
  let o = 0;
  for (let i = 0; i < length; i++) {
    const v = TABLE[s.charCodeAt(i)]!;
    acc = (acc << 6) | v;
    bits += 6;
    if (bits >= 8) {
      bits -= 8;
      out[o++] = (acc >> bits) & 0xff;
      acc &= (1 << bits) - 1;
    }
  }
  return out.subarray(0, o);
}
