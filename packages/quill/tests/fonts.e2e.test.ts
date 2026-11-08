import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { EngineError } from "@nitro-forge/ignition";
import { CliHost } from "@nitro-forge/ignition/cli";
import { QuillDocument } from "../src/index";

// Deterministic generated test face (no third-party font bytes):
// upem 1000; 'W' advance 1000, 'A' 500, space 250, 'i' 200.
// Shaping tables: GPOS kern 'W'+'W' -300 units (first glyph of pair),
// GSUB liga 'f'+'i' -> 'f_i' glyph (advance 600). See make_nftestmono.py.
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
    expect(r.data.num_glyphs).toBe(97);
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

    // 'W' = 1000/1000 em → 10pt at font_size 10, but the fixture's GPOS
    // kern ('W'+'W' −300 on the first glyph of each pair) shapes "WWWW"
    // to per-char advances 7/7/7/10pt: three W's (21pt) fit in 25pt.
    const measured = await doc.layout(25, 10, undefined, "NFTestMono");
    const lines = measured.data.pages[0]!.lines;
    expect(lines).toHaveLength(2);
    expect(lines[0]).toMatchObject({ block: 0, start: 0, end: 3 });
    expect(lines[1]).toMatchObject({ block: 0, start: 3, end: 4 });

    // Same call without font: 0.5em estimate → 4 chars × 5pt fits one line.
    const stub = await doc.layout(25, 10);
    expect(stub.data.pages[0]!.lines).toHaveLength(1);
    await doc.close();
  });

  it("layout wraps on shaped ligature advances", async () => {
    const doc = await QuillDocument.open(host);
    await doc.registerFont("NFTestMono", FONT_BYTES);
    await doc.insertText({ block: 0, offset: 0 }, "fi");

    // GSUB liga 'f'+'i' -> 'f_i' (600 units) shapes "fi" to 6pt at
    // font_size 10; unshaped f+i would be 7pt and the 0.5em stub 10pt.
    const shaped = await doc.layout(8, 10, 1000, "NFTestMono");
    expect(shaped.data.pages[0]!.lines).toHaveLength(1);
    expect(shaped.data.pages[0]!.lines[0]).toMatchObject({
      block: 0,
      start: 0,
      end: 2,
    });

    const stub = await doc.layout(8, 10, 1000);
    expect(stub.data.pages[0]!.lines).toHaveLength(2);
    await doc.close();
  });

  it("layout re-shapes each wrapped line so kern context stops at breaks", async () => {
    const doc = await QuillDocument.open(host);
    await doc.registerFont("NFTestMono", FONT_BYTES);
    await doc.insertText({ block: 0, offset: 0 }, "WWW");

    // Whole-block shaping gives "WWW" per-char advances 7/7/10pt, which
    // would fit "WW"+"W" on a 15pt line. Per-line re-shaping measures
    // each wrapped line alone: every "W" is a lone 10pt glyph and no two
    // fit together → three single-char lines.
    const r = await doc.layout(15, 10, 1000, "NFTestMono");
    const lines = r.data.pages[0]!.lines;
    expect(lines).toHaveLength(3);
    expect(lines[0]).toMatchObject({ block: 0, start: 0, end: 1 });
    expect(lines[1]).toMatchObject({ block: 0, start: 1, end: 2 });
    expect(lines[2]).toMatchObject({ block: 0, start: 2, end: 3 });
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
