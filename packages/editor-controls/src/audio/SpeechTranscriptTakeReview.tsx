import {useEditorBoundary} from '@nyc-tron/ui/components/gestures/editor-interaction-scope';
import {Text,View,type ViewProps} from 'react-native';
import {Select} from '@nyc-tron/ui/components/Select';
import {AutoCaptionTranscriptTimeline,type AutoCaptionTranscriptTimelineProps} from '../timeline/AutoCaptionTranscriptTimeline.tsx';
import {CaptionWordTimingHandles,type CaptionWordTimingHandlesProps} from '../timeline/CaptionWordTimingHandles.tsx';
import {controlIdentity,useScopedControl,type ScopedControlProps} from '../inputs/useScopedControl.ts';
import {ErrorMessage} from '@nyc-tron/ui/components/feedback/ErrorMessage';
import {exact} from '../exact-optional.ts';
export interface SpeechTranscriptTakeReviewProps extends Omit<ViewProps,'children'>,ScopedControlProps {
 takes:readonly {id:string;label:string}[];takeId:string|null;onTakeChange:(id:string,signal?:AbortSignal)=>unknown;
 transcript:AutoCaptionTranscriptTimelineProps;timing:CaptionWordTimingHandlesProps;unstyled?:boolean;
}
/** Take selection plus shared ASR speaker/text correction and real word-boundary editing. */
export function SpeechTranscriptTakeReview({scope='speech-take-review',revision=0,...props}:SpeechTranscriptTakeReviewProps){
 const {takes,takeId,onTakeChange:_take,transcript,timing,unstyled=false,disabledReason,style,...rest}=props;
 if(takes.length>256||new Set(takes.map(t=>t.id)).size!==takes.length||takes.some(t=>!t.id.trim()||t.id.length>512||!t.label.trim()||t.label.length>1024)||takeId!==null&&!takes.some(t=>t.id===takeId))throw new RangeError('Invalid speech take selection');
 const owner=useEditorBoundary([JSON.stringify([...controlIdentity(scope,revision),takeId,disabledReason])]),guard=useScopedControl(owner,props,disabledReason!==undefined),reason=disabledReason??(guard.pending?'Switching speech take':takeId===null?'Select a recorded take':undefined);
 return <View {...rest} accessibilityLabel="Speech transcript take review" style={[{gap:12},style]}>
  {takes.length?<Select label="Recorded speech take" value={takeId??''} options={[{value:'',label:'Select a take',disabled:true},...takes.map(t=>({value:t.id,label:t.label}))]} disabled={guard.pending||disabledReason!==undefined} unstyled={unstyled} onValueChange={id=>guard.run('take',(h,s)=>h.takes.some(t=>t.id===id)?h.onTakeChange(id,s):undefined)}/>:<Text {...{className:unstyled?undefined:'text-text'}}>No recorded speech takes supplied</Text>}
  <AutoCaptionTranscriptTimeline key={owner+'transcript'} {...transcript} scope={owner+'transcript'} revision={revision} disabledReason={reason??transcript.disabledReason} unstyled={unstyled}/>
  <CaptionWordTimingHandles key={owner+'timing'} {...timing} scope={owner+'timing'} revision={revision} disabledReason={reason??timing.disabledReason} unstyled={unstyled}/>
  <ErrorMessage {...exact({message:guard.error??disabledReason,unstyled:unstyled})}/>
 </View>;
}
