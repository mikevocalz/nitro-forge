import {PropertyInspector,type PropertyInspectorProps} from '../inputs/PropertyInspector.tsx';
import {sizingFields,sizingCommit,type AxisSizing} from './HugFillFixedSizeControls.model.ts';
export type {AxisSizing} from './HugFillFixedSizeControls.model.ts';
export const HUG_FILL_FIXED_SIZE_CAPABILITIES=Object.freeze({version:1,configurableBounds:true} as const);
export interface HugFillFixedSizeControlsProps extends Omit<PropertyInspectorProps,'label'|'fields'|'onCommit'> {x:AxisSizing;y:AxisSizing;onCommit:(axis:'x'|'y',value:AxisSizing,signal?:AbortSignal)=>unknown}
export function HugFillFixedSizeControls({x,y,onCommit,...props}:HugFillFixedSizeControlsProps){
 return <PropertyInspector {...props} label="Axis sizing" fields={sizingFields(x,y)} onCommit={(id,value,s)=>{const result=sizingCommit(x,y,id,value);return onCommit(result.axis,result.value,s);}}/>;
}
