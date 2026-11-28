import {Text,View,type ViewProps} from 'react-native';
import {NativeAudioTransport,type NativeAudioTransportProps} from '../audio/NativeAudioTransport.tsx';
import {LiveRecordingWaveform,type LiveRecordingWaveformProps} from '../audio/LiveRecordingWaveform.tsx';
import {Button} from '@nyc-tron/ui/components/Button';
import {ErrorMessage} from '@nyc-tron/ui/components/feedback/ErrorMessage';
import {controlIdentity,useScopedControl,type ScopedControlProps} from '../inputs/useScopedControl.ts';
export interface PDFVoiceNoteArtifact {id:string;label:string;durationSamples:number;sampleRate:number;mimeType:string;bytes:number}
export interface PDFVoiceNoteAttachmentProps extends Omit<ViewProps,'children'>,ScopedControlProps {
 pageId:string;anchor:{x:number;y:number};transport:Omit<NativeAudioTransportProps,'scope'|'revision'>;waveform?:LiveRecordingWaveformProps;
 artifact:PDFVoiceNoteArtifact|null;attachedArtifactId?:string;canAttach:boolean;
 onAttach:(request:{artifactId:string;pageId:string;anchor:{x:number;y:number}},signal?:AbortSignal)=>unknown;
 onDiscard:(artifactId:string,signal?:AbortSignal)=>unknown;unstyled?:boolean;
}
/** The same native recording session supplies transport, measured waveform and the real attachment artifact. */
export function PDFVoiceNoteAttachment({scope='pdf-voice-note',revision=0,...props}:PDFVoiceNoteAttachmentProps){
 const {pageId,anchor,transport,waveform,artifact,attachedArtifactId,canAttach,onAttach:_attach,onDiscard:_discard,unstyled=false,disabledReason,style,...rest}=props;
 if(!pageId.trim()||![anchor.x,anchor.y].every(n=>Number.isFinite(n)&&n>=0)||artifact&&(!artifact.id.trim()||!Number.isSafeInteger(artifact.durationSamples)||artifact.durationSamples<0||!Number.isSafeInteger(artifact.sampleRate)||artifact.sampleRate<1||artifact.sampleRate>768000||!Number.isSafeInteger(artifact.bytes)||artifact.bytes<1||!artifact.mimeType.startsWith('audio/')))throw new RangeError('Invalid PDF voice note metadata');
 const owner=JSON.stringify([...controlIdentity(scope,revision),pageId,anchor.x,anchor.y,artifact?.id,disabledReason]),guard=useScopedControl(owner,props,disabledReason!==undefined),off=guard.pending||disabledReason!==undefined||transport.recording,attached=!!artifact&&attachedArtifactId===artifact.id;
 return <View {...rest} style={[{gap:8},style]} accessibilityLabel="PDF voice note"><NativeAudioTransport {...transport} scope={scope} revision={revision} unstyled={unstyled} disabledReason={disabledReason??transport.disabledReason}/>{waveform?<LiveRecordingWaveform {...waveform} unstyled={unstyled}/>:null}
 <Text {...{className:unstyled?undefined:'text-text'}}>{artifact?artifact.label+' · '+(artifact.durationSamples/artifact.sampleRate).toFixed(2)+' s · '+artifact.bytes+' bytes':'No recorded audio artifact yet'}</Text>
 <Button title={attached?'Voice note attachment acknowledged':'Attach voice note to PDF page'} disabled={off||!artifact||!canAttach||attached} unstyled={unstyled} onPress={()=>guard.run('attach',(h,s)=>{if(!h.artifact||!h.canAttach||h.transport.recording||h.attachedArtifactId===h.artifact.id)throw new Error('Voice note is unavailable');return h.onAttach({artifactId:h.artifact.id,pageId:h.pageId,anchor:h.anchor},s);})}/>
 <Button title="Discard unattached recording" variant="secondary" disabled={off||!artifact||attached} unstyled={unstyled} onPress={()=>guard.run('discard',(h,s)=>h.artifact&&h.attachedArtifactId!==h.artifact.id&&!h.transport.recording?h.onDiscard(h.artifact.id,s):undefined)}/><ErrorMessage message={guard.error??disabledReason} unstyled={unstyled}/></View>;
}
