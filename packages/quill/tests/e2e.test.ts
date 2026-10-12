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

describe("quill engine e2e (real Rust via nf-cli)", () => {
  it("edits text, styles ranges, splits blocks", async () => {
    const doc = await QuillDocument.open(host);
    await doc.insertText({ block: 0, offset: 0 }, "hello world");
    await doc.applyStyle(
      { block: 0, offset: 0 },
      { block: 0, offset: 5 },
      { bold: true },
    );
    await doc.splitBlock({ block: 0, offset: 5 });
    const t = await doc.text();
    expect(t.data.text).toBe("hello\n world");
    const blocks = await doc.blocks<any>();
    expect(blocks.data.blocks).toHaveLength(2);
    expect(blocks.data.blocks[0].inlines[0].style.bold).toBe(true);
    await doc.close();
  });

  it("exports and re-imports real DOCX bytes", async () => {
    const doc = await QuillDocument.open(host);
    await doc.insertText({ block: 0, offset: 0 }, "Title");
    await doc.setBlockKind(0, "h1");
    await doc.insertBlock(1);
    await doc.insertText({ block: 1, offset: 0 }, "body text");
    await doc.applyStyle(
      { block: 1, offset: 0 },
      { block: 1, offset: 4 },
      { italic: true },
    );
    const docx = await doc.exportDocx();
    // zip magic
    expect([docx[0], docx[1]]).toEqual([0x50, 0x4b]);
    await doc.close();

    const re = await QuillDocument.openDocx(host, docx);
    const t = await re.text();
    expect(t.data.text).toContain("Title");
    expect(t.data.text).toContain("body text");
    const blocks = await re.blocks<any>();
    expect(blocks.data.blocks[0].kind).toBe("h1");
    expect(blocks.data.blocks[1].inlines[0].style.italic).toBe(true);
    await re.close();
  });

  it("save/reopen snapshot preserves document", async () => {
    const doc = await QuillDocument.open(host);
    await doc.insertText({ block: 0, offset: 0 }, "persist me");
    const bytes = await doc.save();
    await doc.close();
    const re = await QuillDocument.openSnapshot(host, bytes);
    expect((await re.text()).data.text).toBe("persist me");
    await re.close();
  });

  it("undo restores deleted text; bad positions error cleanly", async () => {
    const doc = await QuillDocument.open(host);
    await doc.insertText({ block: 0, offset: 0 }, "abcdef");
    await doc.deleteRange({ block: 0, offset: 0 }, { block: 0, offset: 3 });
    expect((await doc.text()).data.text).toBe("def");
    expect(await doc.undo()).toBe(true);
    expect((await doc.text()).data.text).toBe("abcdef");
    await expect(
      doc.insertText({ block: 99, offset: 0 }, "x"),
    ).rejects.toBeInstanceOf(EngineError);
    await doc.close();
  });
});
