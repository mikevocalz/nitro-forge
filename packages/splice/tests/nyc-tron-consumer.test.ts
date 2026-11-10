// Consumer contract against the NYC-Tron release pinned in package.json
// (v0.1.0-alpha.4). Type-only imports: the adapter's runtime never loads
// @nyc-tron/*, React or React Native. `pnpm --filter @nitro-forge/splice
// typecheck` checks the assignments below; vitest checks the pin itself.
//
// Alpha.4 includes timeline cluster 2. The full recovered cluster contract
// is checked against installed release declarations by verify:released-ui.
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import type { TimelineEdit } from "@nyc-tron/ui/components/forge/timeline/edits";
import type { FrameRate as TronFrameRate } from "@nyc-tron/ui/components/forge/timebase";
import type { TimelineClipLaneProps } from "@nyc-tron/ui/components/forge/timeline/TimelineClipLane";
import { SpliceTimelineAdapter, type FrameRate, type TimelineClipView, type TimelineEditInput } from "../src/timeline-cluster";

// Every edit TimelineClipLane, ClipTrimHandles and RazorSplitTool emit is one the adapter applies.
export const editFits = (e: TimelineEdit): TimelineEditInput => e;
export const laneFits = (a: SpliceTimelineAdapter): TimelineClipLaneProps["onEdit"] => (e) => {
  void a.applyEdit(e);
};
// Rates and clips cross unchanged.
export const rateFits = (r: TronFrameRate): FrameRate => r;
export const clipFits = (c: TimelineClipView): TimelineClipLaneProps["tracks"][number]["clips"][number] => c;

describe("NYC-Tron pin", () => {
  it("installs @nyc-tron/ui as a dev-only dependency from the alpha.4 release tarball", () => {
    const manifest = JSON.parse(readFileSync(join(import.meta.dirname, "../package.json"), "utf8"));
    expect(manifest.devDependencies["@nyc-tron/ui"]).toBe(
      "https://github.com/mikevocalz/NYC-Tron-UI/releases/download/v0.1.0-alpha.4/nyc-tron-ui-0.1.0-alpha.4.tgz",
    );
    expect(manifest.dependencies?.["@nyc-tron/ui"]).toBeUndefined();
  });
});
