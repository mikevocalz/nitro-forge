import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { EngineError } from "@nitro-forge/ignition";
import { CliHost } from "@nitro-forge/ignition/cli";
import { TallyDocument } from "../src/index";

let host: CliHost;
beforeAll(() => {
  host = new CliHost();
});
afterAll(async () => {
  await host.dispose();
});

describe("tally engine e2e (real Rust via nf-cli)", () => {
  it("sets values and evaluates formulas", async () => {
    const doc = await TallyDocument.open(host);
    await doc.setCell("A1", "10");
    await doc.setCell("A2", "20");
    const r = await doc.setCell("A3", "=A1+A2");
    expect(r.data.computed).toBe(30);
    const cell = await doc.getCell("A3");
    expect(cell.data.computed).toBe(30);
    const ev = await doc.evaluate("=SUM(A1:A3)");
    expect(ev.data.value).toBe(60);
    await doc.close();
  });

  it("round-trips through snapshot/save/reopen", async () => {
    const doc = await TallyDocument.open(host);
    await doc.setCell("B2", "hello");
    await doc.setCell("C1", "=2^10");
    const bytes = await doc.save();
    await doc.close();

    const reopened = await TallyDocument.openSnapshot(host, bytes);
    expect((await reopened.getCell("B2")).data.computed).toBe("hello");
    expect((await reopened.getCell("C1")).data.computed).toBe(1024);
    await reopened.close();
  });

  it("undoes and redoes cell writes", async () => {
    const doc = await TallyDocument.open(host);
    await doc.setCell("A1", "1");
    await doc.setCell("A1", "2");
    expect(await doc.undo()).toBe(true);
    expect((await doc.getCell("A1")).data.computed).toBe(1);
    expect(await doc.redo()).toBe(true);
    expect((await doc.getCell("A1")).data.computed).toBe(2);
    await doc.close();
  });

  it("reports cycle errors and rejects bad commands without corrupting state", async () => {
    const doc = await TallyDocument.open(host);
    await doc.setCell("A1", "=B1");
    await doc.setCell("B1", "=A1");
    expect((await doc.getCell("A1")).data.computed).toBe("#CYCLE!");
    await expect(doc.setCell("!!", "x")).rejects.toBeInstanceOf(EngineError);
    // state intact after error
    expect((await doc.getCell("A1")).data.computed).toBe("#CYCLE!");
    await doc.close();
  });
});
