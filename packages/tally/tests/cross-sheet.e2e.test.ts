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

/** Two-sheet fixture: Sheet1 (active) and "Data" with A1=5, B2=10. */
async function twoSheets() {
  const doc = await TallyDocument.open(host);
  await doc.addSheet("Data");
  await doc.setActive("Data");
  await doc.setCell("A1", "5");
  await doc.setCell("B2", "10");
  await doc.setActive("Sheet1");
  return doc;
}

describe("tally cross-sheet formula references (real Rust via nf-cli)", () => {
  it("evaluates Sheet! refs, quoted names, ranges and chains", async () => {
    const doc = await twoSheets();
    try {
      await doc.setCell("C1", "=Data!A1*2+Data!B2");
      expect((await doc.getCell("C1")).data.computed).toBe(20);
      // Case-insensitive qualifier, quoted form, self-qualified ref.
      await doc.setCell("C2", "=data!A1+'Data'!B2");
      expect((await doc.getCell("C2")).data.computed).toBe(15);
      await doc.setCell("D1", "=Sheet1!C1+1");
      expect((await doc.getCell("D1")).data.computed).toBe(21);
      // Ad-hoc evaluate + range aggregate across the qualifier.
      expect((await doc.evaluate("=SUM(Data!A1:B2)")).data.value).toBe(15);
      // A formula stored on Data sees its own bare refs when reached
      // through a qualifier.
      await doc.setActive("Data");
      await doc.setCell("C3", "=A1+B2");
      await doc.setActive("Sheet1");
      expect((await doc.evaluate("=Data!C3*2")).data.value).toBe(30);
    } finally {
      await doc.close();
    }
  });

  it("reports #REF! for missing sheets and #NAME? for malformed qualifiers", async () => {
    const doc = await twoSheets();
    try {
      for (const [formula, want] of [
        ["=Nope!A1", "#REF!"],
        ["='Nope'!A1", "#REF!"],
        ["=Data!A0", "#REF!"],
        ["=Data!A1:Data!B2", "#NAME?"], // second qualifier unsupported
        ["=Sheet1:Data!A1", "#NAME?"], // 3D ranges unsupported
        ["='Data'", "#NAME?"],
        ["=Data!", "#NAME?"],
      ] as const) {
        expect((await doc.evaluate(formula)).data.value, formula).toBe(want);
      }
      // Stored hostile formulas evaluate the same way, never crash.
      await doc.setCell("E1", "=Nope!A1");
      expect((await doc.getCell("E1")).data.computed).toBe("#REF!");
      await doc.setCell("E2", "='unclosed");
      expect((await doc.getCell("E2")).data.computed).toBe("#NAME?");
    } finally {
      await doc.close();
    }
  });

  it("detects cross-sheet cycles and keeps acyclic chains bounded", async () => {
    const doc = await TallyDocument.open(host);
    try {
      await doc.addSheet("S2");
      await doc.setActive("S2");
      await doc.setCell("B1", "=Sheet1!A1");
      await doc.setActive("Sheet1");
      await doc.setCell("A1", "=S2!B1");
      expect((await doc.getCell("A1")).data.computed).toBe("#CYCLE!");
    } finally {
      await doc.close();
    }
    // Eight-sheet dependency chain stays under the depth cap.
    const chain = await TallyDocument.open(host);
    try {
      for (let i = 1; i <= 8; i++) await chain.addSheet(`T${i}`);
      await chain.setActive("T1");
      await chain.setCell("A1", "1");
      for (let i = 2; i <= 8; i++) {
        await chain.setActive(`T${i}`);
        await chain.setCell("A1", `=T${i - 1}!A1+1`);
      }
      expect((await chain.evaluate("=T8!A1")).data.value).toBe(8);
    } finally {
      await chain.close();
    }
  });

  it("rewrites qualifiers on renameSheet with undo/redo", async () => {
    const doc = await twoSheets();
    try {
      await doc.setCell("C1", "=Data!A1*2");
      await doc.setCell("C2", "='Data'!B2+Sheet1!C1");

      await doc.renameSheet("Data", "Metrics");
      expect((await doc.getCell("C1")).data.raw).toBe("=Metrics!A1*2");
      expect((await doc.getCell("C2")).data.raw).toBe("=Metrics!B2+Sheet1!C1");
      expect((await doc.getCell("C1")).data.computed).toBe(10);
      expect((await doc.getCell("C2")).data.computed).toBe(20);

      // Undo restores name AND formula text; redo re-applies both.
      expect(await doc.undo()).toBe(true);
      expect((await doc.getCell("C1")).data.raw).toBe("=Data!A1*2");
      expect(await doc.redo()).toBe(true);
      expect((await doc.getCell("C1")).data.raw).toBe("=Metrics!A1*2");

      // A name needing quotes is rendered quoted.
      await doc.renameSheet("Metrics", "Q1 Data");
      expect((await doc.getCell("C1")).data.raw).toBe("='Q1 Data'!A1*2");
      expect((await doc.getCell("C1")).data.computed).toBe(10);

      // Snapshot round-trip keeps rewritten formulas working.
      const reopened = await TallyDocument.openSnapshot(host, await doc.save());
      try {
        expect((await reopened.evaluate("='Q1 Data'!A1")).data.value).toBe(5);
      } finally {
        await reopened.close();
      }
    } finally {
      await doc.close();
    }
  });

  it("leaves removed-sheet refs at #REF! and revives them on re-add", async () => {
    const doc = await twoSheets();
    try {
      await doc.setCell("C1", "=Data!A1+1");
      expect((await doc.getCell("C1")).data.computed).toBe(6);
      await doc.removeSheet("Data");
      // Stored text keeps the qualifier; evaluation reports #REF!.
      expect((await doc.getCell("C1")).data.raw).toBe("=Data!A1+1");
      expect((await doc.getCell("C1")).data.computed).toBe("#REF!");
      // Undo restores the sheet and the reference works again.
      expect(await doc.undo()).toBe(true);
      expect((await doc.getCell("C1")).data.computed).toBe(6);
      // Re-adding a sheet with the same name revives the reference
      // (empty cell → 0 + 1).
      expect(await doc.redo()).toBe(true);
      await doc.addSheet("Data");
      expect((await doc.getCell("C1")).data.computed).toBe(1);
    } finally {
      await doc.close();
    }
  });

  it("remaps qualified refs on structural edits across sheets", async () => {
    const doc = await twoSheets();
    try {
      await doc.setCell("A1", "1");
      await doc.setCell("C1", "=Data!A1+A1");
      expect((await doc.getCell("C1")).data.computed).toBe(6);

      // Insert a row at the top of Data: the qualified ref follows the
      // moved cell (Data!A1 → Data!A2, still 5); Sheet1's bare A1 stays.
      await doc.insertRows({ sheet: "Data", from: 1, to: 1 });
      expect((await doc.getCell("C1")).data.raw).toBe("=Data!A2+A1");
      expect((await doc.getCell("C1")).data.computed).toBe(6);

      // A structural edit on Sheet1 moves self-qualified + bare refs but
      // leaves the Data-qualified ref alone.
      await doc.setCell("F1", "=Sheet1!C1+Data!A2");
      await doc.insertRows({ sheet: "Sheet1", from: 1, to: 1 });
      expect((await doc.getCell("F2")).data.raw).toBe("=Sheet1!C2+Data!A2");
      expect((await doc.getCell("C2")).data.raw).toBe("=Data!A2+A2");

      // Undo restores both structural edits.
      expect(await doc.undo()).toBe(true);
      expect(await doc.undo()).toBe(true);
      expect((await doc.getCell("C1")).data.raw).toBe("=Data!A2+A1");
    } finally {
      await doc.close();
    }
  });
});
