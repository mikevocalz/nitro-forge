import {Text,View,type ViewProps} from 'react-native';
import {Button} from '@nyc-tron/ui/components/Button';
import {SegmentedControl} from '@nyc-tron/ui/components/SegmentedControl';
import {ErrorMessage} from '@nyc-tron/ui/components/feedback/ErrorMessage';
import {controlIdentity,useScopedControl,type ScopedControlProps} from '../inputs/useScopedControl.ts';
export type InputMonitorMode='off'|'hardware'|'software';
export interface InputMonitorToggleProps extends Omit<ViewProps,'children'>,ScopedControlProps {
 value:InputMonitorMode;hardwareSupported:boolean;softwareSupported:boolean;feedbackRisk:boolean;feedbackAcknowledged:boolean;
 onAcknowledgeFeedback:(signal?:AbortSignal)=>void|Promise<unknown>;onChange:(mode:InputMonitorMode,signal?:AbortSignal)=>void|Promise<unknown>;unstyled?:boolean;
}
export function InputMonitorToggle({scope='input-monitor',revision=0,...props}:InputMonitorToggleProps){
 const {value,hardwareSupported,softwareSupported,feedbackRisk,feedbackAcknowledged,onAcknowledgeFeedback:_ack,onChange:_change,unstyled=false,disabledReason,style,...rest}=props;
 if(!['off','hardware','software'].includes(value))throw new RangeError('Unknown input monitoring mode');
 const guard=useScopedControl(JSON.stringify([...controlIdentity(scope,revision),disabledReason,hardwareSupported,softwareSupported,feedbackRisk,feedbackAcknowledged]),props,disabledReason!==undefined),off=guard.pending||disabledReason!==undefined;
 return <View {...rest} style={[{gap:8},style]} accessibilityLabel="Input monitoring">
  <SegmentedControl aria-label="Monitor input" value={value} disabled={off} unstyled={unstyled} options={[{value:'off',label:'Off'},{value:'hardware',label:'Hardware',disabled:!hardwareSupported},{value:'software',label:'Software',disabled:!softwareSupported||feedbackRisk&&!feedbackAcknowledged}]}
   onChange={mode=>guard.run('monitor',(host,signal)=>mode==='off'||mode==='hardware'&&host.hardwareSupported||mode==='software'&&host.softwareSupported&&(!host.feedbackRisk||host.feedbackAcknowledged)?host.onChange(mode,signal):undefined)}/>
  {feedbackRisk?<Text {...{className:unstyled?undefined:'text-text'}}>Software monitoring may feed the speakers into the microphone. Use headphones or a safe routing path.</Text>:null}
  {feedbackRisk&&!feedbackAcknowledged&&softwareSupported?<Button title="Acknowledge software monitoring feedback risk" variant="secondary" disabled={off} unstyled={unstyled} onPress={()=>guard.run('ack',(host,signal)=>host.onAcknowledgeFeedback(signal))}/>:null}
  {!hardwareSupported?<Text {...{className:unstyled?undefined:'text-text'}}>This device does not provide hardware monitoring.</Text>:null}<ErrorMessage message={guard.error??undefined} unstyled={unstyled}/>
 </View>;
}
