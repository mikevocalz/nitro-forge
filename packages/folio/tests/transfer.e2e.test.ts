import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { CliHost } from "@nitro-forge/ignition/cli";
import { runExport, runImport, importFormatFor, describeFormat } from "@nitro-forge/ignition/transfer";

let host: CliHost;
beforeAll(() => {
  host = new CliHost();
});
afterAll(async () => {
  await host.dispose();
});

import { EngineError } from "@nitro-forge/ignition";
import { FolioDocument } from "../src/index";
import { FOLIO_EXPORT_FORMATS, FOLIO_IMPORT_FORMATS } from "../src/transfer";

describe("folio PDF transfer (real Rust via nf-cli)", () => {
  it("exports real PDF bytes and imports them into another document", async () => {
    const a = await FolioDocument.create(host, 3);
    const out = await runExport(a.handle, FOLIO_EXPORT_FORMATS, { formatId: "pdf", filename: "Report" });
    expect(out.filename).toBe("Report.pdf");
    expect(new TextDecoder().decode(out.bytes.slice(0, 5))).toBe("%PDF-");
    const b = await FolioDocument.create(host, 1);
    await runImport(b.handle, FOLIO_IMPORT_FORMATS, "pdf", out.bytes);
    expect((await b.handle.apply<{ pages: number }>("pageCount")).data.pages).toBe(3);
    await expect(runImport(b.handle, FOLIO_IMPORT_FORMATS, "pdf", new Uint8Array([1, 2, 3]))).rejects.toBeInstanceOf(EngineError);
    expect((await b.handle.apply<{ pages: number }>("pageCount")).data.pages).toBe(3);
    await a.close();
    await b.close();
  });
});
