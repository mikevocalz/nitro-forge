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
import type { SheetTabsProps } from "@nyc-tron/ui/components/forge/spreadsheet/SheetTabs";
import type { ChartBuilderProps } from "@nyc-tron/ui/components/forge/spreadsheet/ChartBuilder";
import type { SparklineEditorProps } from "@nyc-tron/ui/components/forge/spreadsheet/SparklineEditor";
import type { SpreadsheetCardsViewProps } from "@nyc-tron/ui/components/forge/spreadsheet/SpreadsheetCardsView";
import type { FillPlan } from "@nyc-tron/ui/components/forge/spreadsheet/fill-handle";
import type { TallyGridData, TallyGridDocument } from "../src/grid-adapter";
import { commitTallyGridCell, readTallyWindow } from "../src/grid-adapter";
import type { TallyFillPlan, TallySheetTabsBinding } from "../src/grid-cluster";
import { commitTallyCardField, commitTallyFill, TALLY_SHEET_BOUNDS } from "../src/grid-cluster";
import type { TallyDocument } from "../src/index";

// The adapter's window read feeds SpreadsheetGrid.cells (I-01).
export const cellsFit = (data: TallyGridData): SpreadsheetGridProps["cells"] => data;
// SpreadsheetGrid's window request is a valid adapter window.
export const windowFits = (document: TallyGridDocument, range: SpreadsheetWindowRequest) =>
  readTallyWindow(document, range);
// The formula bar's commit goes straight to the engine write.
export const commitFits = (document: TallyGridDocument): NonNullable<SpreadsheetGridProps["onCommitCell"]> =>
  (address, raw) => commitTallyGridCell(document, address, raw);
export const boundsFit: Pick<SpreadsheetGridProps, "rowCount" | "columnCount"> = TALLY_SHEET_BOUNDS;

// forge/spreadsheet subpaths (alpha.2). The sheet-tab binding spreads straight
// into SheetTabs (I-08); deferred callbacks are absent, so their controls hide.
export const sheetTabsFit = (binding: TallySheetTabsBinding): Pick<
  SheetTabsProps, "tabs" | "activeId" | "onSelect" | "onAdd" | "onRename" | "onRemove" | "onMove" | "onToneChange" | "onDuplicate"
> => binding;
// readTallyRange output feeds ChartBuilder (I-13), SparklineEditor (I-14) and
// SpreadsheetCardsView (I-20).
export const chartCellsFit = (data: TallyGridData): ChartBuilderProps["cells"] => data;
export const sparklineCellsFit = (data: TallyGridData): SparklineEditorProps["cells"] => data;
export const cardCellsFit = (data: TallyGridData): SpreadsheetCardsViewProps["cells"] => data;
// The fill handle's plan is the engine's fill plan (I-02), one fillRange call.
export const fillPlanFits = (plan: FillPlan): TallyFillPlan => plan;
export const fillFits = (document: Pick<TallyDocument, "fillRange">): NonNullable<SpreadsheetGridProps["onFillRange"]> =>
  plan => commitTallyFill(document, plan);
// A card field commit is one setCell (I-20).
export const cardCommitFits = (document: TallyGridDocument): NonNullable<SpreadsheetCardsViewProps["onCommitField"]> =>
  (address, raw) => commitTallyCardField(document, address, raw);

describe("NYC-Tron pin", () => {
  it("installs @nyc-tron/ui from the release tarball recorded in tooling/nyc-tron.json", () => {
    const pin = JSON.parse(readFileSync(join(import.meta.dirname, "../../../tooling/nyc-tron.json"), "utf8"));
    const manifest = JSON.parse(readFileSync(join(import.meta.dirname, "../package.json"), "utf8"));
    expect(manifest.devDependencies["@nyc-tron/ui"]).toBe(pin.packages["@nyc-tron/ui"].url);
    expect(manifest.dependencies["@nyc-tron/ui"]).toBeUndefined();
  });
});
