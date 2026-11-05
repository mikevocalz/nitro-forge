import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { CliHost } from "@nitro-forge/ignition/cli";
import { TallyDocument } from "../src/index";
import {
  commitTallyGridCell, readTallyWindow,
} from "../src/grid-adapter";

let host: CliHost;
beforeAll(() => { host = new CliHost(); });
afterAll(async () => { await host.dispose(); });

describe("real Rust Tally engine to NYC-Tron window adapter", () => {
  it("loads exact A1 ranges and uses engine-computed formula values", async () => {
    const document = await TallyDocument.open(host);
    try {
      await commitTallyGridCell(document, "A1", "7");
      await commitTallyGridCell(document, "B1", "=A1*3");
      const loaded = await readTallyWindow(document, {
        startRow: 0, endRow: 2, startColumn: 0, endColumn: 2,
      });
      expect(loaded.A1?.raw).toBe("7");
      expect(loaded.B1?.computed).toBe(21);
      await commitTallyGridCell(document, "A1", "11");
      const refreshed = await readTallyWindow(document, {
        startRow: 0, endRow: 1, startColumn: 0, endColumn: 2,
      });
      expect(refreshed.B1?.computed).toBe(33);
      expect(await document.undo()).toBe(true);
      const undone = await readTallyWindow(document, {
        startRow: 0, endRow: 1, startColumn: 0, endColumn: 2,
      });
      expect(undone.B1?.computed).toBe(21);
    } finally {
      await document.close();
    }
  });

  it("fills frozen rows and columns from the engine when the body is scrolled", async () => {
    const document = await TallyDocument.open(host);
    try {
      await commitTallyGridCell(document, "A1", "Region");
      await commitTallyGridCell(document, "C1", "Q3");
      await commitTallyGridCell(document, "A200", "West");
      await commitTallyGridCell(document, "C200", "=2*21");
      const loaded = await readTallyWindow(document, {
        startRow: 128, endRow: 256, startColumn: 2, endColumn: 18,
        frozenRows: 1, frozenColumns: 1,
      });
      expect(loaded.C200?.computed).toBe(42); // body
      expect(loaded.C1?.raw).toBe("Q3");      // frozen header row
      expect(loaded.A200?.raw).toBe("West");  // frozen first column
      expect(loaded.A1?.raw).toBe("Region");  // frozen corner
      expect(loaded.A2).toBeUndefined();      // not on screen
    } finally {
      await document.close();
    }
  });
});
