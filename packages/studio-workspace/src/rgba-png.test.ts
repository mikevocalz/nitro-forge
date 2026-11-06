import assert from 'node:assert/strict';
import test from 'node:test';
import { inflateSync } from 'node:zlib';
import { encodeRgbaPng, validatePreviewSize } from './rgba-png.ts';

function decode(png: Uint8Array) {
  assert.deepEqual([...png.subarray(0, 8)], [137, 80, 78, 71, 13, 10, 26, 10]);
  const chunks: Record<string, Uint8Array> = {};
  const view = new DataView(png.buffer, png.byteOffset, png.byteLength);
  let offset = 8;
  while (offset < png.length) {
    const length = view.getUint32(offset);
    const type = String.fromCharCode(...png.subarray(offset + 4, offset + 8));
    // Independent bitwise CRC check, rather than the encoder's lookup table.
    let crc = 0xffffffff;
    for (const byte of png.subarray(offset + 4, offset + 8 + length)) {
      crc ^= byte;
      for (let bit = 0; bit < 8; bit++) crc = crc & 1 ? (crc >>> 1) ^ 0xedb88320 : crc >>> 1;
    }
    assert.equal((crc ^ 0xffffffff) >>> 0, view.getUint32(offset + 8 + length));
    chunks[type] = png.subarray(offset + 8, offset + 8 + length);
    offset += length + 12;
  }
  assert.equal(offset, png.length);
  const header = new DataView(chunks.IHDR!.buffer, chunks.IHDR!.byteOffset, 13);
  assert.deepEqual([...chunks.IHDR!.subarray(8)], [8, 6, 0, 0, 0]);
  const width = header.getUint32(0), height = header.getUint32(4);
  const data = inflateSync(chunks.IDAT!); // Validates zlib, stored blocks, Adler32.
  const rgba = new Uint8Array(width * height * 4);
  for (let row = 0; row < height; row++) {
    assert.equal(data[row * (width * 4 + 1)], 0);
    rgba.set(data.subarray(row * (width * 4 + 1) + 1, (row + 1) * (width * 4 + 1)), row * width * 4);
  }
  assert.equal(chunks.IEND!.length, 0);
  return { width, height, rgba };
}

test('PNG independently decodes exact color and alpha samples', () => {
  const pixels = new Uint8Array([255, 0, 0, 255, 0, 255, 0, 128, 0, 0, 255, 0, 20, 30, 40, 255]);
  assert.deepEqual(decode(encodeRgbaPng(2, 2, pixels)), { width: 2, height: 2, rgba: pixels });
});
test('PNG stored blocks cross the 65535-byte boundary without losing scanlines', () => {
  const pixels = Uint8Array.from({ length: 256 * 128 * 4 }, (_, i) => (i * 37) % 256);
  assert.deepEqual(decode(encodeRgbaPng(256, 128, pixels)).rgba, pixels);
});
test('preview rejects unsafe dimensions and inconsistent engine data before encoding', () => {
  for (const [w, h] of [[0, 1], [-1, 1], [1.5, 1], [NaN, 1], [4097, 1], [2048, 2048]]) assert.throws(() => validatePreviewSize(w!, h!));
  assert.throws(() => encodeRgbaPng(2, 2, new Uint8Array(15)), /RGBA/);
});
