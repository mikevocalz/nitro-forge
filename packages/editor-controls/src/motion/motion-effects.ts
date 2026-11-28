export type EffectParameterValue=number|boolean|string;
export type EffectParameter=Readonly<{id:string;label:string}> & (
 Readonly<{kind:'number';value:number;minimum:number;maximum:number;step:number;unit?:string}>|
 Readonly<{kind:'boolean';value:boolean}>|
 Readonly<{kind:'choice';value:string;choices:readonly {readonly id:string;readonly label:string}[]}>|
 Readonly<{kind:'text';value:string;maxLength:number}>);
export interface MotionEffect {readonly id:string;readonly typeId:string;readonly label:string;readonly bypassed:boolean;readonly favorite:boolean;readonly parameters:readonly EffectParameter[];readonly presets:readonly {readonly id:string;readonly label:string}[];readonly presetId:string|null}
export type MotionEffectMutation=
 {readonly type:'add';readonly typeId:string}|{readonly type:'remove'|'reset';readonly effectId:string}|
 {readonly type:'bypass'|'favorite';readonly effectId:string;readonly value:boolean}|
 {readonly type:'reorder';readonly ids:readonly string[]}|
 {readonly type:'preset';readonly effectId:string;readonly presetId:string}|
 {readonly type:'parameter';readonly effectId:string;readonly parameterId:string;readonly value:EffectParameterValue};
const id=(s:string)=>typeof s==='string'&&s.trim().length>0&&s.length<=256;
export function validateEffectChoices(choices:readonly {readonly id:string;readonly label:string}[]):void {if(choices.length>1000||new Set(choices.map(c=>c.id)).size!==choices.length||choices.some(c=>!id(c.id)||!id(c.label)))throw new TypeError('Invalid effect choices');}
export function validateMotionEffects(effects:readonly MotionEffect[]):void {
 if(effects.length>256||new Set(effects.map(e=>e.id)).size!==effects.length)throw new RangeError('Invalid effect stack identities or budget');
 for(const effect of effects){if(!id(effect.id)||!id(effect.typeId)||!id(effect.label)||typeof effect.bypassed!=='boolean'||typeof effect.favorite!=='boolean'||effect.parameters.length>128||new Set(effect.parameters.map(p=>p.id)).size!==effect.parameters.length)throw new TypeError('Invalid effect');validateEffectChoices(effect.presets);if(effect.presetId!==null&&!id(effect.presetId))throw new TypeError('Invalid effect preset identity');for(const p of effect.parameters){if(!id(p.id)||!id(p.label))throw new TypeError('Invalid effect parameter identity');switch(p.kind){case 'number':if(![p.value,p.minimum,p.maximum,p.step].every(Number.isFinite)||p.minimum>=p.maximum||p.value<p.minimum||p.value>p.maximum||p.step<=0||p.unit!==undefined&&(typeof p.unit!=='string'||p.unit.length>32))throw new RangeError('Invalid effect numeric parameter');break;case 'boolean':if(typeof p.value!=='boolean')throw new TypeError('Invalid effect boolean');break;case 'choice':validateEffectChoices(p.choices);if(!id(p.value))throw new TypeError('Invalid effect choice identity');break;case 'text':if(!Number.isInteger(p.maxLength)||p.maxLength<1||p.maxLength>16384||typeof p.value!=='string'||p.value.length>p.maxLength)throw new RangeError('Invalid effect text');break;default:throw new TypeError('Unsupported effect parameter');}}}
}
export function moveMotionEffect(effects:readonly MotionEffect[],effectId:string,direction:-1|1):readonly string[]{const ids=effects.map(e=>e.id),at=ids.indexOf(effectId);if(at<0)throw new RangeError('Unknown effect');const next=at+direction;if(next<0||next>=ids.length)return ids;[ids[at],ids[next]]=[ids[next]!,ids[at]!];return ids;}
export function validateEffectParameterValue(parameter:EffectParameter,value:EffectParameterValue):void {if(parameter.kind==='number'&&(typeof value!=='number'||!Number.isFinite(value)||value<parameter.minimum||value>parameter.maximum)||parameter.kind==='boolean'&&typeof value!=='boolean'||parameter.kind==='choice'&&(typeof value!=='string'||!parameter.choices.some(c=>c.id===value))||parameter.kind==='text'&&(typeof value!=='string'||value.length>parameter.maxLength))throw new TypeError('Effect parameter does not match its schema');}
