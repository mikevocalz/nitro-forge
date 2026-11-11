import { existsSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { CliHost } from "@nitro-forge/ignition/cli";
import { FolioDocument } from "../src/index";
import { FolioRenderService } from "../src/render";

/**
 * e2e for the folio-render host service (rust/folio-render, pdfium
 * backend). Feeds real folio-engine `savePdf` bytes through the JSON-lines
 * binary — the same path hosts use. Requires `cargo build -p
 * folio-render` and a resolvable pdfium library (see
 * rust/folio-render/README.md); skips when either is absent.
 */

const BIN =
  process.env.FOLIO_RENDER ??
  fileURLToPath(new URL("../../../target/debug/folio-render", import.meta.url).href);
const HAVE_BIN = existsSync(BIN);

let host: CliHost;
let svc: FolioRenderService | undefined;
let handle = 0;
let pdfBytes: Uint8Array;
let unavailable: string | undefined;

function skip(ctx: { skip: () => void }) {
  if (!HAVE_BIN || unavailable !== undefined) ctx.skip();
}

beforeAll(async () => {
  host = new CliHost();
  if (!HAVE_BIN) return;
  try {
    svc = FolioRenderService.connect(BIN);
    // Engine-produced bytes: the real save→render pipeline.
    const doc = await FolioDocument.create(host, 1);
    pdfBytes = (await doc.savePdf()).bytes;
    await doc.close();
    const info = await svc.open(pdfBytes);
    handle = info.handle;
  } catch (e) {
    unavailable = e instanceof Error ? e.message : String(e);
    svc = undefined;
  }
});

afterAll(async () => {
  if (handle !== 0 && svc) await svc.close(handle).catch(() => {});
  await svc?.dispose().catch(() => {});
  await host?.dispose().catch(() => {});
});

describe.runIf(HAVE_BIN)("folio-render service e2e (real pdfium via folio-render binary)", () => {
  it("opens engine save bytes and reports page geometry", async (ctx) => {
    skip(ctx);
    const info = await svc!.open(pdfBytes);
    expect(info.pages).toBe(1);
    expect(info.page_sizes[0]!.width).toBeGreaterThan(0);
    expect(info.encrypted).toBe(false);
    await svc!.close(info.handle);
  });

  it("renders a real PNG page bitmap", async (ctx) => {
    skip(ctx);
    const img = await svc!.renderPage(handle, { page: 0, scale: 0.5, format: "png" });
    expect(img.format).toBe("png");
    expect(img.width).toBeGreaterThan(0);
    expect(img.height).toBeGreaterThan(0);
    // PNG magic.
    expect([...img.bytes.subarray(0, 8)]).toEqual([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);
  });

  it("returns positioned text items", async (ctx) => {
    skip(ctx);
    const items = await svc!.textPage(handle, 0);
    expect(Array.isArray(items)).toBe(true);
    for (const item of items) {
      expect(item.bbox).toHaveLength(4);
      for (const v of item.bbox) expect(Number.isFinite(v)).toBe(true);
    }
  });

  it("answers pageInfo and search without throwing", async (ctx) => {
    skip(ctx);
    const info = await svc!.pageInfo(handle, 0);
    expect(info.size.width).toBeGreaterThan(0);
    expect([0, 90, 180, 270]).toContain(info.rotate);
    const res = await svc!.search(handle, "the");
    expect(res.hits.length).toBeGreaterThanOrEqual(0);
    expect(res.truncated).toBe(false);
  });

  it("rejects out-of-range pages with a service error", async (ctx) => {
    skip(ctx);
    await expect(svc!.textPage(handle, 99)).rejects.toThrow(/folio-render textPage failed/);
  });
});
