import {View,type ViewProps} from 'react-native';
import {UnitInput} from '@nyc-tron/ui/components/shell/UnitInput';
import {Button} from '@nyc-tron/ui/components/Button';
import {MotionVectorFields} from './MotionVectorFields.tsx';
import {defaultMotionTransform,validateMotionTransform,type MotionTransform3D} from './motion-settings.ts';
export type {MotionTransform3D,MotionVector3} from './motion-settings.ts';
export interface Transform3DInspectorProps extends Omit<ViewProps,'children'> {readonly value:MotionTransform3D;readonly onCommit:(value:MotionTransform3D)=>void;readonly disabled?:boolean;readonly unstyled?:boolean}
/** Controlled scene/document transform; rotations retain complete turns. */
export function Transform3DInspector({value,onCommit,disabled=false,unstyled=false,...props}:Transform3DInspectorProps){
 validateMotionTransform(value);const set=(change:Partial<MotionTransform3D>)=>{if(disabled)return;const next={...value,...change};validateMotionTransform(next);onCommit(next);};
 return <View {...props} style={[{gap:10},props.style]}>
  {(['anchor','position','scale','rotation'] as const).map(key=><MotionVectorFields key={key} label={`3D ${key}`} value={value[key]} min={key==='scale'?-10000:key==='rotation'?-360000:-1e9} max={key==='scale'?10000:key==='rotation'?360000:1e9} step={key==='scale'?.01:1} disabled={disabled} unstyled={unstyled} onCommit={vector=>set({[key]:vector})}/>)}
  <UnitInput label="3D opacity" value={value.opacity} min={0} max={1} step={.01} disabled={disabled} unstyled={unstyled} onCommit={opacity=>set({opacity})}/>
  <Button title="Reset 3D transform" disabled={disabled} unstyled={unstyled} onPress={()=>{if(!disabled)onCommit(defaultMotionTransform());}}/>
 </View>;
}
