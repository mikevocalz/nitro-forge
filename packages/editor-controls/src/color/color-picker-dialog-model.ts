/**
 * Pure state rules for `ColorPickerDialog` (C-01): title and labels, the
 * original/new comparison, key handling and the contrast readout. The dialog
 * holds no color; the host keeps `original` and the draft.
 */
import {alphaPercent,assertHsv,hsvToRgb,rgbToHsv,rgbaToHex,type HsvColor,type RgbaColor} from "../color.ts";
import {contrastRating,type ContrastRating} from "./contrast.ts";

/** Which half of the comparison swatch. `original` sits at the start edge, `new` at the end edge. */
export type ColorComparisonSide="original"|"new";

/** Whether two HSV colors are the same exact value. */
export function sameHsv(a:HsvColor,b:HsvColor):boolean{
  return a.h===b.h&&a.s===b.s&&a.v===b.v&&a.alpha===b.alpha;
}

/**
 * Whether the draft would change the displayed color. Hue alone does not count
 * when saturation or brightness is zero, since the screen shows the same gray.
 */
export function colorChanged(original:HsvColor,draft:HsvColor):boolean{
  assertHsv(original);
  assertHsv(draft);
  return rgbaToHex(hsvToRgb(original))!==rgbaToHex(hsvToRgb(draft));
}

/** Dialog heading: "Foreground color" for target "Foreground", else "Color". */
export function colorDialogTitle(target?:string):string{
  const t=target?.trim();
  return t?t+" color":"Color";
}

/** `#RRGGBB`, plus `, 40% opacity` when translucent. */
export function describeColor(color:HsvColor):string{
  const rgb=hsvToRgb(color);
  const hex=rgbaToHex(rgb,false);
  return color.alpha<1?hex+", "+alphaPercent(color.alpha)+"% opacity":hex;
}

/** Screen-reader name for one half of the comparison swatch. */
export function comparisonLabel(side:ColorComparisonSide,color:HsvColor,changed:boolean):string{
  if(side==="new")return "New color, "+describeColor(color);
  return changed?"Revert to original color, "+describeColor(color):"Original color, "+describeColor(color)+", unchanged";
}

/** The draft reset to the original. Keeps the original's exact HSV, so hue survives gray. */
export function revertDraft(original:HsvColor):HsvColor{
  assertHsv(original);
  return {...original};
}

/** A swatch color as the next draft, keeping `draft`'s hue when the swatch is gray. */
export function draftFromRgba(color:RgbaColor,draft:HsvColor):HsvColor{
  return rgbToHsv(color,draft.h);
}

/** A draft with a new alpha only; h, s and v keep their exact values. */
export function draftWithAlpha(draft:HsvColor,alpha:number):HsvColor{
  if(!Number.isFinite(alpha)||alpha<0||alpha>1)throw new RangeError("Alpha must be 0..1");
  return {...draft,alpha};
}

/** Where a key press landed, as far as the dialog's keyboard rules care. */
export type DialogKeyTarget="text-field"|"control"|"surface";

/** What a key press asks the dialog to do. */
export type DialogKeyIntent="commit"|"cancel"|"none";

/**
 * Enter commits only from the dialog surface: in a text field it submits that
 * field, and on a button it presses the button. Escape cancels from anywhere.
 */
export function dialogKeyIntent(key:string|undefined,target:DialogKeyTarget):DialogKeyIntent{
  if(key==="Escape")return "cancel";
  if(key==="Enter"&&target==="surface")return "commit";
  return "none";
}

/** Contrast of the draft against the original, both composited over an opaque `backdrop`. */
export interface ComparisonContrast extends ContrastRating {
  /** "4.52:1 against the original" */
  readonly text:string;
}

/**
 * WCAG contrast between the draft and the original. Each is first composited
 * over `backdrop` (white by default) so translucent colors rate as drawn.
 */
export function comparisonContrast(draft:HsvColor,original:HsvColor,backdrop:RgbaColor={r:255,g:255,b:255,alpha:1}):ComparisonContrast{
  const over=(c:HsvColor)=>{
    const rgb=hsvToRgb(c);
    const a=rgb.alpha;
    const mix=(x:number,y:number)=>Math.round(x*a+y*(1-a));
    return {r:mix(rgb.r,backdrop.r),g:mix(rgb.g,backdrop.g),b:mix(rgb.b,backdrop.b),alpha:1};
  };
  const rating=contrastRating(over(draft),over(original));
  return {...rating,text:rating.ratio.toFixed(2)+":1 against the original"};
}
