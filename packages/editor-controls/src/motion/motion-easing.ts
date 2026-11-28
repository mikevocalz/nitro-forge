export type MotionEasingKind='hold'|'linear'|'bezier'|'spring';
export type MotionEasing={readonly kind:'hold'}|{readonly kind:'linear'}|{readonly kind:'bezier';readonly x1:number;readonly y1:number;readonly x2:number;readonly y2:number}|{readonly kind:'spring';readonly mass:number;readonly stiffness:number;readonly damping:number;readonly velocity:number};
export interface MotionEasingPreset {readonly id:string;readonly label:string;readonly value:MotionEasing}
export const MOTION_EASING_PRESETS:readonly MotionEasingPreset[]=[
 {id:'hold',label:'Hold',value:{kind:'hold'}},{id:'linear',label:'Linear',value:{kind:'linear'}},
 {id:'ease',label:'Ease in and out',value:{kind:'bezier',x1:.42,y1:0,x2:.58,y2:1}},
 {id:'ease-in',label:'Ease in',value:{kind:'bezier',x1:.42,y1:0,x2:1,y2:1}},
 {id:'ease-out',label:'Ease out',value:{kind:'bezier',x1:0,y1:0,x2:.58,y2:1}},
 {id:'overshoot',label:'Overshoot',value:{kind:'bezier',x1:.34,y1:1.56,x2:.64,y2:1}},
 {id:'spring',label:'Damped spring',value:{kind:'spring',mass:1,stiffness:100,damping:10,velocity:0}},
];
export function validateMotionEasing(value:MotionEasing):void {
 if(value.kind==='hold'||value.kind==='linear')return;
 if(value.kind==='bezier'){if(![value.x1,value.x2].every(v=>Number.isFinite(v)&&v>=0&&v<=1)||![value.y1,value.y2].every(v=>Number.isFinite(v)&&v>=-10&&v<=10))throw new RangeError('Invalid temporal Bezier controls');return;}
 if(value.kind==='spring'){if(![value.mass,value.stiffness].every(v=>Number.isFinite(v)&&v>0&&v<=100000)||!Number.isFinite(value.damping)||value.damping<0||value.damping>100000||!Number.isFinite(value.velocity)||Math.abs(value.velocity)>1000)throw new RangeError('Invalid spring parameters');return;}
 throw new TypeError('Unsupported motion easing kind');
}
export function validateMotionEasingPresets(presets:readonly MotionEasingPreset[]):void {if(presets.length>256)throw new RangeError('Easing gallery exceeds 256 presets');const ids=new Set<string>();for(const preset of presets){if(!preset.id.trim()||!preset.label.trim()||ids.has(preset.id))throw new TypeError('Easing presets require distinct labeled identities');validateMotionEasing(preset.value);ids.add(preset.id);}}
