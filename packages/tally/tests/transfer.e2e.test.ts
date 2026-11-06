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

import { TallyDocument } from "../src/index";
import { TALLY_EXPORT_FORMATS, colName, csvField, usedBounds } from "../src/transfer";

describe("tally CSV export (real Rust via nf-cli)", () => {
  it("writes computed values of the active sheet with RFC 4180 quoting", async () => {
    const t = await TallyDocument.open(host);
    await t.handle.apply("setCell", { addr: "A1", value: "name" });
    await t.handle.apply("setCell", { addr: "B1", value: "total" });
    await t.handle.apply("setCell", { addr: "A2", value: 'say "hi", ok' });
    await t.handle.apply("setCell", { addr: "B2", value: "=2*21" });
    await t.handle.apply("setCell", { addr: "C3", value: "x" });
    const out = await runExport(t.handle, TALLY_EXPORT_FORMATS, { formatId: "csv", filename: "sheet" });
    expect(new TextDecoder().decode(out.bytes)).toBe('name,total,\r\n"say ""hi"", ok",42,\r\n,,x\r\n');
    await t.close();
  });

  it("helpers", () => {
    expect(colName(1)).toBe("A");
    expect(colName(28)).toBe("AB");
    expect(usedBounds({ B7: 1, AA2: 1 })).toEqual({ cols: 27, rows: 7 });
    expect(csvField(" pad")).toBe('" pad"');
  });
});
