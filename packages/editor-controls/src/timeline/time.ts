import {assertFrameRate,formatTimecode,framesToSeconds,secondsToFrame,type FrameRate} from "../timebase.ts";

/*
 * Rational frame and sample time. Timeline positions are whole frames at the
 * sequence's rational frame rate; audio positions are whole samples at an
 * integer sample rate. Conversions between them go through exact integer
 * (BigInt) arithmetic, so 29.97 fps never accumulates float drift. Seconds are
 * derived only at the engine boundary (Splice takes seconds).
 */

export type {FrameRate} from "../timebase.ts";
export {framesToSeconds,secondsToFrame} from "../timebase.ts";

/** Lowest and highest sample rates accepted, in Hz. */
export const SAMPLE_RATE_RANGE={min:8000,max:768000} as const;

export function assertSampleRate(rate:number):void{
  if(!Number.isSafeInteger(rate)||rate<SAMPLE_RATE_RANGE.min||rate>SAMPLE_RATE_RANGE.max)
    throw new RangeError("Sample rate must be an integer from 8000 to 768000 Hz");
}
const assertIndex=(n:number,what:string)=>{
  if(!Number.isSafeInteger(n)||n<0)throw new RangeError(what+" must be a nonnegative safe integer");
};
const floorDiv=(a:bigint,b:bigint)=>a/b;

/** Frames per second as a float, for display and layout only. */
export const fps=(rate:FrameRate)=>{assertFrameRate(rate);return rate.numerator/rate.denominator;};

/**
 * Seconds at a fractional frame position, e.g. a media in-point at a speed
 * other than 1x. Whole frames use `framesToSeconds` from `forge/timebase`
 * (re-exported here), which rejects fractions.
 */
export function positionToSeconds(position:number,rate:FrameRate):number{
  assertFrameRate(rate);
  if(!Number.isFinite(position)||position<0)throw new RangeError("Frame position must be finite and nonnegative");
  return position*rate.denominator/rate.numerator;
}

/**
 * First sample at or after the start of `frame`: `ceil(frame * den * sampleRate / num)`,
 * exactly. Ceiling, not floor: the floored sample can start before the frame and
 * so belong to the previous one.
 */
export function framesToSamples(frame:number,rate:FrameRate,sampleRate:number):number{
  assertFrameRate(rate);assertSampleRate(sampleRate);assertIndex(frame,"Frame");
  const num=BigInt(rate.numerator);
  return Number(floorDiv(BigInt(frame)*BigInt(rate.denominator)*BigInt(sampleRate)+num-1n,num));
}

/** The frame that contains `sample`, floored: `sample * num / (den * sampleRate)`, exactly. */
export function samplesToFrames(sample:number,rate:FrameRate,sampleRate:number):number{
  assertFrameRate(rate);assertSampleRate(sampleRate);assertIndex(sample,"Sample");
  return Number(floorDiv(BigInt(sample)*BigInt(rate.numerator),BigInt(rate.denominator)*BigInt(sampleRate)));
}

/** Sample time as `HH:MM:SS.mmm`, floored to the millisecond. */
export function formatSampleClock(sample:number,sampleRate:number):string{
  assertSampleRate(sampleRate);assertIndex(sample,"Sample");
  const ms=Number(floorDiv(BigInt(sample)*1000n,BigInt(sampleRate)));
  const pad=(n:number,w=2)=>String(n).padStart(w,"0");
  return `${pad(Math.floor(ms/3600000))}:${pad(Math.floor(ms/60000)%60)}:${pad(Math.floor(ms/1000)%60)}.${pad(ms%1000,3)}`;
}

const NTSC=(rate:FrameRate)=>rate.denominator===1001&&(rate.numerator===30000||rate.numerator===60000);
/** Whether `rate` supports SMPTE drop-frame labels (29.97 or 59.94). */
export const supportsDropFrame=(rate:FrameRate)=>NTSC(rate);

