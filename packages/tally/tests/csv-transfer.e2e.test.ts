import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { CliHost } from "@nitro-forge/ignition/cli";
import { runImport } from "@nitro-forge/ignition/transfer";
import { TallyDocument } from "../src/index";
import { TALLY_IMPORT_FORMATS } from "../src/transfer";

let host: CliHost;
beforeAll(() => {
  host = new CliHost();
});
afterAll(async () => {
  await host.dispose();
});

describe("tally CSV/TSV ops (real Rust via nf-cli)", () => {
  it("importCsv writes verbatim cells and exportCsv returns computed text", async () => {
    const t = await TallyDocument.open(host);
    const r = await t.importCsv('name,qty\napples,"=2*21"\n"say ""hi""",3.5');
    expect(r.data.changed).toBe(6);
    expect(r.data.rows).toBe(3);
    expect((await t.getCell("B2")).data.computed).toBe(42);
    expect((await t.getCell("A3")).data.raw).toBe('say "hi"');
    const out = await t.exportCsv();
    expect(out.data).toEqual({
      text: 'name,qty\r\napples,42\r\n"say ""hi""",3.5\r\n',
      rows: 3,
      cols: 2,
    });
    await t.close();
  });

  it("importTsv honors tabs and the at/sheet options", async () => {
    const t = await TallyDocument.open(host);
    await t.addSheet("Data");
    await t.importTsv("a\tb\n1\t2", { sheet: "Data", at: "B2" });
    await t.setActive("Data");
    expect((await t.getCell("B2")).data.raw).toBe("a");
    expect((await t.getCell("C3")).data.computed).toBe(2);
    const out = await t.exportTsv({ range: { from: "B2", to: "C3" } });
    expect(out.data.text).toBe("a\tb\r\n1\t2\r\n");
    await t.close();
  });

  it("malformed import rejects atomically and undo restores", async () => {
    const t = await TallyDocument.open(host);
    await t.setCell("A1", "keep");
    await expect(t.importCsv('"unterminated')).rejects.toThrow();
    expect((await t.getCell("A1")).data.raw).toBe("keep");
    await t.importCsv("new,1");
    expect((await t.getCell("A1")).data.raw).toBe("new");
    expect(await t.undo()).toBe(true);
    expect((await t.getCell("A1")).data.raw).toBe("keep");
    await t.close();
  });

  it("protected target sheet rejects import; export stays readable", async () => {
    const t = await TallyDocument.open(host);
    await t.setCell("A1", "v");
    await t.protectSheet(0, true);
    await expect(t.importCsv("x")).rejects.toThrow();
    expect((await t.exportCsv()).data.text).toBe("v\r\n");
    await t.protectSheet(0, false);
    await t.close();
  });

  it("transfer formats: csv/tsv import run through runImport", async () => {
    const t = await TallyDocument.open(host);
    const bytes = new TextEncoder().encode("h1,h2\n1,2\n");
    await runImport(t.handle, TALLY_IMPORT_FORMATS, "csv", bytes);
    expect((await t.getCell("A1")).data.raw).toBe("h1");
    expect((await t.getCell("B2")).data.computed).toBe(2);
    const tsv = new TextEncoder().encode("x\ty\n");
    await runImport(t.handle, TALLY_IMPORT_FORMATS, "tsv", tsv);
    expect((await t.getCell("B1")).data.raw).toBe("y");
    await t.close();
  });
});
