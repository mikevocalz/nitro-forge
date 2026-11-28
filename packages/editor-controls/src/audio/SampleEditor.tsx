import {useEditorBoundary} from '@nyc-tron/ui/components/gestures/editor-interaction-scope';
import {Text,View,type ViewProps} from 'react-native';
import {AudioClipTrimAndFade,type AudioClipTrimAndFadeProps} from './AudioClipTrimAndFade.tsx';
import {LoopPunchRecording,type LoopPunchConfiguration} from './LoopPunchRecording.tsx';
import {PrecisionScrubber} from '@nyc-tron/ui/components/shell/PrecisionScrubber';
import {controlIdentity,useScopedControl,type ScopedControlProps} from '../inputs/useScopedControl.ts';
import {ErrorMessage} from '@nyc-tron/ui/components/feedback/ErrorMessage';
export interface SampleKeyboardMap {rootNote:number;lowNote:number;highNote:number;tuneCents:number}
export interface SampleEditorProps extends Omit<ViewProps,'children'>,ScopedControlProps {
 source:Omit<AudioClipTrimAndFadeProps,'onCommit'|'scope'|'revision'|'disabledReason'|'style'>;
 loop:LoopPunchConfiguration;keyboard:SampleKeyboardMap;
 onRegionCommit:AudioClipTrimAndFadeProps['onCommit'];onLoopCommit:(value:LoopPunchConfiguration,signal?:AbortSignal)=>unknown;
 onKeyboardCommit:(value:SampleKeyboardMap,signal?:AbortSignal)=>unknown;onAudition:(note:number,signal?:AbortSignal)=>unknown;unstyled?:boolean;
}
import {Button} from '@nyc-tron/ui/components/Button';
export function SampleEditor({scope='sample-editor',revision=0,...props}:SampleEditorProps){
 const {source,loop,keyboard,onRegionCommit:_region,onLoopCommit:_loop,onKeyboardCommit:_keyboard,onAudition:_audition,unstyled=false,disabledReason,style,...rest}=props;
 if(![keyboard.rootNote,keyboard.lowNote,keyboard.highNote].every(n=>Number.isInteger(n)&&n>=0&&n<=127)||keyboard.lowNote>keyboard.highNote||keyboard.rootNote<keyboard.lowNote||keyboard.rootNote>keyboard.highNote||!Number.isFinite(keyboard.tuneCents)||Math.abs(keyboard.tuneCents)>1200)throw new RangeError('Invalid sample keyboard map');
 const owner=useEditorBoundary([JSON.stringify([...controlIdentity(scope,revision),source.lengthSamples,source.sampleRate,disabledReason])]),guard=useScopedControl(owner,props,disabledReason!==undefined),off=guard.pending||disabledReason!==undefined;
 return <View {...rest} style={[{gap:12},style]} accessibilityLabel="Sample editor">
  <AudioClipTrimAndFade {...source} scope={owner+'region'} revision={revision} disabledReason={off?'Sample edit unavailable':undefined} unstyled={unstyled} onCommit={r=>guard.run('region',(h,s)=>h.onRegionCommit(r,s))}/>
  <LoopPunchRecording scope={owner+'loop'} revision={revision} durationSamples={source.lengthSamples} sampleRate={source.sampleRate} value={loop} recording={false} passCount={0} disabledReason={off?'Sample edit unavailable':undefined} unstyled={unstyled} onCommit={v=>guard.run('loop',(h,s)=>h.onLoopCommit(v,s))}/>
  <Text {...{className:unstyled?undefined:'text-text'}}>MIDI keyboard mapping</Text>
  {([{key:'lowNote',label:'Lowest mapped note',min:0,max:keyboard.rootNote},{key:'highNote',label:'Highest mapped note',min:keyboard.rootNote,max:127},{key:'rootNote',label:'Root note',min:keyboard.lowNote,max:keyboard.highNote},{key:'tuneCents',label:'Sample tuning',min:-1200,max:1200}] as const).map(f=>f.min<f.max?<PrecisionScrubber key={f.key} scope={owner+f.key} label={f.label} value={keyboard[f.key]} min={f.min} max={f.max} step={1} disabled={off} unstyled={unstyled} onCommit={n=>guard.run('mapping',(h,s)=>h.onKeyboardCommit({...h.keyboard,[f.key]:n},s))}/>:null)}
  <Button title={`Audition root note ${keyboard.rootNote}`} disabled={off} unstyled={unstyled} onPress={()=>guard.run('audition',(h,s)=>h.onAudition(h.keyboard.rootNote,s))}/>
  <ErrorMessage message={guard.error??disabledReason} unstyled={unstyled}/>
 </View>;
}
