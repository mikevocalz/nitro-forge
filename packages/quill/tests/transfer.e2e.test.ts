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

import { QuillDocument } from "../src/index";
import { QUILL_EXPORT_FORMATS, QUILL_IMPORT_FORMATS } from "../src/transfer";

describe("quill DOCX transfer (real Rust via nf-cli)", () => {
  it("exports a .docx that imports back with the same text", async () => {
    const a = await QuillDocument.open(host);
    await a.insertText({ block: 0, offset: 0 }, "Hello transfer");
    const out = await runExport(a.handle, QUILL_EXPORT_FORMATS, { formatId: "docx", filename: "letter.DOCX" });
    expect(out.filename).toBe("letter.DOCX");
    expect(out.bytes[0]).toBe(0x50); // zip "PK"
    const b = await QuillDocument.open(host);
    await runImport(b.handle, QUILL_IMPORT_FORMATS, "docx", out.bytes);
    const text = JSON.stringify((await b.handle.apply("describe")).data);
    expect(text).toContain("Hello transfer");
    await a.close();
    await b.close();
  });
});
