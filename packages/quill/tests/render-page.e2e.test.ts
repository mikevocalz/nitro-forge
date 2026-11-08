import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { CliHost } from "@nitro-forge/ignition/cli";
import { QuillDocument } from "../src/index";

// Same deterministic generated face as fonts.e2e.test.ts — it now carries
// simple box outlines so renderPage has real glyph coverage to draw.
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

describe("quill renderPage (real Rust via nf-cli)", () => {
  it("renders a page to non-empty deterministic RGBA", async () => {
    const doc = await QuillDocument.open(host);
    await doc.insertText({ block: 0, offset: 0 }, "Hello World");
    await doc.registerFont("NFTestMono", FONT_BYTES);

    const r = await doc.renderPage({
      pageWidth: 200,
      fontSize: 12,
      pageHeight: 100,
      font: "NFTestMono",
      page: 0,
    });
    expect(r.data.format).toBe("raw");
    // 200pt x 100pt at 96dpi → 267x133 px.
    expect(r.data.width).toBe(267);
    expect(r.data.height).toBe(133);
    const px = decodeRgba(r.data.pixels_b64!);
    expect(px.length).toBe(267 * 133 * 4);
    // Glyph ink exists: not every pixel is the white background.
    const inked = px.some((_, i) => i % 4 === 0 && px[i]! < 200);
    expect(inked).toBe(true);

    // Deterministic across calls.
    const r2 = await doc.renderPage({
      pageWidth: 200,
      fontSize: 12,
      pageHeight: 100,
      font: "NFTestMono",
      page: 0,
    });
    expect(r2.data.pixels_b64).toBe(r.data.pixels_b64);
  });

  it("paginates identically to layout and rejects bad pages/bounds", async () => {
    const doc = await QuillDocument.open(host);
    await doc.insertText(
      { block: 0, offset: 0 },
      "alpha beta gamma delta epsilon zeta eta theta iota kappa",
    );
    await doc.registerFont("NFTestMono", FONT_BYTES);
    const layout = await doc.layout(120, 12, 30, "NFTestMono");
    const pages = layout.data.pages.length;
    expect(pages).toBeGreaterThan(1);
    for (let page = 0; page < pages; page++) {
      const r = await doc.renderPage({
        pageWidth: 120,
        fontSize: 12,
        pageHeight: 30,
        font: "NFTestMono",
        page,
      });
      expect(r.data.page).toBe(page);
      expect(decodeRgba(r.data.pixels_b64!).length).toBe(
        r.data.width * r.data.height * 4,
      );
    }
    await expect(
      doc.renderPage({
        pageWidth: 120,
        fontSize: 12,
        pageHeight: 30,
        font: "NFTestMono",
        page: pages,
      }),
    ).rejects.toThrow();
    // Pixel bound: 5000pt at 96dpi exceeds 4096px/side.
    await expect(
      doc.renderPage({
        pageWidth: 5000,
        fontSize: 12,
        pageHeight: 100,
        font: "NFTestMono",
        page: 0,
      }),
    ).rejects.toThrow();
    // `font` is required.
    await expect(
      doc.renderPage({ pageWidth: 200, fontSize: 12, pageHeight: 100, font: "", page: 0 }),
    ).rejects.toThrow();
  });

  it("resolves per-run font_size and falls back for unregistered families (R2)", async () => {
    const opts = {
      pageWidth: 200,
      fontSize: 12,
      pageHeight: 100,
      font: "NFTestMono",
      page: 0,
    } as const;
    const open = async () => {
      const d = await QuillDocument.open(host);
      await d.insertText({ block: 0, offset: 0 }, "WW");
      await d.registerFont("NFTestMono", FONT_BYTES);
      return d;
    };

    const plain = await (await open()).renderPage(opts);

    // Unregistered run family → base-face fallback → identical pixels.
    const dFallback = await open();
    await dFallback.applyStyle(
      { block: 0, offset: 0 },
      { block: 0, offset: 2 },
      { font_family: "NotRegistered" },
    );
    const fallback = await dFallback.renderPage(opts);
    expect(fallback.data.pixels_b64).toBe(plain.data.pixels_b64);

    // A 24pt run draws differently from uniform 12pt, deterministically.
    const dStyled = await open();
    await dStyled.applyStyle(
      { block: 0, offset: 1 },
      { block: 0, offset: 2 },
      { font_size: 24 },
    );
    const styled = await dStyled.renderPage(opts);
    expect(styled.data.pixels_b64).not.toBe(plain.data.pixels_b64);
    const styled2 = await dStyled.renderPage(opts);
    expect(styled2.data.pixels_b64).toBe(styled.data.pixels_b64);
    await dFallback.close();
    await dStyled.close();
  });
});
