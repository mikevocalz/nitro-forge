import { afterAll, beforeAll, expect, it } from "vitest";
import { CliHost } from "@nitro-forge/ignition/cli";
import { TallyDocument } from "../src/index";
import { commitTallyFill } from "../src/grid-cluster";
let host: CliHost;
beforeAll(() => { host = new CliHost(); });
afterAll(async () => { await host.dispose(); });

it("batch paste and fill use real Rust, recalculate, undo once and survive saving", async () => {
  const doc = await TallyDocument.open(host);
  try {
    await doc.setRange("A1", [["2", "=A1*2"], ["3", "=A2*2"]]);
    const before = await doc.save();
    const result = await commitTallyFill(doc, {
      source: { startRow: 0, endRow: 1, startColumn: 0, endColumn: 1 },
      target: { startRow: 0, endRow: 5, startColumn: 0, endColumn: 1 }, direction: "down",
    });
    expect(result.data?.changed).toBe(8);
    expect((await doc.getCell("B6")).data).toEqual({ raw: "=A6*2", computed: 6 });
    expect(await doc.undo()).toBe(true);
    expect(await doc.save()).toEqual(before);
    expect(await doc.redo()).toBe(true);
    const restored = await TallyDocument.openSnapshot(host, await doc.save());
    try { expect((await restored.getCell("B6")).data?.computed).toBe(6); }
    finally { await restored.close(); }
    await doc.undo();
    await doc.undo();
    expect((await doc.getCell("A1")).data?.raw).toBe("");
    expect((await doc.getCell("B2")).data?.raw).toBe("");
  } finally { await doc.close(); }
});

it("rejects partial paste/fill without changing state or consuming redo", async () => {
  const doc = await TallyDocument.open(host);
  try {
    await doc.setRange("A1", [["before"]]);
    await doc.setRange("A1", [["after"]]);
    await doc.undo();
    const before = await doc.save();
    await expect(doc.setRange("A1", [["partial"], ["bad", "shape"]])).rejects.toMatchObject({ code: "validation" });
    await expect(doc.fillRange({ from: "A1", to: "A1" }, { from: "B1", to: "C1" })).rejects.toMatchObject({ code: "validation" });
    expect(await doc.save()).toEqual(before);
    await doc.redo();
    expect((await doc.getCell("A1")).data?.raw).toBe("after");
  } finally { await doc.close(); }
});
