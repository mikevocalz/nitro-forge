import type {ReactNode} from 'react';
import {Text,View,type ViewProps} from 'react-native';
import {Button} from '@nyc-tron/ui/components/Button';
import {ErrorMessage} from '@nyc-tron/ui/components/feedback/ErrorMessage';
import {controlIdentity,useScopedControl,type ScopedControlProps} from '../inputs/useScopedControl.ts';
import {exact} from '../exact-optional.ts';
import { controlTokens, tokens } from '../tokens.ts';
export interface MulticamAngle {id:string;label:string;offsetFrames:number;presentedFrame?:number;status:'loading'|'ready'|'error';error?:string;surface:ReactNode}
export interface MulticamAngleViewerProps extends Omit<ViewProps,'children'>,ScopedControlProps {
 angles:readonly MulticamAngle[];selectedId?:string;frame:number;maxDriftFrames?:number;
 onSelect:(cut:{angleId:string;frame:number;offsetFrames:number},signal?:AbortSignal)=>void|Promise<unknown>;unstyled?:boolean;
}
export function MulticamAngleViewer({scope='multicam',revision=0,...props}:MulticamAngleViewerProps){
 const {angles,selectedId,frame,maxDriftFrames=1,onSelect:_select,unstyled=false,disabledReason,style,...rest}=props;
 if(angles.length>64||new Set(angles.map(a=>a.id)).size!==angles.length||angles.some(a=>!a.id.trim()||a.id.length>512||!a.label.trim()||a.label.length>1024||!Number.isSafeInteger(a.offsetFrames)||a.presentedFrame!==undefined&&(!Number.isSafeInteger(a.presentedFrame)||a.presentedFrame<0)||!['loading','ready','error'].includes(a.status))||!Number.isSafeInteger(frame)||frame<0||!Number.isSafeInteger(maxDriftFrames)||maxDriftFrames<0)throw new RangeError('Invalid multicam state');
 const guard=useScopedControl(JSON.stringify([...controlIdentity(scope,revision),disabledReason,angles.map(a=>[a.id,a.offsetFrames])]),props,disabledReason!==undefined);
 const problem=(a:MulticamAngle,reference=frame,tolerance=maxDriftFrames)=>a.status==='error'?(a.error??'Angle could not be decoded'):a.status==='loading'?'Loading angle':a.presentedFrame===undefined?'Presented frame not reported':Math.abs(a.presentedFrame+a.offsetFrames-reference)>tolerance?'Angle is out of sync':undefined;
 return <View {...rest} style={[{gap:tokens.spacing.fixedElement,minWidth:0},style]} accessibilityLabel="Multicam angles">
  <View style={{flexDirection:'row',flexWrap:'wrap',gap:tokens.spacing.fixedElement}}>{angles.map(angle=>{const reason=problem(angle);return <View key={angle.id} style={{minWidth:controlTokens.extent.column,flexBasis:controlTokens.extent.preview,flexGrow:1,gap:tokens.spacing.fixedStack}}>
   <View style={{aspectRatio:16/9,overflow:'hidden'}}>{angle.surface}</View>
   <Text {...{className:unstyled?undefined:'text-text'}}>{angle.label}; presented {angle.presentedFrame??'not reported'}; offset {angle.offsetFrames}</Text>
   {reason?<Text {...{className:unstyled?undefined:'text-text'}}>{reason}</Text>:null}
   <Button title={'Cut to '+angle.label} accessibilityState={{selected:angle.id===selectedId}} disabled={disabledReason!==undefined||guard.pending||reason!==undefined} accessibilityHint={reason} unstyled={unstyled}
    onPress={()=>guard.run('cut',(host,signal)=>{const live=host.angles.find(a=>a.id===angle.id);return live&&!problem(live,host.frame,host.maxDriftFrames??1)?host.onSelect({angleId:live.id,frame:host.frame,offsetFrames:live.offsetFrames},signal):undefined;})}/>
  </View>;})}</View>
  {angles.length===0?<Text {...{className:unstyled?undefined:'text-text'}}>No camera angles loaded</Text>:null}<ErrorMessage {...exact({message:guard.error??undefined,unstyled:unstyled})}/>
 </View>;
}
