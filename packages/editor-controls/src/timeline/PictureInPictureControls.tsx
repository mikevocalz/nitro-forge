import {Text,View,type ViewProps} from 'react-native';
import {Button} from '@nyc-tron/ui/components/Button';
import {ErrorMessage} from '@nyc-tron/ui/components/feedback/ErrorMessage';
import {controlIdentity,useScopedControl,type ScopedControlProps} from '../inputs/useScopedControl.ts';
import {exact} from '../exact-optional.ts';
import { tokens } from '../tokens.ts';
export interface PictureInPictureControlsProps extends Omit<ViewProps,'children'>,ScopedControlProps {
 supported:boolean;unsupportedReason?:string;active:boolean;backgrounded:boolean;
 onEnter:(signal?:AbortSignal)=>void|Promise<unknown>;onExit:(signal?:AbortSignal)=>void|Promise<unknown>;unstyled?:boolean;
}
/** Reflects the OS-reported PiP state. A request never toggles local success. */
export function PictureInPictureControls({scope='picture-in-picture',revision=0,...props}:PictureInPictureControlsProps){
 const {supported,unsupportedReason,active,backgrounded,onEnter:_enter,onExit:_exit,unstyled=false,disabledReason,style,...rest}=props;
 const reason=disabledReason??(!supported?(unsupportedReason??'Picture in picture is not supported on this host'):undefined);
 const guard=useScopedControl(JSON.stringify([...controlIdentity(scope,revision),supported,disabledReason]),props,reason!==undefined);
 return <View {...rest} style={[{gap:tokens.spacing.fixedElement,minWidth:0},style]} accessibilityLabel="Picture in picture">
  <Text {...{className:unstyled?undefined:'text-text'}} accessibilityLiveRegion="polite">{active?'Picture in picture is active':'Picture in picture is inactive'}; app {backgrounded?'in background':'in foreground'}</Text>
  {reason?<Text {...{className:unstyled?undefined:'text-text'}}>{reason}</Text>:null}
  <Button title={active?'Exit picture in picture':'Enter picture in picture'} disabled={reason!==undefined||guard.pending} unstyled={unstyled} onPress={()=>guard.run('pip',(host,signal)=>host.active?host.onExit(signal):host.onEnter(signal))}/>
  <ErrorMessage {...exact({message:guard.error??undefined,unstyled:unstyled})}/>
 </View>;
}
