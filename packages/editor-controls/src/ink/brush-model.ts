/** Engine-neutral brush settings. Presets and processing remain host-owned. */
export interface BrushDynamics {size:number;hardness:number;flow:number;spacing:number;stabilizer:number;scatter:number}
export const BRUSH_DYNAMICS_FIELDS=[
 {key:'size',label:'Brush size',min:.1,max:4096,step:.1,unit:' px'},
 {key:'hardness',label:'Hardness',min:0,max:1,step:.01,unit:''},
 {key:'flow',label:'Flow',min:0,max:1,step:.01,unit:''},
 {key:'spacing',label:'Spacing',min:.01,max:5,step:.01,unit:' × size'},
 {key:'stabilizer',label:'Stabilizer',min:0,max:1,step:.01,unit:''},
 {key:'scatter',label:'Scatter',min:0,max:5,step:.01,unit:' × size'},
] as const;
export function validateBrushDynamics(value:BrushDynamics){for(const f of BRUSH_DYNAMICS_FIELDS)if(!Number.isFinite(value[f.key])||value[f.key]<f.min||value[f.key]>f.max)throw new RangeError('Invalid '+f.label);}
export interface BrushTaper {start:number;end:number;minimumSize:number;pressure:boolean;tip:'round'|'linear'|'sharp'}
export interface BrushTaperSettings {pen:BrushTaper;touch:BrushTaper}
export function validateBrushTaper(value:BrushTaperSettings){for(const taper of [value.pen,value.touch])if(![taper.start,taper.end,taper.minimumSize].every(n=>Number.isFinite(n)&&n>=0&&n<=1)||typeof taper.pressure!=='boolean'||!['round','linear','sharp'].includes(taper.tip))throw new RangeError('Invalid brush taper');}
export interface InkSample {
 readonly x:number;readonly y:number;
 /** RN receipt time in milliseconds unless a native adapter supplies its clock explicitly. */
 readonly timeMs:number;
 readonly pressure?:number;readonly tiltX?:number;readonly tiltY?:number;readonly twist?:number;
 readonly input:'pen'|'touch'|'mouse'|'unknown';
}
export const MAX_INK_PREVIEW_SAMPLES=2048;
export function validateInkSamples(samples:readonly InkSample[]){
 if(samples.length>MAX_INK_PREVIEW_SAMPLES)throw new RangeError('Ink preview sample budget exceeded');
 let previous=-Infinity;
 for(const s of samples){if(![s.x,s.y,s.timeMs].every(Number.isFinite)||s.timeMs<previous||s.pressure!==undefined&&(!Number.isFinite(s.pressure)||s.pressure<0||s.pressure>1)||[s.tiltX,s.tiltY,s.twist].some(n=>n!==undefined&&!Number.isFinite(n))||!['pen','touch','mouse','unknown'].includes(s.input))throw new RangeError('Invalid ink sample');previous=s.timeMs;}
}
export interface BrushStabilization {streamline:number;stabilization:number;motionFilter:number}
export function validateStabilization(value:BrushStabilization){if(![value.streamline,value.stabilization,value.motionFilter].every(n=>Number.isFinite(n)&&n>=0&&n<=1))throw new RangeError('Invalid stabilization settings');}
/** A deterministic preview filter; pressure/tilt/twist/time are copied exactly. */
export function stabilizePreview(samples:readonly InkSample[],value:BrushStabilization):readonly InkSample[]{
 validateInkSamples(samples);validateStabilization(value);
 const amount=1-(1-value.streamline)*(1-value.stabilization)*(1-value.motionFilter),alpha=Math.max(.02,1-amount*.98);
 let previous:InkSample|undefined;
 return samples.map(sample=>{const next=previous?{...sample,x:previous.x+(sample.x-previous.x)*alpha,y:previous.y+(sample.y-previous.y)*alpha}:sample;previous=next;return next;});
}
