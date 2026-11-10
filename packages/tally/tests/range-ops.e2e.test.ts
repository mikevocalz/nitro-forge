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

it("fills mixed sources upward and keeps references on the sheet", async () => {
  const doc = await TallyDocument.open(host);
  try {
    // Number, text, empty and formula cells in one source row.
    await doc.setRange("A5", [["1", "x", "", "=A5+$A$5"]]);
    await doc.setCell("C3", "stale");
    const up = await commitTallyFill(doc, {
      source: { startRow: 4, endRow: 4, startColumn: 0, endColumn: 3 },
      target: { startRow: 2, endRow: 4, startColumn: 0, endColumn: 3 }, direction: "up",
    });
    expect(up.data?.changed).toBe(7);
    expect((await doc.getCell("A3")).data).toEqual({ raw: "1", computed: 1 });
    expect((await doc.getCell("B3")).data?.raw).toBe("x");
    expect((await doc.getCell("C3")).data?.raw).toBe("");
    expect((await doc.getCell("D3")).data).toEqual({ raw: "=A3+$A$5", computed: 2 });

    // Filling down from the last row's neighbour shifts a reference off the sheet.
    await doc.setCell("B1048575", "=B1048576");
    await commitTallyFill(doc, {
      source: { startRow: 1048574, endRow: 1048574, startColumn: 1, endColumn: 1 },
      target: { startRow: 1048574, endRow: 1048575, startColumn: 1, endColumn: 1 }, direction: "down",
    });
    expect((await doc.getCell("B1048576")).data).toEqual({ raw: "=#REF!", computed: "#REF!" });

    const before = await doc.save();
    await expect(doc.setRange("A1048576", [["a"], ["b"]])).rejects.toMatchObject({ code: "out_of_bounds" });
    await expect(doc.fillRange({ from: "XFD1", to: "XFD1" }, { from: "XFD1", to: "XFE1" })).rejects.toMatchObject({ code: "out_of_bounds" });
    expect(await doc.save()).toEqual(before);
  } finally { await doc.close(); }
});

it("rejects every address past XFD1048576 before mutating and evaluates such references as #REF!", async () => {
  const doc = await TallyDocument.open(host);
  try {
    const empty = await doc.save();
    await doc.setCell("XFD1048576", "7");
    const before = await doc.save();
    const offSheet = { code: "out_of_bounds" };
    await expect(doc.setCell("A1048577", "x")).rejects.toMatchObject(offSheet);
    await expect(doc.setCell("XFE1", "x")).rejects.toMatchObject(offSheet);
    await expect(doc.clearCell("XFE1048577")).rejects.toMatchObject(offSheet);
    await expect(doc.getCell("A1048577")).rejects.toMatchObject(offSheet);
    await expect(doc.getRange("XFD1048576", "XFE1048576")).rejects.toMatchObject(offSheet);
    expect(await doc.save()).toEqual(before);
    expect((await doc.evaluate("=SUM(A1:A1048577)")).data?.value).toBe("#REF!");
    expect((await doc.evaluate("=XFD1048576*2")).data?.value).toBe(14);
    // The rejected calls left no journal entries: one undo removes the
    // on-sheet write and returns the document to its state before it.
    expect(await doc.undo()).toBe(true);
    expect(await doc.save()).toEqual(empty);
  } finally { await doc.close(); }
});
