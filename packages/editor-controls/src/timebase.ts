/**
 * Controlled frame math from Nitro Forge media-ui PR #25.
 * Playback/decoder seek side effects remain with each app's player service.
 */
export interface FrameRate {
  readonly numerator:number;
  readonly denominator:number;
}
export const FRAME_RATES={
 FILM_24:{numerator:24,denominator:1},
 PAL_25:{numerator:25,denominator:1},
 NTSC_2997:{numerator:30000,denominator:1001},
 NTSC_5994:{numerator:60000,denominator:1001},
 VIDEO_30:{numerator:30,denominator:1},
 VIDEO_60:{numerator:60,denominator:1},
} as const satisfies Record<string,FrameRate>;
export function assertFrameRate(r:FrameRate):void{
 if(!Number.isSafeInteger(r.numerator)||r.numerator<1||r.numerator>120000||
    !Number.isSafeInteger(r.denominator)||r.denominator<1||r.denominator>100000)
  throw new RangeError("Frame rate must be a positive bounded rational");
}
export function clampFrame(frame:number,durationFrames:number):number{
 if(!Number.isFinite(frame)||!Number.isSafeInteger(durationFrames)||durationFrames<0)
  throw new RangeError("Invalid frame or duration");
 return Math.min(durationFrames,Math.max(0,Math.round(frame)));
}
export function frameToPosition(frame:number,durationFrames:number):number{
 const current=clampFrame(frame,durationFrames);
 return durationFrames===0?0:current/durationFrames;
}
export function positionToFrame(position:number,durationFrames:number):number{
 if(!Number.isFinite(position)||position<0||position>1)
   throw new RangeError("Seek position must be finite in [0, 1]");
 return clampFrame(Math.round(position*durationFrames),durationFrames);
}
/**
 * Exact media time of a frame index: `frame * denominator / numerator`.
 * @throws {RangeError} When the rate is invalid or `frame` is not a
 * nonnegative safe integer.
 */
export function framesToSeconds(frame:number,rate:FrameRate):number{
 assertFrameRate(rate);
 if(!Number.isSafeInteger(frame)||frame<0)
  throw new RangeError("Frame must be a nonnegative safe integer");
 return frame*rate.denominator/rate.numerator;
}
/**
 * Nearest whole frame for a media time. Round-trips with
 * {@linkcode framesToSeconds} for every frame up to 2^48 (over 74,000 years
 * at 120 fps). Above about 2^51 frames, float rounding can land one frame
 * off on NTSC and PAL rates.
 * @throws {RangeError} When the rate is invalid, `seconds` is negative or
 * nonfinite, or the frame index exceeds `Number.MAX_SAFE_INTEGER`.
 */
export function secondsToFrame(seconds:number,rate:FrameRate):number{
 assertFrameRate(rate);
 if(!Number.isFinite(seconds)||seconds<0)
  throw new RangeError("Seconds must be finite and nonnegative");
 const rounded=Math.round(seconds*rate.numerator/rate.denominator);
 if(!Number.isSafeInteger(rounded))throw new RangeError("Frame exceeds safe integer");
 return rounded;
}
export function formatTimecode(
 frame:number,rate:FrameRate,opts:{dropFrame?:boolean}={}
):string{
 assertFrameRate(rate);
 if(!Number.isSafeInteger(frame)||frame<0)
  throw new RangeError("Frame must be a nonnegative safe integer");
 const fps=Math.round(rate.numerator/rate.denominator);
 if(fps<1||fps>120)throw new RangeError("Timecode rate outside supported range");
 let labeled=frame;
 if(opts.dropFrame){
   const ntsc29=rate.numerator===30000&&rate.denominator===1001;
   const ntsc59=rate.numerator===60000&&rate.denominator===1001;
   if(!ntsc29&&!ntsc59)throw new RangeError("Drop-frame requires NTSC rate");
   const drop=ntsc59?4:2;
   const per10=60*fps*10-drop*9;
   const perMin=60*fps-drop;
   const blocks=Math.floor(frame/per10);
   const rem=frame%per10;
   const extra=drop*Math.max(0,Math.floor((rem-drop)/perMin));
   labeled+=blocks*drop*9+extra;
 }
 const sec=Math.floor(labeled/fps)%60;
 const min=Math.floor(labeled/(fps*60))%60;
 const hour=Math.floor(labeled/(fps*3600));
 const within=labeled%fps;
 const pad=(n:number)=>String(n).padStart(2,"0");
 return `${pad(hour)}:${pad(min)}:${pad(sec)}${opts.dropFrame?";":":"}${pad(within)}`;
}
