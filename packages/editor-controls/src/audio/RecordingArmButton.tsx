import {Text,View,type ViewProps} from 'react-native';
import {Button} from '@nyc-tron/ui/components/Button';
import {ErrorMessage} from '@nyc-tron/ui/components/feedback/ErrorMessage';
import {controlIdentity,useScopedControl,type ScopedControlProps} from '../inputs/useScopedControl.ts';
import {exact} from '../exact-optional.ts';
export interface RecordingArmButtonProps extends Omit<ViewProps,'children'>,ScopedControlProps {
 trackId:string;label:string;armed:boolean;recording:boolean;error?:string;onArmChange:(trackId:string,armed:boolean,signal?:AbortSignal)=>void|Promise<unknown>;unstyled?:boolean;
}
export function RecordingArmButton({scope='record-arm',revision=0,...props}:RecordingArmButtonProps){
 const {trackId,label,armed,recording,error,onArmChange:_change,unstyled=false,disabledReason,style,...rest}=props;
 if(!trackId.trim()||trackId.length>512||!label.trim()||label.length>1024)throw new RangeError('Invalid recording track');
 const guard=useScopedControl(JSON.stringify([...controlIdentity(scope,revision),trackId,disabledReason]),props,disabledReason!==undefined||recording);
 return <View {...rest} style={[{gap:4},style]}><Button title={recording?'Recording '+label:armed?'Disarm '+label:'Arm '+label} accessibilityState={{checked:armed}} disabled={disabledReason!==undefined||recording||guard.pending} unstyled={unstyled} onPress={()=>guard.run('arm',(host,signal)=>!host.recording?host.onArmChange(host.trackId,!host.armed,signal):undefined)}/>
  {disabledReason?<Text {...{className:unstyled?undefined:'text-text'}}>{disabledReason}</Text>:null}<ErrorMessage {...exact({message:guard.error??error??undefined,unstyled:unstyled})}/></View>;
}