/**
 * Parses `HH:MM:SS:FF` (non-drop) or `HH:MM:SS;FF` (drop-frame; `.` and `,` also
 * accepted as the last separator) into a frame index. Drop-frame labels that do
 * not exist (frames 00 and 01, or 00-03 at 59.94, of every minute not divisible by
 * ten) and frame fields at or above the timebase are rejected. Inverse of
 * `formatTimecode`.
 */
export function parseTimecode(text:string,rate:FrameRate,opts:{dropFrame?:boolean}={}):number|undefined{
  assertFrameRate(rate);
  const m=/^\s*(\d{1,3}):(\d{2}):(\d{2})([:;.,])(\d{2,3})\s*$/.exec(text);
  if(!m)return undefined;
  const [h,mi,s,f]=[m[1],m[2],m[3],m[5]].map(Number) as [number,number,number,number];
  const dropFrame=opts.dropFrame??m[4]!==":";
  const base=Math.round(rate.numerator/rate.denominator);
  if(mi>59||s>59||f>=base)return undefined;
  if(!dropFrame)return ((h*60+mi)*60+s)*base+f;
  if(!NTSC(rate))return undefined;
  const drop=base===60?4:2;
  const totalMinutes=h*60+mi;
  if(s===0&&f<drop&&totalMinutes%10!==0)return undefined;
  const labeled=((totalMinutes*60)+s)*base+f;
  return labeled-drop*(totalMinutes-Math.floor(totalMinutes/10));
}

/** Timeline display formats offered by `TimecodeDisplay`. */
export type TimeFormat="timecode"|"frames"|"seconds"|"samples";

/** `frame` in `format`. Samples need `sampleRate`; drop-frame needs an NTSC rate. */
export function formatTime(frame:number,rate:FrameRate,format:TimeFormat,opts:{dropFrame?:boolean;sampleRate?:number}={}):string{
  assertIndex(frame,"Frame");
  switch(format){
    case "timecode":return formatTimecode(frame,rate,{dropFrame:opts.dropFrame??false});
    case "frames":return `${frame} f`;
    case "seconds":return `${framesToSeconds(frame,rate).toFixed(3)} s`;
    case "samples":{
      if(opts.sampleRate===undefined)throw new RangeError("Sample display needs a sample rate");
      return `${formatSampleClock(framesToSamples(frame,rate,opts.sampleRate),opts.sampleRate)}`;
    }
  }
}

/**
 * Parses typed time in `format` back to a frame: a timecode, a frame count
 * (`120` or `120 f`), seconds (`4.5` or `4.5 s`, rounded to the nearest frame) or
 * a sample clock. Returns `undefined` for text that is not one.
 */
export function parseTime(text:string,rate:FrameRate,format:TimeFormat,opts:{dropFrame?:boolean;sampleRate?:number}={}):number|undefined{
  const t=text.trim();
  if(format==="timecode")return parseTimecode(t,rate,{dropFrame:opts.dropFrame??false});
  if(format==="frames"){const m=/^(\d+)\s*f?$/i.exec(t);return m?Number(m[1]):undefined;}
  if(format==="seconds"){
    const m=/^(\d+(?:\.\d+)?)\s*s?$/i.exec(t);
    return m?secondsToFrame(Number(m[1]),rate):undefined;
  }
  const m=/^(\d{1,3}):(\d{2}):(\d{2})\.(\d{3})$/.exec(t);
  if(!m||opts.sampleRate===undefined)return undefined;
  const [h,mi,s,ms]=[m[1],m[2],m[3],m[4]].map(Number) as [number,number,number,number];
  if(mi>59||s>59)return undefined;
  const totalMs=((h*60+mi)*60+s)*1000+ms;
  // The clock was floored to the millisecond, so the time lies in [ms, ms+1).
  // Take the last sample of that millisecond: frames are at least 8 ms apart
  // (120 fps), so this always lands in the frame that was formatted.
  const lastSample=Number(floorDiv(BigInt(totalMs+1)*BigInt(opts.sampleRate)+999n,1000n))-1;
  return samplesToFrames(lastSample,rate,opts.sampleRate);
}
