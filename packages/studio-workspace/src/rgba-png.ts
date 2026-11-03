/** Bounded portable PNG encoding for the engine's straight-alpha RGBA preview. */
export const MAX_PREVIEW_PIXELS = 1_048_576;
export function validatePreviewSize(width: number, height: number): void {
  if (!Number.isInteger(width) || !Number.isInteger(height) || width <= 0 || height <= 0
    || width > 4096 || height > 4096 || width * height > MAX_PREVIEW_PIXELS) {
    throw new Error('Canvas preview supports up to 1,048,576 pixels and 4096 pixels per side. Your document is unchanged.');
  }
}
const crcTable = Uint32Array.from({ length: 256 }, (_, index) => {
  let value = index;
  for (let bit = 0; bit < 8; bit++) value = (value & 1) ? 0xedb88320 ^ (value >>> 1) : value >>> 1;
  return value >>> 0;
});
function crc32(bytes: Uint8Array): number {
  let crc = 0xffffffff;
  for (const byte of bytes) crc = crcTable[(crc ^ byte) & 255]! ^ (crc >>> 8);
  return (crc ^ 0xffffffff) >>> 0;
}
function chunk(type: string, data: Uint8Array): Uint8Array {
  const out = new Uint8Array(data.length + 12);
  const view = new DataView(out.buffer);
  view.setUint32(0, data.length);
  out.set(Array.from(type, char => char.charCodeAt(0)), 4);
  out.set(data, 8);
  view.setUint32(out.length - 4, crc32(out.subarray(4, out.length - 4)));
  return out;
}
/** Encode an 8-bit RGBA image without native resources or platform-specific APIs. */
export function encodeRgbaPng(width: number, height: number, rgba: Uint8Array): Uint8Array {
  validatePreviewSize(width, height);
  if (rgba.length !== width * height * 4) throw new Error('The engine returned an invalid RGBA preview length.');
  const stride = width * 4;
  const scanlines = new Uint8Array((stride + 1) * height);
  for (let y = 0; y < height; y++) scanlines.set(rgba.subarray(y * stride, (y + 1) * stride), y * (stride + 1) + 1);
  // RFC1950 zlib wrapping RFC1951 stored blocks. No compression dependency is
  // needed; bounded preview data trades a little size for native/web parity.
  const zlib = new Uint8Array(2 + scanlines.length + Math.ceil(scanlines.length / 65535) * 5 + 4);
  zlib.set([0x78, 0x01]);
  let offset = 2;
  for (let start = 0; start < scanlines.length; start += 65535) {
    const size = Math.min(65535, scanlines.length - start);
    zlib[offset++] = start + size === scanlines.length ? 1 : 0;
    zlib[offset++] = size & 255; zlib[offset++] = size >>> 8;
    zlib[offset++] = (~size) & 255; zlib[offset++] = ((~size) >>> 8) & 255;
    zlib.set(scanlines.subarray(start, start + size), offset);
    offset += size;
  }
  let a = 1, b = 0;
  for (const byte of scanlines) { a = (a + byte) % 65521; b = (b + a) % 65521; }
  new DataView(zlib.buffer).setUint32(offset, ((b << 16) | a) >>> 0);
  const header = new Uint8Array(13);
  const headerView = new DataView(header.buffer);
  headerView.setUint32(0, width); headerView.setUint32(4, height);
  header.set([8, 6, 0, 0, 0], 8);
  const chunks = [new Uint8Array([137, 80, 78, 71, 13, 10, 26, 10]), chunk('IHDR', header), chunk('IDAT', zlib), chunk('IEND', new Uint8Array())];
  const png = new Uint8Array(chunks.reduce((sum, data) => sum + data.length, 0));
  offset = 0;
  for (const data of chunks) { png.set(data, offset); offset += data.length; }
  return png;
}
