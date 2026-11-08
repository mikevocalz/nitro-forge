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

// P12 slice 9: paragraph alignment, indents and tab stops — storage-only
// formatting on blocks, plus the `properties.paragraph` grammar on
// paragraph-kind named styles.
describe("quill paragraph format (real Rust via nf-cli)", () => {
  it("sets, patches, clears and reads alignment/indents/tab stops", async () => {
    const doc = await QuillDocument.open(host);
    await doc.insertText({ block: 0, offset: 0 }, "hello");
    const set = await doc.setParagraphFormat(0, {
      alignment: "center",
      indent_left: 720,
      indent_first: -360,
      tabs: [
        { position: 1440, alignment: "right", leader: "dot" },
        { position: 2880, alignment: "decimal" },
      ],
    });
    expect(set.events.some((e) => e.kind === "document:changed")).toBe(true);
    let blocks = (await doc.blocks<any>()).data.blocks;
    expect(blocks[0].format).toEqual({
      alignment: "center",
      indent_left: 720,
      indent_first: -360,
      tabs: [
        { position: 1440, alignment: "right", leader: "dot" },
        { position: 2880, alignment: "decimal" },
      ],
    });

    // Partial patch: absent keys untouched, explicit null clears.
    await doc.setParagraphFormat(0, { indent_right: 360, alignment: null });
    blocks = (await doc.blocks<any>()).data.blocks;
    expect(blocks[0].format.alignment).toBeUndefined();
    expect(blocks[0].format.indent_left).toBe(720);
    expect(blocks[0].format.indent_right).toBe(360);
    expect(blocks[0].format.indent_first).toBe(-360);
    expect(blocks[0].format.tabs).toHaveLength(2);

    // Clearing every field removes `format` from the payload entirely.
    await doc.setParagraphFormat(0, {
      indent_left: null,
      indent_right: null,
      indent_first: null,
      tabs: null,
    });
    blocks = (await doc.blocks<any>()).data.blocks;
    expect(blocks[0].format).toBeUndefined();
    await doc.close();
  });

  it("equal writes and empty patches are eventless", async () => {
    const doc = await QuillDocument.open(host);
    const empty = await doc.setParagraphFormat(0, {});
    expect(empty.events).toEqual([]);
    await doc.setParagraphFormat(0, { alignment: "justify" });
    const again = await doc.setParagraphFormat(0, { alignment: "justify" });
    expect(again.events).toEqual([]);
    const clearUnset = await doc.setParagraphFormat(0, { indent_left: null });
    expect(clearUnset.events).toEqual([]);
    await doc.close();
  });

  it("rejects out-of-bounds values and table blocks atomically", async () => {
    const doc = await QuillDocument.open(host);
    await doc.insertText({ block: 0, offset: 0 }, "x");
    await expect(
      doc.setParagraphFormat(0, { alignment: "middle" as never }),
    ).rejects.toBeInstanceOf(EngineError);
    await expect(doc.setParagraphFormat(0, { indent_left: 31681 })).rejects.toBeInstanceOf(
      EngineError,
    );
    await expect(doc.setParagraphFormat(0, { indent_first: -40000 })).rejects.toBeInstanceOf(
      EngineError,
    );
    await expect(
      doc.setParagraphFormat(0, {
        tabs: [
          { position: 200, alignment: "left" },
          { position: 100, alignment: "left" },
        ],
      }),
    ).rejects.toBeInstanceOf(EngineError);
    await expect(doc.setParagraphFormat(9, { alignment: "center" })).rejects.toBeInstanceOf(
      EngineError,
    );
    // State untouched by the rejects.
    expect((await doc.blocks<any>()).data.blocks[0].format).toBeUndefined();
    // Table blocks reject.
    await doc.insertTable(1, 1, 1);
    await expect(doc.setParagraphFormat(1, { alignment: "center" })).rejects.toBeInstanceOf(
      EngineError,
    );
    await doc.close();
  });

  it("undo/redo restores format and splits carry it", async () => {
    const doc = await QuillDocument.open(host);
    await doc.insertText({ block: 0, offset: 0 }, "abcdef");
    await doc.setParagraphFormat(0, { alignment: "center", indent_left: 720 });
    await doc.splitBlock({ block: 0, offset: 3 });
    let blocks = (await doc.blocks<any>()).data.blocks;
    expect(blocks).toHaveLength(2);
    expect(blocks[0].format.alignment).toBe("center");
    expect(blocks[1].format.alignment).toBe("center");
    expect(blocks[1].format.indent_left).toBe(720);
    // One undo removes the split; another removes the format.
    expect(await doc.undo()).toBe(true);
    expect(await doc.undo()).toBe(true);
    blocks = (await doc.blocks<any>()).data.blocks;
    expect(blocks[0].format).toBeUndefined();
    expect(await doc.redo()).toBe(true);
    blocks = (await doc.blocks<any>()).data.blocks;
    expect(blocks[0].format.alignment).toBe("center");
    await doc.close();
  });

  it("persists through snapshot reopen on the schema:4 wrapper", async () => {
    const doc = await QuillDocument.open(host);
    await doc.insertText({ block: 0, offset: 0 }, "persist");
    await doc.setParagraphFormat(0, {
      alignment: "right",
      tabs: [{ position: 720, alignment: "left" }],
    });
    const bytes = await doc.save();
    await doc.close();
    const re = await QuillDocument.openSnapshot(host, bytes);
    const blocks = (await re.blocks<any>()).data.blocks;
    expect(blocks[0].format.alignment).toBe("right");
    expect(blocks[0].format.tabs[0].position).toBe(720);
    await re.close();
  });

  it("named paragraph styles carry properties.paragraph with precedence", async () => {
    const doc = await QuillDocument.open(host);
    await doc.insertText({ block: 0, offset: 0 }, "abc");
    await doc.setParagraphFormat(0, { alignment: "left", indent_left: 720 });
    await doc.defineStyle({
      id: "centered",
      name: "Centered",
      kind: "paragraph",
      properties: {
        bold: true,
        paragraph: { alignment: "center", indent_right: 360 },
      },
    });
    await doc.setBlockStyle(0, "centered");
    let blocks = (await doc.blocks<any>()).data.blocks;
    // Style's present keys win; absent keys (indent_left) stay untouched.
    expect(blocks[0].format.alignment).toBe("center");
    expect(blocks[0].format.indent_left).toBe(720);
    expect(blocks[0].format.indent_right).toBe(360);
    expect(blocks[0].inlines[0].style.bold).toBe(true);
    expect(blocks[0].style_id).toBe("centered");
    // updateStyle never propagates to already-styled content.
    await doc.updateStyle("centered", {
      properties: { paragraph: { alignment: "right" } },
    });
    blocks = (await doc.blocks<any>()).data.blocks;
    expect(blocks[0].format.alignment).toBe("center");
    // Clearing the reference leaves stamped format in place.
    await doc.setBlockStyle(0, null);
    blocks = (await doc.blocks<any>()).data.blocks;
    expect(blocks[0].format.alignment).toBe("center");
    // Character styles reject paragraph properties.
    await expect(
      doc.defineStyle({
        id: "c1",
        name: "C1",
        kind: "character",
        properties: { paragraph: { alignment: "center" } },
      }),
    ).rejects.toBeInstanceOf(EngineError);
    await doc.close();
  });
});
