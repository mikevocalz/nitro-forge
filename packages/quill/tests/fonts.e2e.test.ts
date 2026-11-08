import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { EngineError } from "@nitro-forge/ignition";
import { CliHost } from "@nitro-forge/ignition/cli";
import { QuillDocument } from "../src/index";

// Deterministic generated test face (no third-party font bytes):
// upem 1000; 'W' advance 1000, 'A' 500, space 250, 'i' 200.
const FONT_PATH = join(
  dirname(fileURLToPath(import.meta.url)),
  "../rust/tests/fixtures/nftestmono.ttf",
);
const FONT_BYTES = new Uint8Array(readFileSync(FONT_PATH));

let host: CliHost;
beforeAll(() => {
  host = new CliHost();
});
afterAll(async () => {
  await host.dispose();
});

describe("quill font registry + measured layout (real Rust via nf-cli)", () => {
  it("registers a font, reports identity, and dedups", async () => {
    const doc = await QuillDocument.open(host);
    const r = await doc.registerFont("NFTestMono", FONT_BYTES);
    expect(r.data.registered).toBe(true);
    expect(r.data.family).toBe("NFTestMono");
    expect(r.data.face_index).toBe(0);
    expect(r.data.units_per_em).toBe(1000);
    expect(r.data.num_glyphs).toBe(96);
    expect(r.data.sha256).toMatch(/^[0-9a-f]{64}$/);

    const again = await doc.registerFont("NFTestMono", FONT_BYTES);
    expect(again.data.registered).toBe(false);

    const list = await doc.listFonts();
    expect(list.data.fonts).toHaveLength(1);
    expect(list.data.fonts[0]!.family).toBe("NFTestMono");
    await doc.close();
  });

  it("layout with font wraps on real advances; without font keeps the estimate", async () => {
    const doc = await QuillDocument.open(host);
    await doc.registerFont("NFTestMono", FONT_BYTES);
    await doc.insertText({ block: 0, offset: 0 }, "WWWW");

    // 'W' = 1000/1000 em → 10pt at font_size 10; two fit in 25pt, three don't.
    const measured = await doc.layout(25, 10, undefined, "NFTestMono");
    const lines = measured.data.pages[0]!.lines;
    expect(lines).toHaveLength(2);
    expect(lines[0]).toMatchObject({ block: 0, start: 0, end: 2 });
    expect(lines[1]).toMatchObject({ block: 0, start: 2, end: 4 });

    // Same call without font: 0.5em estimate → 4 chars × 5pt fits one line.
    const stub = await doc.layout(25, 10);
    expect(stub.data.pages[0]!.lines).toHaveLength(1);
    await doc.close();
  });

  it("rejects unknown font families and hostile bytes without mutating", async () => {
    const doc = await QuillDocument.open(host);
    await doc.insertText({ block: 0, offset: 0 }, "text");
    await expect(doc.layout(100, 10, undefined, "Missing")).rejects.toBeInstanceOf(
      EngineError,
    );
    await expect(
      doc.registerFont("Bad", new Uint8Array([1, 2, 3, 4])),
    ).rejects.toBeInstanceOf(EngineError);
    await expect(doc.registerFont("  ", FONT_BYTES)).rejects.toBeInstanceOf(
      EngineError,
    );
    const list = await doc.listFonts();
    expect(list.data.fonts).toHaveLength(0);
    await doc.close();
  });

  it("removeFont drops faces by content hash; fonts are session state", async () => {
    const doc = await QuillDocument.open(host);
    const reg = await doc.registerFont("NFTestMono", FONT_BYTES);
    const rm = await doc.removeFont(reg.data.sha256);
    expect(rm.data.removed).toBe(1);
    expect((await doc.listFonts()).data.fonts).toHaveLength(0);
    await expect(doc.layout(100, 10, undefined, "NFTestMono")).rejects.toBeInstanceOf(
      EngineError,
    );

    // Snapshot round-trip does not carry the registry.
    await doc.registerFont("NFTestMono", FONT_BYTES);
    const snap = await doc.save();
    const reopened = await QuillDocument.openSnapshot(host, snap);
    expect((await reopened.listFonts()).data.fonts).toHaveLength(0);
    await reopened.close();
    await doc.close();
  });
});
