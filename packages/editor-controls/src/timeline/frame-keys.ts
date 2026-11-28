import {adjustKey} from "@nyc-tron/ui/components/gestures/adjust-keys";
import type {FrameRate} from "../timebase.ts";

/**
 * The frame a key moves to: arrows step one frame, Page Up/Down one second
 * (rounded to whole frames), Home/End the ends. `undefined` for other keys and
 * for Escape, which the caller handles as cancel. Time never mirrors in RTL.
 */
export function frameForKey(key:string|undefined,frame:number,durationFrames:number,rate:FrameRate):number|undefined{
  const intent=adjustKey(key);
  if(!intent||intent.kind==="cancel")return undefined;
  const second=Math.max(1,Math.round(rate.numerator/rate.denominator));
  const next=intent.kind==="step"?frame+intent.direction
    :intent.kind==="page"?frame+intent.direction*second
    :intent.kind==="min"?0:durationFrames;
  return Math.min(durationFrames,Math.max(0,Math.round(next)));
}
