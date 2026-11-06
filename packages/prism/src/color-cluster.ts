/**
 * Engine side of NYC-Tron's color controls (C-01 ColorPickerDialog, C-12
 * ForegroundBackgroundChips, C-13 SwatchGrid recent row).
 *
 * No React and no `@nyc-tron/*` import: the shapes below mirror NYC-Tron's
 * `RgbaColor` and `ColorPair` structurally. Every write goes to the engine
 * first; the palette is then re-read and handed to `onChanged`. Nothing is
 * optimistic. Live preview while a picker is open stays in the UI: the
 * engine sees one `setColors` per Apply, so one dialog session is one undo
 * step.
 */
import { OPS, type PrismColors, type PrismDocument, type Rgba } from "./index";

/** NYC-Tron `RgbaColor`: integer channels 0..255, alpha 0..1. */
export interface ColorValue {
  readonly r: number;
  readonly g: number;
  readonly b: number;
  readonly alpha: number;
}

/** NYC-Tron `ColorPairSlot`. */
export type ColorSlot = "foreground" | "background";

/** NYC-Tron `ColorPair`. */
export interface ColorPairValue {
  readonly foreground: ColorValue;
  readonly background: ColorValue;
}

/** Palette as the color controls read it. */
export interface PrismColorBinding {
  readonly pair: ColorPairValue;
  /** Newest first; feeds a SwatchGrid "Recent" row. */
  readonly recent: readonly ColorValue[];
}

/**
 * Ops a color control could call that the engine does not have yet. The
 * matching control prop is left unset so no dead button is drawn.
 */
export const PRISM_COLOR_DEFERRED_OPS = {} as const;

/** Commits the dialog RGBA value to an existing shape/path fill in one undo step. */
export function commitPrismFill(doc:PrismDocument,layerId:number,color:ColorValue){
  return doc.setFill(layerId,{type:'solid',color:toEngineColor(color)});
}

export function toEngineColor(c: ColorValue): Rgba {
  for (const [k, v] of [["r", c.r], ["g", c.g], ["b", c.b]] as const) {
    if (!Number.isInteger(v) || v < 0 || v > 255) {
      throw new RangeError(`channel ${k} must be an integer 0..255, got ${v}`);
    }
  }
  if (!Number.isFinite(c.alpha) || c.alpha < 0 || c.alpha > 1) {
    throw new RangeError(`alpha must be 0..1, got ${c.alpha}`);
  }
  return [c.r, c.g, c.b, Math.round(c.alpha * 255)];
}

export function fromEngineColor(c: Rgba): ColorValue {
  return { r: c[0], g: c[1], b: c[2], alpha: Math.round((c[3] / 255) * 1000) / 1000 };
}

function toBinding(p: PrismColors): PrismColorBinding {
  return {
    pair: { foreground: fromEngineColor(p.foreground), background: fromEngineColor(p.background) },
    recent: p.recent.map(fromEngineColor),
  };
}

export async function readPrismColors(doc: PrismDocument): Promise<PrismColorBinding> {
  return toBinding((await doc.getColors()).data);
}

/** Callbacks for ForegroundBackgroundChips plus ColorPickerDialog commits. */
export interface PrismColorCallbacks {
  /** ColorPickerDialog `onCommit` for the given slot. */
  commit(slot: ColorSlot, color: ColorValue): Promise<PrismColorBinding>;
  /** ForegroundBackgroundChips swap. */
  swap(): Promise<PrismColorBinding>;
  /** ForegroundBackgroundChips reset to black on white. */
  reset(): Promise<PrismColorBinding>;
  clearRecent(): Promise<PrismColorBinding>;
}

export function bindPrismColors(
  doc: PrismDocument,
  onChanged: (next: PrismColorBinding) => void,
): PrismColorCallbacks {
  const reread = async () => {
    const next = await readPrismColors(doc);
    onChanged(next);
    return next;
  };
  return {
    async commit(slot, color) {
      // Validate before any engine call so a bad value never reaches Rust.
      const value = toEngineColor(color);
      await doc.setColors(slot === "foreground" ? { foreground: value } : { background: value });
      return reread();
    },
    async swap() {
      await doc.swapColors();
      return reread();
    },
    async reset() {
      await doc.setColors({ foreground: [0, 0, 0, 255], background: [255, 255, 255, 255], remember: false });
      return reread();
    },
    async clearRecent() {
      await doc.clearRecentColors();
      return reread();
    },
  };
}

/** The op names this adapter calls; tests assert they are real engine ops. */
export const PRISM_COLOR_OPS = [OPS.getColors, OPS.setColors, OPS.swapColors, OPS.clearRecentColors] as const;
