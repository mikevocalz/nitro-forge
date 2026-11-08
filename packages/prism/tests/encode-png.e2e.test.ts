import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { inflateSync } from "node:zlib";
import { EngineError, base64ToBytes } from "@nitro-forge/ignition";
import { CliHost } from "@nitro-forge/ignition/cli";
import { PrismDocument } from "../src/index";

let host: CliHost;
beforeAll(() => {
  host = new CliHost();
});
afterAll(async () => {
  await host.dispose();
});

/** Minimal PNG reader: signature, IHDR, CRC-checked chunks, zlib inflate,
 * all five scanline filters. Returns straight RGBA8 pixels. */
function decodePng(png: Uint8Array): { width: number; height: number; rgba: Uint8Array } {
  expect([...png.subarray(0, 8)]).toEqual([137, 80, 78, 71, 13, 10, 26, 10]);
  const chunks = new Map<string, Uint8Array>();
  const view = new DataView(png.buffer, png.byteOffset, png.byteLength);
  let offset = 8;
  while (offset < png.length) {
    const length = view.getUint32(offset);
    const type = String.fromCharCode(...png.subarray(offset + 4, offset + 8));
    let crc = 0xffffffff;
    for (const byte of png.subarray(offset + 4, offset + 8 + length)) {
      crc ^= byte;
      for (let bit = 0; bit < 8; bit++) crc = crc & 1 ? (crc >>> 1) ^ 0xedb88320 : crc >>> 1;
    }
    expect((crc ^ 0xffffffff) >>> 0).toBe(view.getUint32(offset + 8 + length));
    chunks.set(type, png.subarray(offset + 8, offset + 8 + length));
    offset += length + 12;
  }
  expect(offset).toBe(png.length);
  const ihdr = chunks.get("IHDR")!;
  expect(ihdr.length).toBe(13);
  expect([...ihdr.subarray(8)]).toEqual([8, 6, 0, 0, 0]); // 8-bit RGBA, non-interlaced
  const width = new DataView(ihdr.buffer, ihdr.byteOffset).getUint32(0);
  const height = new DataView(ihdr.buffer, ihdr.byteOffset).getUint32(4);
  const raw = inflateSync(chunks.get("IDAT")!);
  const stride = width * 4;
  const rgba = new Uint8Array(width * height * 4);
  const prev = new Uint8Array(stride);
  for (let y = 0; y < height; y++) {
    const row = raw.subarray(y * (stride + 1), (y + 1) * (stride + 1));
    const filter = row[0];
    const cur = rgba.subarray(y * stride, (y + 1) * stride);
    for (let x = 0; x < stride; x++) {
      const a = x >= 4 ? cur[x - 4]! : 0;
      const b = prev[x]!;
      const c = x >= 4 ? prev[x - 4]! : 0;
      const add = filter === 0 ? 0 : filter === 1 ? a : filter === 2 ? b : filter === 3 ? Math.floor((a + b) / 2)
        : (() => { const p = a + b - c; const pa = Math.abs(p - a), pb = Math.abs(p - b), pc = Math.abs(p - c);
            return pa <= pb && pa <= pc ? a : pb <= pc ? b : c; })();
      cur[x] = (row[x + 1]! + add) & 0xff;
    }
    prev.set(cur);
  }
  return { width, height, rgba };
}

describe("prism encodePng e2e (real Rust via nf-cli)", () => {
  it("encodes the flattened composite as a decodable deterministic PNG", async () => {
    const doc = await PrismDocument.open(host, 4, 4);
    const layer = (await doc.addRasterLayer("paint")).data.layer_id;
    await doc.drawPixels(layer, 1, 1, 1, 1, new Uint8Array([255, 0, 0, 255]));
    await doc.fillLayer(layer, [10, 20, 30, 255]);

    const flat = await doc.flatten();
    const expected = base64ToBytes(flat.data.pixels_b64);

    const res = await doc.encodePng();
    expect(res.data.width).toBe(4);
    expect(res.data.height).toBe(4);
    expect(res.data.format).toBe("png");
    // Read-only: no document:changed event.
    expect(res.events.filter((e) => e.kind === "document:changed")).toHaveLength(0);

    const png = base64ToBytes(res.data.png_b64);
    const decoded = decodePng(png);
    expect(decoded.width).toBe(4);
    expect(decoded.height).toBe(4);
    expect([...decoded.rgba]).toEqual([...expected]);

    // Deterministic: identical pixels → identical bytes.
    const again = await doc.encodePng();
    expect(again.data.png_b64).toBe(res.data.png_b64);
    await doc.close();
  });

  it("layer option renders the subtree alone", async () => {
    const doc = await PrismDocument.open(host, 4, 4);
    const bottom = (await doc.addRasterLayer("bottom")).data.layer_id;
    await doc.fillLayer(bottom, [255, 0, 0, 255]);
    const top = (await doc.addRasterLayer("top")).data.layer_id;
    await doc.fillLayer(top, [0, 0, 255, 255]);
    await doc.setLayerOpacity(top, 0.5);

    const layerPng = base64ToBytes((await doc.encodePng({ layer: top })).data.png_b64);
    const layerPx = decodePng(layerPng).rgba;
    // Layer alone: full blue, no 50% composite with red below.
    expect([...layerPx.slice(0, 4)]).toEqual([0, 0, 255, 255]);
    expect(layerPx.every((_, i) => i % 4 !== 3 || layerPx[i] === 255)).toBe(true);

    const compPx = decodePng(base64ToBytes((await doc.encodePng()).data.png_b64)).rgba;
    expect([...compPx.slice(0, 4)]).not.toEqual([0, 0, 255, 255]);

    await expect(doc.encodePng({ layer: 99999 })).rejects.toBeInstanceOf(EngineError);
    await doc.close();
  });

  it("records no undo entry and rejects oversize canvases", async () => {
    const doc = await PrismDocument.open(host, 4, 4);
    const layer = (await doc.addRasterLayer()).data.layer_id;
    await doc.fillLayer(layer, [1, 2, 3, 255]);
    const before = await doc.save();
    await doc.encodePng();
    await doc.encodePng({ layer });
    // Snapshot unchanged and undo still unwinds exactly the fillLayer.
    expect(await doc.save()).toEqual(before);
    expect(await doc.undo()).toBe(true);
    await doc.close();

    // 4097px side exceeds the export budget even though `new` accepts it.
    const wide = await PrismDocument.open(host, 4097, 1);
    await expect(wide.encodePng()).rejects.toBeInstanceOf(EngineError);
    await wide.close();
    // 2048x2048 exceeds the 1,048,576-pixel total.
    const big = await PrismDocument.open(host, 2048, 2048);
    await expect(big.encodePng()).rejects.toBeInstanceOf(EngineError);
    await big.close();
  });
});
