import {assertRgba,type RgbaColor} from "../color.ts";

/** The painting foreground and background, edited by `ForegroundBackgroundChips`. */
export interface ColorPair {
  readonly foreground:RgbaColor;
  readonly background:RgbaColor;
}
/** Which chip of a {@linkcode ColorPair} the pickers edit. */
export type ColorPairSlot="foreground"|"background";

/** Black on white, the reset most editors use. Pass your own to `ForegroundBackgroundChips`. */
export const DEFAULT_COLOR_PAIR={
  foreground:{r:0,g:0,b:0,alpha:1},
  background:{r:255,g:255,b:255,alpha:1},
} as const satisfies ColorPair;

/** Foreground and background exchanged. */
export function swapColorPair(pair:ColorPair):ColorPair{
  assertRgba(pair.foreground);
  assertRgba(pair.background);
  return {foreground:pair.background,background:pair.foreground};
}

/** Whether two pairs hold the same channels, so Reset can be disabled when it would do nothing. */
export function sameColorPair(a:ColorPair,b:ColorPair):boolean{
  const eq=(x:RgbaColor,y:RgbaColor)=>x.r===y.r&&x.g===y.g&&x.b===y.b&&x.alpha===y.alpha;
  return eq(a.foreground,b.foreground)&&eq(a.background,b.background);
}
