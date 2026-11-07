import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { CliHost } from "@nitro-forge/ignition/cli";
import { TallyDocument } from "../src/index";

let host: CliHost;
beforeAll(() => {
  host = new CliHost();
});
afterAll(async () => {
  await host.dispose();
});

describe("tally comments (real Rust via nf-cli)", () => {
  it("adds, patches, resolves and lists cell/range-anchored comments", async () => {
    const doc = await TallyDocument.open(host);
    try {
      const added = await doc.addComment({ cell: "b2" }, "check this", {
        author: "Ada",
      });
      expect(added.data.comment.id).toBe(1);
      expect(added.data.comment.anchor).toBe("B2"); // canonicalized
      expect(added.data.comment.sheet).toBe("Sheet1");
      expect(added.data.comment.author).toBe("Ada");
      expect(added.data.comment.resolved).toBe(false);

      // Range anchor canonicalizes endpoint order.
      const ranged = await doc.addComment(
        { range: { from: "$d$4", to: "c$3" } },
        "range note",
      );
      expect(ranged.data.comment.id).toBe(2);
      expect(ranged.data.comment.anchor).toBe("C3:D4");
      expect(ranged.data.comment.author).toBeUndefined();

      // addComment resolved flag.
      const done = await doc.addComment({ cell: "A1" }, "already done", {
        resolved: true,
      });
      expect(done.data.comment.resolved).toBe(true);

      // Partial update; author:null clears; equal patch is eventless.
      const patched = await doc.updateComment(1, { body: "revised" });
      expect(patched.data.comment.body).toBe("revised");
      expect(patched.data.comment.author).toBe("Ada");
      const noopUpdate = await doc.updateComment(1, {});
      expect(noopUpdate.events).toEqual([]);
      const noopSame = await doc.updateComment(1, { body: "revised" });
      expect(noopSame.events).toEqual([]);
      const clearedAuthor = await doc.updateComment(1, { author: null });
      expect(clearedAuthor.data.comment.author).toBeUndefined();

      // resolve/reopen with eventless repeats.
      const resolved = await doc.resolveComment(2);
      expect(resolved.data.comment.resolved).toBe(true);
      const noopResolve = await doc.resolveComment(2);
      expect(noopResolve.events).toEqual([]);
      const reopened = await doc.reopenComment(2);
      expect(reopened.data.comment.resolved).toBe(false);

      // listComments: all, sheet filter, cell/range anchor filters.
      await doc.addSheet("Other");
      await doc.addComment({ cell: "B2" }, "other sheet", { sheet: "Other" });
      expect((await doc.listComments()).data.comments).toHaveLength(4);
      expect(
        (await doc.listComments({ sheet: "Other" })).data.comments,
      ).toHaveLength(1);
      const onB2 = (await doc.listComments({ cell: "B2" })).data.comments;
      expect(onB2).toHaveLength(1); // active sheet is still Sheet1
      const inside = (await doc.listComments({ cell: "C4" })).data.comments;
      expect(inside).toHaveLength(1);
      expect(inside[0]?.body).toBe("range note");
      const hit = (
        await doc.listComments({ range: { from: "D4", to: "E5" } })
      ).data.comments;
      expect(hit).toHaveLength(1);
      expect(hit[0]?.anchor).toBe("C3:D4");

      // Undo/redo across mutations.
      expect(await doc.undo()).toBe(true); // undo addComment on Other
      expect((await doc.listComments()).data.comments).toHaveLength(3);
      expect(await doc.redo()).toBe(true);
      expect((await doc.listComments()).data.comments).toHaveLength(4);

      // Snapshot round-trip preserves comments (schema:7 wrapper).
      const bytes = await doc.save();
      const payload = JSON.parse(
        new TextDecoder().decode(bytes.subarray(9)),
      ) as { kind?: string; schema?: number };
      expect(payload.kind).toBe("tally");
      expect(payload.schema).toBe(7);
      const reopenedDoc = await TallyDocument.openSnapshot(host, bytes);
      try {
        const comments = (await reopenedDoc.listComments()).data.comments;
        expect(comments).toHaveLength(4);
        expect(comments.find((c) => c.id === 1)?.body).toBe("revised");
        expect(comments.find((c) => c.id === 3)?.resolved).toBe(true);
        expect(comments.find((c) => c.sheet === "Other")?.anchor).toBe("B2");
      } finally {
        await reopenedDoc.close();
      }

      // removeComment; unknown ids reject.
      await expect(doc.removeComment(99)).rejects.toThrow();
      const removed = await doc.removeComment(3);
      expect(removed.data.ok).toBe(true);
      expect((await doc.listComments()).data.comments).toHaveLength(3);
      await expect(doc.resolveComment(99)).rejects.toThrow();
      await expect(doc.updateComment(99, { body: "x" })).rejects.toThrow();
    } finally {
      await doc.close();
    }
  });

  it("anchors stay on coordinates when cell contents move (sortRange)", async () => {
    const doc = await TallyDocument.open(host);
    try {
      await doc.setRange("A1", [["2"], ["1"]]);
      await doc.addComment({ cell: "A2" }, "stays on A2");
      await doc.sortRange({ from: "A1", to: "A2" }, [{ offset: 0 }]);
      // The comment's anchor is a coordinate, not content: still A2 even
      // though the row contents permuted.
      const comments = (await doc.listComments()).data.comments;
      expect(comments).toHaveLength(1);
      expect(comments[0]?.anchor).toBe("A2");
      expect((await doc.getCell("A1")).data.computed).toBe(1);
      expect((await doc.getCell("A2")).data.computed).toBe(2);
    } finally {
      await doc.close();
    }
  });

  it("cascades on sheet removal and restores on undo", async () => {
    const doc = await TallyDocument.open(host);
    try {
      await doc.addSheet("Data");
      await doc.addComment({ cell: "A1" }, "on sheet1");
      await doc.addComment({ cell: "A1" }, "on data", { sheet: "Data" });
      expect((await doc.listComments()).data.comments).toHaveLength(2);
      await doc.removeSheet("Data");
      expect((await doc.listComments()).data.comments).toHaveLength(1);
      expect(await doc.undo()).toBe(true);
      const comments = (await doc.listComments()).data.comments;
      expect(comments).toHaveLength(2);
      expect(comments.some((c) => c.sheet === "Data")).toBe(true);
    } finally {
      await doc.close();
    }
  });

  it("rejects invalid comment payloads without mutating the document", async () => {
    const doc = await TallyDocument.open(host);
    try {
      await doc.addComment({ cell: "A1" }, "seed");
      const before = await doc.describe();
      await expect(doc.addComment({ cell: "A1" }, "")).rejects.toThrow();
      await expect(
        doc.addComment({ cell: "A1" }, "x".repeat(8193)),
      ).rejects.toThrow();
      await expect(
        doc.addComment({ cell: "A1" }, "x", { author: "a\nb" }),
      ).rejects.toThrow();
      await expect(doc.addComment({ cell: "A0" }, "x")).rejects.toThrow();
      await expect(doc.updateComment(1, { body: "  " })).rejects.toThrow();
      await expect(doc.listComments({ sheet: "Missing" })).rejects.toThrow();
      expect(await doc.describe()).toEqual(before);
    } finally {
      await doc.close();
    }
  });
});
