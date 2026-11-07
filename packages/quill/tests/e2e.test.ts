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

  it("findText locates matches and replaceText swaps them in one undo", async () => {
    const doc = await QuillDocument.open(host);
    await doc.insertText({ block: 0, offset: 0 }, "Foo bar foo");
    const found = await doc.findText("foo");
    expect(found.data.count).toBe(2);
    expect(found.data.matches[0]?.text).toBe("Foo");
    const sensitive = await doc.findText("foo", { caseSensitive: true });
    expect(sensitive.data.count).toBe(1);
    expect(sensitive.data.matches[0]?.from.offset).toBe(8);

    const replaced = await doc.replaceText("foo", "qux");
    expect(replaced.data.replaced).toBe(2);
    expect((await doc.text()).data.text).toBe("qux bar qux");
    expect(await doc.undo()).toBe(true);
    expect((await doc.text()).data.text).toBe("Foo bar foo");
    await doc.close();
  });

  it("bookmarks track edits, persist through snapshots, and undo", async () => {
    const doc = await QuillDocument.open(host);
    await doc.insertText({ block: 0, offset: 0 }, "hello world");
    await doc.addBookmark("mid", { block: 0, offset: 6 });
    await doc.insertText({ block: 0, offset: 0 }, "XX");
    expect((await doc.listBookmarks()).data.bookmarks).toEqual([
      { name: "mid", pos: { block: 0, offset: 8 } },
    ]);
    // snapshot keeps the schema:3 bookmark collection
    const bytes = await doc.save();
    await doc.close();

    const re = await QuillDocument.openSnapshot(host, bytes);
    expect((await re.listBookmarks()).data.bookmarks[0]?.pos.offset).toBe(8);
    await re.removeBookmarkByName("mid");
    expect((await re.listBookmarks()).data.bookmarks).toEqual([]);
    await expect(
      re.addBookmark("mid", { block: 0, offset: 0 }),
    ).resolves.toBeDefined();
    await expect(
      re.addBookmark("mid", { block: 0, offset: 1 }),
    ).rejects.toBeInstanceOf(EngineError);
    await re.close();
  });

  it("named styles define, apply, persist, and undo via nf-cli", async () => {
    const doc = await QuillDocument.open(host);
    await doc.insertText({ block: 0, offset: 0 }, "hello world");
    await doc.defineStyle({
      id: "emph",
      name: "Emphasis",
      kind: "character",
      properties: { italic: true, color: "#ff0000" },
    });
    await doc.defineStyle({
      id: "title",
      name: "Title",
      kind: "paragraph",
      properties: { bold: true, font_size: 18 },
    });
    const listed = await doc.listStyles();
    expect(listed.data.styles.map((s) => s.id)).toEqual(["emph", "title"]);

    await doc.applyNamedStyle("emph", { block: 0, offset: 0 }, { block: 0, offset: 5 });
    await doc.setBlockStyle(0, "title");
    const blocks = await doc.blocks<any>();
    expect(blocks.data.blocks[0].style_id).toBe("title");
    expect(blocks.data.blocks[0].inlines[0].style.bold).toBe(true);
    expect(blocks.data.blocks[0].inlines[0].style.font_size).toBe(18);
    // "hello" got both the paragraph stamp and the character range style
    const hello = blocks.data.blocks[0].inlines.find((i: any) => i.text === "hello");
    expect(hello.style.italic).toBe(true);
    expect(hello.style.color).toBe("#ff0000");

    // kind mismatches reject
    await expect(
      doc.applyNamedStyle("title", { block: 0, offset: 0 }, { block: 0, offset: 1 }),
    ).rejects.toBeInstanceOf(EngineError);
    await expect(doc.setBlockStyle(0, "emph")).rejects.toBeInstanceOf(EngineError);

    // snapshot keeps definitions + reference; reopen resolves them
    const bytes = await doc.save();
    await doc.close();
    const re = await QuillDocument.openSnapshot(host, bytes);
    expect((await re.listStyles()).data.styles).toHaveLength(2);
    expect((await re.blocks<any>()).data.blocks[0].style_id).toBe("title");

    // removeStyle clears the block reference atomically; undo restores it
    await re.removeStyle("title");
    expect((await re.blocks<any>()).data.blocks[0].style_id).toBeUndefined();
    expect(await re.undo()).toBe(true);
    expect((await re.blocks<any>()).data.blocks[0].style_id).toBe("title");
    await re.close();
  });

  it("sections carry page setup and headers through edits and snapshots", async () => {
    const doc = await QuillDocument.open(host);
    await doc.insertText({ block: 0, offset: 0 }, "one\ntwo\nthree\nfour");
    const first = await doc.listSections();
    expect(first.data.sections).toHaveLength(1);
    expect(first.data.sections[0]?.block).toBe(0);
    expect(first.data.sections[0]?.page.width).toBe(612);

    await doc.setPageSetup(0, {
      width: 595,
      height: 842,
      orientation: "landscape",
      columns: 2,
      column_gap: 36,
      start: "continuous",
    });
    await doc.setHeaderFooter(0, {
      header: "Running head",
      footer: "Page",
      different_first: true,
      first_header: "First",
      page_numbers: true,
      number_start: 3,
      number_format: "roman",
    });
    const inserted = await doc.insertSection(2, {
      page_setup: { margin_top: 100 },
      header_footer: { footer: "Second section" },
    });
    expect(inserted.data.section).toBe(1);
    const listed = await doc.listSections();
    expect(listed.data.sections.map((s) => s.block)).toEqual([0, 2]);
    // Inherits the owning section's settings, patch applied on top.
    expect(listed.data.sections[1]?.page.width).toBe(595);
    expect(listed.data.sections[1]?.page.margin_top).toBe(100);
    expect(listed.data.sections[1]?.header_footer.header).toBe("Running head");
    expect(listed.data.sections[1]?.header_footer.footer).toBe("Second section");

    // Boundaries track block edits: one newline at block 0 shifts section 1.
    await doc.insertText({ block: 0, offset: 0 }, "x\ny");
    expect((await doc.listSections()).data.sections.map((s) => s.block)).toEqual([0, 3]);

    // Invalid page setup rejects without touching state.
    await expect(
      doc.setPageSetup(1, { margin_top: 2000 }),
    ).rejects.toBeInstanceOf(EngineError);
    await expect(doc.insertSection(0)).rejects.toBeInstanceOf(EngineError);
    await expect(doc.removeSection(0)).rejects.toBeInstanceOf(EngineError);

    // Snapshot keeps sections; undo/redo round-trips them.
    const bytes = await doc.save();
    await doc.close();
    const re = await QuillDocument.openSnapshot(host, bytes);
    expect((await re.listSections()).data.sections.map((s) => s.block)).toEqual([0, 3]);
    await re.removeSection(1);
    expect((await re.listSections()).data.sections).toHaveLength(1);
    expect(await re.undo()).toBe(true);
    expect((await re.listSections()).data.sections).toHaveLength(2);
    await re.close();
  });

  it("comments anchor ranges, track edits, persist, and resolve via nf-cli", async () => {
    const doc = await QuillDocument.open(host);
    await doc.insertText({ block: 0, offset: 0 }, "hello world\nsecond");
    await doc.addComment({
      id: "c1",
      from: { block: 0, offset: 0 },
      to: { block: 0, offset: 5 },
      author: "Ada",
      body: "check this",
    });
    await doc.addComment({
      id: "c2",
      from: { block: 1, offset: 0 },
      to: { block: 1, offset: 0 },
      body: "point note",
    });
    const listed = await doc.listComments();
    expect(listed.data.comments.map((c) => c.id)).toEqual(["c1", "c2"]);
    expect(listed.data.comments[0]?.author).toBe("Ada");
    expect(listed.data.comments[0]?.resolved).toBe(false);

    // Edits re-anchor: insert before/at the range start keeps `from`
    // left-gravity (new text lands inside), `to` shifts right.
    await doc.insertText({ block: 0, offset: 0 }, "XX");
    let c1 = (await doc.listComments()).data.comments[0]!;
    expect(c1.from.offset).toBe(0);
    expect(c1.to.offset).toBe(7);
    // Insert exactly at `from` again: still inside, end moves again.
    await doc.insertText({ block: 0, offset: 0 }, "!");
    c1 = (await doc.listComments()).data.comments[0]!;
    expect(c1.from.offset).toBe(0);
    expect(c1.to.offset).toBe(8);

    // Resolve/reopen and update round-trip; duplicate ids reject.
    await doc.resolveComment("c1");
    expect((await doc.listComments()).data.comments[0]?.resolved).toBe(true);
    await doc.reopenComment("c1");
    await doc.updateComment("c1", { body: "revised", author: null });
    const updated = (await doc.listComments()).data.comments[0]!;
    expect(updated.body).toBe("revised");
    expect(updated.author).toBeNull();
    await expect(
      doc.addComment({
        id: "c1",
        from: { block: 0, offset: 0 },
        to: { block: 0, offset: 1 },
        body: "dup",
      }),
    ).rejects.toBeInstanceOf(EngineError);

    // Snapshot keeps the schema:3 comments collection; anchors survive.
    const bytes = await doc.save();
    await doc.close();
    const re = await QuillDocument.openSnapshot(host, bytes);
    const restored = (await re.listComments()).data.comments;
    expect(restored).toHaveLength(2);
    expect(restored[0]?.from.offset).toBe(0);
    expect(restored[0]?.to.offset).toBe(8);
    // Undo restores the comment list, not just the text.
    await re.removeComment("c2");
    expect((await re.listComments()).data.comments).toHaveLength(1);
    expect(await re.undo()).toBe(true);
    expect((await re.listComments()).data.comments).toHaveLength(2);
    await re.close();
  });

  it("inserts tables, edits cell text, and keeps anchors stable", async () => {
    const doc = await QuillDocument.open(host);
    await doc.insertText({ block: 0, offset: 0 }, "before\nafter");
    await doc.addBookmark("tail", { block: 1, offset: 0 });
    const ins = await doc.insertTable(1, 2, 3);
    expect(ins.data.block_index).toBe(1);
    const tables = (await doc.listTables()).data.tables;
    expect(tables).toEqual([{ block: 1, rows: 2, cols: 3 }]);
    await doc.setCellText(1, 0, 0, "hello\nworld");
    await doc.setCellText(1, 1, 2, "corner");
    const described = (await doc.describeTable(1)).data;
    expect(described.cells[0]?.[0]).toBe("hello\nworld");
    expect(described.cells[1]?.[2]).toBe("corner");
    expect(described.cells[0]?.[1]).toBe("");
    // The bookmark after the insertion point shifted one block; in-cell
    // edits never move top-level anchors.
    const bms = (await doc.listBookmarks()).data.bookmarks;
    expect(bms[0]?.pos.block).toBe(2);
    // describe/blocks expose the table block with its payload.
    const blocks = await doc.blocks<any>();
    expect(blocks.data.blocks[1].kind).toBe("table");
    expect(blocks.data.blocks[1].table.rows).toBe(2);
    // Snapshot round-trip preserves the table and the bookmark.
    const bytes = await doc.save();
    await doc.close();
    const re = await QuillDocument.openSnapshot(host, bytes);
    expect((await re.describeTable(1)).data.cells[0]?.[0]).toBe("hello\nworld");
    expect((await re.listBookmarks()).data.bookmarks[0]?.pos.block).toBe(2);
    // deleteTable removes the block and shifts anchors back.
    await re.deleteTable(1);
    expect((await re.listTables()).data.tables).toHaveLength(0);
    expect((await re.listBookmarks()).data.bookmarks[0]?.pos.block).toBe(1);
    expect(await re.undo()).toBe(true);
    expect((await re.listTables()).data.tables).toHaveLength(1);
    await re.close();
  });

  it("rejects out-of-bounds tables and cell edits atomically", async () => {
    const doc = await QuillDocument.open(host);
    await doc.insertTable(1, 1, 1);
    await expect(doc.insertTable(9, 1, 1)).rejects.toBeInstanceOf(EngineError);
    await expect(doc.insertTable(0, 0, 1)).rejects.toBeInstanceOf(EngineError);
    await expect(doc.insertTable(0, 1, 27)).rejects.toBeInstanceOf(EngineError);
    await expect(doc.setCellText(1, 5, 0, "x")).rejects.toBeInstanceOf(EngineError);
    await expect(doc.setCellText(0, 0, 0, "x")).rejects.toBeInstanceOf(EngineError);
    await expect(doc.deleteTable(0)).rejects.toBeInstanceOf(EngineError);
    // Document unchanged: still [para, table].
    expect((await doc.listTables()).data.tables).toEqual([{ block: 1, rows: 1, cols: 1 }]);
    await doc.close();
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
