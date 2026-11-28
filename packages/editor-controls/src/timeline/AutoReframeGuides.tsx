import {Text,View,type ViewProps} from 'react-native';
import {Button} from '@nyc-tron/ui/components/Button';
import {SettingSwitch} from '@nyc-tron/ui/components/forms/SettingSwitch';
import {GuidedCropAndStraighten,type GuidedCropAndStraightenProps} from '../canvas/GuidedCropAndStraighten.tsx';
import {ErrorMessage} from '@nyc-tron/ui/components/feedback/ErrorMessage';
import {controlIdentity,useScopedControl,type ScopedControlProps} from '../inputs/useScopedControl.ts';
export interface AutoReframeGuidesProps extends Omit<ViewProps,'children'>,ScopedControlProps {
 frame:number;manual:boolean;onManualChange:(manual:boolean)=>void;
 crop:Omit<GuidedCropAndStraightenProps,'scope'|'revision'|'disabledReason'>;
 tracking:{status:'idle'|'running'|'ready'|'lost'|'error';subjectLabel?:string;progress?:number;error?:string};
 onTrack:(frame:number,signal?:AbortSignal)=>void|Promise<unknown>;onStop:()=>void;unstyled?:boolean;
}
export function AutoReframeGuides({scope='auto-reframe',revision=0,...props}:AutoReframeGuidesProps){
 const {frame,manual,onManualChange:_manual,crop,tracking,onTrack:_track,onStop,unstyled=false,disabledReason,style,...rest}=props;
 if(!Number.isSafeInteger(frame)||frame<0||!['idle','running','ready','lost','error'].includes(tracking.status)||tracking.progress!==undefined&&(!Number.isFinite(tracking.progress)||tracking.progress<0||tracking.progress>1))throw new RangeError('Invalid reframing state');
 const owner=JSON.stringify([...controlIdentity(scope,revision),disabledReason]),guard=useScopedControl(owner,props,disabledReason!==undefined||tracking.status==='running'),off=guard.pending||disabledReason!==undefined||tracking.status==='running';
 return <View {...rest} style={[{gap:8,minWidth:0},style]} accessibilityLabel="Automatic reframing">
  <Text {...{className:unstyled?undefined:'text-text'}}>Frame {frame}; subject: {tracking.subjectLabel??'Not reported'}</Text>
  <SettingSwitch label="Manual crop override" on={manual} disabled={off} styled={!unstyled} onChange={value=>guard.current()?.onManualChange(value)}/>
  <GuidedCropAndStraighten {...crop} scope={scope} revision={revision} unstyled={unstyled} {...(disabledReason?{disabledReason}:off?{disabledReason:'Tracking operation in progress'}:!manual?{disabledReason:'Enable manual crop override to adjust guides'}:{})}/>
  <Text {...{className:unstyled?undefined:'text-text'}} accessibilityLiveRegion="polite">Tracking: {tracking.status}{tracking.progress===undefined?'':`; ${(tracking.progress*100).toFixed(0)}%`}</Text>
  {tracking.status==='lost'?<Text {...{className:unstyled?undefined:'text-text'}}>Subject lost. Use manual crop correction or track again.</Text>:null}
  <Button title="Track subject for reframing" disabled={off} unstyled={unstyled} onPress={()=>guard.run('track',(host,signal)=>host.onTrack(host.frame,signal))}/>
  {guard.pendingId==='track'||tracking.status==='running'?<Button title="Stop reframing tracking" variant="secondary" unstyled={unstyled} onPress={()=>{if(guard.cancel())onStop();}}/>:null}
  <ErrorMessage message={guard.error??tracking.error??undefined} unstyled={unstyled}/>
 </View>;
}
