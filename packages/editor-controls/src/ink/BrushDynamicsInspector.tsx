import {Text,View,type ViewProps} from 'react-native';
import {PrecisionScrubber} from '@nyc-tron/ui/components/shell/PrecisionScrubber';
import {ErrorMessage} from '@nyc-tron/ui/components/feedback/ErrorMessage';
import {controlIdentity,useScopedControl,type ScopedControlProps} from '../inputs/useScopedControl.ts';
import {BRUSH_DYNAMICS_FIELDS,validateBrushDynamics,type BrushDynamics} from './brush-model.ts';
export interface BrushDynamicsInspectorProps extends Omit<ViewProps,'children'>,ScopedControlProps {
 value:BrushDynamics;onCommit:(value:BrushDynamics,signal?:AbortSignal)=>void|Promise<unknown>;unstyled?:boolean;
}
export function BrushDynamicsInspector({scope='brush-dynamics',revision=0,...props}:BrushDynamicsInspectorProps){
 const {value,onCommit:_commit,unstyled=false,disabledReason,style,...rest}=props;validateBrushDynamics(value);
 const guard=useScopedControl(JSON.stringify([...controlIdentity(scope,revision),disabledReason]),props,disabledReason!==undefined),off=guard.pending||disabledReason!==undefined;
 return <View {...rest} style={[{gap:8,minWidth:0},style]} accessibilityLabel="Brush dynamics">
  <ErrorMessage message={guard.error??undefined} unstyled={unstyled}/>
  {off?<Text {...{className:unstyled?undefined:'text-text'}} accessibilityLiveRegion="polite">{disabledReason??'Applying brush settings'}</Text>:null}
  {BRUSH_DYNAMICS_FIELDS.map(f=><PrecisionScrubber key={f.key} scope={scope} revision={revision} label={f.label} unit={f.unit} value={value[f.key]} min={f.min} max={f.max} step={f.step} disabled={off} unstyled={unstyled}
   onCommit={n=>guard.run(f.key,(host,signal)=>host.onCommit({...host.value,[f.key]:n},signal))}/>)}
 </View>;
}
