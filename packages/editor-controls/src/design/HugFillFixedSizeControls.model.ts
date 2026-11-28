import type {InspectorProperty} from '../inputs/PropertyInspector.tsx';

export interface AxisSizing {
 mode:'hug'|'fill'|'fixed';value:number;canHug:boolean;canFill:boolean;unavailableReason?:string;
 /** Host-owned positive dimension range. Defaults preserve the original control contract. */
 min?:number;max?:number;step?:number;
}

function bounds(value:AxisSizing){
 const min=value.min??.001,max=value.max??1000000,step=value.step??1;
 if(!Number.isFinite(min)||!Number.isFinite(max)||!Number.isFinite(step)||min<=0||max<min||step<=0)
  throw new RangeError('Sizing bounds must be finite, positive and ordered');
 return {min,max,step};
}

export function sizingFields(x:AxisSizing,y:AxisSizing):InspectorProperty[]{
 const fields:InspectorProperty[]=[];
 for(const axis of ['x','y'] as const){
  const value=axis==='x'?x:y,range=bounds(value),label=axis==='x'?'Width':'Height';
  fields.push({kind:'choice',id:axis+':mode',label:label+' sizing',value:value.mode,disabledReason:value.unavailableReason,
   choices:[{id:'hug',label:'Hug contents',disabled:!value.canHug},{id:'fill',label:'Fill parent',disabled:!value.canFill},{id:'fixed',label:'Fixed'}]});
  if(value.mode==='fixed')fields.push({kind:'number',id:axis+':value',label,value:value.value,...range,disabledReason:value.unavailableReason});
 }
 return fields;
}

/** Validate a controlled write without changing caller state or replacing its capability metadata. */
export function sizingCommit(x:AxisSizing,y:AxisSizing,id:string,next:unknown):{axis:'x'|'y';value:AxisSizing}{
 const match=/^(x|y):(mode|value)$/.exec(id);
 if(!match||match[0]!==id)throw new Error('Unknown sizing field');
 const axis=match[1] as 'x'|'y',key=match[2],value=axis==='x'?x:y;
 if(value.unavailableReason!==undefined)throw new Error(value.unavailableReason||'Sizing is unavailable');
 const range=bounds(value);
 if(key==='mode'){
  if(next!=='hug'&&next!=='fill'&&next!=='fixed')throw new Error('Unknown sizing mode');
  if(next==='hug'&&!value.canHug||next==='fill'&&!value.canFill)throw new Error('Sizing mode unavailable');
  if(next==='fixed'&&(!Number.isFinite(value.value)||value.value<range.min||value.value>range.max))
   throw new RangeError('Fixed size is outside the configured range');
  return {axis,value:{...value,mode:next}};
 }
 if(value.mode!=='fixed')throw new Error('Only fixed sizing accepts a numeric value');
 if(typeof next!=='number'||!Number.isFinite(next)||next<range.min||next>range.max)
  throw new RangeError('Fixed size is outside the configured range');
 return {axis,value:{...value,value:next}};
}
