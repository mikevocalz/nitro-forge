import {assertRgba,type RgbaColor} from "../color.ts";

const linear=(channel:number)=>{
  const c=channel/255;
  return c<=0.04045?c/12.92:((c+0.055)/1.055)**2.4;
};

/**
 * WCAG 2.2 relative luminance of an opaque sRGB color, 0 (black) to 1 (white).
 * Alpha is ignored; composite translucent colors first with {@linkcode compositeOver}.
 */
export function relativeLuminance(c:RgbaColor):number{
  assertRgba(c);
  return 0.2126*linear(c.r)+0.7152*linear(c.g)+0.0722*linear(c.b);
}

/** `top` drawn over an opaque `bottom`, as the display shows it. The result is opaque. */
export function compositeOver(top:RgbaColor,bottom:RgbaColor):RgbaColor{
  assertRgba(top);
  assertRgba(bottom);
  const mix=(a:number,b:number)=>Math.round(a*top.alpha+b*(1-top.alpha));
  return {r:mix(top.r,bottom.r),g:mix(top.g,bottom.g),b:mix(top.b,bottom.b),alpha:1};
}

/**
 * WCAG contrast ratio between a foreground and an opaque background, 1 to 21.
 * A translucent foreground is composited over the background first.
 */
export function contrastRatio(foreground:RgbaColor,background:RgbaColor):number{
  const fg=relativeLuminance(compositeOver(foreground,{...background,alpha:1}));
  const bg=relativeLuminance({...background,alpha:1});
  const [hi,lo]=fg>bg?[fg,bg]:[bg,fg];
  return (hi+0.05)/(lo+0.05);
}

/** Which WCAG 2.2 text contrast levels a ratio meets; see {@linkcode contrastRating}. */
export interface ContrastRating {
  /** The ratio rounded down to two decimals, so 4.499 never displays as passing 4.5. */
  readonly ratio:number;
  /** 4.5:1, normal text, SC 1.4.3. */
  readonly aa:boolean;
  /** 7:1, normal text, SC 1.4.6. */
  readonly aaa:boolean;
  /** 3:1, large text (24px, or 18.66px bold). */
  readonly aaLarge:boolean;
  /** 4.5:1, large text. */
  readonly aaaLarge:boolean;
}

/** Rates `foreground` on `background` against the WCAG 2.2 text thresholds. */
export function contrastRating(foreground:RgbaColor,background:RgbaColor):ContrastRating{
  const exact=contrastRatio(foreground,background);
  return {
    ratio:Math.floor(exact*100)/100,
    aa:exact>=4.5,aaa:exact>=7,aaLarge:exact>=3,aaaLarge:exact>=4.5,
  };
}
