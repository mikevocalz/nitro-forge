import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { CliHost } from "@nitro-forge/ignition/cli";
import { TallyDocument } from "../src/index";
import { commitTallyGridCell } from "../src/grid-adapter";
import { bindTallySheetTabs, commitTallyCardField, readTallyRange, type TallySheetTabsBinding } from "../src/grid-cluster";

let host: CliHost;
beforeAll(() => { host = new CliHost(); });
afterAll(async () => { await host.dispose(); });

describe("real Rust Tally engine behind the NYC-Tron spreadsheet cluster", () => {
  it("drives SheetTabs: add, rename, select, engine rejection, remove", async () => {
    const document = await TallyDocument.open(host);
    try {
      let latest: TallySheetTabsBinding | undefined;
      const first = await bindTallySheetTabs(document, next => { latest = next; });
      expect(first.tabs).toHaveLength(1);
      await first.onAdd();
      expect(latest!.tabs).toHaveLength(2);
      await latest!.onRename("1", "Plan");
      expect(latest!.tabs.map(t => t.name)).toContain("Plan");
      await latest!.onSelect("1");
      expect(latest!.activeId).toBe("1");
      const before = latest!;
      await expect(before.onRename("1", before.tabs[0]!.name)).rejects.toThrow(/already exists/);
      expect(latest).toBe(before);
      await latest!.onRemove("1");
      expect(latest!.tabs).toHaveLength(1);
      await expect(latest!.onRemove("0")).rejects.toThrow(/at least one sheet/);
    } finally {
      await document.close();
    }
  });

  it("reads chart/sparkline ranges with computed formulas and commits card fields", async () => {
    const document = await TallyDocument.open(host);
    try {
      await commitTallyGridCell(document, "A1", "Item");
      await commitTallyGridCell(document, "B1", "Qty");
      await commitTallyGridCell(document, "A2", "Pens");
      await commitTallyGridCell(document, "B2", "3");
      await commitTallyGridCell(document, "B3", "=B2*4");
      const cells = await readTallyRange(document, "A1:B3");
      expect(cells.B3?.computed).toBe(12);
      expect(cells.A3?.raw).toBe("");
      await commitTallyCardField(document, "B2", "5");
      const after = await readTallyRange(document, "B2:B3");
      expect(after.B3?.computed).toBe(20);
      expect(await document.undo()).toBe(true);
      expect((await readTallyRange(document, "B3")).B3?.computed).toBe(12);
    } finally {
      await document.close();
    }
  });
});
