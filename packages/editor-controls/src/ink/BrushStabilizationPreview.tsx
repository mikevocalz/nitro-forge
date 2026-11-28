import {Text,View,type ViewProps} from 'react-native';
import {PrecisionScrubber} from '@nyc-tron/ui/components/shell/PrecisionScrubber';
import {ErrorMessage} from '@nyc-tron/ui/components/feedback/ErrorMessage';
import {controlIdentity,useScopedControl,type ScopedControlProps} from '../inputs/useScopedControl.ts';
import {InkStrokePreview,type InkStrokePreviewProps} from './InkStrokePreview.tsx';
import {stabilizePreview,validateStabilization,type BrushStabilization} from './brush-model.ts';
import {exact} from '../exact-optional.ts';
export interface BrushStabilizationPreviewProps extends Omit<ViewProps,'children'>,ScopedControlProps {
 value:BrushStabilization;onCommit:(value:BrushStabilization,signal?:AbortSignal)=>void|Promise<unknown>;
 pad:Omit<InkStrokePreviewProps,'scope'|'revision'|'filterSamples'>;unstyled?:boolean;
}
export function BrushStabilizationPreview({scope='brush-stabilization',revision=0,...props}:BrushStabilizationPreviewProps){
 const {value,onCommit:_commit,pad,unstyled=false,disabledReason,style,...rest}=props;validateStabilization(value);
 const guard=useScopedControl(JSON.stringify([...controlIdentity(scope,revision),disabledReason]),props,disabledReason!==undefined),off=guard.pending||disabledReason!==undefined;
 return <View {...rest} style={[{gap:8,minWidth:0},style]} accessibilityLabel="Brush stabilization">
  {(['streamline','stabilization','motionFilter'] as const).map(key=><PrecisionScrubber key={key} scope={scope} revision={revision} label={key==='motionFilter'?'Motion filtering':key==='streamline'?'Streamline':'Stabilization'} value={value[key]} min={0} max={1} step={.01} disabled={off} unstyled={unstyled}
   onCommit={n=>guard.run(key,(host,signal)=>host.onCommit({...host.value,[key]:n},signal))}/>)}
  <Text {...{className:unstyled?undefined:'text-text'}}>Position filtering preview; pressure, tilt, twist and sample timing are preserved.</Text>
  <InkStrokePreview {...pad} scope={scope} revision={revision} unstyled={unstyled} {...(disabledReason?{disabledReason}:{})} filterSamples={points=>stabilizePreview(points,value)}/>
  {off?<Text {...{className:unstyled?undefined:'text-text'}} accessibilityLiveRegion="polite">{disabledReason??'Applying stabilization'}</Text>:null}<ErrorMessage {...exact({message:guard.error??undefined,unstyled:unstyled})}/>
 </View>;
}
