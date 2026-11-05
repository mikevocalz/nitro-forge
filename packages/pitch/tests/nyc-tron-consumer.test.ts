// Consumer contract against the pinned NYC-Tron release (tooling/nyc-tron.json).
// Type-only imports: the adapter's runtime never loads @nyc-tron/*, React or
// React Native. `pnpm --filter @nitro-forge/pitch typecheck` checks the
// assignments below; vitest checks the pin itself.
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import type { SlideFilmstripProps } from "@nyc-tron/ui/components/forge/slides/SlideFilmstrip";
import type { SlideSorterProps } from "@nyc-tron/ui/components/forge/slides/SlideSorter";
import type { SlideCanvasProps } from "@nyc-tron/ui/components/forge/slides/SlideCanvas";
import type { SlideAnimationPaneProps } from "@nyc-tron/ui/components/forge/slides/SlideAnimationPane";
import type {
  PitchAnimationBinding, PitchCanvasBinding, PitchSlideListBinding,
} from "../src/office-cluster";

// J-01 SlideFilmstrip: slides plus the engine-backed list callbacks.
export const filmstripFits = (b: PitchSlideListBinding): Pick<
  SlideFilmstripProps, "slides" | "onMove" | "onAdd" | "onRemove"
> => b;
// SlideSorter: the same slides, reordered and removed in bulk.
export const sorterFits = (b: PitchSlideListBinding): Pick<SlideSorterProps, "slides" | "onReorder" | "onRemove"> =>
  ({ slides: b.slides, onReorder: b.onReorder, onRemove: b.onRemoveMany });
// SlideCanvas: one slide and its object edits.
export const canvasFits = (b: PitchCanvasBinding): Pick<
  SlideCanvasProps,
  "slide" | "size" | "onMoveObject" | "onResizeObject" | "onRotateObject" | "onSetText" | "onRemoveObject"
> => b;
// SlideAnimationPane: the slide's animations and the effects Pitch can store.
export const animationFits = (b: PitchAnimationBinding): Pick<
  SlideAnimationPaneProps, "animations" | "effects" | "onAdd" | "onRemove"
> => b;

describe("NYC-Tron pin", () => {
  it("installs @nyc-tron/ui from the release tarball recorded in tooling/nyc-tron.json", () => {
    const pin = JSON.parse(readFileSync(join(import.meta.dirname, "../../../tooling/nyc-tron.json"), "utf8"));
    const manifest = JSON.parse(readFileSync(join(import.meta.dirname, "../package.json"), "utf8"));
    expect(manifest.devDependencies["@nyc-tron/ui"]).toBe(pin.packages["@nyc-tron/ui"].url);
    expect(manifest.dependencies?.["@nyc-tron/ui"]).toBeUndefined();
  });
});
