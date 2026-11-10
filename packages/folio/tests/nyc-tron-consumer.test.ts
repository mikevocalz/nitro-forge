// Consumer contract against the pinned NYC-Tron release (tooling/nyc-tron.json).
// Type-only imports: the adapter's runtime never loads @nyc-tron/*, React or
// React Native. `pnpm --filter @nitro-forge/folio typecheck` checks the
// assignments below; vitest checks the pin itself.
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import type { AnnotationToolbarProps } from "@nyc-tron/ui/components/forge/pdf/AnnotationToolbar";
import type { CommentsThreadPanelProps } from "@nyc-tron/ui/components/forge/pdf/CommentsThreadPanel";
import type { FolioCommentsBinding } from "../src/office-cluster";
import { bindFolioHistory, FOLIO_ANNOTATION_TOOLS } from "../src/office-cluster";

// CommentsThreadPanel: Folio threads and the delete it supports.
export const commentsFits = (b: FolioCommentsBinding): Pick<CommentsThreadPanelProps, "threads" | "onDelete"> => b;
// AnnotationToolbar: the tools Folio can create, plus undo/redo.
export const toolsFit: AnnotationToolbarProps["tools"] = FOLIO_ANNOTATION_TOOLS;
export const historyFits = (b: ReturnType<typeof bindFolioHistory>): Pick<AnnotationToolbarProps, "onUndo" | "onRedo"> => b;

describe("NYC-Tron pin", () => {
  it("installs @nyc-tron/ui from the release tarball recorded in tooling/nyc-tron.json", () => {
    const pin = JSON.parse(readFileSync(join(import.meta.dirname, "../../../tooling/nyc-tron.json"), "utf8"));
    const manifest = JSON.parse(readFileSync(join(import.meta.dirname, "../package.json"), "utf8"));
    expect(manifest.devDependencies["@nyc-tron/ui"]).toBe(pin.packages["@nyc-tron/ui"].url);
    expect(manifest.dependencies?.["@nyc-tron/ui"]).toBeUndefined();
  });
});
