import {View} from 'react-native';
import {UnitInput} from '@nyc-tron/ui/components/shell/UnitInput';
import {validateMotionVector,type MotionVector3} from './motion-settings.ts';
import { tokens } from '../tokens.ts';
export interface MotionVectorFieldsProps {readonly label:string;readonly value:MotionVector3;readonly onCommit:(value:MotionVector3)=>void;readonly min?:number;readonly max?:number;readonly step?:number;readonly disabled?:boolean;readonly unstyled?:boolean}
/** Common axis entry preserves the two untouched floating coordinates. */
export function MotionVectorFields({label,value,onCommit,min=-1e9,max=1e9,step=1,disabled=false,unstyled=false}:MotionVectorFieldsProps){
 validateMotionVector(value,min,max);return <View style={{gap:tokens.spacing.off6}}>{(['x','y','z'] as const).map(axis=><UnitInput key={axis} label={`${label} ${axis.toUpperCase()}`} value={value[axis]} min={min} max={max} step={step} precision={6} disabled={disabled} unstyled={unstyled} onCommit={number=>{if(disabled||number===value[axis])return;const next={...value,[axis]:number};validateMotionVector(next,min,max);onCommit(next);}}/>)}</View>;
}
