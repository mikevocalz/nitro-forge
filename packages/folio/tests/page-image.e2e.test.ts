import { deflateSync } from "node:zlib";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { EngineError } from "@nitro-forge/ignition";
import { CliHost } from "@nitro-forge/ignition/cli";
import { FolioDocument } from "../src/index";

let host: CliHost;
beforeAll(() => {
  host = new CliHost();
});
afterAll(async () => {
  await host.dispose();
});

// --- tiny PNG/JPEG builders (test fixtures only) -------------------------

const CRC_TABLE = (() => {
  const t = new Uint32Array(256);
  for (let n = 0; n < 256; n++) {
    let c = n;
    for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
    t[n] = c >>> 0;
  }
  return t;
})();
function crc32(bytes: Uint8Array): number {
  let c = 0xffffffff;
  for (const b of bytes) c = CRC_TABLE[(c ^ b) & 0xff]! ^ (c >>> 8);
  return (c ^ 0xffffffff) >>> 0;
}
function chunk(kind: string, data: Uint8Array): Uint8Array {
  const out = new Uint8Array(12 + data.length);
  const dv = new DataView(out.buffer);
  dv.setUint32(0, data.length);
  out.set(new TextEncoder().encode(kind), 4);
  out.set(data, 8);
  const crcIn = new Uint8Array(4 + data.length);
  crcIn.set(new TextEncoder().encode(kind), 0);
  crcIn.set(data, 4);
  dv.setUint32(8 + data.length, crc32(crcIn));
  return out;
}
function u32be(n: number): Uint8Array {
  const b = new Uint8Array(4);
  new DataView(b.buffer).setUint32(0, n);
  return b;
}
function concat(...parts: Uint8Array[]): Uint8Array {
  const out = new Uint8Array(parts.reduce((n, p) => n + p.length, 0));
  let o = 0;
  for (const p of parts) { out.set(p, o); o += p.length; }
  return out;
}
/** Real PNG: signature + IHDR + IDAT(zlib of filter-0 scanlines) + IEND. */
function makePng(width: number, height: number, colorType: number, rows: Uint8Array[]): Uint8Array {
  const ihdr = concat(u32be(width), u32be(height), new Uint8Array([8, colorType, 0, 0, 0]));
  const raw = concat(...rows.map(r => concat(new Uint8Array([0]), r)));
  return concat(
    new Uint8Array([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
    chunk("IHDR", ihdr),
    chunk("IDAT", new Uint8Array(deflateSync(raw))),
    chunk("IEND", new Uint8Array(0)),
  );
}
/** Minimal JPEG marker stream through SOF0 — enough for the engine's header parse. */
function makeJpeg(width: number, height: number, components: number): Uint8Array {
  const segLen = 8 + 3 * components;
  const parts: number[] = [0xff, 0xd8, 0xff, 0xc0, (segLen >> 8) & 0xff, segLen & 0xff, 8,
    (height >> 8) & 0xff, height & 0xff, (width >> 8) & 0xff, width & 0xff, components];
  for (let i = 1; i <= components; i++) parts.push(i, 0x22, 0);
  parts.push(0xff, 0xd9);
  return new Uint8Array(parts);
}

describe("folio insertPageImage + open password e2e (real Rust via nf-cli)", () => {
  it("inserts a raw RGB image, saves a real PDF, and undoes", async () => {
    const doc = await FolioDocument.create(host, 1);
    const px = new Uint8Array([255, 0, 0, 0, 255, 0, 0, 0, 255, 255, 255, 255]);
    const res = await doc.insertPageImage(0, [10, 20, 100, 50], {
      format: "raw", data: px, width: 2, height: 2, colorSpace: "DeviceRGB",
    });
    expect(res.data.ok).toBe(true);
    expect(res.data.width).toBe(2);
    expect(res.data.color_space).toBe("DeviceRGB");
    expect(res.data.name).toMatch(/^X\d+$/);

    const { bytes } = await doc.savePdf();
    expect(bytes.subarray(0, 5)).toEqual(new TextEncoder().encode("%PDF-"));

    // Reopen: the document still parses with the embedded image.
    const reopened = await FolioDocument.openPdf(host, bytes);
    const described = await reopened.describe<{ pages: number }>();
    expect(described.data.pages).toBe(1);
    await reopened.close();

    // Undo removes it.
    expect(await doc.undo()).toBe(true);
    const { bytes: after } = await doc.savePdf();
    const plain = await FolioDocument.openPdf(host, after);
    await plain.close();
    await doc.close();
  });

  it("decodes a real PNG (RGB + alpha discard) and passes JPEG through", async () => {
    const doc = await FolioDocument.create(host, 1);
    const rgbPng = makePng(2, 1, 2, [new Uint8Array([255, 0, 0, 0, 255, 0])]);
    const pngRes = await doc.insertPageImage(0, [0, 0, 50, 50], { format: "png", data: rgbPng });
    expect(pngRes.data.color_space).toBe("DeviceRGB");
    expect(pngRes.data.width).toBe(2);

    const rgbaPng = makePng(1, 1, 6, [new Uint8Array([10, 20, 30, 40])]);
    const rgbaRes = await doc.insertPageImage(0, [60, 0, 50, 50], { format: "png", data: rgbaPng });
    expect(rgbaRes.data.color_space).toBe("DeviceRGB");

    const jpg = makeJpeg(4, 3, 3);
    const jpgRes = await doc.insertPageImage(0, [0, 60, 50, 50], { format: "jpeg", data: jpg });
    expect(jpgRes.data.format).toBe("jpeg");
    expect(jpgRes.data.width).toBe(4);
    expect(jpgRes.data.height).toBe(3);

    const { bytes } = await doc.savePdf();
    const reopened = await FolioDocument.openPdf(host, bytes);
    expect((await reopened.pageCount()).data.pages).toBe(1);
    await reopened.close();
    await doc.close();
  });

  it("rejects bad images atomically and encrypted documents", async () => {
    const doc = await FolioDocument.create(host, 1);
    await expect(doc.insertPageImage(0, [0, 0, 10, 10], {
      format: "raw", data: new Uint8Array([1, 2, 3]), width: 2, height: 2, colorSpace: "DeviceRGB",
    })).rejects.toBeInstanceOf(EngineError);
    await expect(doc.insertPageImage(0, [0, 0, 10, 10], {
      format: "png", data: new Uint8Array([1, 2, 3]),
    })).rejects.toBeInstanceOf(EngineError);
    await expect(doc.insertPageImage(9, [0, 0, 10, 10], {
      format: "raw", data: new Uint8Array([0]), width: 1, height: 1, colorSpace: "DeviceGray",
    })).rejects.toBeInstanceOf(EngineError);

    await doc.encrypt({ password: "pw" });
    await expect(doc.insertPageImage(0, [0, 0, 10, 10], {
      format: "raw", data: new Uint8Array([0]), width: 1, height: 1, colorSpace: "DeviceGray",
    })).rejects.toBeInstanceOf(EngineError);
    // Mutating ops reject on encrypted docs (slice F reconciliation).
    await expect(doc.rotatePage(0, 90)).rejects.toBeInstanceOf(EngineError);
    await expect(doc.addAnnotation(0, [0, 0, 1, 1], "x")).rejects.toBeInstanceOf(EngineError);
    await doc.close();
  });

  it("openPdf with password unlocks an encrypted document in one step", async () => {
    const doc = await FolioDocument.create(host, 1);
    await doc.encrypt({ password: "open-me" });
    const { bytes } = await doc.savePdf();
    await doc.close();

    // Without a password the doc opens but reports encrypted.
    const locked = await FolioDocument.openPdf(host, bytes);
    expect((await locked.info()).data.encrypted).toBe(true);
    await locked.close();

    // With the user password it opens decrypted.
    const unlocked = await FolioDocument.openPdf(host, bytes, "open-me");
    expect((await unlocked.info()).data.encrypted).toBe(false);
    expect((await unlocked.pageCount()).data.pages).toBe(1);
    await unlocked.close();

    // Wrong password rejects and does not leak a session.
    await expect(FolioDocument.openPdf(host, bytes, "wrong")).rejects.toBeInstanceOf(EngineError);
  });
});
