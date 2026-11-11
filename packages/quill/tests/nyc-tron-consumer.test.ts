// Consumer contract against the pinned NYC-Tron release (tooling/nyc-tron.json).
// Type-only imports: the adapter's runtime never loads @nyc-tron/*, React or
// React Native. `pnpm --filter @nitro-forge/quill typecheck` checks the
// assignments below; vitest checks the pin itself.
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import type { RichTextRibbonProps } from "@nyc-tron/ui/components/forge/document/RichTextRibbon";
import type { BulletsNumberingEditorProps } from "@nyc-tron/ui/components/forge/document/BulletsNumberingEditor";
import type { NavigationOutlineProps } from "@nyc-tron/ui/components/forge/document/NavigationOutline";
import type {
  QuillBookmarkBinding, QuillListBinding, QuillOutlineHeading, QuillRibbonBinding,
} from "../src/office-cluster";

// RichTextRibbon: the toggles, font family, color and paragraph style Quill can write.
export const ribbonFits = (b: QuillRibbonBinding): Pick<
  RichTextRibbonProps, "onToggle" | "onChangeCase" | "fontFamily" | "onFontFamilyChange" | "fontSize" | "onFontSizeChange" | "highlight" | "onHighlightChange" | "onColorChange" | "paragraphStyles" | "onParagraphStyleChange"
> => b;
// BulletsNumberingEditor: list items, kind and the kinds Quill stores.
export const listFits = (b: QuillListBinding): Pick<
  BulletsNumberingEditorProps, "items" | "kind" | "kinds" | "selectionStart" | "selectionEnd" | "levelFormats" | "onKindChange" | "onLevelFormatChange" | "onShiftLevel"
> => b;
// NavigationOutline: headings read from the document.
export const outlineFits = (headings: QuillOutlineHeading[]): NavigationOutlineProps["headings"] => headings;
// NavigationOutline Bookmarks view: engine-backed named positions.
export const bookmarkFits = (b: QuillBookmarkBinding): Pick<
  NavigationOutlineProps, "bookmarks" | "onJumpToBookmark"
> => b;

describe("NYC-Tron pin", () => {
  it("installs @nyc-tron/ui from the release tarball recorded in tooling/nyc-tron.json", () => {
    const pin = JSON.parse(readFileSync(join(import.meta.dirname, "../../../tooling/nyc-tron.json"), "utf8"));
    const manifest = JSON.parse(readFileSync(join(import.meta.dirname, "../package.json"), "utf8"));
    expect(manifest.devDependencies["@nyc-tron/ui"]).toBe(pin.packages["@nyc-tron/ui"].url);
    expect(manifest.dependencies?.["@nyc-tron/ui"]).toBeUndefined();
  });
});
