import {Text,View} from 'react-native';
import {MotionCurveEditor,type MotionCurveEditorProps} from '../motion/MotionCurveEditor.tsx';
import {Button} from '@nyc-tron/ui/components/Button';
import {ErrorMessage} from '@nyc-tron/ui/components/feedback/ErrorMessage';
import {controlIdentity,useScopedControl} from '../inputs/useScopedControl.ts';
export interface VideoSpeedRampCurveProps extends Omit<MotionCurveEditorProps,'mode'|'valueLabel'|'onCommit'> {
 clipId:string;allowReverse?:boolean;allowFreeze?:boolean;estimatedSourceDurationSeconds?:number;
 onCommit:(...args:[...Parameters<MotionCurveEditorProps['onCommit']>,signal?:AbortSignal])=>void|Promise<unknown>;
 canUndo:boolean;onUndo:(signal?:AbortSignal)=>void|Promise<unknown>;
}
/** Edit speed itself, not its derivative. The engine applies retiming and reports source usage. */
export function VideoSpeedRampCurve({clipId,allowReverse=false,allowFreeze=false,estimatedSourceDurationSeconds,canUndo,onUndo:_undo,onCommit:_commit,...props}:VideoSpeedRampCurveProps){
 if(!clipId.trim()||clipId.length>512||!allowReverse&&props.value.minimum<0||!allowFreeze&&!allowReverse&&props.value.minimum<=0||estimatedSourceDurationSeconds!==undefined&&(!Number.isFinite(estimatedSourceDurationSeconds)||estimatedSourceDurationSeconds<0))throw new RangeError('Invalid speed ramp capabilities');
 const host={...props,clipId,onUndo:_undo,onCommit:_commit},owner=JSON.stringify([...controlIdentity(props.scope,props.revision),clipId,props.disabled,allowReverse,allowFreeze]);
 const guard=useScopedControl(owner,host,!!props.disabled);
 return <View style={{gap:8,minWidth:0}} accessibilityLabel="Video speed ramp">
  <MotionCurveEditor key={owner} {...props} mode="value" valueLabel="Playback speed ×" disabled={!!props.disabled||guard.pending}
   onCommit={(curve,selected)=>guard.run('ramp',(current,signal)=>current.onCommit(curve,selected,signal))}/>
  <Text {...{className:props.unstyled?undefined:'text-text'}}>Engine source-duration estimate: {estimatedSourceDurationSeconds===undefined?'Not reported':estimatedSourceDurationSeconds.toFixed(3)+' s'}</Text>
  <Button title="Undo speed change" disabled={!canUndo||!!props.disabled||guard.pending} unstyled={props.unstyled} onPress={()=>guard.run('undo',(current,signal)=>current.onUndo(signal))}/>
  <ErrorMessage message={guard.error??undefined} unstyled={props.unstyled}/>
 </View>;
}
