import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { CliHost } from "@nitro-forge/ignition/cli";
import { QuillDocument } from "../src/index";

// R3 e2e: section `page_setup` binding, headers/footers, columns, and
// TOC page numbers through the real nf-cli engine.
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

function decodeRgba(b64: string): Uint8Array {
  return Uint8Array.from(Buffer.from(b64, "base64"));
}

/** True when any pixel in rows [y0,y1) carries ink (R < 200). */
function bandHasInk(px: Uint8Array, width: number, y0: number, y1: number) {
  for (let y = y0; y < y1; y++) {
    for (let x = 0; x < width; x++) {
      if (px[(y * width + x) * 4]! < 200) return true;
    }
  }
  return false;
}

describe("quill renderPage/layout useSections (real Rust via nf-cli)", () => {
  it("layout binds section page_setup geometry and reports toc_pages", async () => {
    const doc = await QuillDocument.open(host);
    // h1 heading on its own page, then body — tiny page forces breaks.
    await doc.insertText({ block: 0, offset: 0 }, "Alpha");
    await doc.setBlockKind(0, "h1");
    await doc.insertBlock(1);
    await doc.insertText({ block: 1, offset: 0 }, "body");
    await doc.insertBlock(2);
    await doc.insertText({ block: 2, offset: 0 }, "Beta");
    await doc.setBlockKind(2, "h2");
    await doc.insertToc(3);
    await doc.setPageSetup(0, {
      width: 200,
      height: 40,
      margin_top: 10,
      margin_bottom: 10,
      margin_left: 10,
      margin_right: 10,
    });

    const layout = await doc.layout(undefined, 10, undefined, undefined, true);
    // col_height = 20pt → one 14pt line per page → 4 pages.
    expect(layout.data.pages).toHaveLength(4);
    expect(layout.data.pages[0]).toMatchObject({
      index: 0,
      section: 0,
      width: 200,
      height: 40,
      number: 1,
      first_in_section: true,
    });
    // TOC page numbers come from real pagination: Alpha p1, Beta p3.
    expect(layout.data.toc_pages).toEqual([
      {
        field: 3,
        entries: [
          { level: 1, title: "Alpha", block: 0, page: 1 },
          { level: 2, title: "Beta", block: 2, page: 3 },
        ],
      },
    ]);
    await doc.close();
  });

  it("layout honors section-start breaks, columns, and per-section geometry", async () => {
    const doc = await QuillDocument.open(host);
    await doc.insertText({ block: 0, offset: 0 }, "x".repeat(72));
    await doc.insertBlock(1);
    await doc.insertText({ block: 1, offset: 0 }, "second");
    await doc.setPageSetup(0, {
      width: 200,
      height: 40,
      margin_top: 10,
      margin_bottom: 10,
      margin_left: 10,
      margin_right: 10,
    });
    // even-page start: index 2 is even → one blank pad page, then the
    // new section's narrower geometry applies.
    await doc.insertSection(1, {
      page_setup: { width: 100, height: 50, start: "even-page" },
    });
    const layout = await doc.layout(undefined, 10, undefined, undefined, true);
    expect(layout.data.pages).toHaveLength(4);
    expect(layout.data.pages[2]!.lines).toHaveLength(0);
    expect(layout.data.pages[2]).toMatchObject({ section: 0, number: 3 });
    expect(layout.data.pages[3]).toMatchObject({
      section: 1,
      width: 100,
      height: 50,
      number: 4,
      first_in_section: true,
    });
    await doc.close();

    // Columns: 200 x's at 16 chars/line, 5 lines per column.
    const doc2 = await QuillDocument.open(host);
    await doc2.insertText({ block: 0, offset: 0 }, "x".repeat(200));
    await doc2.setPageSetup(0, {
      width: 200,
      height: 100,
      margin_top: 10,
      margin_bottom: 10,
      margin_left: 10,
      margin_right: 10,
      columns: 2,
      column_gap: 20,
    });
    const colLayout = await doc2.layout(undefined, 10, undefined, undefined, true);
    expect(colLayout.data.pages).toHaveLength(2);
    const cols = colLayout.data.pages[0]!.lines.map((l) => l.column);
    expect(cols).toEqual([0, 0, 0, 0, 0, 1, 1, 1, 1, 1]);
    await doc2.close();
  });

  it("renderPage useSections draws section geometry plus header/footer bands", async () => {
    const doc = await QuillDocument.open(host);
    await doc.insertText({ block: 0, offset: 0 }, "Hello World");
    await doc.registerFont("NFTestMono", FONT_BYTES);
    await doc.setPageSetup(0, {
      width: 200,
      height: 100,
      margin_top: 30,
      margin_bottom: 30,
      margin_left: 40,
      margin_right: 40,
    });
    await doc.setHeaderFooter(0, {
      header: "HDR",
      footer: "FTR",
      page_numbers: true,
    });

    const r = await doc.renderPage({
      fontSize: 12,
      font: "NFTestMono",
      page: 0,
      useSections: true,
    });
    // 200pt x 100pt at 96dpi → 267x133 px from PageSetup, not params.
    expect(r.data.width).toBe(267);
    expect(r.data.height).toBe(133);
    expect(r.data.section).toBe(0);
    expect(r.data.number).toBe(1);
    const px = decodeRgba(r.data.pixels_b64!);
    // Header band (top 30pt ≈ 40px) and footer band (bottom 30pt) carry ink.
    expect(bandHasInk(px, 267, 0, 39)).toBe(true);
    expect(bandHasInk(px, 267, 94, 133)).toBe(true);
    // Deterministic.
    const r2 = await doc.renderPage({
      fontSize: 12,
      font: "NFTestMono",
      page: 0,
      useSections: true,
    });
    expect(r2.data.pixels_b64).toBe(r.data.pixels_b64);

    // Same page setup without header/footer renders differently.
    const bare = await QuillDocument.open(host);
    await bare.insertText({ block: 0, offset: 0 }, "Hello World");
    await bare.registerFont("NFTestMono", FONT_BYTES);
    await bare.setPageSetup(0, {
      width: 200,
      height: 100,
      margin_top: 30,
      margin_bottom: 30,
      margin_left: 40,
      margin_right: 40,
    });
    const rb = await bare.renderPage({
      fontSize: 12,
      font: "NFTestMono",
      page: 0,
      useSections: true,
    });
    expect(rb.data.pixels_b64).not.toBe(r.data.pixels_b64);
    await bare.close();
    await doc.close();
  });

  it("renderPage useSections validates and bounds like the uniform path", async () => {
    const doc = await QuillDocument.open(host);
    await doc.insertText({ block: 0, offset: 0 }, "text");
    await doc.registerFont("NFTestMono", FONT_BYTES);
    await expect(
      doc.renderPage({ fontSize: 12, font: "NFTestMono", page: 99, useSections: true }),
    ).rejects.toThrow();
    // `font` is still required in sections mode.
    await expect(
      doc.renderPage({ fontSize: 12, font: "", page: 0, useSections: true }),
    ).rejects.toThrow();
    // A section page over the pixel bound still rejects.
    await doc.setPageSetup(0, {
      width: 5000,
      height: 100,
      margin_top: 10,
      margin_bottom: 10,
      margin_left: 10,
      margin_right: 10,
    });
    await expect(
      doc.renderPage({ fontSize: 12, font: "NFTestMono", page: 0, useSections: true }),
    ).rejects.toThrow();
    await doc.close();
  });
});
