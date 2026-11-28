/**
 * Display-only min/max extrema math adapted from the user's Nitro Forge
 * draft media-ui WaveformLane/PR #25. Source PCM remains in the audio engine;
 * never average transients away or fake signal data.
 */
export interface WaveformPeak { readonly min:number; readonly max:number }
export interface WaveformBar { readonly top:number; readonly height:number }
export function normalizePeak(p:WaveformPeak):WaveformPeak{
 if(!Number.isFinite(p.min)||!Number.isFinite(p.max)||p.min>p.max)
   throw new RangeError("Invalid min/max waveform extrema");
 return {min:Math.min(1,Math.max(-1,p.min)),max:Math.min(1,Math.max(-1,p.max))};
}
export function resamplePeaks(peaks:readonly WaveformPeak[],columns:number):WaveformPeak[]{
 if(!Number.isInteger(columns)||columns<1||columns>4096)
   throw new RangeError("Waveform columns must be within 1..4096");
 if(!peaks.length)return Array.from({length:columns},()=>({min:0,max:0}));
 const valid=peaks.map(normalizePeak);
 return Array.from({length:columns},(_,index)=>{
   const start=Math.floor(index*valid.length/columns);
   const end=Math.max(start+1,Math.ceil((index+1)*valid.length/columns));
   let min=1,max=-1;
   for(let i=start;i<Math.min(end,valid.length);i++){
     const p=valid[i]!;min=Math.min(min,p.min);max=Math.max(max,p.max);
   }
   return {min,max};
 });
}
export function peaksToBars(peaks:readonly WaveformPeak[],height:number):WaveformBar[]{
 if(!Number.isFinite(height)||height<=0||height>8192)
  throw new RangeError("Waveform height outside valid range");
 return peaks.map(raw=>{
   const p=normalizePeak(raw);
   const top=((1-p.max)/2)*height;
   const bottom=((1-p.min)/2)*height;
   return {top,height:Math.max(1,bottom-top)};
 });
}

/**
 * Visible part of a clip, as normalized positions with
 * `0 <= start < end <= 1`. {@linkcode WaveformLane} draws only this span.
 */
export interface WaveformRange { readonly start:number; readonly end:number }

/** The whole clip. */
export const FULL_RANGE:WaveformRange={start:0,end:1};

/** @throws {RangeError} Unless `0 <= start < end <= 1`. */
export function assertWaveformRange(r:WaveformRange):void{
 if(!Number.isFinite(r.start)||!Number.isFinite(r.end)||r.start<0||r.end>1||r.start>=r.end)
  throw new RangeError("Waveform range must satisfy 0 <= start < end <= 1");
}

/**
 * The peaks covering `range`, without copying the rest. Work stays
 * proportional to the visible span, so a long clip zoomed in draws only its
 * window. Includes the partial peaks at both edges.
 */
export function slicePeaks(peaks:readonly WaveformPeak[],range:WaveformRange):readonly WaveformPeak[]{
 assertWaveformRange(range);
 if(range.start===0&&range.end===1)return peaks;
 const from=Math.floor(range.start*peaks.length);
 const to=Math.max(from+1,Math.ceil(range.end*peaks.length));
 return peaks.slice(from,to);
}

/**
 * Range after dragging the lane by `dxPx` across `widthPx` points. Dragging
 * right shows earlier audio. The span keeps its length and stops at the
 * clip edges.
 */
export function scrollRange(range:WaveformRange,dxPx:number,widthPx:number):WaveformRange{
 assertWaveformRange(range);
 if(!Number.isFinite(dxPx)||!Number.isFinite(widthPx)||widthPx<=0)throw new RangeError("Invalid waveform scroll");
 const span=range.end-range.start;
 const start=Math.min(1-span,Math.max(0,range.start-dxPx/widthPx*span));
 return {start:Number(start.toFixed(9)),end:Number((start+span).toFixed(9))};
}

/** Clip position for a point `x` points into a lane `widthPx` wide showing `range`. */
export function rangePosition(range:WaveformRange,x:number,widthPx:number):number{
 assertWaveformRange(range);
 if(!Number.isFinite(x)||!Number.isFinite(widthPx)||widthPx<=0)throw new RangeError("Invalid waveform point");
 return Math.min(1,Math.max(0,range.start+Math.min(1,Math.max(0,x/widthPx))*(range.end-range.start)));
}
