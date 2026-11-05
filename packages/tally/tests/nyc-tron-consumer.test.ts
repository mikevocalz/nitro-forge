// Consumer contract against the pinned NYC-Tron release (tooling/nyc-tron.json).
// Type-only imports: the adapter's runtime never loads @nyc-tron/*, React or
// React Native. `pnpm --filter @nitro-forge/tally typecheck` checks the
// assignments below; vitest checks the pin itself.
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import type {
  SpreadsheetGridProps, SpreadsheetWindowRequest,
} from "@nyc-tron/ui/components/forge/SpreadsheetGrid";
import type { TallyGridData, TallyGridDocument } from "../src/grid-adapter";
import { commitTallyGridCell, readTallyWindow } from "../src/grid-adapter";
import { TALLY_SHEET_BOUNDS } from "../src/grid-cluster";

// The adapter's window read feeds SpreadsheetGrid.cells (I-01).
export const cellsFit = (data: TallyGridData): SpreadsheetGridProps["cells"] => data;
// SpreadsheetGrid's window request is a valid adapter window.
export const windowFits = (document: TallyGridDocument, range: SpreadsheetWindowRequest) =>
  readTallyWindow(document, range);
// The formula bar's commit goes straight to the engine write.
export const commitFits = (document: TallyGridDocument): NonNullable<SpreadsheetGridProps["onCommitCell"]> =>
  (address, raw) => commitTallyGridCell(document, address, raw);
export const boundsFit: Pick<SpreadsheetGridProps, "rowCount" | "columnCount"> = TALLY_SHEET_BOUNDS;

describe("NYC-Tron pin", () => {
  it("installs @nyc-tron/ui from the release tarball recorded in tooling/nyc-tron.json", () => {
    const pin = JSON.parse(readFileSync(join(import.meta.dirname, "../../../tooling/nyc-tron.json"), "utf8"));
    const manifest = JSON.parse(readFileSync(join(import.meta.dirname, "../package.json"), "utf8"));
    expect(manifest.devDependencies["@nyc-tron/ui"]).toBe(pin.packages["@nyc-tron/ui"].url);
    expect(manifest.dependencies["@nyc-tron/ui"]).toBeUndefined();
  });
});
