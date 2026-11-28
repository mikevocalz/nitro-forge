import {assertHsv,wrapHue,type HsvColor} from "../color.ts";

/** Color harmony rules offered by `ColorHarmonyAssistant`. */
export type HarmonyKind="complementary"|"analogous"|"triadic"|"split-complementary"|"square";

/** Every {@linkcode HarmonyKind} in display order, with its hue offsets in degrees. */
export const HARMONY_KINDS=[
  {kind:"complementary",label:"Complementary",turns:[180]},
  {kind:"analogous",label:"Analogous",turns:[-30,30]},
  {kind:"triadic",label:"Triadic",turns:[120,240]},
  {kind:"split-complementary",label:"Split complementary",turns:[150,210]},
  {kind:"square",label:"Square",turns:[90,180,270]},
] as const satisfies readonly {kind:HarmonyKind;label:string;turns:readonly number[]}[];

/**
 * The base color followed by its companions for `kind`. Companions rotate the
 * hue and keep saturation, value and alpha, so a gray base yields grays.
 */
export function harmonyColors(base:HsvColor,kind:HarmonyKind):HsvColor[]{
  assertHsv(base);
  const entry=HARMONY_KINDS.find(k=>k.kind===kind);
  if(!entry)throw new RangeError("Unknown harmony "+String(kind));
  const h=wrapHue(base.h);
  return [{...base,h},...entry.turns.map(t=>({...base,h:wrapHue(h+t)}))];
}
