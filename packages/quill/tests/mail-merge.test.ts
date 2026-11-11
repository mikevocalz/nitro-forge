import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { EngineError } from "@nitro-forge/ignition";
import { CliHost } from "@nitro-forge/ignition/cli";
import { QuillDocument } from "../src/index";

let host: CliHost;
beforeAll(() => {
  host = new CliHost();
});
afterAll(async () => {
  await host.dispose();
});

// P12 slice 8 (mail merge): `{{name}}` field tokens in block text,
// record payloads supplied per command, read-only preview plus one
// undoable runMerge fill. No persisted field/data-source state.
describe("quill mail merge (real Rust via nf-cli)", () => {
  it("lists fields in first-appearance order with occurrence counts", async () => {
    const doc = await QuillDocument.open(host);
    await doc.insertText({ block: 0, offset: 0 }, "Hi {{name}}, bye {{name}} {{city}}");
    const r = await doc.listMergeFields();
    expect(r.events).toHaveLength(0);
    expect(r.data).toEqual({
      fields: [
        { name: "name", occurrences: 2 },
        { name: "city", occurrences: 1 },
      ],
      occurrences: 3,
    });
    await doc.close();
  });

  it("previews multiple records without mutating the document", async () => {
    const doc = await QuillDocument.open(host);
    await doc.insertText({ block: 0, offset: 0 }, "Dear {{name}} of {{city}}");
    const r = await doc.previewMerge([
      { name: "Ada", city: "Oslo", unused: "x" },
      { name: "Bob" },
    ]);
    expect(r.events).toHaveLength(0);
    expect(r.data.results).toEqual([
      {
        index: 0,
        text: "Dear Ada of Oslo",
        missing: [],
      },
      {
        index: 1,
        text: "Dear Bob of ",
        missing: ["city"],
      },
    ]);
    expect(r.data.fields).toEqual([
      { name: "name", occurrences: 1 },
      { name: "city", occurrences: 1 },
    ]);
    // Preview changed nothing.
    expect((await doc.text()).data.text).toBe("Dear {{name}} of {{city}}");
    await doc.close();
  });

  it("runMerge fills fields as one undoable step", async () => {
    const doc = await QuillDocument.open(host);
    await doc.insertText({ block: 0, offset: 0 }, "Hello {{name}}, city {{city}}");
    const r = await doc.runMerge({ name: "Ada", city: "Oslo" });
    expect(r.data).toEqual({ ok: true, replaced: 2, missing: [] });
    expect((await doc.text()).data.text).toBe("Hello Ada, city Oslo");
    await doc.undo();
    expect((await doc.text()).data.text).toBe("Hello {{name}}, city {{city}}");
    await doc.redo();
    expect((await doc.text()).data.text).toBe("Hello Ada, city Oslo");
    await doc.close();
  });

  it("runMerge honors ranges, reports missing fields, and rejects bad payloads", async () => {
    const doc = await QuillDocument.open(host);
    await doc.insertText({ block: 0, offset: 0 }, "{{a}} one\n{{a}} two");
    // Only the second block is in range.
    const r = await doc.runMerge(
      { a: "X" },
      { from: { block: 1, offset: 0 }, to: { block: 1, offset: 7 } },
    );
    expect(r.data.replaced).toBe(1);
    expect((await doc.text()).data.text).toBe("{{a}} one\nX two");
    // No tokens in range: eventless.
    const noop = await doc.runMerge(
      { a: "Y" },
      { from: { block: 0, offset: 0 }, to: { block: 0, offset: 4 } },
    );
    expect(noop.events).toHaveLength(0);
    expect(noop.data.replaced).toBe(0);
    // Missing field merges as "" and is reported.
    const miss = await doc.runMerge({ unrelated: "z" });
    expect(miss.data.missing).toEqual(["a"]);
    expect((await doc.text()).data.text).toBe(" one\nX two");
    // Payload validation rejects atomically.
    await expect(doc.runMerge({ "bad{key": "v" })).rejects.toBeInstanceOf(
      EngineError,
    );
    await expect(doc.runMerge({ a: "line\nbreak" })).rejects.toBeInstanceOf(
      EngineError,
    );
    expect((await doc.text()).data.text).toBe(" one\nX two");
    await doc.close();
  });

  it("merges fields inside table cells", async () => {
    const doc = await QuillDocument.open(host);
    await doc.insertText({ block: 0, offset: 0 }, "intro");
    await doc.insertTable(1, 1, 2);
    await doc.setCellText(1, 0, 0, "{{name}}");
    await doc.setCellText(1, 0, 1, "{{city}}");
    const scan = await doc.listMergeFields();
    expect(scan.data.fields).toEqual([
      { name: "name", occurrences: 1 },
      { name: "city", occurrences: 1 },
    ]);
    const r = await doc.runMerge({ name: "Ada", city: "Oslo" });
    expect(r.data.replaced).toBe(2);
    const desc = await doc.describeTable(1);
    expect(desc.data.cells).toEqual([["Ada", "Oslo"]]);
    await doc.close();
  });
});
